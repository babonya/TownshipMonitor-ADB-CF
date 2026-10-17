using System.Text.Json;

namespace TownshipMonitor;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        string? Value(string key) { var index = Array.IndexOf(args, key); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
        try
        {
            MonitorRestart.WaitForPrevious(Value("--restart-parent"),Value("--restart-parent-start"));
            var root = Value("--root") ?? FindRoot();
            using var form = new MonitorForm(root, Value("--source"), Value("--inventory"), args.Contains("--smoke-test"));
            if (args.Contains("--smoke-test"))
            {
                var fixture = Value("--snapshot") ?? throw new ArgumentException("--snapshot 필요");
                var output = Value("--output") ?? throw new ArgumentException("--output 필요");
                form.Shown += async (_, _) =>
                {
                    try
                    {
                        using var document = JsonDocument.Parse(File.ReadAllText(fixture));
                        await form.CheckBridgeAsync(document.RootElement.GetProperty("sourceRoot").GetString()!);
                        form.ApplySnapshot(document.RootElement);
                        await Task.Delay(200);
                        using var bitmap = new Bitmap(form.Width, form.Height);
                        form.DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height));
                        bitmap.Save(output, System.Drawing.Imaging.ImageFormat.Png);
                        File.WriteAllText(output + ".json", JsonSerializer.Serialize(form.CheckLayout()));
                    }
                    catch (Exception ex) { File.WriteAllText(output + ".error.txt", ex.ToString()); Environment.ExitCode = 1; }
                    form.Close();
                };
            }
            Application.Run(form);
        }
        catch (Exception ex)
        {
            if (args.Contains("--smoke-test") && Value("--output") is { } output) File.WriteAllText(output + ".error.txt",ex.ToString());
            else MessageBox.Show(ex.Message, "Township Monitor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }
    private static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "tools", "mumu-monitor-cli.mjs"))) return directory.FullName;
        throw new DirectoryNotFoundException("구현 폴더를 --root로 지정하세요.");
    }
}
