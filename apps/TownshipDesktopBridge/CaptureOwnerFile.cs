using System.Text.Json.Nodes;

namespace TownshipDesktopBridge;

internal static class CaptureOwnerFile
{
    internal static JsonNode Read(string path)
    {
        // The Node producer keeps its writable exclusive-create handle open for
        // the lease lifetime. A read-only reader must share that existing write
        // access; File.ReadAllBytes denies it on Windows. Do not share deletion.
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return JsonNode.Parse(file) ?? throw new InvalidDataException("CAPTURE_OWNER_INVALID");
    }
}
