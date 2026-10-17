using System.Text.Json;
using System.Security.Cryptography;
namespace TownshipMonitor;
// Display assets only. This provider has no product recognition authority.
internal sealed class ProductDisplayAssets : IDisposable
{
    private readonly Dictionary<string,string> imagePaths = [];
    private readonly Dictionary<string,string> names = [];
    public Dictionary<string,string> Names { get { LoadCatalogue(); return names; } }
    private readonly Dictionary<string,(string Hash,Image Image)> temporary = [];
    private readonly string root;
    private bool catalogueLoaded;
    private readonly Dictionary<string,Image?> images = [];
    public ProductDisplayAssets(string root) { this.root=root; }
    private void LoadCatalogue()
    {
        if (catalogueLoaded) return; catalogueLoaded=true;
        var reference = Path.Combine(root,"reference");
        ReadJson(Path.Combine(reference,"product-catalog.json"), data=>
        {
            foreach (var item in Items(data,"items"))
                if (Value(item,"itemId") is { Length: > 0 } id) names.TryAdd(id,Value(item,"nameEn"));
        });
        var matching = Path.Combine(reference,"image-matching");
        RegisterImages(Path.Combine(matching,"helicopter","profile.json"),"items");
        RegisterImages(Path.Combine(matching,"registry.json"),"templates");
    }
    private void RegisterImages(string file,string collection)
    {
        var directory = Path.GetFullPath(Path.GetDirectoryName(file)!);
        ReadJson(file, data=>
        {
            foreach (var item in Items(data,collection))
            {
                var id = Value(item,"itemId"); var relative = Value(item,"file");
                if (id.Length == 0 || relative.Length == 0 || Path.IsPathRooted(relative)) continue;
                var path = Path.GetFullPath(Path.Combine(directory,relative));
                if (path.StartsWith(directory+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) && File.Exists(path)) imagePaths.TryAdd(id,path);
            }
        });
    }
    private static void ReadJson(string file,Action<JsonElement> read)
    {
        try { using var document = JsonDocument.Parse(File.ReadAllText(file)); read(document.RootElement); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { }
    }
    public Image? ProductImage(string id)
    {
        LoadCatalogue();
        if (images.TryGetValue(id,out var cached)) return cached;
        Image? image = null;
        if (imagePaths.TryGetValue(id,out var file))
            try { using var stream = File.OpenRead(file); using var original = Image.FromStream(stream); image = new Bitmap(original); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        images[id] = image; return image;
    }
    public void UpdateTemporaryImages(JsonElement data)
    {
        var retained=new HashSet<string>();
        foreach (var item in Items(data,"images").Concat(Items(data,"failedImages")))
        {
            var id=Value(item,"id"); var hash=Value(item,"sha256"); var path=Value(item,"path");
            if (id.Length!=64 || hash.Length!=64 || path.Length==0) continue;
            retained.Add(id);
            if (temporary.TryGetValue(id,out var cached) && cached.Hash==hash) continue;
            if (temporary.Remove(id,out var old)) old.Image.Dispose();
            try
            {
                var bytes=File.ReadAllBytes(path);
                if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(hash,StringComparison.OrdinalIgnoreCase)) continue;
                using var stream=new MemoryStream(bytes); using var original=Image.FromStream(stream);
                temporary[id]=(hash,new Bitmap(original));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
        foreach (var id in temporary.Keys.Where(id=>!retained.Contains(id)).ToArray()) { temporary[id].Image.Dispose(); temporary.Remove(id); }
    }
    public Image? TemporaryImage(string id)=>temporary.TryGetValue(id,out var item)?item.Image:null;
    private static string Value(JsonElement value,string key)=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var result)&&result.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)?result.ToString():"";
    private static IEnumerable<JsonElement> Items(JsonElement value,string key)=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var result)&&result.ValueKind==JsonValueKind.Array?result.EnumerateArray():Enumerable.Empty<JsonElement>();
    public void Dispose() { foreach (var image in images.Values) image?.Dispose(); images.Clear(); foreach (var item in temporary.Values) item.Image.Dispose(); temporary.Clear(); }
}
