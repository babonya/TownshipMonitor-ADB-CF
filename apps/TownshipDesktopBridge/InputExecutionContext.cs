namespace TownshipDesktopBridge;

// A synchronous Input invocation is the sole owner. This context never retries
// a gesture; a release is cleanup of its own button-down only.
internal sealed class InputExecutionContext(string actionId,DateTimeOffset startedAt)
{
    internal bool MutexOwned { get; set; }
    internal bool ButtonDown { get; set; }
    internal string? AuditPath { get; set; }
    internal string? Failure { get; set; }
    internal int Attempted { get; private set; }
    internal int Inserted { get; private set; }
    internal uint ReleaseInserted { get; private set; }
    internal int PlannedClicks { get; set; }
    internal int CompletedClicks { get; private set; }
    internal void CompleteClick()=>CompletedClicks++;
    internal void Send(int count,Func<uint> insert)
    {
        Attempted+=count;var sent=insert();Inserted+=(int)sent;
        if(sent!=count)throw new InvalidOperationException("INPUT_PARTIAL_OR_BLOCKED");
    }
    internal void ReleaseButton(Func<uint> release)
    {
        if(!ButtonDown)return;
        ButtonDown=false;ReleaseInserted=release();
    }
    internal NativeInputReceipt Receipt(DateTimeOffset completedAt)=>new(actionId,
        Failure==null?"issued":Attempted==0?"not_issued":"unknown",Attempted,Inserted,ReleaseInserted,Failure,
        startedAt.ToString("O"),completedAt.ToString("O"),false,PlannedClicks,CompletedClicks);
}
