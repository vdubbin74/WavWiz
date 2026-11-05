using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Features;

/// <summary>Local play history (always on, stays on this server): a song counts as played once half of it (or 4 minutes, whichever comes first) has played,
/// the Last.fm rule; songs of 30 s or less never count. Up to 500 entries. When Last.fm is connected and on, each counted play is also scrobbled.</summary>
public sealed class PlayHistoryService
{
    public const int Max = 500;
    private readonly Db _db; private readonly ConductorRegistry _reg; private readonly EventHub _ev; private readonly object _l = new();
    public Func<DateTimeOffset> Clock { get; set; } = () => DateTimeOffset.UtcNow;
    public LastFm LastFm { get; }
    /// <summary>Optional: tells a remote library (Subsonic / Navidrome) that its song was played: (location) -> task.</summary>
    public Func<string, Task>? RemoteScrobble { get; set; }
    public Func<string, string>? ZoneName { get; set; }
    private sealed class Cur { public long ItemId; public QueueItem Item = null!; public DateTimeOffset Started; public long? RowId; }
    private readonly Dictionary<string, Cur> _cur = new();
    public PlayHistoryService(Db db, ConductorRegistry reg, EventHub ev, HttpMessageHandler? http = null) { _db = db; _reg = reg; _ev = ev; LastFm = new LastFm(db, http); }

    /// <summary>The Last.fm threshold for a song of this length (ms): half, capped at 4 minutes; 0 = never counts (30 s or shorter, or unknown).</summary>
    public static long ThresholdMs(long durationMs) => durationMs <= 30_000 ? 0 : Math.Min(durationMs / 2, 240_000);

    public void Tick() { foreach (var cd in _reg.Live()) { try { Observe(cd.GroupId, cd.Now()); } catch { } } }

    /// <summary>One look at a group's now-playing (every second).</summary>
    public void Observe(string gid, NowPlaying now)
    {
        var it = now.Item; var t = Clock();
        Cur? c; lock (_l) _cur.TryGetValue(gid, out c);
        bool playing = now.State == "playing" && it != null && it.Kind is "track" or "remote";
        if (c != null && (it == null || c.ItemId != it.Id))
        {   // the song changed (or the queue emptied): close the open row
            if (c.RowId is long rid) _db.Exec("UPDATE play_history SET finished_at=$f WHERE id=$i", ("$f", t.ToString("O")), ("$i", rid));
            lock (_l) _cur.Remove(gid); c = null;
        }
        if (!playing) return;
        if (c == null)
        {
            c = new Cur { ItemId = it!.Id, Item = it, Started = t.AddMilliseconds(-Math.Max(0, now.PositionMs)) }; lock (_l) _cur[gid] = c;
            if (LastFm.Active) _ = Task.Run(() => LastFm.NowPlaying(it));
        }
        var th = ThresholdMs(now.DurationMs > 0 ? now.DurationMs : it!.DurationMs);
        if (c.RowId == null && th > 0 && now.PositionMs >= th) Record(gid, c);
    }

    private void Record(string gid, Cur c)
    {
        var it = c.Item;
        c.RowId = _db.Insert("INSERT INTO play_history(group_id,kind,track_id,location,title,artist,album,duration_ms,started_at) VALUES($g,$k,$t,$l,$ti,$a,$al,$d,$s)",
            ("$g", gid), ("$k", it.Kind), ("$t", it.Kind == "track" ? it.RefId : null), ("$l", it.Kind == "remote" ? it.Location : null), ("$ti", it.Title ?? ""), ("$a", it.Artist ?? ""), ("$al", it.Album ?? ""), ("$d", it.DurationMs), ("$s", c.Started.ToString("O")));
        _db.Exec($"DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY id DESC LIMIT {Max})");
        var rid = c.RowId.Value;
        if (LastFm.Active) _ = Task.Run(async () => { if (await LastFm.Scrobble(it, c.Started)) _db.Exec("UPDATE play_history SET lastfm=1 WHERE id=$i", ("$i", rid)); });
        if (it.Kind == "remote" && RemoteScrobble != null) _ = Task.Run(async () => { try { await RemoteScrobble(it.Location); } catch { } });
        _ev.Publish("history");
    }

