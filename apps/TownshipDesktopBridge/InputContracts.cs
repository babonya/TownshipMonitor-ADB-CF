using System.Text.Json.Nodes;
namespace TownshipDesktopBridge;
// The original JSON tree is the contract input; this projection is never hashed or serialized as a replacement permit.
internal sealed record NativeInputRequest(JsonNode Raw)
{
    internal JsonNode Action=>Raw["action"]!;
    internal JsonNode Expected=>Raw["expected"]!;
    internal JsonNode Viewport=>Raw["viewport"]!;
}
internal sealed record NativeInputReceipt(string ActionId,string Status,int Attempted,int Inserted,uint ReleaseInserted,string? Error,string StartedAt,string CompletedAt,bool GameResultVerified,int PlannedClicks,int CompletedClicks);
internal sealed record NativeInputPlan(string Kind,(int X,int Y) First,(int X,int Y) Last,int Duration,JsonNode Expected)
{
    internal static NativeInputPlan Parse(NativeInputRequest request)
    {
        var a=request.Action;var expected=request.Expected;var viewport=request.Viewport;
        string type=a["type"]!.GetValue<string>();if(type is not ("tap" or "swipe"))throw new InvalidOperationException("INPUT_TYPE_UNSUPPORTED");
        var first=InputContracts.ScreenPoint(expected,viewport,a[type=="tap"?"x":"x1"]!.GetValue<int>(),a[type=="tap"?"y":"y1"]!.GetValue<int>());
        var last=type=="tap"?first:InputContracts.ScreenPoint(expected,viewport,a["x2"]!.GetValue<int>(),a["y2"]!.GetValue<int>());
        int duration=type=="tap"?0:a["durationMs"]!.GetValue<int>();if(type=="swipe" && (duration<200 || duration>2000))throw new InvalidOperationException("DRAG_DURATION_INVALID");
        return new(type,first,last,duration,expected);
    }
}
internal static class InputContracts
{
    static void Require(bool ok,string reason){if(!ok)throw new InvalidOperationException(reason);}
    static T Read<T>(JsonNode n,string name)=>n[name]!.GetValue<T>();
    internal static JsonNode InputEvidence(JsonNode state,JsonNode action)
    {
        var proof=action["somProof"];
        if(proof?["inputMode"]==null)return action["preflightEvidence"]!;
        var id=action["frameId"]?.GetValue<string>();
        var frame=id==null?null:state["frames"]?[id];
        var kind=action["target"]?["kind"]?.GetValue<string>();
        Require(proof["inputMode"]?.GetValue<string>()=="source_observation"&&
            state["settings"]?["workflowMode"]?.GetValue<string>()=="som"&&state["session"]?["provider"]?.GetValue<string>()=="google_play_windows"&&
            kind?.StartsWith("som_",StringComparison.Ordinal)==true&&action["target"]?["som"]?["kind"]?.GetValue<string>()==kind&&frame!=null&&
            frame["id"]?.GetValue<string>()==id&&state["latestFrameId"]?.GetValue<string>()==id&&proof["frameId"]?.GetValue<string>()==id&&
            proof["evidenceHash"]?.GetValue<string>()==frame["evidenceHash"]?.GetValue<string>()&&
            action["coordinateSource"]?["frameId"]?.GetValue<string>()==id&&action["coordinateSource"]?["evidenceHash"]?.GetValue<string>()==frame["evidenceHash"]?.GetValue<string>()&&
            state["scene"]?["epoch"]?.GetValue<int>()==action["epoch"]?.GetValue<int>()&&frame["epoch"]?.GetValue<int>()+1==action["epoch"]?.GetValue<int>()&&
            !(state["observationInvalidation"]?["sequence"]?.GetValue<int>()>=frame["sequence"]?.GetValue<int>()),"INPUT_OBSERVATION_CHANGED");
        return frame!;
    }
    internal static void ValidateInputTiming(JsonNode state,JsonNode action,DateTimeOffset now)
    {
        var evidence=InputEvidence(state,action);
        var observed=DateTimeOffset.Parse(Read<string>(evidence,"observedAt"));
        if(action["somProof"]?["inputMode"]?.GetValue<string>()=="source_observation")
        {
            // Planning may include model comparisons. Bound dispatch latency to
            // the reservation, without relabeling the source capture as fresh.
            var decided=DateTimeOffset.Parse(Read<string>(action,"at"));
            var reserved=DateTimeOffset.Parse(Read<string>(action,"inputReservedAt"));
            Require(observed<=decided&&decided<=reserved&&reserved<=now&&now-reserved<TimeSpan.FromSeconds(5),"INPUT_OBSERVATION_EXPIRED");
        }
        else Require(now>=observed&&now-observed<TimeSpan.FromSeconds(5),"INPUT_PREFLIGHT_EXPIRED");
    }
    internal static bool ValidateSequence(JsonNode request,JsonNode state,JsonNode action)
    {
        var sequence=request["inputSequence"];
        Require(JsonNode.DeepEquals(sequence,action["inputSequence"]),"INPUT_SEQUENCE_CHANGED");
        if(sequence==null)return false;
        Require(sequence is JsonObject obj&&obj.Count==4&&sequence["kind"]?.GetValue<string>()=="som_helicopter_send_skip"&&
            sequence["delayMs"]?.GetValue<int>()==100&&sequence["clickCount"]?.GetValue<int>()==2&&sequence["ownerPid"]?.GetValue<int>()>0,
            "INPUT_SEQUENCE_INVALID");
        var target=action["target"];var intent=target?["som"];
        Require(action["command"]?["type"]?.GetValue<string>()=="tap"&&target?["kind"]?.GetValue<string>()=="som_send"&&
            intent?["kind"]?.GetValue<string>()=="som_send"&&intent?["next"]?.GetValue<string>()=="helicopter"&&
            !string.IsNullOrWhiteSpace(intent?["orderHash"]?.GetValue<string>())&&!string.IsNullOrWhiteSpace(action["somProof"]?["ownerToken"]?.GetValue<string>()),"INPUT_SEQUENCE_SCOPE_INVALID");
        Require(state["settings"]?["workflowMode"]?.GetValue<string>()=="som"&&state["session"]?["provider"]?.GetValue<string>()=="google_play_windows"&&
            state["session"]?["management"]?["source"]?.GetValue<string>()=="explicit_user"&&state["session"]?["management"]?["scope"]?.GetValue<string>()=="transport_no_tcash"&&
            state["session"]?["management"]?["policy"]?["tcash"]?.GetValue<string>()=="forbidden","INPUT_SEQUENCE_AUTHORITY_CHANGED");
        return true;
    }
    internal static void ValidateSequenceOwner(JsonNode sequence,JsonNode action,JsonNode owner,bool foreignOwner)
    {
        Require(owner["token"]?.GetValue<string>()==action["somProof"]?["ownerToken"]?.GetValue<string>()&&
            owner["pid"]?.GetValue<int>()==sequence["ownerPid"]?.GetValue<int>(),"CAPTURE_PRODUCER_NOT_OWNED");
        Require(!foreignOwner,"FOREIGN_INPUT_OWNER");
    }
    internal static void ValidatePercentage(NativeInputRequest input)
    {
        var request=input.Raw;var c=request["coordinates"];var geometry=c?["geometry"];var viewport=request["viewport"]!;
        Require(c!=null&&Read<int>(c,"schema")==1&&Read<string>(c,"unit")=="fraction"&&Read<string>(c,"space")=="game","INPUT_PERCENTAGE_REQUIRED");
        Require(JsonNode.DeepEquals(geometry?["viewport"],viewport)&&Read<int>(geometry!["capture"]!,"width")==Read<int>(request["expected"]!["bounds"]!,"width")&&Read<int>(geometry["capture"]!,"height")==Read<int>(request["expected"]!["bounds"]!,"height"),"INPUT_PERCENTAGE_GEOMETRY_CHANGED");
        var normalized=c!["command"]!;var physical=request["action"]!;var type=Read<string>(normalized,"type");
        Require(type==Read<string>(physical,"type")&&(type=="tap"||type=="swipe"),"INPUT_PERCENTAGE_COMMAND_CHANGED");
        void Match(string field,string axis,string size)
        {
            var fraction=Read<double>(normalized,field);Require(double.IsFinite(fraction)&&fraction>=0&&fraction<1,"INPUT_PERCENTAGE_INVALID");
            int value=Read<int>(viewport,axis)+(int)Math.Floor(fraction*Read<int>(viewport,size)+.5);
            Require(value==Read<int>(physical,field),"INPUT_PERCENTAGE_COMMAND_CHANGED");
        }
        if(type=="tap"){Match("x","x","width");Match("y","y","height");}
        else{Match("x1","x","width");Match("y1","y","height");Match("x2","x","width");Match("y2","y","height");Require(Read<int>(normalized,"durationMs")==Read<int>(physical,"durationMs"),"INPUT_PERCENTAGE_COMMAND_CHANGED");}
    }
    internal static (int X,int Y) ScreenPoint(JsonNode expected,JsonNode viewport,int x,int y)
    {
        Require(x>=Read<int>(viewport,"x")&&y>=Read<int>(viewport,"y")&&x<Read<int>(viewport,"x")+Read<int>(viewport,"width")&&y<Read<int>(viewport,"y")+Read<int>(viewport,"height"),"INPUT_OUTSIDE_GAME_VIEWPORT");
        return (Read<int>(expected["bounds"]!,"x")+x,Read<int>(expected["bounds"]!,"y")+y);
    }
}
