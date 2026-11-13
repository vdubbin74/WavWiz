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
    /// <summary>0.4.0: the Jukebox's own zone (its picked speakers) once there is one; else the house group, like 0.3.9.</summary>
    public Func<Playback.Conductor?>? Zone { get; set; }
    private Playback.Conductor Cond => Zone?.Invoke() ?? _cond;

    public sealed class Config
    {
        public string Style { get; set; } = "modern"; public List<string> Folders { get; set; } = new(); public List<long> Playlists { get; set; } = new();
        public int PerGuest { get; set; } = 3; public bool VoteSkip { get; set; } = true; public int VotesNeeded { get; set; } = 3; public bool ExplicitFilter { get; set; }
        public int ArtistCooldownMin { get; set; } public AutoFill Autofill { get; set; } = new(); public int Beat { get; set; } = 50; public bool CdSound { get; set; }
        /// <summary>0.4.9 F76: the Jukebox zone's default speakers (device ids; null = none saved yet) and whether the Jukebox zone shows in Devices when it is not running.</summary>
        public List<long>? DefaultSpeakers { get; set; } public bool ShowInDevices { get; set; } = true;
        /// <summary>0.6.9 #19 (t1847): the Jukebox zone's OFF / ON (see JukeboxPower). Off by default - fresh setups and installs that never set it.</summary>
        public bool ZoneOn { get; set; }
    }
    public sealed class AutoFill { public string Kind { get; set; } = "playlist"; public long? Id { get; set; } public string Genre { get; set; } = ""; }
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);

    public Config Cfg() { try { var j = _db.Setting("jukebox.config"); if (j != null) { var s = JsonSerializer.Deserialize<string>(j); if (s != null) return JsonSerializer.Deserialize<Config>(s, J) ?? new(); } } catch { } return new(); }
    public object CfgDto() { var c = Cfg(); var n = JsonSerializer.SerializeToNode(c, J)!.AsObject(); n["hasPin"] = _db.Setting("jukebox.pinHash") != null; return n; }

    public string? Update(JsonElement b)
    {
        if (b.Bool("reset") == true) { _db.Exec("DELETE FROM setting WHERE key='jukebox.config'"); try { Saved?.Invoke(); } catch { } _ev.Publish("jukebox", State()); return null; }
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
        if (c.DefaultSpeakers != null) c.DefaultSpeakers = c.DefaultSpeakers.Where(x => x > 0).Distinct().Take(200).ToList();   // 0.4.9 F76
        _db.SetSetting("jukebox.config", JsonSerializer.Serialize(JsonSerializer.Serialize(c, J)));
        try { Saved?.Invoke(); } catch { }   // 0.6.9 #19: the Jukebox zone's speakers follow a saved OFF / ON
        _ev.Publish("jukebox", State()); _ev.Publish("zones"); return null;
    }
    /// <summary>0.6.9 #19: runs after the settings are saved (the host wires JukeboxPower.Apply).</summary>
    public Action? Saved;
    public bool CheckPin(string? pin) { var hj = _db.Setting("jukebox.pinHash"); if (hj == null || string.IsNullOrEmpty(pin)) return false; var hash = JsonSerializer.Deserialize<string>(hj)!; return AuthService.VerifyPassword(pin, hash); }

    // ---- session state ----
    public bool Running { get; private set; }
    /// <summary>0.4.9 F76 fix: hands the borrowed speakers back to their own zones (set by the host; runs after Stop).</summary>
    public Action? Release;
    private volatile bool _starting;
    /// <summary>0.4.9 F76 fix: running, or starting (speakers being borrowed) - while false, no speaker may stay in the Jukebox zone.</summary>
    public bool Active => Running || _starting;
    /// <summary>The queue the Jukebox autofill owns while it runs (Keep playing leaves that one alone).</summary>
    public Playback.Conductor? Owns => Active ? Cond : null;
    /// <summary>0.4.9 F76 fix: borrows these speakers (device ids) into the Jukebox zone for this session.</summary>
    public Action<List<long>>? Borrow;
    public string? Code { get; private set; }
    public bool Locked { get; private set; }
    private readonly Dictionary<long, (string Guest, string Name, string? Net)> _req = new();   // queue item id -> requester (0.6.9 J3: + network key)
    private readonly HashSet<string> _banned = new();
    // 0.6.9 J3: the per-guest limit, bans and votes also follow the phone's network address, so clearing the browser (a new random guest id)
    // no longer gives fresh picks. Privacy-light: only a salted hash of the address is kept, in memory, for this Jukebox session (a new salt on
    // every Start; nothing is saved to disk or sent to any page). Limit: phones behind one shared address (a guest network that NATs every phone
    // to one IP, a reverse proxy) count as one guest - the host can press Reset guests.
    private readonly HashSet<string> _bannedNet = new();
    private readonly HashSet<string> _voteNets = new();
    private byte[] _salt = RandomNumberGenerator.GetBytes(16);
    /// <summary>0.6.9 J3: the session key for a client address (salted SHA-256, 16 hex chars), or null when there is no address.</summary>
    public string? NetKey(System.Net.IPAddress? ip)
    {
        if (ip == null) return null;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (System.Net.IPAddress.IsLoopback(ip)) return null;   // the server PC itself (its own big screen / browser): the guest id alone, as before
        byte[] salt; lock (_l) salt = _salt;
        return Convert.ToHexString(HMACSHA256.HashData(salt, ip.GetAddressBytes()))[..16].ToLowerInvariant();
    }
    private readonly Dictionary<string, DateTime> _artistAt = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _votes = new(); private long _voteItem = -1;

    public object State() => new { running = Running, locked = Locked, style = Cfg().Style, code = Running ? Code : null };
    /// <summary>The host's look (theme colors) so the guest page matches the big screen. Only #RRGGBB values are kept.</summary>
    public Dictionary<string, string> Theme { get; private set; } = new();
    public string Start(JsonElement? theme = null, List<long>? speakers = null)
    {
        var t = new Dictionary<string, string>();
        if (theme is { ValueKind: JsonValueKind.Object } th)
            foreach (var k in new[] { "accent", "accent2", "hl", "bg", "ink" })
                if (th.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String && System.Text.RegularExpressions.Regex.IsMatch(v.GetString()!, "^#[0-9a-fA-F]{6}$")) t[k] = v.GetString()!;
        Theme = t; return StartCore(speakers);
    }
    private string StartCore(List<long>? speakers = null)
    {
        lock (_l)
        {
            // 0.3.5 J13: start with an EMPTY playlist so guest picks play promptly; the host's playlist is kept and comes back on Stop
            // 0.4.9 F76 fix: borrow the picked speakers first (Active while starting), so the Jukebox zone is the queue set aside below
            if (speakers != null) { _starting = true; try { Borrow?.Invoke(speakers); } catch { } }
            if (!Running)
            {
                var q = Cond.Queue(); var now = Cond.Now();
                _saved = q.Count > 0 ? (q.ToList(), Math.Clamp(now.Index, 0, q.Count - 1)) : null;
                if (q.Count > 0) Cond.Clear();
            }
            Running = true; _starting = false; Locked = false; Code = Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant(); _req.Clear(); _banned.Clear(); _votes.Clear(); _filler.Clear(); _bannedNet.Clear(); _voteNets.Clear(); _salt = RandomNumberGenerator.GetBytes(16);
        }
        _ev.Publish("jukebox", State()); return Code!;
    }
    public void Stop()
    {
        lock (_l)
        {
            if (!Running) return;
            Running = false; Code = null;
            // 0.3.5 J13: put the host's playlist back. The song playing now keeps playing; the old playlist sits around it in its old order and
            // carries on from the song that was playing when Jukebox started. Jukebox songs still to come are dropped.
            var sv = _saved; _saved = null; _filler.Clear();
            if (sv is { } s0 && s0.Items.Count > 0)
            {
                var now = Cond.Now(); var q = Cond.Queue();
                if (now.Item != null && now.State != "stopped")
                {
                    for (int i = q.Count - 1; i >= 0; i--) if (q[i].Id != now.Item.Id) Cond.Remove(i);
                    Cond.Insert(s0.Items.Skip(s0.Index), 1);
                    Cond.Insert(s0.Items.Take(s0.Index), 0);
                }
                else { Cond.Clear(); Cond.Add(s0.Items, false); }
            }
        }
        try { Release?.Invoke(); } catch { }   // 0.4.9 F76 fix: Exit Jukebox returns every borrowed speaker to its zone
        _ev.Publish("jukebox", State()); _ev.Publish("queue");
    }
    private (List<QueueItem> Items, int Index)? _saved;
    private readonly HashSet<long> _filler = new();   // 0.3.5 J13: queue item ids added as random filler (guest picks go in front of them)
    /// <summary>0.3.5 J13: true when the host's playlist is being kept aside (tests / host UI).</summary>
    public int SavedCount { get { lock (_l) return _saved?.Items.Count ?? 0; } }
    public bool Guest(HttpContext c) => Running && Code != null && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(c.Request.Headers[Header].ToString() is { Length: > 0 } h ? h : c.Request.Query["j"].ToString()), System.Text.Encoding.UTF8.GetBytes(Code));
    public void SetLocked(bool on) { Locked = on; _ev.Publish("jukebox", State()); }
    public void Ban(string guest) { lock (_l) { _banned.Add(guest); foreach (var r in _req.Values) if (r.Guest == guest && r.Net != null) _bannedNet.Add(r.Net); } }
    /// <summary>0.6.9 J3: host "Reset guests" - lifts bans and frees every guest's waiting picks from the limit (the songs stay queued with
    /// their requester names), so everyone starts again with their full allowance.</summary>
    public void ResetGuests()
    {
        lock (_l)
        {
            _banned.Clear(); _bannedNet.Clear();
            foreach (var k in _req.Keys.ToList()) { var r = _req[k]; _req[k] = ("", r.Name, null); }
        }
        _ev.Publish("queue");
    }

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
    /// <summary>0.6.9 J1: the album cover for a queued song with no picture of its own - the album's first song that has an embedded picture
    /// (the same rule as the Library's album tile, LibraryBrowse.FirstTrackOfAlbum). Null for Unknown Album or when no song of the album has one.</summary>
    public long? AlbumArtTrack(long trackId)
    {
        var row = _db.Query("SELECT album_artist, album FROM track WHERE id=$i", r => (Ar: r.GetString(0), Al: r.GetString(1)), ("$i", trackId)).FirstOrDefault();
        if (row.Al == null || Library.OnlineArt.IsUnknown(row.Al)) return null;
        var id = _db.Scalar("SELECT id FROM track WHERE missing=0 AND has_art=1 AND album_artist=$ar AND album=$al ORDER BY disc_no, track_no, id LIMIT 1", ("$ar", row.Ar), ("$al", row.Al));
        return id == null ? null : Convert.ToInt64(id);
    }
    public bool IsAllowed(long trackId) { var (w, ps) = Allowed(Cfg()); return Convert.ToInt32(_db.Scalar($"SELECT COUNT(*) FROM track WHERE id=$id AND {w}", ps.Append(("$id", (object?)trackId)).ToArray())) > 0; }

    /// <summary>0.6.9 #28 (t1878): Remote library songs join the guest search only when the host allows ALL music (no folder / playlist picks -
    /// those name local music only). Radio is never in it.</summary>
    public bool RemoteOk() => RemoteOk(Cfg());
    private static bool RemoteOk(Config c) => c.Folders.Count == 0 && c.Playlists.Count == 0;
    private static bool Explicit(string? title, string? album) => (title ?? "").Contains("explicit", StringComparison.OrdinalIgnoreCase) || (album ?? "").Contains("explicit", StringComparison.OrdinalIgnoreCase);
    /// <summary>0.6.9 #28: one song in the guest search. Local songs keep their old shape (id = track id); a Remote song has no id but `rid`
    /// ("server:song", what /guest/add takes), `src` (the library's name, shown small) and `art` (the guest cover URL).</summary>
    public sealed record Song(long? Id, string Title, string Artist, string Album, long DurationMs,
        [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Rid = null,
        [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Src = null,
        [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Art = null);
    static string Key(string? t, string? a) => string.Join(' ', (t ?? "").ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries)) + "\u0001" + string.Join(' ', (a ?? "").ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    /// <summary>0.6.9 #28, pure: Local songs first, then Remote ones that are not already there (same title + artist, case / spacing ignored - the
    /// same song in both libraries shows once, as Local), also no duplicates between Remote servers. Live items and explicit ones (when filtered) are left out.</summary>
    public static List<Song> MergeSongs(IEnumerable<Song> local, IEnumerable<(QueueItem It, string Src)> remote, bool explicitFilter, int max = 50)
    {
        var outp = local.ToList(); var seen = outp.Select(x => Key(x.Title, x.Artist)).ToHashSet();
        foreach (var (it, src) in remote)
        {
            if (outp.Count >= max) break;
            if (it.Kind != "remote" || !it.Location.StartsWith(Library.SubsonicService.Scheme) || explicitFilter && Explicit(it.Title, it.Album)) continue;
            if (!seen.Add(Key(it.Title, it.Artist))) continue;
            outp.Add(new Song(null, it.Title, it.Artist, it.Album, it.DurationMs, it.Location[Library.SubsonicService.Scheme.Length..], src, GuestArt(it)));
        }
        return outp;
    }
    /// <summary>0.6.9 #28: the guest-page cover for a Remote item: its /remote/{sid}/art/{cover} picture through the guest route (the session
    /// code instead of a sign-in). Null for anything else.</summary>
    public static string? GuestArt(QueueItem x)
    {
        const string P = "/api/v1/remote/";
        if (x.Kind != "remote" || x.ArtUrl is not { } u || !u.StartsWith(P)) return null;
        var rest = u[P.Length..]; var i = rest.IndexOf("/art/", StringComparison.Ordinal);
        return i <= 0 ? null : $"/api/v1/jukebox/guest/rart/{rest[..i]}/{rest[(i + 5)..]}";
    }

    /// <summary>Grouped search: Artists (song counts), Albums (track counts), Songs - counting only allowed music.</summary>
    public object Search(string q) => Search(q, null);
    /// <summary>0.6.9 #28: the same, with Remote library songs (already fetched by the caller) merged into Songs.</summary>
    public object Search(string q, IEnumerable<(QueueItem It, string Src)>? remote)
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
            r => new Song(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt64(4)), all);
        return new { artists, albums, songs = remote == null ? songs : MergeSongs(songs, remote, Cfg().ExplicitFilter) };
    }
    /// <summary>0.3.4 H4 Retro CD: "More to pick" (B1-B5) - a few random allowed songs that are not already queued. Read-only suggestions.</summary>
    public object Picks(int n = 5)
    {
        var (w, ps) = Allowed(Cfg()); n = Math.Clamp(n, 1, 10);
        var queued = Cond.Queue().Where(x => x.Kind == "track").Select(x => x.RefId).ToHashSet();
        var rows = _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} ORDER BY random() LIMIT {n + Math.Min(40, queued.Count)}",
            r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, ps);
        return rows.Where(x => !queued.Contains(x.id)).Take(n).ToList();
    }
    public object ArtistSongs(string name) { var (w, ps) = Allowed(Cfg()); return _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} AND (artist=$a OR album_artist=$a) ORDER BY album, disc_no, track_no", r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, ps.Append(("$a", (object?)name)).ToArray()); }
    public object AlbumSongs(string artist, string album) { var (w, ps) = Allowed(Cfg()); return _db.Query($"SELECT id,title,artist,album,duration_ms FROM track WHERE {w} AND album=$al AND (album_artist=$a OR artist=$a) ORDER BY disc_no, track_no", r => new { id = r.GetInt64(0), title = r.GetString(1), artist = r.GetString(2), album = r.GetString(3), durationMs = r.GetInt64(4) }, ps.Append(("$a", (object?)artist)).Append(("$al", (object?)album)).ToArray()); }

    /// <summary>A guest adds ONE song. Returns an error sentence for the guest, or null.</summary>
    public string? Add(string guest, string name, long trackId, string? net = null) => AddAt(guest, name, trackId, net).Err;
    /// <summary>0.6.9 J4: adds like Add and also says where the song landed in Up next (1 = plays next; 0 = playing now) for "Added - you're #4".</summary>
    public (string? Err, int Pos) AddAt(string guest, string name, long trackId, string? net = null) => AddAt(guest, name, trackId, null, net);
    /// <summary>0.6.9 #28 (t1878): a guest's Remote library pick - the item was looked up on its server (SubsonicService.SongItem), same rules as a local song.</summary>
    public (string? Err, int Pos) AddRemoteAt(string guest, string name, QueueItem? item, string? net = null) => AddAt(guest, name, 0, item ?? new QueueItem(0, "remote", "", "", "", "", 0, null), net);
    private (string? Err, int Pos) AddAt(string guest, string name, long trackId, QueueItem? remote, string? net)
    {
        var err = AddCore(guest, name, trackId, remote, net, out var itemId); if (err != null) return (err, -1);
        lock (_l)
        {
            var q = Cond.Queue(); var now = Cond.Now(); var i = q.ToList().FindIndex(x => x.Id == itemId);
            return (null, i < 0 ? -1 : now.Item?.Id == itemId && now.State != "stopped" ? 0 : Math.Max(1, i - now.Index));
        }
    }
    /// <summary>0.6.9 J4: a guest takes back one of their OWN picks that has not started playing yet (same guest id or same phone address).</summary>
    public string? RemovePick(string guest, long itemId, string? net = null)
    {
        lock (_l)
        {
            if (!Running) return "The Jukebox is closed.";
            if (!_req.TryGetValue(itemId, out var r) || !Same(r, guest, net)) return "You can only remove your own picks.";
            var q = Cond.Queue(); var now = Cond.Now(); var i = q.ToList().FindIndex(x => x.Id == itemId);
            if (i < 0) return "That song has already played.";
            if (i <= now.Index || now.Item?.Id == itemId) return "That song is already playing.";
            Cond.Remove(i); _req.Remove(itemId);
        }
        _ev.Publish("queue"); return null;
    }
    private string? AddCore(string guest, string name, long trackId, QueueItem? remote, string? net, out long itemId)
    {
        itemId = -1;
        lock (_l)
        {
            if (!Running) return "The Jukebox is closed.";
            if (Locked) return "The host has paused requests for now.";
            if (_banned.Contains(guest) || net != null && _bannedNet.Contains(net)) return "Requests from this phone are turned off by the host.";
            var c = Cfg();
            if (remote != null ? !RemoteOk(c) || remote.Kind != "remote" || remote.Location.Length == 0 || c.ExplicitFilter && Explicit(remote.Title, remote.Album) : !IsAllowed(trackId)) return "That song isn't available here.";
            var q = Cond.Queue(); var now = Cond.Now(); var upcoming = q.Skip(Math.Max(0, now.Index + 1)).Select(x => x.Id).ToHashSet();
            if (now.Item != null && now.State != "stopped") upcoming.Add(now.Item.Id);
            var mine = Waiting(guest, net);
            if (mine >= c.PerGuest) return $"You already have {mine} song{(mine == 1 ? "" : "s")} waiting. Add more once one has played.";
            var items = remote != null ? new List<QueueItem> { remote } : Cond.TracksToItems(new[] { trackId }); if (items.Count == 0) return "That song isn't available here.";
            var it = items[0];
            if (c.ArtistCooldownMin > 0 && _artistAt.TryGetValue(it.Artist, out var at) && Clock() - at < TimeSpan.FromMinutes(c.ArtistCooldownMin)) return $"{it.Artist} played a moment ago. Try another artist for now.";
            // 0.3.5 J13: guest picks always go before random filler
            var before = q.Select(x => x.Id).ToHashSet(); var pos = -1;
            for (int i = Math.Max(0, now.Index + 1); i < q.Count; i++) if (_filler.Contains(q[i].Id)) { pos = i; break; }
            if (pos >= 0) Cond.Insert(items, pos); else Cond.Add(items, false);
            var qn = Cond.Queue(); var added = qn.FirstOrDefault(x => !before.Contains(x.Id));
            if (Cond.State == Playback.PlayState.Stopped && added != null) Cond.Jump(qn.ToList().FindIndex(x => x.Id == added.Id));
            if (added != null) itemId = added.Id;
            if (added != null) _req[added.Id] = (guest, string.IsNullOrWhiteSpace(name) ? "Guest" : name.Trim()[..Math.Min(24, name.Trim().Length)], net);
            _artistAt[it.Artist] = Clock();
            _ev.Publish("queue"); return null;
        }
    }

    /// <summary>0.3.5 J18: this guest's picks still to play or playing now - the same count the per-guest limit uses (unchanged since 0.3.0),
    /// so the guest page's "N available plays" always matches what the server allows. A play comes back once that pick has played or is removed.</summary>
    /// 0.6.9 J3: a pick counts for this guest when it carries the guest id OR came from the same network address (a cleared browser).
    private int Waiting(string guest, string? net = null)
    {
        var q = Cond.Queue(); var now = Cond.Now(); var upcoming = q.Skip(Math.Max(0, now.Index + 1)).Select(x => x.Id).ToHashSet();
        if (now.Item != null && now.State != "stopped") upcoming.Add(now.Item.Id);
        return _req.Count(kv => Same(kv.Value, guest, net) && upcoming.Contains(kv.Key));
    }
    static bool Same((string Guest, string Name, string? Net) r, string? guest, string? net) => !string.IsNullOrEmpty(guest) && r.Guest == guest || net != null && r.Net == net;
    /// <summary>Vote to skip the current song (one vote per guest per song). Returns (votes, needed, skipped).</summary>
    public (int Votes, int Needed, bool Skipped, string? Err) Vote(string guest, string? net = null)
    {
        lock (_l)
        {
            var c = Cfg(); if (!Running) return (0, 0, false, "The Jukebox is closed."); if (!c.VoteSkip) return (0, 0, false, "Vote to skip is off.");
            var cur = Cond.Now().Item; if (cur == null) return (0, c.VotesNeeded, false, "Nothing is playing.");
            if (_voteItem != cur.Id) { _votes.Clear(); _voteNets.Clear(); _voteItem = cur.Id; }
            // 0.6.9 J3: one vote per phone - a cleared browser (new guest id) on the same address does not vote twice
            if (net == null || _voteNets.Add(net)) _votes.Add(guest);
            if (_votes.Count >= c.VotesNeeded) { _votes.Clear(); _voteNets.Clear(); Cond.Next(); _ev.Publish("now"); return (c.VotesNeeded, c.VotesNeeded, true, null); }
            return (_votes.Count, c.VotesNeeded, false, null);
        }
    }

    /// <summary>Now playing + next songs with requester names (big screen and guest page).</summary>
    /// 0.3.4: <paramref name="me"/> = the asking phone's guest id; only its own picks get mine = true.
    public object Board(bool host = false, string? me = null, string? net = null)
    {
        var now = Cond.Now(); var q = Cond.Queue(); var c = Cfg();
        string? Who(long id) => _req.TryGetValue(id, out var r) ? r.Name : null;
        int? left = null; if (!string.IsNullOrEmpty(me)) lock (_l) left = Math.Max(0, c.PerGuest - Waiting(me, net));
        return new { running = Running, locked = Locked, style = c.Style, playsLeft = left, filler = now.Item != null && _filler.Contains(now.Item.Id), voteSkip = c.VoteSkip, votesNeeded = c.VotesNeeded, votes = _voteItem == now.Item?.Id ? _votes.Count : 0, voted = !string.IsNullOrEmpty(me) && _voteItem == now.Item?.Id && (_votes.Contains(me) || net != null && _voteNets.Contains(net)), beat = c.Beat, cdSound = c.CdSound, theme = Theme, perGuest = c.PerGuest,
            now = now.Item == null ? null : new { title = now.Item.Title, artist = now.Item.Artist, album = now.Item.Album, trackId = now.Item.Kind == "track" ? now.Item.RefId : null, art = GuestArt(now.Item), by = Who(now.Item.Id), mine = !string.IsNullOrEmpty(me) && _req.TryGetValue(now.Item.Id, out var r0) && Same(r0, me, net), state = now.State, positionMs = now.PositionMs, durationMs = now.DurationMs },
            next = q.Skip(Math.Max(0, now.Index + 1)).Take(10).Select((x, i) => new { id = x.Id, index = Math.Max(0, now.Index + 1) + i, title = x.Title, artist = x.Artist, trackId = x.Kind == "track" ? x.RefId : null, art = GuestArt(x), by = Who(x.Id), guest = host && _req.TryGetValue(x.Id, out var r) && r.Guest.Length > 0 ? r.Guest : null, mine = !string.IsNullOrEmpty(me) && _req.TryGetValue(x.Id, out var r2) && Same(r2, me, net) }) };
    }

    /// <summary>0.6.9 #27 (t1877): a radio station already in the Jukebox's queue (added before it started, or by an older client) is taken out - a stream
    /// never ends, so the Jukebox would never get to the guests' songs. If it was playing, the queue moves on to the next song. Returns how many went.</summary>
    public int DropRadio()
    {
        if (!Running) return 0;
        var q = Cond.Queue(); int n = 0;
        for (int i = q.Count - 1; i >= 0; i--) if (q[i].Kind == "radio" && Cond.Remove(i)) n++;
        if (n > 0) _ev.Publish("queue");
        return n;
    }
    /// <summary>Auto-fill: when the queue runs dry, add a random allowed song from the chosen playlist (or genre). Called every second.</summary>
    public void Tick()
    {
        if (!Running) return;
        DropRadio();
        var c = Cfg();
        var now = Cond.Now(); var q = Cond.Queue();
        bool dry = q.Count == 0 || now.Index >= q.Count - 1 && (now.State == "stopped" || now.DurationMs > 0 && now.DurationMs - now.PositionMs < 15_000);
        if (!dry) return;
        if (q.Count > 0 && now.Index < q.Count - 1) return;
        var (w, ps) = Allowed(c);
        // 0.3.5 J13: random filler from the chosen playlist / genre, else from all the allowed music
        var src = c.Autofill.Id != null ? $" AND id IN (SELECT track_id FROM playlist_item WHERE playlist_id={c.Autofill.Id.Value})" : !string.IsNullOrEmpty(c.Autofill.Genre) ? " AND genre=$g" : "";
        var recent = q.Where(x => x.Kind == "track" && x.RefId != null).Select(x => x.RefId!.Value).TakeLast(20).ToList();
        var notRecent = recent.Count > 0 ? $" AND id NOT IN ({string.Join(",", recent)})" : "";
        var id = _db.Scalar($"SELECT id FROM track WHERE {w}{src}{notRecent} ORDER BY random() LIMIT 1", ps.Append(("$g", (object?)c.Autofill.Genre)).ToArray())
              ?? _db.Scalar($"SELECT id FROM track WHERE {w}{src} ORDER BY random() LIMIT 1", ps.Append(("$g", (object?)c.Autofill.Genre)).ToArray());
        if (id == null) return;
        var items = Cond.TracksToItems(new[] { Convert.ToInt64(id) }); if (items.Count == 0) return;
        lock (_l)
        {
            if (!Running) return;
            var before = Cond.Queue().Select(x => x.Id).ToHashSet();
            Cond.Add(items, false); var added = Cond.Queue().FirstOrDefault(x => !before.Contains(x.Id)); if (added != null) _filler.Add(added.Id);
            if (Cond.State == Playback.PlayState.Stopped) Cond.Jump(Cond.Queue().Count - 1);
        }
        _ev.Publish("queue");
    }
}