    public List<object> Recent(string? gid, int limit = 100) => _db.Query(
        $"SELECT id,group_id,kind,track_id,title,artist,album,duration_ms,started_at,finished_at,lastfm FROM play_history{(gid == null ? "" : " WHERE group_id=$g")} ORDER BY id DESC LIMIT {Math.Clamp(limit, 1, Max)}",
        r => (object)new { id = r.GetInt64(0), zoneId = r.GetString(1), zone = ZoneName?.Invoke(r.GetString(1)), kind = r.GetString(2), trackId = r.IsDBNull(3) ? (long?)null : r.GetInt64(3), title = r.GetString(4), artist = r.GetString(5), album = r.GetString(6),
            durationMs = r.GetInt64(7), startedAt = r.GetString(8), finishedAt = r.IsDBNull(9) ? null : r.GetString(9), lastfm = r.GetInt32(10) != 0 }, ("$g", gid));
    public void ClearAll() => _db.Exec("DELETE FROM play_history");
}

/// <summary>Last.fm (opt-in, off by default). Uses the official web-auth flow with the user's own API key: the session key and secret stay in this server's database
/// and are never sent to the web page. Off or not connected = no calls to Last.fm at all.</summary>
public sealed class LastFm
{
    public const string ApiUrl = "https://ws.audioscrobbler.com/2.0/", AuthUrl = "https://www.last.fm/api/auth/";
    private readonly Db _db; private readonly HttpClient _http;
    public int Calls; // outbound calls made (tests)
    public LastFm(Db db, HttpMessageHandler? h = null) { _db = db; _http = h != null ? new HttpClient(h) : new HttpClient(); _http.Timeout = TimeSpan.FromSeconds(15); _http.DefaultRequestHeaders.UserAgent.ParseAdd("WavWiz"); }
    public sealed class Cfg { public bool Enabled { get; set; } public string? ApiKey { get; set; } public string? Secret { get; set; } public string? Session { get; set; } public string? User { get; set; } public string? PendingToken { get; set; } }
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    public Cfg Get() { try { if (_db.Setting("lastfm.config") is { } j) return JsonSerializer.Deserialize<Cfg>(j, J) ?? new(); } catch { } return new(); }
    private void Put(Cfg c) => _db.SetSetting("lastfm.config", JsonSerializer.Serialize(c, J));
    public bool Active { get { var c = Get(); return c.Enabled && !string.IsNullOrEmpty(c.Session) && !string.IsNullOrEmpty(c.ApiKey) && !string.IsNullOrEmpty(c.Secret); } }
    /// <summary>What the page may see: never the secret or the session key.</summary>
    public object Status() { var c = Get(); return new { enabled = c.Enabled, connected = !string.IsNullOrEmpty(c.Session), user = c.User, hasKey = !string.IsNullOrEmpty(c.ApiKey) && !string.IsNullOrEmpty(c.Secret), pending = c.PendingToken != null, active = Active }; }

    public void SetKeys(string? key, string? secret) { var c = Get(); if (key != null) c.ApiKey = key.Trim(); if (secret != null) c.Secret = secret.Trim(); if (key != null || secret != null) { c.Session = null; c.User = null; c.PendingToken = null; } Put(c); }
    public void SetEnabled(bool on) { var c = Get(); c.Enabled = on; Put(c); }
    public void Disconnect() { var c = Get(); c.Session = null; c.User = null; c.PendingToken = null; c.Enabled = false; Put(c); }

