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

internal static class WindowCapture
{
    static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static void Require(bool ok,string reason){if(!ok)throw new InvalidOperationException(reason);}
    static T Read<T>(JsonNode n,string name)=>n[name]!.GetValue<T>();
    static object Box(Native.Rect r)=>new{x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top};
    static JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,Json)!;
    internal static JsonNode Describe(nint hwnd)
    {
        Require(Native.IsWindow(hwnd)&&Native.IsWindowVisible(hwnd)&&!Native.IsIconic(hwnd),"WINDOW_UNAVAILABLE");
        Native.GetWindowThreadProcessId(hwnd,out var pid);using var p=Process.GetProcessById((int)pid);
        Require(Native.DwmInt(hwnd,14,out var cloaked,4)==0&&cloaked==0,"WINDOW_CLOAKED");
        Require(Native.DwmGetWindowAttribute(hwnd,9,out var bounds,16)==0,"WINDOW_BOUNDS_UNKNOWN");
        Require(Native.GetClientRect(hwnd,out var client),"CLIENT_BOUNDS_UNKNOWN");
        var origin=new Native.Point(0,0);Require(Native.ClientToScreen(hwnd,ref origin),"CLIENT_ORIGIN_UNKNOWN");
        Require(bounds.Right>bounds.Left&&bounds.Bottom>bounds.Top,"WINDOW_EMPTY");
        return Node(new{hwnd=hwnd.ToInt64(),pid,processStartedTicks=p.StartTime.ToUniversalTime().Ticks.ToString(),processPath=p.MainModule!.FileName,
            title=Native.Title(hwnd),isForeground=Native.GetForegroundWindow()==hwnd,bounds=Box(bounds),client=new{x=origin.X,y=origin.Y,width=client.Right,height=client.Bottom},dpi=Native.GetDpiForWindow(hwnd),
            virtualDesktop=new{x=Native.GetSystemMetrics(76),y=Native.GetSystemMetrics(77),width=Native.GetSystemMetrics(78),height=Native.GetSystemMetrics(79)}});
    }
    internal static JsonNode Verify(JsonNode target)
    {
        var actual=Describe((nint)Read<long>(target,"hwnd"));
        foreach(var key in new[]{"hwnd","pid","processStartedTicks","processPath","title"})Require(JsonNode.DeepEquals(actual[key],target[key]),"WINDOW_IDENTITY_CHANGED:"+key);
        return actual;
    }
    internal static bool SameGeometry(JsonNode a,JsonNode b)=>new[]{"bounds","client","dpi","virtualDesktop"}.All(k=>JsonNode.DeepEquals(a[k],b[k]));
    internal static async Task<JsonNode> Capture(JsonNode target)
    {
        var elapsed=Stopwatch.StartNew();long nullFrames=0,oldFrames=0,minTicks=0,lastFrameTicks=0,nextTraceMs=0;
        void Trace(string phase,JsonNode? verifiedTarget=null)
        {
            // Capture diagnostics only: never include pixels, input permits or requests.
            try{Console.Error.WriteLine(JsonSerializer.Serialize(new{diagnostic="capture-v1",phase,
                at=DateTimeOffset.UtcNow.ToString("O"),elapsedMs=elapsed.ElapsedMilliseconds,nullFrames,oldFrames,
                minQpcTicks=minTicks.ToString(),lastFrameTicks=lastFrameTicks.ToString(),target=verifiedTarget},Json));}catch{}
        }
        Trace("target.verify.before");
        try
        {
        var before=Verify(target);Trace("target.verified",before);var startedAt=DateTimeOffset.UtcNow;minTicks=(long)(Stopwatch.GetTimestamp()*(10000000.0/Stopwatch.Frequency));
        Trace("wgc.support");
        Require(GraphicsCaptureSession.IsSupported(),"WGC_UNSUPPORTED");
        Trace("device.create");using var device=Native.CreateDevice();
        Trace("item.create");var item=Native.CreateItem((nint)Read<long>(target,"hwnd"));
        Trace("pool.create");
        using var pool=Direct3D11CaptureFramePool.CreateFreeThreaded(device,DirectXPixelFormat.B8G8R8A8UIntNormalized,2,item.Size);
        Trace("session.create");using var session=pool.CreateCaptureSession(item);session.IsCursorCaptureEnabled=false;
        Trace("session.start");session.StartCapture();
        var deadline=Stopwatch.StartNew();
        Trace("frame.poll");
        while(deadline.ElapsedMilliseconds<4000)
        {
            if(elapsed.ElapsedMilliseconds>=nextTraceMs){Trace("frame.poll");nextTraceMs=elapsed.ElapsedMilliseconds+500;}
            using var frame=pool.TryGetNextFrame();
            if(frame==null){nullFrames++;await Task.Delay(15);continue;}
            lastFrameTicks=frame.SystemRelativeTime.Ticks;
            if(lastFrameTicks<minTicks){oldFrames++;continue;}
            Trace("frame.fresh");
            var size=frame.ContentSize;Require(size.Width==Read<int>(before["bounds"]!,"width")&&size.Height==Read<int>(before["bounds"]!,"height"),"WGC_GEOMETRY_MISMATCH");
            Trace("surface.copy");
            using var bitmap=await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface,BitmapAlphaMode.Ignore);
            Require(bitmap.PixelWidth==size.Width&&bitmap.PixelHeight==size.Height,"WGC_SURFACE_SIZE_MISMATCH");
            var bytes=await EncodePng(bitmap,phase=>Trace(phase));
            Trace("target.verify.after");
            var after=Verify(target);Require(SameGeometry(before,after),"WINDOW_CHANGED_DURING_CAPTURE");
            Trace("result.encode");
            var result=Node(new{bytes=Convert.ToBase64String(bytes),sha256=Hash(bytes),width=size.Width,height=size.Height,startedAt=startedAt.ToString("O"),
                observedAt=DateTimeOffset.UtcNow.ToString("O"),sourceQpcTicks=frame.SystemRelativeTime.Ticks.ToString(),captureTarget=after});
            Trace("capture.release");return result;
        }
        Trace("frame.timeout");
        throw new InvalidOperationException("WGC_FRESH_FRAME_TIMEOUT");
        }
        catch{Trace("capture.error");throw;}
        finally{Trace("capture.end");}
    }
    private static async Task<byte[]> EncodePng(SoftwareBitmap bitmap,Action<string> trace)
    {
            trace("encoder.create");
            using var stream=new InMemoryRandomAccessStream();var encoder=await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId,stream);
            trace("encoder.set");encoder.SetSoftwareBitmap(bitmap);trace("encoder.flush");await encoder.FlushAsync();stream.Seek(0);
            trace("stream.read");
            using var reader=new DataReader(stream.GetInputStreamAt(0));await reader.LoadAsync((uint)stream.Size);var bytes=new byte[stream.Size];reader.ReadBytes(bytes);
            return bytes;
    }
}
