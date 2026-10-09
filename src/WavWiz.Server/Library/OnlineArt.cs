using System.Collections.Concurrent;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
namespace WavWiz.Server.Library;

/// <summary>
/// 0.2.1 F13: online art for the library, cached on this PC (data folder\artcache\online). Albums with no embedded or folder picture get the
/// front cover from the Cover Art Archive (found through a MusicBrainz release-group search); artists get a photo from Wikidata (P18 image on
/// Wikimedia Commons, found through the artist's MusicBrainz page). Lookups run one at a time in the background (MusicBrainz asks for at
/// most one request per second), so a page never waits for the internet: the first view shows the generated cover / portrait and the picture
/// appears on a later view. Misses are remembered for 14 days. Only names (artist, album) leave the PC. Off with server.json "onlineArt": false
/// or the admin setting library.onlineArt = false.
/// </summary>
public sealed class OnlineArt : IDisposable
{
    public const string MbBase = "https://musicbrainz.org/ws/2";
    private readonly string _dir; private readonly Func<bool> _enabled; private readonly HttpClient _http;
    private readonly Channel<(string Kind, string A, string B)> _q = Channel.CreateBounded<(string, string, string)>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropWrite });
    private readonly ConcurrentDictionary<string, byte> _queued = new();
    private readonly CancellationTokenSource _stop = new(); private readonly Task _worker;
    private DateTime _lastMb = DateTime.MinValue;
    public static readonly TimeSpan MissRetry = TimeSpan.FromDays(14);
    public int Fetched; public int Missed;

    public OnlineArt(string dataDir, Func<bool> enabled, HttpMessageHandler? handler = null)
    {
        _dir = Path.Combine(dataDir, "artcache", "online"); Directory.CreateDirectory(_dir); _enabled = enabled;
        _http = handler == null ? new HttpClient() : new HttpClient(handler);
        _http.Timeout = TimeSpan.FromSeconds(12);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"WavWiz/{WavWiz.Core.WavWizInfo.Version} ( https://github.com/vdubbin74/WavWiz )");
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        _worker = Task.Run(Work);
    }
    public bool Enabled => _enabled();

    public static string Norm(string s) => string.Join(' ', (s ?? "").Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    public static string Key(string kind, string a, string b = "") => kind + "-" + Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(Norm(a) + "\u001f" + Norm(b)))).ToLowerInvariant();
    private string PathOf(string key) => Path.Combine(_dir, key + ".img");
    private string MissOf(string key) => Path.Combine(_dir, key + ".none");

    /// <summary>Cached picture bytes for an album / artist, or null. When nothing is cached (and no recent miss), a background lookup is queued.</summary>
    public byte[]? Album(string artist, string album) => Get("album", artist, album);
    public byte[]? Artist(string name) => Get("artist", name, "");
    public string? CacheKey(string kind, string a, string b = "") { var k = Key(kind, a, b); return File.Exists(PathOf(k)) ? k : null; }

    private byte[]? Get(string kind, string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || (kind == "album" && string.IsNullOrWhiteSpace(b))) return null;
        if (IsUnknown(a) || (kind == "album" && IsUnknown(b))) return null;
        var key = Key(kind, a, b); var file = PathOf(key);
        try { if (File.Exists(file)) return File.ReadAllBytes(file); } catch { return null; }
        if (!Enabled) return null;
        var miss = MissOf(key);
        try { if (File.Exists(miss) && DateTime.UtcNow - File.GetLastWriteTimeUtc(miss) < MissRetry) return null; } catch { }
        if (_queued.TryAdd(key, 0) && !_q.Writer.TryWrite((kind, a, b))) _queued.TryRemove(key, out _);
        return null;
    }
    private static bool IsUnknown(string s) => Norm(s) is "" or "unknown" or "unknown artist" or "unknown album" or "various artists" or "various";

    private async Task Work()
    {
        try
        {
            await foreach (var (kind, a, b) in _q.Reader.ReadAllAsync(_stop.Token))
            {
                var key = Key(kind, a, b);
                try
                {
                    if (!Enabled) continue;
                    var bytes = kind == "album" ? await FindAlbum(a, b, _stop.Token) : await FindArtist(a, _stop.Token);
                    if (bytes is { Length: > 200 } && bytes.Length < 12_000_000) { var tmp = PathOf(key) + ".tmp"; await File.WriteAllBytesAsync(tmp, bytes, _stop.Token); File.Move(tmp, PathOf(key), true); Interlocked.Increment(ref Fetched); }
                    else { await File.WriteAllTextAsync(MissOf(key), DateTime.UtcNow.ToString("O"), _stop.Token); Interlocked.Increment(ref Missed); }
                }
                catch (OperationCanceledException) { throw; }
                catch { try { await File.WriteAllTextAsync(MissOf(key), DateTime.UtcNow.ToString("O")); } catch { } Interlocked.Increment(ref Missed); }
                finally { _queued.TryRemove(key, out _); }
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>MusicBrainz allows one request per second per client.</summary>
    private async Task<JsonDocument?> Mb(string url, CancellationToken ct)
    {
        var wait = _lastMb + TimeSpan.FromMilliseconds(1100) - DateTime.UtcNow; if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
        _lastMb = DateTime.UtcNow;
        using var r = await _http.GetAsync(url, ct); if (!r.IsSuccessStatusCode) return null;
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct));
    }
    private static string Q(string s) => "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    public async Task<byte[]?> FindAlbum(string artist, string album, CancellationToken ct)
    {
        using var doc = await Mb($"{MbBase}/release-group/?query={Uri.EscapeDataString($"releasegroup:{Q(album)} AND artist:{Q(artist)}")}&fmt=json&limit=5", ct);
        if (doc == null || !doc.RootElement.TryGetProperty("release-groups", out var rgs)) return null;
        foreach (var rg in rgs.EnumerateArray())
        {
            if (rg.TryGetProperty("score", out var sc) && sc.GetInt32() < 90) continue;
            var id = rg.GetProperty("id").GetString(); if (string.IsNullOrEmpty(id)) continue;
            using var r = await _http.GetAsync($"https://coverartarchive.org/release-group/{id}/front-500", ct);
            if (r.IsSuccessStatusCode) return await r.Content.ReadAsByteArrayAsync(ct);
        }
        return null;
    }

    public async Task<byte[]?> FindArtist(string name, CancellationToken ct)
    {
        string? id = null;
        using (var doc = await Mb($"{MbBase}/artist/?query={Uri.EscapeDataString($"artist:{Q(name)}")}&fmt=json&limit=3", ct))
        {
            if (doc == null || !doc.RootElement.TryGetProperty("artists", out var arr)) return null;
            foreach (var a in arr.EnumerateArray())
                if ((!a.TryGetProperty("score", out var sc) || sc.GetInt32() >= 95) && string.Equals(Norm(a.GetProperty("name").GetString() ?? ""), Norm(name), StringComparison.Ordinal)) { id = a.GetProperty("id").GetString(); break; }
        }
        if (id == null) return null;
        string? qid = null;
        using (var doc = await Mb($"{MbBase}/artist/{id}?inc=url-rels&fmt=json", ct))
        {
            if (doc == null || !doc.RootElement.TryGetProperty("relations", out var rels)) return null;
            foreach (var rel in rels.EnumerateArray())
                if (rel.TryGetProperty("type", out var t) && t.GetString() == "wikidata" && rel.TryGetProperty("url", out var u) && u.TryGetProperty("resource", out var res))
                { qid = res.GetString()?.Split('/').LastOrDefault(); break; }
        }
        if (string.IsNullOrEmpty(qid) || !System.Text.RegularExpressions.Regex.IsMatch(qid, "^Q[0-9]+$")) return null;
        string? file;
        using (var r = await _http.GetAsync($"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", ct))
        {
            if (!r.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct));
            file = WikidataImage(doc.RootElement, qid);
        }
        if (string.IsNullOrEmpty(file)) return null;
        using var img = await _http.GetAsync($"https://commons.wikimedia.org/wiki/Special:FilePath/{Uri.EscapeDataString(file)}?width=600", ct);
        return img.IsSuccessStatusCode ? await img.Content.ReadAsByteArrayAsync(ct) : null;
    }

    /// <summary>The Commons file name of an entity's P18 (image) claim, or null.</summary>
    public static string? WikidataImage(JsonElement root, string qid)
    {
        try
        {
            var e = root.GetProperty("entities").GetProperty(qid);
            var p18 = e.GetProperty("claims").GetProperty("P18");
            foreach (var c in p18.EnumerateArray()) if (c.GetProperty("mainsnak").TryGetProperty("datavalue", out var dv)) return dv.GetProperty("value").GetString();
        }
        catch { }
        return null;
    }

    public void Dispose() { _stop.Cancel(); _q.Writer.TryComplete(); try { _worker.Wait(1000); } catch { } _http.Dispose(); }
}
