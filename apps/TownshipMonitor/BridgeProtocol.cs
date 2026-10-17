using System.Text.Json;
namespace TownshipMonitor;

internal enum BridgePhase { Accepting, ShutdownRequested, ProtocolClosed, ExitConfirmed, OutcomeUncertain }
// Mutated under BridgeClient's lifecycle lock. Pipe EOF is not process exit.
internal sealed class BridgeLifetime
{
    internal BridgePhase Phase { get; private set; } = BridgePhase.Accepting;
    internal bool ProtocolClosed { get; private set; }
    internal bool Accepting => Phase == BridgePhase.Accepting && !ProtocolClosed;
    internal void RequestShutdown() => Phase=BridgePhase.ShutdownRequested;
    internal void RejectShutdown() { if (!ProtocolClosed) Phase=BridgePhase.Accepting; else Phase=BridgePhase.ProtocolClosed; }
    internal void CloseProtocol() { ProtocolClosed=true; if (Phase==BridgePhase.Accepting) Phase=BridgePhase.ProtocolClosed; }
    internal void Uncertain() => Phase=BridgePhase.OutcomeUncertain;
    internal void ConfirmExit() => Phase=BridgePhase.ExitConfirmed;
}
internal sealed record BridgeMessage(int? Id, JsonElement Value, string? Event)
{
    internal static BridgeMessage Parse(string line)
    {
        using var document=JsonDocument.Parse(line);var value=document.RootElement;
        if (value.TryGetProperty("event",out var ev)) return new(null,default,ev.GetRawText());
        int? id=value.TryGetProperty("id",out var identifier) && identifier.ValueKind==JsonValueKind.Number ? identifier.GetInt32() : null;
        return new(id,value.Clone(),null);
    }
}