    /// <summary>Last.fm signature: md5 of the sorted name+value pairs followed by the secret (format/callback excluded).</summary>
    public static string Sign(IDictionary<string, string> p, string secret)
    {
        var sb = new StringBuilder(); foreach (var kv in p.Where(x => x.Key is not ("format" or "callback")).OrderBy(x => x.Key, StringComparer.Ordinal)) sb.Append(kv.Key).Append(kv.Value);
        sb.Append(secret); return Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(sb.ToString()))).ToLowerInvariant();
    }
    private async Task<JsonElement?> Call(Dictionary<string, string> p, bool post)
    {
        var c = Get(); if (string.IsNullOrEmpty(c.ApiKey) || string.IsNullOrEmpty(c.Secret)) return null;
        p["api_key"] = c.ApiKey; p["api_sig"] = Sign(p, c.Secret); p["format"] = "json";
        Interlocked.Increment(ref Calls);
        using var resp = post ? await _http.PostAsync(ApiUrl, new FormUrlEncodedContent(p)) : await _http.GetAsync(ApiUrl + "?" + string.Join("&", p.Select(kv => kv.Key + "=" + Uri.EscapeDataString(kv.Value))));
        var txt = await resp.Content.ReadAsStringAsync(); try { var e = JsonDocument.Parse(txt).RootElement.Clone(); return e.TryGetProperty("error", out _) ? null : e; } catch { return null; }
    }
    /// <summary>Step 1: a request token and the Last.fm page where the user allows WavWiz.</summary>
    public async Task<(string? Url, string? Error)> Begin()
    {
        var c = Get(); if (string.IsNullOrEmpty(c.ApiKey) || string.IsNullOrEmpty(c.Secret)) return (null, "Enter your Last.fm API key and shared secret first.");
        var r = await Call(new() { ["method"] = "auth.getToken" }, false); var tok = r?.TryGetProperty("token", out var t) == true ? t.GetString() : null;
        if (tok == null) return (null, "Last.fm did not answer. Check the API key and secret.");
        c = Get(); c.PendingToken = tok; Put(c); return ($"{AuthUrl}?api_key={Uri.EscapeDataString(c.ApiKey!)}&token={Uri.EscapeDataString(tok)}", null);
    }
    /// <summary>Step 2 (after the user clicked Allow on Last.fm): swap the token for a session key, kept on this server only.</summary>
    public async Task<string?> Finish()
    {
        var c = Get(); if (c.PendingToken == null) return "Start the connection first.";
        var r = await Call(new() { ["method"] = "auth.getSession", ["token"] = c.PendingToken }, false);
        if (r is not JsonElement e || !e.TryGetProperty("session", out var s)) return "Last.fm has not confirmed yet. Click Allow on the Last.fm page, then try again.";
        c = Get(); c.Session = s.GetProperty("key").GetString(); c.User = s.TryGetProperty("name", out var n) ? n.GetString() : null; c.PendingToken = null; c.Enabled = true; Put(c); return null;
    }
    public async Task<bool> Scrobble(QueueItem it, DateTimeOffset started)
    {
        if (!Active) return false; var c = Get();
        var p = new Dictionary<string, string> { ["method"] = "track.scrobble", ["artist"] = it.Artist ?? "", ["track"] = it.Title ?? "", ["timestamp"] = started.ToUnixTimeSeconds().ToString(), ["sk"] = c.Session! };
        if (!string.IsNullOrEmpty(it.Album)) p["album"] = it.Album; if (it.DurationMs > 0) p["duration"] = (it.DurationMs / 1000).ToString();
        try { return await Call(p, true) != null; } catch { return false; }
    }
    public async Task NowPlaying(QueueItem it)
    {
        if (!Active) return; var c = Get();
        var p = new Dictionary<string, string> { ["method"] = "track.updateNowPlaying", ["artist"] = it.Artist ?? "", ["track"] = it.Title ?? "", ["sk"] = c.Session! };
        if (!string.IsNullOrEmpty(it.Album)) p["album"] = it.Album;
        try { await Call(p, true); } catch { }
    }
}
