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
/// Wikimedia Commons, found through the artist's MusicBrainz page), and 0.2.2 T4 adds TheAudioDB (free public key, artist thumbnails) as the
/// fallback source. Lookups run in the background so a page never waits for the internet; when a picture arrives <see cref="Arrived"/> fires and
/// the server pushes an "art" event so open pages swap the tile at once (0.2.2 T4b). Only names (artist, album) leave the PC.
/// 0.2.2 T4a: only a CONFIRMED "not found" is remembered as a miss (retried after 7 days); a timeout, network error, rate limit or server error
/// is transient and retried after about an hour, doubling up to a day. T4b: the queue no longer drops lookups when it is busy.
/// Off with server.json "onlineArt": false or the admin setting library.onlineArt = false.
/// </summary>
public sealed class OnlineArt : IDisposable
{
    public const string MbBase = "https://musicbrainz.org/ws/2";
    public const string AudioDbBase = "https://www.theaudiodb.com/api/v1/json/123";      // TheAudioDB's free public API key ("123"); attribution in Settings > Library
    private readonly string _dir; private readonly Func<bool> _enabled; private readonly HttpClient _http;
    private readonly Channel<(string Kind, string A, string B)> _q = Channel.CreateUnbounded<(string, string, string)>(new UnboundedChannelOptions { SingleReader = true });
    private readonly ConcurrentDictionary<string, byte> _queued = new();
    private readonly CancellationTokenSource _stop = new(); private readonly Task _worker;
    private DateTime _lastMb = DateTime.MinValue, _lastAdb = DateTime.MinValue;
    /// <summary>0.2.2 T4a: a confirmed "no picture anywhere" is asked again after 7 days (was 14 days for any error).</summary>
    public static readonly TimeSpan MissRetry = TimeSpan.FromDays(7);
    /// <summary>0.2.2 T4a: first wait after a transient error; doubles per failed attempt up to <see cref="TransientMax"/>.</summary>
    public static TimeSpan TransientFirst = TimeSpan.FromHours(1);
    public static readonly TimeSpan TransientMax = TimeSpan.FromDays(1);
    public int Fetched; public int Missed; public int Transient;
    /// <summary>0.2.2 T4b: a picture was found and cached (kind "album"/"artist", artist name, album name or "").</summary>
    public event Action<string, string, string>? Arrived;

    /// <summary>A lookup that failed for a reason that says nothing about whether a picture exists (timeout, network, 429, 5xx).</summary>
    public sealed class TransientException(string m) : Exception(m);

