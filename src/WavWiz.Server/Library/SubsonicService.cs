using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Api;
namespace WavWiz.Server.Library;

/// <summary>
/// 0.5.x F164: remote libraries over the Subsonic / OpenSubsonic REST API (Navidrome first; also Airsonic, Gonic, Funkwhale…).
/// WavWiz is the CLIENT here: it browses the server and streams songs through ffmpeg like a radio URL. It is not a Subsonic server.
/// Passwords are stored like NAS logins (Windows DPAPI, admin.* setting, never returned by the API). Remote songs never enter the local
/// track table, so an unreachable server only dims its row; the local library is never touched.
/// Queue items: Kind "remote", Location "subsonic:{serverId}:{songId}" (no secret in the saved queue); the stream URL is minted at play time.
/// </summary>
public sealed class SubsonicService
{
    public const string Key = "admin.subsonic.servers";
    public const string Scheme = "subsonic:";
    private const string ApiVersion = "1.16.1", Client = "WavWiz";
    public sealed record Saved(string Id, string Url, string User, string Secret, string? Label, bool Legacy, DateTimeOffset SavedAt);

    private readonly Db _db; private readonly ISecretProtector _prot; private readonly HttpClient _http; private readonly string _cache;
    private readonly Dictionary<string, (DateTime At, string? Error)> _state = new(); private readonly object _l = new();

    public SubsonicService(Db db, string dataDir, ISecretProtector? prot = null, HttpMessageHandler? handler = null)
    {
        _db = db; _prot = prot ?? SecretProtectors.For(dataDir);
        _http = handler == null ? new HttpClient() : new HttpClient(handler); _http.Timeout = TimeSpan.FromSeconds(12);
        _cache = Path.Combine(dataDir, "artcache", "remote"); try { Directory.CreateDirectory(_cache); } catch { }
    }
    public bool Available => _prot.Available;

    private List<Saved> Load() { try { return _db.Setting(Key) is string j ? JsonSerializer.Deserialize<List<Saved>>(j) ?? new() : new(); } catch { return new(); } }
    private void Store(List<Saved> l) => _db.SetSetting(Key, JsonSerializer.Serialize(l));
    private Saved? Get(string id) => Load().FirstOrDefault(x => x.Id == id);
    public static string Display(Saved s) => string.IsNullOrWhiteSpace(s.Label) ? new Uri(s.Url).Host : s.Label!;

    public List<object> List()
    {
        var l = Load(); lock (_l)
            return l.Select(c => { var has = _state.TryGetValue(c.Id, out var st);
                return (object)new { id = c.Id, url = c.Url, user = c.User, label = Display(c), savedAt = c.SavedAt, online = has && st.Error == null, checkedAt = has ? st.At : (DateTime?)null, lastError = has ? st.Error : null }; }).ToList();
    }

