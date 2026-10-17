namespace TownshipDesktopBridge;

// Exactly one authorized animation skip at the already-bound Send point. No
// retries: a failed second guard leaves the first click's outcome unresolved.
internal static class HelicopterSendSequence
{
    internal static void Execute(Action tap,Action beginTimer,Action<int> wait,Action guard,Func<long> elapsedMs)
    {
        tap();beginTimer();wait(100);guard();
        // A delayed helper must not turn the skip into a later order's Send.
        if(elapsedMs()>250)throw new InvalidOperationException("INPUT_SEQUENCE_WINDOW_EXPIRED");
        tap();
    }
}
