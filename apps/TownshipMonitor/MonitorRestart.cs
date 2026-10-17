using System.Diagnostics;
namespace TownshipMonitor;
internal static class MonitorRestart
{
    internal static ProcessStartInfo Replacement(string executable,string root,string source,string inventory,int parentId,long parentStarted)
    {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, WorkingDirectory = root };
        foreach (var argument in new[] { "--root",root,"--source",source,"--inventory",inventory,
            "--restart-parent",parentId.ToString(),"--restart-parent-start",parentStarted.ToString() }) info.ArgumentList.Add(argument);
        return info;
    }
    internal static void WaitForPrevious(string? parentId,string? parentStarted,TimeSpan? timeout = null)
    {
        if (parentId is null && parentStarted is null) return;
        if (!int.TryParse(parentId,out var id) || id <= 0 || id == Environment.ProcessId || !long.TryParse(parentStarted,out var started)) throw new IOException("MONITOR_RESTART_PARENT_INVALID");
        Process parent;
        try { parent = Process.GetProcessById(id); }
        catch (ArgumentException) { return; }
        using (parent)
        {
            if (parent.StartTime.ToUniversalTime().Ticks != started) throw new IOException("MONITOR_RESTART_PARENT_CHANGED");
            if (!parent.WaitForExit((int)(timeout ?? TimeSpan.FromSeconds(15)).TotalMilliseconds)) throw new TimeoutException("MONITOR_PREVIOUS_PROCESS_STILL_RUNNING");
        }
    }
}
