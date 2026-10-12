using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
namespace WavWiz.Server.Features;

/// <summary>0.3.0 §1 Jukebox (beta): the host starts it (admin), guests scan a QR code and add songs from the allowed folders/playlists within
/// the rules. Guest calls carry the session code (header X-WavWiz-Guest) - never a sign-in, never any settings.</summary>
public sealed class JukeboxService
{
    public const string Header = "X-WavWiz-Guest";
    private readonly Db _db; private readonly Playback.Conductor _cond; private readonly EventHub _ev; private readonly object _l = new();
    public Func<DateTime> Clock { get; set; } = () => DateTime.UtcNow;
    public JukeboxService(Db db, Playback.Conductor cond, EventHub ev) { _db = db; _cond = cond; _ev = ev; }

    public sealed class Config
    {
        public string Style { get; set; } = "modern"; public List<string> Folders { get; set; } = new(); public List<long> Playlists { get; set; } = new();
        public int PerGuest { get; set; } = 3; public bool VoteSkip { get; set; } = true; public int VotesNeeded { get; set; } = 3; public bool ExplicitFilter { get; set; }
        public int ArtistCooldownMin { get; set; } public AutoFill Autofill { get; set; } = new(); public int Beat { get; set; } = 50; public bool CdSound { get; set; }
    }
    public sealed class AutoFill { public string Kind { get; set; } = "playlist"; public long? Id { get; set; } public string Genre { get; set; } = ""; }
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);

    public Config Cfg() { try { var j = _db.Setting("jukebox.config"); if (j != null) { var s = JsonSerializer.Deserialize<string>(j); if (s != null) return JsonSerializer.Deserialize<Config>(s, J) ?? new(); } } catch { } return new(); }
    public object CfgDto() { var c = Cfg(); var n = JsonSerializer.SerializeToNode(c, J)!.AsObject(); n["hasPin"] = _db.Setting("jukebox.pinHash") != null; return n; }

    public string? Update(JsonElement b)
    {
        if (b.Bool("reset") == true) { _db.Exec("DELETE FROM setting WHERE key='jukebox.config'"); _ev.Publish("jukebox", State()); return null; }
        var node = JsonSerializer.SerializeToNode(Cfg(), J)!.AsObject();
        foreach (var p in b.EnumerateObject())
        {
            if (p.Name == "pin") { var pin = p.Value.GetString() ?? ""; if (pin.Length is < 4 or > 8 || !pin.All(char.IsDigit)) return "The PIN must be 4 to 8 digits."; _db.SetSetting("jukebox.pinHash", JsonSerializer.Serialize(AuthService.HashPassword(pin, 50_000))); continue; }
            if (p.Name is "hasPin") continue;
            if (!node.ContainsKey(p.Name)) return $"unknown option {p.Name}";
            node[p.Name] = JsonNode.Parse(p.Value.GetRawText());
        }
        Config c; try { c = node.Deserialize<Config>(J)!; } catch { return "Some Jukebox options are not valid."; }
        if (c.Style is not ("modern" or "retro")) return "Pick Modern or Retro CD.";
        c.PerGuest = Math.Clamp(c.PerGuest, 1, 20); c.VotesNeeded = Math.Clamp(c.VotesNeeded, 1, 50); c.ArtistCooldownMin = Math.Clamp(c.ArtistCooldownMin, 0, 240); c.Beat = Math.Clamp(c.Beat, 0, 100);
        _db.SetSetting("jukebox.config", JsonSerializer.Serialize(JsonSerializer.Serialize(c, J)));
        _ev.Publish("jukebox", State()); return null;
    }
    public bool CheckPin(string? pin) { var hj = _db.Setting("jukebox.pinHash"); if (hj == null || string.IsNullOrEmpty(pin)) return false; var hash = JsonSerializer.Deserialize<string>(hj)!; return AuthService.VerifyPassword(pin, hash); }

    // ---- session state ----
    public bool Running { get; private set; }
    public string? Code { get; private set; }
    public bool Locked { get; private set; }
    private readonly Dictionary<long, (string Guest, string Name)> _req = new();   // queue item id -> requester
    private readonly HashSet<string> _banned = new();
    private readonly Dictionary<string, DateTime> _artistAt = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _votes = new(); private long _voteItem = -1;

    public object State() => new { running = Running, locked = Locked, style = Cfg().Style, code = Running ? Code : null };
    public string Start() { lock (_l) { Running = true; Locked = false; Code = Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant(); _req.Clear(); _banned.Clear(); _votes.Clear(); } _ev.Publish("jukebox", State()); return Code!; }
    public void Stop() { lock (_l) { Running = false; Code = null; } _ev.Publish("jukebox", State()); }
    public bool Guest(HttpContext c) => Running && Code != null && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(c.Request.Headers[Header].ToString() is { Length: > 0 } h ? h : c.Request.Query["j"].ToString()), System.Text.Encoding.UTF8.GetBytes(Code));
    public void SetLocked(bool on) { Locked = on; _ev.Publish("jukebox", State()); }
    public void Ban(string guest) { lock (_l) _banned.Add(guest); }

    // ---- allowed music ----
    private (string Where, (string, object?)[] Ps) Allowed(Config c)
    {
        var parts = new List<string>(); var ps = new List<(string, object?)>();
        for (int i = 0; i < c.Folders.Count; i++) { parts.Add($"path LIKE $f{i} ESCAPE '\\'"); ps.Add(($"$f{i}", c.Folders[i].TrimEnd('\\', '/').Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%")); }
        if (c.Playlists.Count > 0) parts.Add($"id IN (SELECT track_id FROM playlist_item WHERE playlist_id IN ({string.Join(",", c.Playlists.Select(x => x.ToString(System.Globalization.CultureInfo.InvariantCulture)))}) AND track_id IS NOT NULL)");
        var w = "missing=0" + (parts.Count > 0 ? " AND (" + string.Join(" OR ", parts) + ")" : "");
        if (c.ExplicitFilter) w += " AND NOT (lower(title) LIKE '%explicit%' OR lower(album) LIKE '%explicit%')";
        return (w, ps.ToArray());
    }
    public bool IsAllowed(long trackId) { var (w, ps) = Allowed(Cfg()); return Convert.ToInt32(_db.Scalar($"SELECT COUNT(*) FROM track WHERE id=$id AND {w}", ps.Append(("$id", (object?)trackId)).ToArray())) > 0; }

    /// <summary>Grouped search: Artists (song counts), Albums (track counts), Songs - counting only allowed music.</summary>
    public object Search(string q)
    {
        var (w, ps) = Allowed(Cfg()); var terms = (q ?? "").ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToArray();
        if (terms.Length == 0) return new { artists = Array.Empty<object>(), albums = Array.Empty<object>(), songs = Array.Empty<object>() };
        var tw = string.Join(" AND ", terms.Select((_, i) => $"search LIKE $t{i} ESCAPE '\\'"));
        var all = ps.Concat(terms.Select((t, i) => ($"$t{i}", (object?)("%" + t.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%")))).ToArray();
        var artists = _db.Query($"SELECT a, COUNT(*) FROM (SELECT CASE WHEN album_artist<>'' THEN album_artist ELSE artist END a FROM track WHERE {w}) WHERE a IN (SELECT CASE WHEN album_artist<>'' THEN album_artist ELSE artist END FROM track WHERE {w} AND {tw} AND (lower(artist) LIKE $t0 OR lower(album_artist) LIKE $t0)) GROUP BY a ORDER BY a COLLATE NOCASE LIMIT 20",
            r => new { name = r.GetString(0), songs = r.GetInt32(1) }, all);
        var albums = _db.Query($"SELECT a, album, COUNT(*) FROM (SELECT CASE WHEN album_artist<>'' THEN album_artist ELSE artist END a, album FROM track WHERE {w}) t WHERE album<>'' AND EXISTS (SELECT 1 FROM track x WHERE {w.Replace("path", "x.path").Replace("missing", "x.missing").Replace(" id IN", " x.id IN").Replace("lower(title)", "lower(x.title)").Replace("lower(album)", "lower(x.album)")} AND x.album=t.album AND (CASE WHEN x.album_artist<>'' THEN x.album_artist ELSE x.artist END)=t.a AND {tw.Replace("search", "x.search")}) GROUP BY a, album ORDER BY album COLLATE NOCASE LIMIT 20",
            r => new { artist = r.GetString(0), name = r.GetString(1), tracks = r.GetInt32(2) }, all);
        var songs = _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} AND {tw} ORDER BY artist, album, disc_no, track_no LIMIT 50",
            r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, all);
        return new { artists, albums, songs };
    }
    public object ArtistSongs(string name) { var (w, ps) = Allowed(Cfg()); return _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} AND (artist=$a OR album_artist=$a) ORDER BY album, disc_no, track_no", r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, ps.Append(("$a", (object?)name)).ToArray()); }
    public object AlbumSongs(string artist, string album) { var (w, ps) = Allowed(Cfg()); return _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} AND album=$al AND (album_artist=$a OR artist=$a) ORDER BY disc_no, track_no", r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, ps.Append(("$a", (object?)artist)).Append(("$al", (object?)album)).ToArray()); }

    /// <summary>A guest adds ONE song. Returns an error sentence for the guest, or null.</summary>
    public string? Add(string guest, string name, long trackId)
    {
        lock (_l)
        {
            if (!Running) return "The Jukebox is closed.";
            if (Locked) return "The host has paused requests for now.";
            if (_banned.Contains(guest)) return "Requests from this phone are turned off by the host.";
            var c = Cfg();
            if (!IsAllowed(trackId)) return "That song isn't available here.";
            var q = _cond.Queue(); var now = _cond.Now(); var upcoming = q.Skip(Math.Max(0, now.Index + 1)).Select(x => x.Id).ToHashSet();
            if (now.Item != null && now.State != "stopped") upcoming.Add(now.Item.Id);
            var mine = _req.Count(kv => kv.Value.Guest == guest && upcoming.Contains(kv.Key));
            if (mine >= c.PerGuest) return $"You already have {mine} song{(mine == 1 ? "" : "s")} waiting. Add more once one has played.";
            var items = _cond.TracksToItems(new[] { trackId }); if (items.Count == 0) return "That song isn't available here.";
            var it = items[0];
            if (c.ArtistCooldownMin > 0 && _artistAt.TryGetValue(it.Artist, out var at) && Clock() - at < TimeSpan.FromMinutes(c.ArtistCooldownMin)) return $"{it.Artist} played a moment ago. Try another artist for now.";
            _cond.Add(items, false);
            if (_cond.State == Playback.PlayState.Stopped) { var qq = _cond.Queue(); _cond.Jump(qq.Count - 1); }
            var added = _cond.Queue().LastOrDefault(); if (added != null) _req[added.Id] = (guest, string.IsNullOrWhiteSpace(name) ? "Guest" : name.Trim()[..Math.Min(24, name.Trim().Length)]);
            _artistAt[it.Artist] = Clock();
            _ev.Publish("queue"); return null;
        }
    }

    /// <summary>Vote to skip the current song (one vote per guest per song). Returns (votes, needed, skipped).</summary>
    public (int Votes, int Needed, bool Skipped, string? Err) Vote(string guest)
    {
        lock (_l)
        {
            var c = Cfg(); if (!Running) return (0, 0, false, "The Jukebox is closed."); if (!c.VoteSkip) return (0, 0, false, "Vote to skip is off.");
            var cur = _cond.Now().Item; if (cur == null) return (0, c.VotesNeeded, false, "Nothing is playing.");
            if (_voteItem != cur.Id) { _votes.Clear(); _voteItem = cur.Id; }
            _votes.Add(guest);
            if (_votes.Count >= c.VotesNeeded) { _votes.Clear(); _cond.Next(); _ev.Publish("now"); return (c.VotesNeeded, c.VotesNeeded, true, null); }
            return (_votes.Count, c.VotesNeeded, false, null);
        }
    }

    /// <summary>Now playing + next songs with requester names (big screen and guest page).</summary>
    public object Board()
    {
        var now = _cond.Now(); var q = _cond.Queue(); var c = Cfg();
        string? Who(long id) => _req.TryGetValue(id, out var r) ? r.Name : null;
        return new { running = Running, locked = Locked, style = c.Style, voteSkip = c.VoteSkip, votesNeeded = c.VotesNeeded, votes = _voteItem == now.Item?.Id ? _votes.Count : 0, beat = c.Beat, cdSound = c.CdSound,
            now = now.Item == null ? null : new { title = now.Item.Title, artist = now.Item.Artist, album = now.Item.Album, artUrl = now.Item.ArtUrl, refId = now.Item.RefId, by = Who(now.Item.Id), state = now.State, positionMs = now.PositionMs, durationMs = now.DurationMs },
            next = q.Skip(Math.Max(0, now.Index + 1)).Take(10).Select(x => new { id = x.Id, title = x.Title, artist = x.Artist, by = Who(x.Id) }) };
    }

    /// <summary>Auto-fill: when the queue runs dry, add a random allowed song from the chosen playlist (or genre). Called every second.</summary>
    public void Tick()
    {
        if (!Running) return;
        var c = Cfg(); if (c.Autofill.Id == null && string.IsNullOrEmpty(c.Autofill.Genre)) return;
        var now = _cond.Now(); var q = _cond.Queue();
        bool dry = q.Count == 0 || now.Index >= q.Count - 1 && (now.State == "stopped" || now.DurationMs > 0 && now.DurationMs - now.PositionMs < 15_000);
        if (!dry) return;
        if (q.Count > 0 && now.Index < q.Count - 1) return;
        var (w, ps) = Allowed(c);
        var src = c.Autofill.Id != null ? $" AND id IN (SELECT track_id FROM playlist_item WHERE playlist_id={c.Autofill.Id.Value})" : " AND genre=$g";
        var id = _db.Scalar($"SELECT id FROM track WHERE {w}{src} ORDER BY random() LIMIT 1", ps.Append(("$g", (object?)c.Autofill.Genre)).ToArray());
        if (id == null) return;
        var items = _cond.TracksToItems(new[] { Convert.ToInt64(id) }); if (items.Count == 0) return;
        _cond.Add(items, false); if (now.State == "stopped") _cond.Jump(_cond.Queue().Count - 1);
        _ev.Publish("queue");
    }
}
