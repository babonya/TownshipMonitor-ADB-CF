using System.Diagnostics;
using System.Text.Json;

namespace TownshipMonitor;

// [사용자 변경 2026-10-18] 폰 화면 밝기 조절(오래 켜 두는 폰의 발열·배터리 절약).
// adb는 반드시 Android SDK 것 + 서버 포트 15037(PATH의 다른 adb는 서버를 죽인다). MuMu 에뮬레이터(emulator-*)는 건드리지 않는다.
internal static class ScreenBrightness
{
    public static string? Serial(JsonElement session, string root)
    {
        var s = MonitorDisplayText.TextOf(session, "serial");
        if (string.IsNullOrWhiteSpace(s)) s = Environment.GetEnvironmentVariable("TOWNSHIP_SERIAL") ?? "";
        if (string.IsNullOrWhiteSpace(s))
            try
            {
                using var d = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "setup-local", "device.json")));
                s = MonitorDisplayText.TextOf(d.RootElement, "serial");
            }
            catch { }
        s = s.Trim();
        return s.Length == 0 || s.StartsWith("emulator-", StringComparison.OrdinalIgnoreCase) ? null : s;
    }

    // 자동 밝기를 끄고(수동) 밝기 값을 정한다. 반환: 오류 문구(성공이면 null).
    public static async Task<string?> Set(string serial, int value)
    {
        var adb = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Android", "Sdk", "platform-tools", "adb.exe");
        if (!File.Exists(adb)) return "adb 없음: " + adb;
        var info = new ProcessStartInfo(adb) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        info.Environment["ANDROID_ADB_SERVER_PORT"] = "15037";
        foreach (var a in new[] { "-s", serial, "shell", $"settings put system screen_brightness_mode 0 && settings put system screen_brightness {value}" }) info.ArgumentList.Add(a);
        using var p = Process.Start(info)!;
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(); } catch { } return "adb 시간 초과"; }
        return p.ExitCode == 0 ? null : "adb 실패: " + (await p.StandardError.ReadToEndAsync()).Trim();
    }
}