    public static string? NormalizeUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null; url = url.Trim();
        if (!url.Contains("://")) url = "http://" + url;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return null;
        var s = u.GetLeftPart(UriPartial.Path).TrimEnd('/');
        if (s.EndsWith("/rest", StringComparison.OrdinalIgnoreCase)) s = s[..^5];
        return s;
    }

    // ---- auth ----
    public static string Md5Hex(string s) => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    /// <summary>Subsonic 1.13+: t = md5(password + salt), s = salt. Legacy servers: p = enc:hex(password).</summary>
    public static string AuthQuery(string user, string password, bool legacy, string? salt = null)
    {
        var q = "u=" + Uri.EscapeDataString(user) + "&v=" + ApiVersion + "&c=" + Client + "&f=json";
        if (legacy) return q + "&p=enc:" + Convert.ToHexString(Encoding.UTF8.GetBytes(password)).ToLowerInvariant();
        salt ??= Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
        return q + "&t=" + Md5Hex(password + salt) + "&s=" + salt;
    }
    private string Password(Saved s) => Encoding.UTF8.GetString(_prot.Unprotect(Convert.FromBase64String(s.Secret)));
    private string Url(Saved s, string method, string? extra = null) => $"{s.Url}/rest/{method}?{AuthQuery(s.User, Password(s), s.Legacy)}{(string.IsNullOrEmpty(extra) ? "" : "&" + extra)}";

    public sealed class SubsonicError : Exception { public int Code; public SubsonicError(int code, string msg) : base(msg) { Code = code; } }

    private static JsonElement Parse(string body)
    {
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("subsonic-response", out var r)) throw new SubsonicError(-1, "That address did not answer like a Subsonic server.");
        if (r.Str("status") != "ok")
        {
            var e = r.TryGetProperty("error", out var ee) ? ee : default; int code = e.ValueKind == JsonValueKind.Object && e.TryGetProperty("code", out var c) && c.TryGetInt32(out var ci) ? ci : 0;
            throw new SubsonicError(code, Explain(code, e.ValueKind == JsonValueKind.Object ? e.Str("message") : null));
        }
        return r.Clone();
    }
    public static string Explain(int code, string? msg) => code switch
    {
        40 => "The user name or password was not accepted.",
        41 => "This server does not accept token login.",
        50 => "That user is not allowed to do this on the server.",
        70 => "Not found on the server.",
        _ => string.IsNullOrWhiteSpace(msg) ? $"The server answered with error {code}." : msg!,
    };

    private async Task<JsonElement> Raw(string url, CancellationToken ct)
    {
        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) throw new SubsonicError(-(int)resp.StatusCode, $"The server answered HTTP {(int)resp.StatusCode}. Check the address (for Navidrome usually http://NAS:4533).");
        return Parse(await resp.Content.ReadAsStringAsync(ct));
    }

    /// <summary>A call against a saved server; records online/offline for the dim status.</summary>
    public async Task<JsonElement> Call(string serverId, string method, string? extra = null, CancellationToken ct = default)
    {
        var s = Get(serverId) ?? throw new SubsonicError(70, "That remote library was removed.");
        try { var r = await Raw(Url(s, method, extra), ct); Mark(s.Id, null); return r; }
        catch (SubsonicError e) { if (e.Code is < 0 or 40) Mark(s.Id, e.Message); throw; }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested) { var m = "Could not reach " + Display(s) + ". Is it on?"; Mark(s.Id, m); throw new SubsonicError(-1, m); }
    }
    private void Mark(string id, string? err) { lock (_l) _state[id] = (DateTime.UtcNow, err); }

    /// <summary>Tries ping (token, then legacy hex password); only a working login is saved. Returns a plain-English error or null.</summary>
    public async Task<string?> Save(string url, string user, string password, string? label, string? id = null)
    {
        var u = NormalizeUrl(url); if (u == null) return "Enter the server address, e.g. http://192.168.1.20:4533 (Navidrome).";
        if (string.IsNullOrWhiteSpace(user)) return "Enter the user name for the server.";
        if (!_prot.Available) return "Saving remote library logins is not available on this server.";
        user = user.Trim(); bool legacy = false;
        try
        {
            try { await Raw($"{u}/rest/ping?{AuthQuery(user, password, false)}", default); }
            catch (SubsonicError e) when (e.Code is 41 or 30) { legacy = true; await Raw($"{u}/rest/ping?{AuthQuery(user, password, true)}", default); }
        }
        catch (SubsonicError e) { return e.Message; }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { return "Could not reach " + u + ". Is the server on, and is the port right?"; }
        catch (JsonException) { return "That address did not answer like a Subsonic server."; }
        var l = Load(); id ??= l.FirstOrDefault(x => x.Url.Equals(u, StringComparison.OrdinalIgnoreCase) && x.User.Equals(user, StringComparison.OrdinalIgnoreCase))?.Id ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        l.RemoveAll(x => x.Id == id);
        l.Add(new Saved(id, u, user, Convert.ToBase64String(_prot.Protect(Encoding.UTF8.GetBytes(password))), string.IsNullOrWhiteSpace(label) ? null : label.Trim(), legacy, DateTimeOffset.Now)); Store(l);
        Mark(id, null); return null;
    }
    public bool Remove(string id) { var l = Load(); int n = l.RemoveAll(x => x.Id == id); if (n > 0) { Store(l); lock (_l) _state.Remove(id); } return n > 0; }
    public async Task<string?> Test(string id) { try { await Call(id, "ping"); return null; } catch (Exception e) { return e.Message; } }

    // ---- browse DTOs (shapes close to the local library's) ----
    private static IEnumerable<JsonElement> Arr(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var a) ? a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : new[] { a } : Array.Empty<JsonElement>();
    private static JsonElement Obj(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var a) ? a : default;
    private static int? Int(JsonElement e, string n) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(n, out var v) && v.TryGetInt32(out var i) ? i : null;
    private static string S(JsonElement e, string n) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(n, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString() : "";
    public static string? ArtUrl(string sid, string? coverId) => string.IsNullOrEmpty(coverId) ? null : $"/api/v1/remote/{sid}/art/{Uri.EscapeDataString(coverId)}";

    private static object Artist(string sid, JsonElement a) => new { id = S(a, "id"), name = S(a, "name"), albums = Int(a, "albumCount") ?? 0, artUrl = ArtUrl(sid, S(a, "coverArt")) };
    private static object Album(string sid, JsonElement a) => new { id = S(a, "id"), album = S(a, "name") is { Length: > 0 } n ? n : S(a, "title"), artist = S(a, "artist"), year = Int(a, "year"), tracks = Int(a, "songCount"), artUrl = ArtUrl(sid, S(a, "coverArt")) };
    private static object Song(string sid, JsonElement x) => new { id = S(x, "id"), title = S(x, "title"), artist = S(x, "artist"), album = S(x, "album"), trackNo = Int(x, "track"), year = Int(x, "year"), genre = S(x, "genre"), durationMs = (Int(x, "duration") ?? 0) * 1000L, coverArt = S(x, "coverArt"), artUrl = ArtUrl(sid, S(x, "coverArt")) };

    public async Task<object> Artists(string sid) { var r = await Call(sid, "getArtists"); return Arr(Obj(r, "artists"), "index").SelectMany(i => Arr(i, "artist")).Select(a => Artist(sid, a)).ToList(); }
    public async Task<object> ArtistAlbums(string sid, string id) { var r = await Call(sid, "getArtist", "id=" + Uri.EscapeDataString(id)); return Arr(Obj(r, "artist"), "album").Select(a => Album(sid, a)).ToList(); }
    public async Task<object> Albums(string sid, string type, int size, int offset)
    {
        type = type is "newest" or "recent" or "frequent" or "random" or "alphabeticalByArtist" or "starred" ? type : "alphabeticalByName";
        var r = await Call(sid, "getAlbumList2", $"type={type}&size={Math.Clamp(size, 1, 500)}&offset={Math.Max(0, offset)}");
        return Arr(Obj(r, "albumList2"), "album").Select(a => Album(sid, a)).ToList();
    }
    public async Task<object> Album(string sid, string id) { var r = await Call(sid, "getAlbum", "id=" + Uri.EscapeDataString(id)); var a = Obj(r, "album"); return new { album = Album(sid, a), songs = Arr(a, "song").Select(x => Song(sid, x)).ToList() }; }
    public async Task<object> Search(string sid, string q)
    {
        var r = await Call(sid, "search3", $"query={Uri.EscapeDataString(q)}&artistCount=12&albumCount=20&songCount=50"); var o = Obj(r, "searchResult3");
        return new { artists = Arr(o, "artist").Select(a => Artist(sid, a)).ToList(), albums = Arr(o, "album").Select(a => Album(sid, a)).ToList(), tracks = Arr(o, "song").Select(x => Song(sid, x)).ToList() };
    }

    // ---- play ----
    public static QueueItem Item(string sid, string songId, string title, string artist, string album, long durMs, string? coverArt, int? trackNo = null, int? year = null, string? genre = null)
        => new(0, "remote", $"{Scheme}{sid}:{songId}", string.IsNullOrWhiteSpace(title) ? "Remote song" : title, artist ?? "", album ?? "", durMs, null, string.IsNullOrWhiteSpace(genre) ? null : genre, year, ArtUrl(sid, coverArt), trackNo);
    public async Task<List<QueueItem>> AlbumItems(string sid, string albumId)
    {
        var r = await Call(sid, "getAlbum", "id=" + Uri.EscapeDataString(albumId));
        return Arr(Obj(r, "album"), "song").Select(x => Item(sid, S(x, "id"), S(x, "title"), S(x, "artist"), S(x, "album"), (Int(x, "duration") ?? 0) * 1000L, S(x, "coverArt"), Int(x, "track"), Int(x, "year"), S(x, "genre"))).ToList();
    }
    /// <summary>"subsonic:{sid}:{songId}" → a fresh stream URL (new salt), or null when the server was removed / the password cannot be read.</summary>
    public string? StreamUrl(string location)
    {
        if (!location.StartsWith(Scheme)) return null; var rest = location[Scheme.Length..]; int c = rest.IndexOf(':'); if (c <= 0) return null;
        var s = Get(rest[..c]); if (s == null) return null;
        try { return Url(s, "stream", "id=" + Uri.EscapeDataString(rest[(c + 1)..]) + "&estimateContentLength=true"); } catch { return null; }
    }

    // ---- covers (cached on disk like local art) ----
    public async Task<byte[]?> Cover(string sid, string coverId, int size, CancellationToken ct)
    {
        size = ArtService.Sizes.FirstOrDefault(x => x >= size, ArtService.Sizes[^1]);
        var file = Path.Combine(_cache, $"{sid}_{Md5Hex(coverId)[..16]}_{size}.img");
        try { if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct); } catch { }
        var s = Get(sid); if (s == null) return null;
        try
        {
            using var resp = await _http.GetAsync(Url(s, "getCoverArt", $"id={Uri.EscapeDataString(coverId)}&size={size}"), ct);
            if (!resp.IsSuccessStatusCode || resp.Content.Headers.ContentType?.MediaType?.StartsWith("image/") != true) return null;
            var b = await resp.Content.ReadAsByteArrayAsync(ct); if (b.Length == 0) return null;
            try { await File.WriteAllBytesAsync(file, b, ct); } catch { }
            return b;
        }
        catch { return null; }
    }
}
