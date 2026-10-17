using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
namespace TownshipMonitor;
internal sealed class BridgeClient : IDisposable
{
    private sealed class RequestRejected(string message) : InvalidOperationException(message);
    private readonly Process process;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> pending = new();
    private readonly SemaphoreSlim writer = new(1, 1);
    private readonly object lifecycle = new();
    private readonly Task output, errors;
    private Task? shutdown;
    private readonly BridgeLifetime lifetime = new();
    private int disposed;
    private int sequence;
    public event Action<string>? Log;
    internal bool HasExited => process.HasExited;
    internal bool CanSend { get { lock (lifecycle) return disposed == 0 && lifetime.Accepting && !process.HasExited; } }
    internal BridgePhase Phase { get { lock (lifecycle) return lifetime.Phase; } }
    internal int ProcessId => process.Id;
    public BridgeClient(string root)
    {
        var info = new ProcessStartInfo("node") { WorkingDirectory = root, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            StandardInputEncoding = new UTF8Encoding(false) };
        info.ArgumentList.Add(Path.Combine(root, "tools", "mumu-monitor-cli.mjs")); info.ArgumentList.Add("--bridge");
        process = Process.Start(info) ?? throw new InvalidOperationException("Node 실행 실패");
        output = ReadOutput(); errors = ReadErrors();
    }
    public Task<JsonElement> SendAsync(string op, object? args = null)
    {
        lock (lifecycle)
        {
            if (!lifetime.Accepting || disposed != 0) throw new InvalidOperationException("MONITOR_SHUTTING_DOWN");
            return SendCoreAsync(op,args);
        }
    }
    private async Task<JsonElement> SendCoreAsync(string op, object? args)
    {
        var id = Interlocked.Increment(ref sequence);
        var source = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously); pending[id] = source;
        try
        {
            await writer.WaitAsync();
            try
            {
                lock (lifecycle) if (lifetime.ProtocolClosed || disposed != 0) throw new IOException("조회 프로그램 연결 종료");
                await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { id, op, args })); await process.StandardInput.FlushAsync();
            }
            finally { writer.Release(); }
            JsonElement message;
            try { message = await source.Task.WaitAsync(TimeSpan.FromSeconds(op == "start" ? 45 : 15)); }
            catch (TimeoutException) { throw new TimeoutException($"MONITOR_REQUEST_TIMEOUT: {op} (id={id}) · 응답 지연; 요청 취소나 작업 종료를 뜻하지 않습니다."); }
            if (!message.GetProperty("ok").GetBoolean()) throw new RequestRejected(message.GetProperty("error").GetString() ?? "MONITOR_REQUEST_REJECTED");
            return message.GetProperty("result").Clone();
        }
        finally { pending.TryRemove(id, out _); }
    }
    internal Task ShutdownAsync(bool preserveStops = false, TimeSpan? timeout = null)
    {
        lock (lifecycle)
        {
            if (shutdown is not null) return shutdown;
            lifetime.RequestShutdown(); shutdown = StopAndWaitAsync(preserveStops,timeout ?? TimeSpan.FromSeconds(20)); return shutdown;
        }
    }
    private async Task StopAndWaitAsync(bool preserveStops, TimeSpan timeout)
    {
        // Acceptance is not exit. Await this exact owned process and pipe drain.
        JsonElement reply;
        try { reply = await SendCoreAsync("shutdown",new { preserveStops }); }
        catch (RequestRejected)
        {
            // An explicit protocol rejection precedes shutdown; keep Pause and
            // status usable. A missing reply/timeout never reopens this client.
            lock (lifecycle) { lifetime.RejectShutdown(); shutdown = null; }
            throw;
        }
        catch { lock (lifecycle) lifetime.Uncertain(); throw; }
        try
        {
        if (!reply.TryGetProperty("shutdown",out var accepted) || accepted.ValueKind != JsonValueKind.True ||
            !reply.TryGetProperty("preserveStops",out var preserved) || preserved.ValueKind is not (JsonValueKind.True or JsonValueKind.False) || preserved.GetBoolean() != preserveStops) throw new IOException("MONITOR_SHUTDOWN_UNCONFIRMED");
        process.StandardInput.Close();
        try { await process.WaitForExitAsync().WaitAsync(timeout); await Task.WhenAll(output,errors).WaitAsync(timeout); }
        catch (TimeoutException) { throw new TimeoutException("MONITOR_EXIT_UNCONFIRMED: 프로그램 재시작을 취소했습니다."); }
        if (!process.HasExited || process.ExitCode != 0) throw new IOException("MONITOR_EXIT_UNCONFIRMED");
        lock (lifecycle) lifetime.ConfirmExit();
        }
        catch { lock (lifecycle) lifetime.Uncertain(); throw; }
    }
    private async Task ReadOutput()
    {
        try
        {
            while (await process.StandardOutput.ReadLineAsync() is { } line)
            {
                var message=BridgeMessage.Parse(line);
                if (message.Event is not null) { Log?.Invoke(message.Event); continue; }
                if (message.Id is int id && pending.TryGetValue(id,out var source)) source.TrySetResult(message.Value);
            }
        }
        catch (Exception ex) { Log?.Invoke(ex.Message); }
        finally
        {
            lock (lifecycle) lifetime.CloseProtocol();
            foreach (var source in pending.Values) source.TrySetException(new IOException("조회 프로그램 연결 종료"));
        }
    }
    private async Task ReadErrors()
    {
        try { while (await process.StandardError.ReadLineAsync() is { } line) Log?.Invoke(line); }
        catch (Exception ex) { Log?.Invoke(ex.Message); }
    }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed,1) != 0) return;
        lock (lifecycle) lifetime.CloseProtocol();
        // EOF permits owned cleanup. Never kill trees or delete leases here.
        try { process.StandardInput.Close(); } catch { } process.Dispose();
    }
}
