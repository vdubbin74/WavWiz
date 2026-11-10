using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Features;

/// <summary>Keep playing: when an everyday zone's queue runs dry, add one more song (or a radio station) so the music does not stop.
/// One setting per playback group (linked boxes share one group, so only the shared leader queue fills). The Jukebox zone keeps its own autofill.</summary>
public sealed class KeepPlayingService
{
    public const string Origin = "keep", Label = "Keep playing";
    public static readonly TimeSpan NoRepeat = TimeSpan.FromHours(6);
    public static readonly string[] Modes = { "off", "playlist", "similar", "radio" };
    private readonly Db _db; private readonly ConductorRegistry _reg; private readonly EventHub _ev; private readonly object _l = new();
    public Func<DateTime> Clock { get; set; } = () => DateTime.UtcNow;
    /// <summary>The conductor the Jukebox owns right now (null when the Jukebox is not running): Keep playing never fills that one.</summary>
    public Func<Conductor?>? JukeboxOwns { get; set; }
    /// <summary>Extra pools by mode name (e.g. rule-based lists): (id) -> local track ids.</summary>
    public Dictionary<string, Func<long, IReadOnlyList<long>>> Pools { get; } = new();
    public Dictionary<string, Func<long, string?>> PoolNames { get; } = new();
    private readonly Dictionary<string, Config> _cache = new();
    private readonly Dictionary<string, Dictionary<long, DateTime>> _played = new();   // group -> track id -> when Keep playing last picked it
    private readonly Dictionary<string, DateTime> _lastFill = new();
    public KeepPlayingService(Db db, ConductorRegistry reg, EventHub ev) { _db = db; _reg = reg; _ev = ev; }

    public sealed class Config { public string Mode { get; set; } = "off"; public long? Id { get; set; } public string? Name { get; set; } }
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    private static string Key(string gid) => "queue.keepPlaying." + gid;

    public Config Get(string gid)
    {
        lock (_l) if (_cache.TryGetValue(gid, out var c)) return c;
        Config r = new(); try { if (_db.Setting(Key(gid)) is { } j) r = JsonSerializer.Deserialize<Config>(j, J) ?? new(); } catch { r = new(); }
        lock (_l) _cache[gid] = r; return r;
    }
    public string? Set(string gid, string? mode, long? id)
    {
        mode = (mode ?? "off").Trim().ToLowerInvariant();
        if (!Modes.Contains(mode) && !Pools.ContainsKey(mode)) return "Pick Off, a playlist, a smart playlist, Similar music or a radio station.";
        string? name = null;
        if (mode == "playlist") { if (id == null || (name = _db.Scalar("SELECT name FROM playlist WHERE id=$i", ("$i", id)) as string) == null) return "Pick a playlist."; }
        else if (mode == "radio") { if (id == null || (name = _db.Scalar("SELECT name FROM radio_station WHERE id=$i", ("$i", id)) as string) == null) return "Pick a radio station."; }
        else if (Pools.ContainsKey(mode)) { if (id == null || (name = PoolNames.TryGetValue(mode, out var pn) ? pn(id.Value) : "") == null) return "Pick a smart playlist."; }
        else id = null;
        var c = new Config { Mode = mode, Id = id, Name = name };
        if (mode == "off") _db.DeleteSetting(Key(gid)); else _db.SetSetting(Key(gid), JsonSerializer.Serialize(c, J));
        lock (_l) _cache[gid] = c;
        _ev.Publish("queue"); return null;
    }
    public void Forget(string gid) { lock (_l) _cache.Remove(gid); }

    /// <summary>Called every second: each live group whose queue has nothing left after the song now playing (and is near its end) gets ONE more item.</summary>
    public void Tick()
    {
        var jb = JukeboxOwns?.Invoke();
        foreach (var cd in _reg.Live())
        {
            if (ReferenceEquals(cd, jb)) continue;   // the Jukebox's own autofill owns that queue
            try { TickOne(cd); } catch { /* never disturbs playback */ }
        }
    }

