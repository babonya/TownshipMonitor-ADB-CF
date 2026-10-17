using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace TownshipMonitor;

internal sealed record RestartResult(bool Ok, string Status, string? Error = null,
    int? ReplacementPid = null, string? ReplacementStarted = null);

// One endpoint per process incarnation; no discovery files, game commands or retries.
internal sealed class MonitorControl : IDisposable
{
    private readonly CancellationTokenSource stopping = new();
    private readonly Func<Task<RestartResult>> restart;
    private readonly Action closeAfterReply;
    private readonly Action<string> log;
    private readonly int processId;
    private readonly string started;
    internal Task Completion { get; }

    internal static string PipeName(int processId, string started) => $"TownshipMonitor-{processId}-{started}";

    internal MonitorControl(Func<Task<RestartResult>> restart, Action closeAfterReply, Action<string> log)
    {
        this.restart = restart; this.closeAfterReply = closeAfterReply; this.log = log;
        using var current = Process.GetCurrentProcess();
        processId = current.Id; started = current.StartTime.ToUniversalTime().Ticks.ToString();
        Completion = Task.Run(Listen);
    }

    private async Task Listen()
    {
        while (!stopping.IsCancellationRequested)
        {
            RestartResult? result = null;
            try
            {
                using var pipe = new NamedPipeServerStream(PipeName(processId, started), PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stopping.Token);
                using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 1024, leaveOpen: true);
                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true);
                using var readLimit = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
                readLimit.CancelAfter(TimeSpan.FromSeconds(5));
                var line = await ReadRequest(reader, readLimit.Token);
                using var document = JsonDocument.Parse(line);
                var request = document.RootElement;
                var requestId = request.GetProperty("requestId").GetString();
                if (!Guid.TryParseExact(requestId, "D", out _) ||
                    request.GetProperty("op").GetString() != "restart" ||
                    request.GetProperty("targetPid").GetInt32() != processId ||
                    request.GetProperty("targetStarted").GetString() != started)
                    throw new IOException("MONITOR_CONTROL_REQUEST_INVALID");
                result = await restart();
                var response = JsonSerializer.Serialize(new { requestId, targetPid = processId, targetStarted = started,
                    ok = result.Ok, status = result.Status, error = result.Error,
                    replacementPid = result.ReplacementPid, replacementStarted = result.ReplacementStarted });
                using var writeLimit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await writer.WriteLineAsync(response.AsMemory(), writeLimit.Token);
                await writer.FlushAsync(writeLimit.Token);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested) { return; }
            catch (Exception ex) { log("Local restart control: " + ex.Message); }
            finally
            {
                // A lost reply must never leave the launched child waiting forever for us.
                if (result?.Ok == true) closeAfterReply();
            }
            if (result?.Ok == true) return;
        }
    }

    private static async Task<string> ReadRequest(StreamReader reader, CancellationToken token)
    {
        var value = new StringBuilder(); var buffer = new char[1];
        while (value.Length < 4096)
        {
            if (await reader.ReadAsync(buffer.AsMemory(), token) == 0) throw new IOException("MONITOR_CONTROL_EOF");
            if (buffer[0] == '\n') return value.ToString();
            value.Append(buffer[0]);
        }
        throw new IOException("MONITOR_CONTROL_REQUEST_TOO_LARGE");
    }

    public void Dispose() => stopping.Cancel();
}