    public OnlineArt(string dataDir, Func<bool> enabled, HttpMessageHandler? handler = null)
    {
        _dir = Path.Combine(dataDir, "artcache", "online"); Directory.CreateDirectory(_dir); _enabled = enabled;
        _http = handler == null ? new HttpClient() : new HttpClient(handler);
        _http.Timeout = TimeSpan.FromSeconds(15);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"WavWiz/{WavWiz.Core.WavWizInfo.Version} ( https://github.com/vdubbin74/WavWiz )");
        // 0.2.2 T4e: no shared Accept header - JSON lookups ask for JSON, picture downloads ask for images (see Send)
        ForgetOldMisses();
        _worker = Task.Run(Work);
    }
    public bool Enabled => _enabled();

    /// <summary>0.2.2 T4a: 0.2.1 saved EVERY failure (timeouts, rate limits) as a 14-day miss, so many artists were stuck on generated portraits.
    /// Those misses are forgotten once on upgrade, so they are looked up again.</summary>
    private void ForgetOldMisses()
    {
        try
        {
            var mark = Path.Combine(_dir, "misses-v2.txt"); if (File.Exists(mark)) return;
            foreach (var f in Directory.EnumerateFiles(_dir, "*.none")) { try { File.Delete(f); } catch { } }
            File.WriteAllText(mark, "0.2.2: misses are only confirmed not-found results\n");
        }
        catch { }
    }

    public static string Norm(string s) => string.Join(' ', (s ?? "").Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    public static string Key(string kind, string a, string b = "") => kind + "-" + Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(Norm(a) + "\u001f" + Norm(b)))).ToLowerInvariant();
    private string PathOf(string key) => Path.Combine(_dir, key + ".img");
    private string MissOf(string key) => Path.Combine(_dir, key + ".none");
    private string RetryOf(string key) => Path.Combine(_dir, key + ".retry");

    /// <summary>Cached picture bytes for an album / artist, or null. When nothing is cached (and no recent miss / transient back-off), a background lookup is queued.</summary>
    public byte[]? Album(string artist, string album) => Get("album", artist, album);
    public byte[]? Artist(string name) => Get("artist", name, "");
    public string? CacheKey(string kind, string a, string b = "") { if (IsUnknown(a) || (kind == "album" && IsUnknown(b))) return null; var k = Key(kind, a, b); return File.Exists(PathOf(k)) ? k : null; }

    private byte[]? Get(string kind, string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || (kind == "album" && string.IsNullOrWhiteSpace(b))) return null;
        if (IsUnknown(a) || (kind == "album" && IsUnknown(b))) return null;
        var key = Key(kind, a, b); var file = PathOf(key);
        try { if (File.Exists(file)) return File.ReadAllBytes(file); } catch { return null; }
        if (!Enabled) return null;
        if (Waiting(key)) return null;
        if (_queued.TryAdd(key, 0) && !_q.Writer.TryWrite((kind, a, b))) _queued.TryRemove(key, out _);
        return null;
    }
    /// <summary>True while a confirmed miss is younger than 7 days or a transient back-off has not run out.</summary>
    private bool Waiting(string key)
    {
        try
        {
            var miss = MissOf(key);
            if (File.Exists(miss) && DateTime.UtcNow - File.GetLastWriteTimeUtc(miss) < MissRetry) return true;
            var rf = RetryOf(key);
            if (File.Exists(rf) && ReadRetry(rf).Next > DateTime.UtcNow) return true;
        }
        catch { }
        return false;
    }
    private static (int Attempts, DateTime Next) ReadRetry(string file)
    {
        try { var p = File.ReadAllText(file).Split('|'); return (int.Parse(p[0], System.Globalization.CultureInfo.InvariantCulture), DateTime.Parse(p[1], null, System.Globalization.DateTimeStyles.RoundtripKind)); }
        catch { return (0, DateTime.MinValue); }
    }
    /// <summary>0.2.2 T4a: the wait after <paramref name="attempts"/> transient failures in a row (1 h, 2 h, 4 h ... at most 1 day).</summary>
    public static TimeSpan Backoff(int attempts)
    {
        var t = TransientFirst.TotalMilliseconds * Math.Pow(2, Math.Clamp(attempts - 1, 0, 16));
        return TimeSpan.FromMilliseconds(Math.Min(t, TransientMax.TotalMilliseconds));
    }
    /// <summary>0.4.4 F24: generic / unknown names - never a picture key (public so the art cache and the library share one rule).</summary>
    public static bool IsUnknown(string? s) => Norm(s ?? "") is "" or "unknown" or "unknown artist" or "unknown album" or "various artists" or "various";

    /// <summary>0.2.2 T4e: what Settings > Library shows.</summary>
    public sealed record KindStatus(int Found, int NotFound, int Pending);
    public sealed record ArtStatus(bool Enabled, KindStatus Artists, KindStatus Albums, int Queued, int Fetched, int Missed, int Transient);
    public ArtStatus Status()
    {
        int af = 0, an = 0, ap = 0, lf = 0, ln = 0, lp = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(_dir))
            {
                var n = Path.GetFileName(f); bool artist = n.StartsWith("artist-", StringComparison.Ordinal), album = n.StartsWith("album-", StringComparison.Ordinal);
                if (!artist && !album) continue;
                if (n.EndsWith(".img", StringComparison.Ordinal)) { if (artist) af++; else lf++; }
                else if (n.EndsWith(".none", StringComparison.Ordinal)) { if (artist) an++; else ln++; }
                else if (n.EndsWith(".retry", StringComparison.Ordinal)) { if (artist) ap++; else lp++; }
            }
        }
        catch { }
        foreach (var k in _queued.Keys) { if (k.StartsWith("artist-", StringComparison.Ordinal)) { if (!File.Exists(RetryOf(k))) ap++; } else if (!File.Exists(RetryOf(k))) lp++; }
        return new ArtStatus(Enabled, new KindStatus(af, an, ap), new KindStatus(lf, ln, lp), _queued.Count, Fetched, Missed, Transient);
    }
    /// <summary>0.2.2 T4e: "Retry missing photos" - forgets every artist miss and back-off, then queues the given artists again. Returns how many were queued.</summary>
    public int RetryMissing(IEnumerable<string> artists, bool albumsToo = false)
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(_dir))
            {
                var n = Path.GetFileName(f);
                if ((n.EndsWith(".none", StringComparison.Ordinal) || n.EndsWith(".retry", StringComparison.Ordinal)) && (n.StartsWith("artist-", StringComparison.Ordinal) || albumsToo)) { try { File.Delete(f); } catch { } }
            }
        }
        catch { }
        int q = 0;
        foreach (var a in artists) { if (CacheKey("artist", a) == null && !IsUnknown(a) && !string.IsNullOrWhiteSpace(a)) { Artist(a); q++; } }
        return q;
    }

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
                    if (File.Exists(PathOf(key))) continue;
                    var bytes = kind == "album" ? await FindAlbum(a, b, _stop.Token) : await FindArtistAnySource(a, _stop.Token);
                    if (bytes is { Length: > 200 } && bytes.Length < 12_000_000)
                    {
                        var tmp = PathOf(key) + ".tmp"; await File.WriteAllBytesAsync(tmp, bytes, _stop.Token); File.Move(tmp, PathOf(key), true);
                        TryDelete(MissOf(key)); TryDelete(RetryOf(key));
                        Interlocked.Increment(ref Fetched);
                        try { Arrived?.Invoke(kind, a, b); } catch { }
                    }
                    else { await File.WriteAllTextAsync(MissOf(key), DateTime.UtcNow.ToString("O"), _stop.Token); TryDelete(RetryOf(key)); Interlocked.Increment(ref Missed); }
                }
                catch (OperationCanceledException) when (_stop.IsCancellationRequested) { throw; }
                catch (Exception)
                {
                    // 0.2.2 T4a: a timeout / network error / rate limit / server error is NOT a miss: retry later with a growing back-off
                    try
                    {
                        var rf = RetryOf(key); int n = File.Exists(rf) ? ReadRetry(rf).Attempts + 1 : 1;
                        await File.WriteAllTextAsync(rf, n.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + (DateTime.UtcNow + Backoff(n)).ToString("O"));
                    }
                    catch { }
                    Interlocked.Increment(ref Transient);
                }
                finally { _queued.TryRemove(key, out _); }
            }
        }
        catch (OperationCanceledException) { }
    }
    private static void TryDelete(string f) { try { if (File.Exists(f)) File.Delete(f); } catch { } }

    /// <summary>GET with the right Accept header. 2xx = the response; 404 / 400 / 410 = null (confirmed not there); anything else (429, 5xx,
    /// timeout, network) throws <see cref="TransientException"/>.</summary>
    private async Task<HttpResponseMessage?> Send(string url, bool image, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.ParseAdd(image ? "image/*" : "application/json");
        HttpResponseMessage r;
        try { r = await _http.SendAsync(req, ct); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new TransientException("timeout: " + url); }
        catch (HttpRequestException e) { throw new TransientException(e.Message); }
        if (r.IsSuccessStatusCode) return r;
        var code = (int)r.StatusCode; r.Dispose();
        if (code is 404 or 400 or 410) return null;
        throw new TransientException($"HTTP {code}: {url}");
    }
    private async Task<JsonDocument?> GetJson(string url, CancellationToken ct)
    {
        using var r = await Send(url, false, ct); if (r == null) return null;
        try { return JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct)); }
        catch (JsonException) { throw new TransientException("bad JSON: " + url); }
    }
    private async Task<byte[]?> GetImage(string url, CancellationToken ct)
    {
        using var r = await Send(url, true, ct); if (r == null) return null;
        return await r.Content.ReadAsByteArrayAsync(ct);
    }

    /// <summary>MusicBrainz allows one request per second per client.</summary>
    private async Task<JsonDocument?> Mb(string url, CancellationToken ct)
    {
        var wait = _lastMb + TimeSpan.FromMilliseconds(1100) - DateTime.UtcNow; if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
        _lastMb = DateTime.UtcNow;
        return await GetJson(url, ct);
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
            var img = await GetImage($"https://coverartarchive.org/release-group/{id}/front-500", ct);
            if (img != null) return img;
        }
        return null;
    }

    /// <summary>0.2.2 T4c: Wikidata / Commons first, TheAudioDB when that has nothing (or failed). Null only when every source CONFIRMED there is no
    /// photo; if one source failed for a transient reason and the other found nothing, the transient error is passed on (retried later).</summary>
    public async Task<byte[]?> FindArtistAnySource(string name, CancellationToken ct)
    {
        TransientException? first = null;
        try { var b = await FindArtist(name, ct); if (b != null) return b; }
        catch (TransientException e) { first = e; }
        var b2 = await FindArtistAudioDb(name, ct);
        if (b2 != null) return b2;
        if (first != null) throw first;
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
        using (var doc = await GetJson($"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", ct))
        {
            if (doc == null) return null;
            file = WikidataImage(doc.RootElement, qid);
        }
        if (string.IsNullOrEmpty(file)) return null;
        return await GetImage($"https://commons.wikimedia.org/wiki/Special:FilePath/{Uri.EscapeDataString(file)}?width=600", ct);
    }

    /// <summary>0.2.2 T4c: TheAudioDB artist search (free public key, no account; at most one request every 2 s from here). Exact name match only;
    /// the artist thumbnail (700 px) is used. Source credited in Settings > Library and THIRD-PARTY-NOTICES.</summary>
    public async Task<byte[]?> FindArtistAudioDb(string name, CancellationToken ct)
    {
        var wait = _lastAdb + TimeSpan.FromMilliseconds(2000) - DateTime.UtcNow; if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
        _lastAdb = DateTime.UtcNow;
        string? thumb = null;
        using (var doc = await GetJson($"{AudioDbBase}/search.php?s={Uri.EscapeDataString(name)}", ct))
        {
            if (doc == null) return null;
            thumb = AudioDbThumb(doc.RootElement, name);
        }
        if (string.IsNullOrEmpty(thumb)) return null;
        return await GetImage(thumb, ct);
    }
    /// <summary>The artist thumbnail URL of the exact-name match in a TheAudioDB search answer, or null ("artists": null = not found).</summary>
    public static string? AudioDbThumb(JsonElement root, string name)
    {
        try
        {
            if (!root.TryGetProperty("artists", out var arr) || arr.ValueKind != JsonValueKind.Array) return null;
            foreach (var a in arr.EnumerateArray())
            {
                var n = a.TryGetProperty("strArtist", out var sn) ? sn.GetString() : null;
                if (n == null || !string.Equals(Norm(n), Norm(name), StringComparison.Ordinal)) continue;
                if (a.TryGetProperty("strArtistThumb", out var t) && t.ValueKind == JsonValueKind.String && Uri.TryCreate(t.GetString(), UriKind.Absolute, out var u) && u.Scheme == "https") return u.AbsoluteUri;
            }
        }
        catch { }
        return null;
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