    /// <summary>True when the group's queue is about to run dry: playing, nothing up next (repeat / shuffle accounted for), and the song ends within 15 s.</summary>
    public static bool Dry(NowPlaying now, int count)
        => count > 0 && now.State == "playing" && now.NextIndex < 0 && now.Item != null && now.Item.Kind is "track" or "remote" && now.DurationMs > 0 && now.DurationMs - now.PositionMs < 15_000;

    public bool TickOne(Conductor cd)
    {
        var c = Get(cd.GroupId); if (c.Mode == "off") return false;
        var now = cd.Now(); var q = cd.Queue();
        if (!Dry(now, q.Count)) return false;
        var t = Clock();
        lock (_l) { if (_lastFill.TryGetValue(cd.GroupId, out var lf) && (t - lf).TotalSeconds < 20) return false; _lastFill[cd.GroupId] = t; }
        var item = Pick(cd.GroupId, c, now.Item, q); if (item == null) return false;
        cd.Add(new[] { item with { Origin = Origin } }, false);
        _ev.Publish("queue"); return true;
    }

    /// <summary>0.6.8-#3: Skip (Next) with Keep playing on and nothing queued after the current song: add the next auto-pick now so
    /// Next advances to it instead of stopping. Not for the Jukebox's own zone, receivers or an empty queue. True when an item was added.</summary>
    public bool FillForSkip(Conductor cd)
    {
        if (ReferenceEquals(cd, JukeboxOwns?.Invoke())) return false;
        var c = Get(cd.GroupId); if (c.Mode == "off") return false;
        var now = cd.Now(); var q = cd.Queue();
        if (q.Count == 0 || now.NextIndex >= 0 || now.Item == null || now.Item.Kind is not ("track" or "remote" or "radio")) return false;
        if (c.Mode == "radio" && now.Item.Kind == "radio" && now.Item.RefId == c.Id) return false;   // already on the Keep playing station
        var item = Pick(cd.GroupId, c, now.Item, q); if (item == null) return false;
        lock (_l) _lastFill[cd.GroupId] = Clock();   // the 1 s tick must not add a second one right after
        cd.Add(new[] { item with { Origin = Origin } }, false);
        _ev.Publish("queue"); return true;
    }

    /// <summary>The next item for this group's setting, or null when there is nothing to pick.</summary>
    public QueueItem? Pick(string gid, Config c, QueueItem? last, IReadOnlyList<QueueItem> q)
    {
        if (c.Mode == "radio") return c.Id is long rid ? _reg.Default.StationToItem(rid) : null;
        List<long> pool;
        if (c.Mode == "playlist") pool = c.Id is long pid ? _db.Query("SELECT pi.track_id FROM playlist_item pi JOIN track t ON t.id=pi.track_id WHERE pi.playlist_id=$p AND t.missing=0", r => r.GetInt64(0), ("$p", pid)) : new();
        else if (c.Mode == "similar") { var sp = SimilarPick(gid, last, q); return sp == null ? null : _reg.Default.TracksToItems(new[] { sp.Value }).FirstOrDefault(); }   // 0.6.8-#13
        else if (Pools.TryGetValue(c.Mode, out var f) && c.Id is long sid) pool = f(sid).ToList();
        else return null;
        var id = Choose(gid, pool, q); if (id == null) return null;
        return _reg.Default.TracksToItems(new[] { id.Value }).FirstOrDefault();
    }

