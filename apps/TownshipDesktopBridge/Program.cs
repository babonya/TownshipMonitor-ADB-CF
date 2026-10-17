using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace TownshipDesktopBridge;

internal static class Program
{
    static JsonNode? inputFailure;
    static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static void Require(bool ok,string reason){if(!ok)throw new InvalidOperationException(reason);}
    static T Read<T>(JsonNode n,string name)=>n[name]!.GetValue<T>();
    static object Box(Native.Rect r)=>new{x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top};
    static JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,Json)!;
    static JsonNode Describe(nint hwnd)=>WindowCapture.Describe(hwnd);
    static JsonNode Verify(JsonNode target)=>WindowCapture.Verify(target);
    static bool SameGeometry(JsonNode a,JsonNode b)=>WindowCapture.SameGeometry(a,b);
    static Task<JsonNode> Capture(JsonNode target)=>WindowCapture.Capture(target);
    static void Permit(JsonNode request)
    {
        var permit=request["permit"]!;var bytes=File.ReadAllBytes(Read<string>(permit,"statePath"));
        Require(Hash(bytes)==Read<string>(permit,"sha256"),"INPUT_STATE_CHANGED");
        var envelope=JsonNode.Parse(bytes)!;var s=envelope["state"]!;
        Require(s["stopCapture"]?.GetValue<bool>()!=true&&s["stopReader"]?.GetValue<bool>()!=true,"SESSION_STOPPED");
        var actionId=Read<string>(permit,"actionId");Require(s["input"]?.GetValue<string>()==actionId,"INPUT_NOT_OWNED");
        var a=s["actions"]?[actionId];Require(a?["status"]?.GetValue<string>()=="pending","ACTION_NOT_PENDING");
        Require(JsonNode.DeepEquals(a!["command"],request["action"]),"INPUT_COMMAND_CHANGED");
        Require(JsonNode.DeepEquals(s["session"]?["windowsTarget"],request["target"]),"INPUT_TARGET_CHANGED");
        Require(JsonNode.DeepEquals(s["session"]?["windowsViewport"],request["viewport"]),"INPUT_VIEWPORT_CHANGED");
        Require(JsonNode.DeepEquals(a?["percentageCommand"],request["coordinates"]),"INPUT_PERCENTAGE_COMMAND_CHANGED");
        PercentageInput(request);
        Require(JsonNode.DeepEquals(InputContracts.InputEvidence(s,a!)["captureTarget"],request["expected"]),"INPUT_PREFLIGHT_CHANGED");
        if(InputContracts.ValidateSequence(request,s,a!))
        {
            var root=Path.GetDirectoryName(Path.GetFullPath(Read<string>(permit,"statePath")))!;
            var owner=CaptureOwnerFile.Read(Path.Combine(root,"capture.lock"));
            InputContracts.ValidateSequenceOwner(request["inputSequence"]!,a!,owner,
                File.Exists(Path.Combine(root,".management","runner.lock"))||File.Exists(Path.Combine(root,"helicopter-runner.lock")));
            try{using var producer=Process.GetProcessById(Read<int>(owner,"pid"));Require(!producer.HasExited,"CAPTURE_PRODUCER_NOT_OWNED");}
            catch(ArgumentException){throw new InvalidOperationException("CAPTURE_PRODUCER_NOT_OWNED");}
        }
    }
    static void PercentageInput(JsonNode request)=>InputContracts.ValidatePercentage(new(request));
    static void InputTarget(JsonNode request,Native.Point point,bool checkButtons)
    {
        Permit(request);var actual=Verify(request["target"]!);Require(SameGeometry(actual,request["expected"]!),"INPUT_GEOMETRY_CHANGED");
        // A visible inactive window can receive the click directly. The hit
        // window, identity and geometry determine the recipient, not focus.
        var hwnd=(nint)Read<long>(request["target"]!,"hwnd");
        var hit=Native.WindowFromPoint(point);Require(hit!=0&&Native.GetAncestor(hit,2)==hwnd,"INPUT_TARGET_OCCLUDED");
        foreach(var key in new[]{2,4,16,17,18,91,92})Require((Native.GetAsyncKeyState(key)&0x8000)==0,"USER_INPUT_ACTIVE");
        if(checkButtons)Require((Native.GetAsyncKeyState(1)&0x8000)==0,"USER_INPUT_ACTIVE");
    }
    static Native.Input Move(Native.Point point,JsonNode expected)
    {
        var d=expected["virtualDesktop"]!;int w=Read<int>(d,"width"),h=Read<int>(d,"height"),x=point.X-Read<int>(d,"x"),y=point.Y-Read<int>(d,"y");
        Require(w>1&&h>1&&x>=0&&y>=0&&x<w&&y<h,"INPUT_OUTSIDE_DESKTOP");
        return new Native.Input{Mouse=new Native.Mouse{X=(int)Math.Round(x*65535.0/(w-1)),Y=(int)Math.Round(y*65535.0/(h-1)),Flags=0x8001|0x4000,Extra=0x54574e53}};
    }
    static JsonNode Input(JsonNode r)
    {
        using var mutex=new Mutex(false,"Local\\TownshipDesktopInput-v1");var startedAt=DateTimeOffset.UtcNow;
        var actionId=Read<string>(r["permit"]!,"actionId");var execution=new InputExecutionContext(actionId,startedAt);
        Require(System.Text.RegularExpressions.Regex.IsMatch(actionId,@"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$"),"ACTION_ID_INVALID");
        JsonNode Receipt()=>Node(execution.Receipt(DateTimeOffset.UtcNow));
        void SendEvents(params Native.Input[] events)
        {
            execution.Send(events.Length,()=>Native.SendInput((uint)events.Length,events,Marshal.SizeOf<Native.Input>()));
        }
        try
        {
            try{execution.MutexOwned=mutex.WaitOne(0);}catch(AbandonedMutexException){execution.MutexOwned=true;throw new InvalidOperationException("INPUT_OWNER_ABANDONED");}
            Require(execution.MutexOwned,"DESKTOP_INPUT_BUSY");var plan=NativeInputPlan.Parse(new(r));
            var type=plan.Kind;var expected=plan.Expected;var duration=plan.Duration;
            var sendSequence=r["inputSequence"]!=null;
            execution.PlannedClicks=type=="tap"?(sendSequence?2:1):0;
            var first=new Native.Point(plan.First.X,plan.First.Y);var last=new Native.Point(plan.Last.X,plan.Last.Y);
            InputTarget(r,first,true);if(type=="swipe")InputTarget(r,last,true);
            var state=JsonNode.Parse(File.ReadAllBytes(Read<string>(r["permit"]!,"statePath")))!["state"]!;
            InputContracts.ValidateInputTiming(state,state["actions"]![actionId]!,DateTimeOffset.UtcNow);
            Require(Native.GetCursorPos(out var idle),"POINTER_UNAVAILABLE");Thread.Sleep(100);
            Require(Native.GetCursorPos(out var current)&&current.X==idle.X&&current.Y==idle.Y,"USER_POINTER_ACTIVE");
            InputTarget(r,first,true);
            var directory=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(Read<string>(r["permit"]!,"statePath")))!,"desktop-input");
            Directory.CreateDirectory(directory);
            var path=Path.Combine(directory,Hash(System.Text.Encoding.UTF8.GetBytes(actionId))+".json");
            using(var file=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.Read))
            {var bytes=System.Text.Encoding.UTF8.GetBytes(Node(new{actionId,status="dispatching",gameResultVerified=false}).ToJsonString());file.Write(bytes);file.Flush(true);}
            execution.AuditPath=path;Permit(r);
            if(type=="tap")
            {
                void Tap(){execution.ButtonDown=true;SendEvents(Move(first,expected),new(){Mouse=new(){Flags=2,Extra=0x54574e53}},new(){Mouse=new(){Flags=4,Extra=0x54574e53}});execution.ButtonDown=false;execution.CompleteClick();}
                if(sendSequence)
                {
                    var timer=new Stopwatch();
                    HelicopterSendSequence.Execute(Tap,timer.Restart,Thread.Sleep,()=>{
                        Require(Native.GetCursorPos(out var cursor)&&Math.Abs(cursor.X-first.X)<=1&&Math.Abs(cursor.Y-first.Y)<=1,"POINTER_CHANGED_DURING_SEND");
                        InputTarget(r,first,true);
                    },()=>timer.ElapsedMilliseconds);
                }
                else Tap();
            }
            else
            {
                execution.ButtonDown=true;SendEvents(Move(first,expected),new(){Mouse=new(){Flags=2,Extra=0x54574e53}});
                var timer=Stopwatch.StartNew();var previous=first;
                while(timer.ElapsedMilliseconds<duration)
                {
                    Thread.Sleep(16);Require(Native.GetCursorPos(out var cursor)&&Math.Abs(cursor.X-previous.X)<=1&&Math.Abs(cursor.Y-previous.Y)<=1,"POINTER_CHANGED_DURING_DRAG");
                    double t=Math.Min(1,timer.Elapsed.TotalMilliseconds/duration);var point=new Native.Point((int)Math.Round(first.X+(last.X-first.X)*t),(int)Math.Round(first.Y+(last.Y-first.Y)*t));
                    InputTarget(r,point,false);SendEvents(Move(point,expected));previous=point;
                }
                SendEvents(new Native.Input{Mouse=new(){Flags=4,Extra=0x54574e53}});execution.ButtonDown=false;
            }
            return Receipt();
        }
        catch(Exception e){execution.Failure=e.Message;throw;}
        finally
        {
            // This is completion/cleanup of the owned gesture, never a second game action.
            execution.ReleaseButton(()=>Native.SendInput(1,new[]{new Native.Input{Mouse=new(){Flags=4,Extra=0x54574e53}}},Marshal.SizeOf<Native.Input>()));
            if(execution.Failure!=null)inputFailure=Receipt();
            if(execution.AuditPath!=null)
            {
                var temp=execution.AuditPath+".tmp";
                try{File.WriteAllText(temp,Receipt().ToJsonString());File.Move(temp,execution.AuditPath,true);}catch{}
            }
            if(execution.MutexOwned)mutex.ReleaseMutex();
        }
    }
    static async Task<int> Main()
    {
        Console.InputEncoding=new System.Text.UTF8Encoding(false);
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        try
        {
            Require(Native.SetProcessDpiAwarenessContext((nint)(-4)),"PER_MONITOR_DPI_REQUIRED");
            var text=await Console.In.ReadToEndAsync();Require(text.Length<131072,"REQUEST_TOO_LARGE");var request=JsonNode.Parse(text)!;
            JsonNode result;
            switch(Read<string>(request,"op"))
            {
                case "list":
                    var windows=new List<JsonNode>();Native.EnumWindows((hwnd,_)=>{try{if(Native.Title(hwnd).Contains("Township",StringComparison.OrdinalIgnoreCase)){var d=Describe(hwnd);if(Path.GetFileName(Read<string>(d,"processPath")).Equals("crosvm.exe",StringComparison.OrdinalIgnoreCase))windows.Add(d);}}catch{}return true;},0);result=Node(windows);break;
                case "describe":result=Verify(request["target"]!);break;
                case "capture":result=await Capture(request["target"]!);break;
                case "input":result=Input(request);break;
                default:throw new InvalidOperationException("OPERATION_UNSUPPORTED");
            }
            Console.Write(JsonSerializer.Serialize(new{ok=true,result},Json));return 0;
        }
        catch(Exception e){Console.Error.WriteLine(e);Console.Write(JsonSerializer.Serialize(new{ok=false,error=e.Message,inputReceipt=inputFailure},Json));return 1;}
    }
}
