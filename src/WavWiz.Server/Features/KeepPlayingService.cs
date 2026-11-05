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

    /// <summary>The next item for this group's setting, or null when there is nothing to pick.</summary>
    public QueueItem? Pick(string gid, Config c, QueueItem? last, IReadOnlyList<QueueItem> q)
    {
        if (c.Mode == "radio") return c.Id is long rid ? _reg.Default.StationToItem(rid) : null;
        List<long> pool;
        if (c.Mode == "playlist") pool = c.Id is long pid ? _db.Query("SELECT pi.track_id FROM playlist_item pi JOIN track t ON t.id=pi.track_id WHERE pi.playlist_id=$p AND t.missing=0", r => r.GetInt64(0), ("$p", pid)) : new();
        else if (c.Mode == "similar") pool = Similar(last);
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

    /// <summary>A random pool member not picked in the last 6 hours and not in the queue; pool used up -> allow a repeat rather than stop.</summary>
    public long? Choose(string gid, IReadOnlyList<long> pool, IReadOnlyList<QueueItem> q)
    {
        if (pool.Count == 0) return null;
        var t = Clock(); var inQ = q.Where(x => x.Kind == "track" && x.RefId != null).Select(x => x.RefId!.Value).ToHashSet();
        Dictionary<long, DateTime> seen; lock (_l) { if (!_played.TryGetValue(gid, out seen!)) _played[gid] = seen = new(); foreach (var k in seen.Where(kv => t - kv.Value >= NoRepeat).Select(kv => kv.Key).ToList()) seen.Remove(k); }
        List<long> fresh; lock (_l) fresh = pool.Distinct().Where(x => !inQ.Contains(x) && !seen.ContainsKey(x)).ToList();
        if (fresh.Count == 0) lock (_l) fresh = pool.Distinct().Where(x => !seen.ContainsKey(x)).ToList();
        if (fresh.Count == 0) fresh = pool.Distinct().ToList();   // everything was played lately: repeat rather than go silent
        var pick = fresh[Random.Shared.Next(fresh.Count)];
        lock (_l) seen[pick] = t; return pick;
    }
}