    /// <summary>F228: same artist (exact, then delimiter-safe loosen; artist or album_artist), else same genre, else album artist, else year +/-2. A remote song is matched by its tags against the local library. No any-local last resort.</summary>
    public List<long> Similar(QueueItem? last)
    {
        if (last == null) return new();
        string artist = last.Artist ?? "", genre = last.Genre ?? "", albumArtist = ""; int? year = last.Year; long self = last.Kind == "track" ? last.RefId ?? -1 : -1;
        if (last.Kind == "track" && last.RefId is long tid)
        {
            var row = _db.Query("SELECT artist, COALESCE(genre,''), COALESCE(album_artist,''), year FROM track WHERE id=$i", r => (r.GetString(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? (int?)null : r.GetInt32(3)), ("$i", tid)).FirstOrDefault();
            if (row.Item1 != null) { artist = row.Item1; genre = row.Item2; albumArtist = row.Item3; year ??= row.Item4; }
        }
        bool remote = last.Kind != "track";
        var list = ArtistPool(artist, self, remote);
        if (list.Count == 0 && genre.Trim().Length > 0) list = _db.Query("SELECT id FROM track WHERE missing=0 AND genre=$g COLLATE NOCASE AND id<>$s", r => r.GetInt64(0), ("$g", genre.Trim()), ("$s", self));
        if (list.Count == 0 && albumArtist.Length > 0 && !string.Equals(NormArtist(albumArtist), NormArtist(artist), StringComparison.OrdinalIgnoreCase)) list = ArtistPool(albumArtist, self, true);
        if (list.Count == 0 && year is int y && y > 0) list = _db.Query("SELECT id FROM track WHERE missing=0 AND year BETWEEN $lo AND $hi AND id<>$s", r => r.GetInt64(0), ("$lo", y - 2), ("$hi", y + 2), ("$s", self));
        return list;
    }

    /// <summary>0.6.8-#13: the "Similar music" pool, wider and less repetitive. The F228 match (<see cref="Similar"/>) stays the core; songs that share
    /// the genre (and the album artist's other songs) are added around it, so a long session does not loop one artist. The pick prefers an artist that
    /// is not the one playing now and not one of the last few Keep playing picks (falls back to anything fresh rather than stop).</summary>
    public long? SimilarPick(string gid, QueueItem? last, IReadOnlyList<QueueItem> q)
    {
        var core = Similar(last); if (core.Count == 0) return null;
        string genre = last?.Genre ?? "";
        if (last is { Kind: "track", RefId: long tid }) genre = _db.Scalar("SELECT COALESCE(genre,'') FROM track WHERE id=$i", ("$i", tid)) as string ?? genre;
        var self = last is { Kind: "track", RefId: long s } ? s : -1;
        var wide = genre.Trim().Length > 0 ? _db.Query("SELECT id FROM track WHERE missing=0 AND genre=$g COLLATE NOCASE AND id<>$s", r => r.GetInt64(0), ("$g", genre.Trim()), ("$s", self)) : new();
        var pool = core.Concat(wide).Distinct().ToList();
        var art = ArtistsOf(pool);
        var avoid = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (NormArtist(last?.Artist).Length > 0) avoid.Add(NormArtist(last?.Artist));
        lock (_l) if (_recentArtists.TryGetValue(gid, out var ra)) foreach (var a in ra) avoid.Add(a);
        foreach (var x in q.TakeLast(3)) if (NormArtist(x.Artist).Length > 0) avoid.Add(NormArtist(x.Artist));
        // about a third of the time stay close (the core match, same artist allowed); otherwise roam the wider pool, preferring an artist not heard just now
        bool stay = core.Count < pool.Count && Roll() < StayClose;
        var id = stay ? Choose(gid, core, q) : Choose(gid, pool, q, x => !avoid.Contains(art.GetValueOrDefault(x, "")));
        if (id is long p) lock (_l)
        {
            if (!_recentArtists.TryGetValue(gid, out var ra)) _recentArtists[gid] = ra = new();
            var an = art.GetValueOrDefault(p, ""); if (an.Length > 0) { ra.Remove(an); ra.Add(an); if (ra.Count > RecentArtists) ra.RemoveAt(0); }
        }
        return id;
    }
    public const int RecentArtists = 4; public const double StayClose = 0.35;
    /// <summary>0..1 dice for <see cref="SimilarPick"/> (tests pin it).</summary>
    public Func<double> Roll { get; set; } = () => Random.Shared.NextDouble();
    private readonly Dictionary<string, List<string>> _recentArtists = new();   // group -> the last few Keep playing artists (normalized)

    Dictionary<long, string> ArtistsOf(IReadOnlyList<long> ids)
    {
        var m = new Dictionary<long, string>();
        for (int i = 0; i < ids.Count; i += 500)
        {
            var chunk = ids.Skip(i).Take(500).ToList();
            foreach (var (id, a) in _db.Query("SELECT id, artist FROM track WHERE id IN (" + string.Join(",", chunk) + ")", r => (r.GetInt64(0), r.IsDBNull(1) ? "" : r.GetString(1)))) m[id] = NormArtist(a);
        }
        return m;
    }

    /// <summary>F228: trim, collapse whitespace, drop "feat./ft./featuring ..." and after.</summary>
    public static string NormArtist(string? a)
    {
        var s = System.Text.RegularExpressions.Regex.Replace(a ?? "", @"\s+", " ").Trim();
        s = System.Text.RegularExpressions.Regex.Replace(s, @"[\s(\[]+(feat\.?|ft\.?|featuring)(\s.*|$)", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        return s;
    }

    List<long> ArtistPool(string artist, long self, bool loosen)
    {
        var n = NormArtist(artist); if (n.Length == 0) return new();
        var raw = artist.Trim();
        var list = _db.Query("SELECT id FROM track WHERE missing=0 AND (artist=$a COLLATE NOCASE OR artist=$n COLLATE NOCASE OR album_artist=$a COLLATE NOCASE OR album_artist=$n COLLATE NOCASE) AND id<>$s", r => r.GetInt64(0), ("$a", raw), ("$n", n), ("$s", self));
        if (list.Count > 0 && !loosen) return list;
        if (list.Count == 0 || loosen)
        {
            // delimiter-bounded prefix only: never %token% (Air must not match Airbourne)
            var e = n.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            const string L = "(COL LIKE $p1 ESCAPE '\\' OR COL LIKE $p2 ESCAPE '\\' OR COL LIKE $p3 ESCAPE '\\' OR COL LIKE $p4 ESCAPE '\\' OR COL LIKE $p5 ESCAPE '\\')";
            var more = _db.Query("SELECT id FROM track WHERE missing=0 AND (" + L.Replace("COL", "artist") + " OR " + L.Replace("COL", "album_artist") + ") AND id<>$s", r => r.GetInt64(0),
                ("$p1", e + " %"), ("$p2", e + "/%"), ("$p3", e + ";%"), ("$p4", e + ",%"), ("$p5", e + " (%"), ("$s", self));
            list = list.Concat(more).Distinct().ToList();
        }
        return list;
    }

    /// <summary>A random pool member not picked in the last 6 hours and not in the queue; pool used up -> allow a repeat rather than stop.
    /// When <paramref name="prefer"/> is given, fresh songs it accepts go first (0.6.8-#13: a different artist), then any fresh song.</summary>
    public long? Choose(string gid, IReadOnlyList<long> pool, IReadOnlyList<QueueItem> q, Func<long, bool>? prefer = null)
    {
        if (pool.Count == 0) return null;
        var t = Clock(); var inQ = q.Where(x => x.Kind == "track" && x.RefId != null).Select(x => x.RefId!.Value).ToHashSet();
        Dictionary<long, DateTime> seen; lock (_l) { if (!_played.TryGetValue(gid, out seen!)) _played[gid] = seen = new(); foreach (var k in seen.Where(kv => t - kv.Value >= NoRepeat).Select(kv => kv.Key).ToList()) seen.Remove(k); }
        List<long> fresh; lock (_l) fresh = pool.Distinct().Where(x => !inQ.Contains(x) && !seen.ContainsKey(x)).ToList();
        if (prefer != null && fresh.Where(prefer).ToList() is { Count: > 0 } pf) fresh = pf;
        if (fresh.Count == 0) lock (_l) fresh = pool.Distinct().Where(x => !seen.ContainsKey(x)).ToList();
        if (fresh.Count == 0) fresh = pool.Distinct().ToList();   // everything was played lately: repeat rather than go silent
        var pick = fresh[Random.Shared.Next(fresh.Count)];
        lock (_l) seen[pick] = t; return pick;
    }
}
