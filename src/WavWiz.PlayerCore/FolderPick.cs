using System.Text.Json;
namespace WavWiz.PlayerCore;

/// <summary>
/// 0.6.9 #6: the page asks the Windows app for a native "choose a folder" dialog through the WebView2 host bridge:
/// page -> host {cmd:'pickFolder', id, title, initial}; host -> page {cmd:'folderPicked', id, path} (path null = cancelled).
/// Pure (no Windows types) so it is unit-tested on Linux. Browsers and phones never get this; they keep typing the path.
/// </summary>
public static class FolderPick
{
    public sealed record Request(string Id, string Title, string? Initial);

    public static Request? Parse(string json)
    {
        try
        {
            using var d = JsonDocument.Parse(json); var r = d.RootElement;
            if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("cmd", out var c) || c.GetString() != "pickFolder") return null;
            string? S(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            var id = S("id") ?? ""; if (id.Length is 0 or > 40 || !id.All(char.IsLetterOrDigit)) return null;
            var title = S("title") ?? "Choose a music folder"; if (title.Length > 120) title = title[..120];
            var init = S("initial"); if (init != null && (init.Length > 260 || init.IndexOfAny(new[] { '\0', '\n', '\r' }) >= 0)) init = null;
            return new Request(id, title, string.IsNullOrWhiteSpace(init) ? null : init);
        }
        catch { return null; }
    }

    public static string Answer(string id, string? path) => JsonSerializer.Serialize(new { cmd = "folderPicked", id, path = string.IsNullOrWhiteSpace(path) ? null : path });
}
