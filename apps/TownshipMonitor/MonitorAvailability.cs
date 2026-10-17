namespace TownshipMonitor;

[Flags]
internal enum UiOperation { None=0, Connect=1, Start=2, Pause=4, Options=8, Refresh=16, Restart=32, Close=64 }
internal sealed class MonitorUiOperations
{
    private UiOperation active;
    internal int Generation { get; private set; }
    internal bool Has(UiOperation operation) => (active & operation) != 0;
    internal void Invalidate() => Generation++;
    internal void Begin(UiOperation operation) { active |= operation; if (operation != UiOperation.Refresh) Invalidate(); }
    internal void End(UiOperation operation) { active &= ~operation; if (operation != UiOperation.Refresh) Invalidate(); }
}
internal sealed record MonitorAvailability(bool Connect, bool Start, bool Pause, bool Refresh, bool Restart, bool EditPaths, bool DeliveryOptions)
{
    internal static MonitorAvailability Compute(MonitorUiOperations local, bool connected, bool workerBusy, bool producer,
        bool deliveryRunning, bool native, bool inputPending)
    {
        var blocked=local.Has(UiOperation.Restart | UiOperation.Close);
        var changing=local.Has(UiOperation.Options | UiOperation.Connect);
        var busy=workerBusy || local.Has(UiOperation.Start);
        return new(!blocked && !busy && !changing,
            connected && !blocked && !busy && !producer && !changing,
            connected && !blocked && !local.Has(UiOperation.Pause),
            connected && !blocked,
            !blocked && !changing && !local.Has(UiOperation.Pause) && !deliveryRunning,
            !blocked && !busy && !changing,
            connected && native && !blocked && !busy && !producer && !deliveryRunning && !changing && !local.Has(UiOperation.Pause) && !inputPending);
    }
}
