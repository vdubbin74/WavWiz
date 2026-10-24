using System.Text.Json;
using System.Text.Json.Nodes;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Zones;

/// <summary>
/// 0.4.0 Stage 2: ties the Zones screen (zone_group rows: "Kitchen", "Basement"...) to the playback groups of <see cref="ConductorRegistry"/>.
/// Vocabulary (the old code mixed these up):
///   device  = one speaker / output = a row of the zone table (ZoneManager's "zones" in the code are devices).
///   zone    = what the user sees as a zone = a zone_group row (a named set of devices).
///   playback group = one Conductor (queue, now playing, engine). Zones that are LINKED share one; a split zone has its own.
/// State: setting zone.links = { "&lt;zone id&gt;": "&lt;playback group id&gt;" }. A zone with no entry is in the house group "default", so every existing install starts with all zones LINKED = exactly 0.3.9 (this is the migration: nothing to convert).
/// A device plays the group of the FIRST zone (by zone order) it belongs to; a device in no zone plays "default". Devices picked for the Jukebox zone play "jukebox" instead
/// (setting jukebox.devices = player ids; empty = the Jukebox plays in the house group like in 0.3.9).
/// </summary>
public sealed class ZoneLinks
{
    public const string MapKey = "zone.links", JukeboxKey = "jukebox.devices", JukeboxGroup = "jukebox";
    private readonly Db _db; private readonly ZoneManager _zm; private readonly ConductorRegistry _reg; private readonly EventHub _ev; private readonly object _l = new();
    public ZoneLinks(Db db, ZoneManager zm, ConductorRegistry reg, EventHub ev) { _db = db; _zm = zm; _reg = reg; _ev = ev; }

    private Dictionary<long, string> Map()
    {
        try { var raw = _db.Setting(MapKey); if (string.IsNullOrWhiteSpace(raw)) return new(); var d = JsonSerializer.Deserialize<Dictionary<string, string>>(raw); return d == null ? new() : d.Where(kv => long.TryParse(kv.Key, out _)).ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value); }
        catch { return new(); }
    }
    private void Save(Dictionary<long, string> m) => _db.SetSetting(MapKey, JsonSerializer.Serialize(m.Where(kv => kv.Value != Conductor.DefaultGroupId).ToDictionary(kv => kv.Key.ToString(), kv => kv.Value)));
    public List<(long Id, string Name)> ZoneList() => Zones();
    /// <summary>0.4.0 Stage 4: raised after every full Apply (link, split, rename, delete), so zone receivers follow their zone.</summary>
    public event Action? Applied;
    private List<(long Id, string Name)> Zones() => _db.Query("SELECT id,name FROM zone_group ORDER BY sort,id", r => (r.GetInt64(0), r.GetString(1)));

    // ---------------- 0.4.1 overlap rule: the SMALLER zone takes precedence ----------------
    public const string ClaimKey = "zone.claims"; public static TimeSpan ClaimGrace = TimeSpan.FromSeconds(8);
    private readonly Dictionary<long, DateTime> _claims = new(); private bool _claimsLoaded;
    private void LoadClaims() { if (_claimsLoaded) return; _claimsLoaded = true; try { var raw = _db.Setting(ClaimKey); if (!string.IsNullOrWhiteSpace(raw)) foreach (var id in JsonSerializer.Deserialize<List<long>>(raw) ?? new()) _claims[id] = DateTime.UtcNow.AddHours(-1); } catch { } }
    private void SaveClaims() { try { _db.SetSetting(ClaimKey, JsonSerializer.Serialize(_claims.Keys.ToList())); } catch { } }
    private Dictionary<long, HashSet<long>> Members() { var d = new Dictionary<long, HashSet<long>>(); foreach (var (g, dev) in _db.Query("SELECT group_id,device_id FROM zone_group_member", r => (r.GetInt64(0), r.GetInt64(1)))) { if (!d.TryGetValue(g, out var h)) d[g] = h = new(); h.Add(dev); } return d; }
    /// <summary>Zones that contain some of this zone's devices but have more devices (the larger zones it can take speakers from).</summary>
    public List<long> LargerOverlapping(long zoneId) { var mem = Members(); if (!mem.TryGetValue(zoneId, out var mine) || mine.Count == 0) return new(); return mem.Where(kv => kv.Key != zoneId && kv.Value.Count > mine.Count && kv.Value.Overlaps(mine)).Select(kv => kv.Key).ToList(); }
    /// <summary>Is this zone currently taking its devices away from larger zones (playing on its own inside them)?</summary>
    public bool Claiming(long zoneId) { lock (_l) { LoadClaims(); return _claims.ContainsKey(zoneId); } }

    /// <summary>0.4.1: press play inside a smaller zone: it gets its own playback group and takes its devices from the larger zones, automatically (no manual split). Zones with no larger overlapping zone are untouched. Returns the playback group id to play in.</summary>
    public string ClaimForPlay(long zoneId)
    {
        lock (_l)
        {
            LoadClaims(); var zs = Zones(); if (!zs.Any(z => z.Id == zoneId)) return Conductor.DefaultGroupId;
            var larger = LargerOverlapping(zoneId); if (larger.Count == 0) return PlaybackId(zoneId);
            var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId;
            bool changed = false;
            if (larger.Any(l => Of(l) == Of(zoneId)) || Of(zoneId) == Conductor.DefaultGroupId)
            {
                var own = OwnId(zoneId); if (Of(zoneId) == own || zs.Any(z => z.Id != zoneId && Of(z.Id) == own)) { int k = 2; while (_reg.Exists(own + "#" + k) && !(Of(zoneId) == own + "#" + k)) k++; own = own + "#" + k; }
                m[zoneId] = own; Save(m); changed = true;
            }
            if (!_claims.ContainsKey(zoneId)) { _claims[zoneId] = DateTime.UtcNow; SaveClaims(); changed = true; } else _claims[zoneId] = DateTime.UtcNow;
            if (changed) { Apply(); _ev.Publish("zones"); }
            return PlaybackId(zoneId);
        }
    }
    /// <summary>0.4.1: a claiming zone whose music has stopped gives its speakers back to the larger zones. Cheap when nothing is claimed.</summary>
    public void Sweep()
    {
        lock (_l)
        {
            LoadClaims(); if (_claims.Count == 0) return; bool any = false;
            foreach (var id in _claims.Keys.ToList())
            {
                if ((DateTime.UtcNow - _claims[id]) < ClaimGrace) continue;
                var c = _reg.Get(PlaybackId(id)); if (c == null || c.State == PlayState.Stopped) { _claims.Remove(id); any = true; }
            }
            if (any) { SaveClaims(); Apply(); _ev.Publish("zones"); }
        }
    }
    /// <summary>The zone each device is currently playing in because a smaller zone claimed it: deviceId -> (zone id, zone name).</summary>
    public Dictionary<long, (long ZoneId, string Zone)> ClaimedDevices()
    {
        lock (_l)
        {
            LoadClaims(); var r = new Dictionary<long, (long, string)>(); if (_claims.Count == 0) return r;
            var zs = Zones().ToDictionary(z => z.Id, z => z.Name); var mem = Members();
            foreach (var id in _claims.Keys.OrderByDescending(i => mem.TryGetValue(i, out var h) ? h.Count : 0)) if (mem.TryGetValue(id, out var devs) && zs.TryGetValue(id, out var n)) foreach (var d in devs) r[d] = (id, n);
            return r;
        }
    }

    public string PlaybackId(long zoneId) => Map().TryGetValue(zoneId, out var g) ? g : Conductor.DefaultGroupId;
    public static string OwnId(long zoneId) => "zg:" + zoneId;
    /// <summary>Zones that play the same music as this one (not counting itself).</summary>
    public List<(long Id, string Name)> LinkedWith(long zoneId) { var m = Map(); var mine = m.TryGetValue(zoneId, out var g) ? g : Conductor.DefaultGroupId; return Zones().Where(z => z.Id != zoneId && (m.TryGetValue(z.Id, out var o) ? o : Conductor.DefaultGroupId) == mine).ToList(); }

    // ---------------- link / split ----------------
    /// <summary>Link: this zone (and any zones already linked to it) play the same music as <paramref name="withZone"/>. Its old group keeps its queue for a later split.</summary>
    public string? Link(long zoneId, long withZone)
    {
        lock (_l)
        {
            var zs = Zones(); if (!zs.Any(z => z.Id == zoneId) || !zs.Any(z => z.Id == withZone)) return "zone not found";
            if (zoneId == withZone) return "pick another zone to link with";
            var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId;
            var target = Of(withZone); var cur = Of(zoneId); if (cur == target) return null;
            foreach (var z in zs.Where(z => Of(z.Id) == cur).Select(z => z.Id).ToList()) m[z] = target;
            Save(m); Apply(); _ev.Publish("zones"); return null;
        }
    }
    /// <summary>Link every zone into one group: the group of <paramref name="intoZone"/> (the zone being controlled), or the house group.</summary>
    public string? LinkAll(long? intoZone)
    {
        lock (_l)
        {
            var zs = Zones(); var m = Map();
            var target = intoZone is long z && zs.Any(x => x.Id == z) ? (m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId) : Conductor.DefaultGroupId;
            foreach (var x in zs) m[x.Id] = target;
            LoadClaims(); _claims.Clear(); SaveClaims();
            Save(m); Apply(); _ev.Publish("zones"); return null;
        }
    }
    /// <summary>0.4.9 fix: a phone sends to "WavWiz – Everywhere" (house AirPlay / Spotify Connect). That receiver plays in the house group, but once zones
    /// have their own groups (split off, or a zone claimed by pressing play in it) the house group has no speakers left and the phone plays to nobody.
    /// So the session links every zone into the house group (like Link all) and remembers the layout; <see cref="EverywhereEnd"/> puts it back.</summary>
    public const string BeforeLiveKey = "zone.links.beforeLive";
    public void EverywhereBegin()
    {
        lock (_l)
        {
            LoadClaims(); var m = Map();
            if (_db.Setting(BeforeLiveKey) is not { Length: > 2 })
                _db.SetSetting(BeforeLiveKey, JsonSerializer.Serialize(new LiveLayout(m.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value), _claims.Keys.ToList())));
            var free = Zones().Where(z => !_casting.Contains(z.Id)).ToList();          // a zone busy with its own cast keeps it
            foreach (var z in free) m[z.Id] = Conductor.DefaultGroupId;
            foreach (var id in _casting) if (!m.TryGetValue(id, out var cg) || cg == Conductor.DefaultGroupId) m[id] = FreeOwn(m, id);   // its cast moves out of the house group with it
            Carrying = true; try { _claims.Clear(); SaveClaims(); Save(m); Apply(); } finally { Carrying = false; } _ev.Publish("zones");
        }
    }
    public void EverywhereEnd()
    {
        lock (_l)
        {
            var raw = _db.Setting(BeforeLiveKey); _db.SetSetting(BeforeLiveKey, "{}"); if (raw is not { Length: > 2 }) return;
            LiveLayout? l; try { l = JsonSerializer.Deserialize<LiveLayout>(raw); } catch { return; } if (l == null) return;
            var zs = Zones().Select(z => z.Id).ToHashSet(); var m = new Dictionary<long, string>();
            var cur = Map(); _afterCast.Clear();
            foreach (var z in zs) { var g = l.Links.TryGetValue(z.ToString(), out var sg) ? sg : Conductor.DefaultGroupId;
                if (_casting.Contains(z)) { _afterCast[z] = g; if (cur.TryGetValue(z, out var cg)) m[z] = cg; }   // still casting: untouched, gets its layout when its cast ends
                else m[z] = g; }
            LoadClaims(); _claims.Clear(); foreach (var c in l.Claims.Where(zs.Contains)) _claims[c] = DateTime.UtcNow; SaveClaims();
            Save(m); Apply(); _ev.Publish("zones");
        }
    }
    private readonly HashSet<long> _casting = new(); private readonly Dictionary<long, string> _afterCast = new();
    public bool EverywhereActive => _db.Setting(BeforeLiveKey) is { Length: > 2 };
    /// <summary>0.4.9: a zone's own AirPlay/Spotify cast starts. While Everywhere runs the zone leaves the Everywhere group and plays its own cast.</summary>
    public void ZoneCastBegin(long zoneId)
    {
        lock (_l)
        {
            if (!_casting.Add(zoneId)) return;
            var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId; var cur = Of(zoneId);
            // leave the group when Everywhere plays in it, or when another zone's own cast already plays there (two casts never share a group)
            if (!(EverywhereActive && cur == Conductor.DefaultGroupId) && !_casting.Any(z => z != zoneId && Of(z) == cur)) return;
            if (!EverywhereActive) _afterCast[zoneId] = cur;
            m[zoneId] = FreeOwn(m, zoneId); Save(m); Apply(); _ev.Publish("zones");
        }
    }
    /// <summary>0.4.9: a zone's own cast ended: it rejoins Everywhere if that still runs, else gets the layout saved before Everywhere (if Everywhere ended meanwhile).
    /// <paramref name="relayout"/> false = the zone was regrouped by hand (do not move it again).</summary>
    public void ZoneCastEnd(long zoneId, bool relayout = true)
    {
        lock (_l)
        {
            if (!_casting.Remove(zoneId)) return; var had = _afterCast.Remove(zoneId, out var saved); if (!relayout) return;
            var m = Map(); string? to = EverywhereActive ? Conductor.DefaultGroupId : had ? saved : null; if (to == null) return;
            if ((m.TryGetValue(zoneId, out var g) ? g : Conductor.DefaultGroupId) == to) return;
            m[zoneId] = to; Save(m); Apply(); _ev.Publish("zones");
        }
    }
    private string FreeOwn(Dictionary<long, string> m, long zoneId) { var own = OwnId(zoneId); int k = 2; while (m.Values.Contains(own) || (k > 2 && _reg.Exists(own))) own = OwnId(zoneId) + "#" + k++; return own; }
    /// <summary>True while Everywhere moves a casting zone to its own group: the zone's receiver carries its session along instead of ending it.</summary>
    public bool Carrying { get; private set; }
    public bool ZoneCasting(long zoneId) { lock (_l) return _casting.Contains(zoneId); }
    private sealed record LiveLayout(Dictionary<string, string> Links, List<long> Claims);
    /// <summary>Split off: this zone gets its own music. The zones it was linked with keep playing; the zone resumes its own saved queue (stopped).</summary>
    public string? SplitOff(long zoneId)
    {
        lock (_l)
        {
            var zs = Zones(); if (!zs.Any(z => z.Id == zoneId)) return "zone not found";
            var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId;
            var cur = Of(zoneId); if (!zs.Any(z => z.Id != zoneId && Of(z.Id) == cur)) return null;      // already on its own
            var own = OwnId(zoneId);
            if (cur == own) { int k = 2; while (_reg.Exists(own + "#" + k)) k++; own = own + "#" + k; }   // the lead leaves: the others keep the song, the leaver starts a fresh group
            m[zoneId] = own; Save(m); Apply(); _ev.Publish("zones"); return null;
        }
    }
    /// <summary>0.4.1: why Split off would do nothing for this zone (null = it will split). Shown as a message instead of a silent no-op.</summary>
    public string? SplitNote(long zoneId)
    {
        lock (_l)
        {
            var zs = Zones(); if (!zs.Any(z => z.Id == zoneId)) return null; var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId;
            var cur = Of(zoneId); if (zs.Any(z => z.Id != zoneId && Of(z.Id) == cur)) return null;
            return LargerOverlapping(zoneId).Count > 0 ? "This zone already has its own music. Press play inside it and only its devices play." : "This zone already plays its own music. Link it with another zone first, then split it off.";
        }
    }
    /// <summary>0.4.1: the playback group a request's zoneId means. "g:&lt;zone id&gt;" = a zone (a smaller zone is claimed automatically when <paramref name="forPlay"/>), a group id = that group; anything unknown = the house group (null).</summary>
    public string? ResolveZone(string? zid, bool forPlay)
    {
        if (string.IsNullOrWhiteSpace(zid)) return null;
        if (zid.StartsWith("g:") && long.TryParse(zid.AsSpan(2), out var id)) { if (!Zones().Any(z => z.Id == id)) return null; return forPlay ? ClaimForPlay(id) : PlaybackId(id); }
        return _reg.Exists(zid) ? zid : null;
    }
    /// <summary>A zone was removed: forget its link.</summary>
    public void Forget(long zoneId) { lock (_l) { LoadClaims(); if (_claims.Remove(zoneId)) SaveClaims(); var m = Map(); if (m.Remove(zoneId)) Save(m); Apply(); } }

    // ---------------- Jukebox zone ----------------
    public List<string> JukeboxPlayers() { try { var raw = _db.Setting(JukeboxKey); return string.IsNullOrWhiteSpace(raw) ? new() : JsonSerializer.Deserialize<List<string>>(raw) ?? new(); } catch { return new(); } }
    public string? SetJukeboxDevices(IEnumerable<long> deviceIds)
    {
        lock (_l)
        {
            var rows = _db.Query("SELECT id,player_id FROM zone", r => (Id: r.GetInt64(0), P: r.GetString(1))).ToDictionary(x => x.Id, x => x.P);
            var ps = new List<string>(); foreach (var id in deviceIds.Distinct()) { if (!rows.TryGetValue(id, out var p)) return "device not found"; ps.Add(p); }
            _db.SetSetting(JukeboxKey, JsonSerializer.Serialize(ps)); Apply(); _ev.Publish("zones"); return null;
        }
    }
    /// <summary>0.4.9 F76 fix: speakers are only borrowed by the Jukebox while it runs. When this says it is not running, Apply drops any
    /// leftover Jukebox assignment (exit, a server restart mid-session, or a 0.4.9 install already stuck) so each speaker plays its own zone again.</summary>
    public Func<bool>? JukeboxRunning;
    /// <summary>0.4.9 F76 fix: null when every id is a known device, else the error.</summary>
    public string? CheckDevices(IEnumerable<long> deviceIds) { var ids = _db.Query("SELECT id FROM zone", r => r.GetInt64(0)).ToHashSet(); return deviceIds.All(ids.Contains) ? null : "device not found"; }
    public List<long> JukeboxDeviceIds() { var ps = JukeboxPlayers(); return _db.Query("SELECT id,player_id FROM zone", r => (Id: r.GetInt64(0), P: r.GetString(1))).Where(x => ps.Contains(x.P)).Select(x => x.Id).OrderBy(x => x).ToList(); }
    /// <summary>The Conductor the Jukebox plays in: its own zone once speakers are picked, else the house group (0.3.9 behavior).</summary>
    public Conductor? JukeboxConductor() => JukeboxPlayers().Count > 0 ? _reg.Get(JukeboxGroup) : null;

    // ---------------- zone keys (what an alarm / sleep timer targets): "g:<zone id>" or "jukebox"; null / "" = everything, like 0.3.9 ----------------
    public static string? ParseKey(string? key) => string.IsNullOrWhiteSpace(key) ? null : key.Trim();
    /// <summary>The Conductor a zone key plays in: the zone's playback group, the Jukebox zone (house group while it has no speakers), or the house group.</summary>
    public Conductor CondFor(string? key)
    {
        key = ParseKey(key);
        if (key == JukeboxGroup) return JukeboxConductor() ?? _reg.Default;
        if (key != null && key.StartsWith("g:") && long.TryParse(key.AsSpan(2), out var id)) return _reg.Get(PlaybackId(id)) ?? _reg.Default;
        return _reg.Default;
    }
    /// <summary>The devices of a zone key (null = no target, i.e. everything). A deleted zone gives an empty list.</summary>
    public List<long>? DevicesOf(string? key)
    {
        key = ParseKey(key); if (key == null) return null;
        if (key == JukeboxGroup) return JukeboxDeviceIds();
        if (key.StartsWith("g:") && long.TryParse(key.AsSpan(2), out var id)) return _db.Query("SELECT device_id FROM zone_group_member WHERE group_id=$g ORDER BY device_id", r => r.GetInt64(0), ("$g", id));
        return null;
    }
    public string? KeyName(string? key)
    {
        key = ParseKey(key); if (key == null) return null; if (key == JukeboxGroup) return "Jukebox";
        if (key.StartsWith("g:") && long.TryParse(key.AsSpan(2), out var id)) return Zones().FirstOrDefault(z => z.Id == id).Name;
        return null;
    }
    /// <summary>Stop the music of every playback group (the master "All off").</summary>
    public void StopAll() { foreach (var c in _reg.Live()) c.Stop(); }

    // ---------------- apply ----------------
    /// <summary>Put every device into the playback group its zones say. <paramref name="onlyPlayer"/> = just that device (a device that just connected).</summary>
    public void Apply(string? onlyPlayer = null)
    {
        lock (_l)
        {
            var m = Map(); var zs = Zones().ToDictionary(z => z.Id, z => z.Name); var jb = JukeboxPlayers().ToHashSet();
            if (jb.Count > 0 && JukeboxRunning?.Invoke() == false) { jb.Clear(); _db.SetSetting(JukeboxKey, "[]"); }   // 0.4.9 F76 fix: release leftover borrowed speakers
            LoadClaims(); foreach (var c in _claims.Keys.Where(c => !zs.ContainsKey(c)).ToList()) _claims.Remove(c);
            var first = new Dictionary<long, long>(); var counts = new Dictionary<long, int>();
            var rowsM = _db.Query("SELECT m.group_id,m.device_id FROM zone_group_member m JOIN zone_group g ON g.id=m.group_id ORDER BY g.sort,g.id,m.device_id", r => (r.GetInt64(0), r.GetInt64(1)));
            foreach (var (gid, _) in rowsM) counts[gid] = counts.GetValueOrDefault(gid) + 1;
            foreach (var (gid, dev) in rowsM) first.TryAdd(dev, gid);
            // a claim ends when its zone is linked again (it shares a group with a larger zone it overlaps)
            string Gof(long z) => m.TryGetValue(z, out var g0) ? g0 : Conductor.DefaultGroupId;
            foreach (var c in _claims.Keys.ToList()) if (Gof(c) == Conductor.DefaultGroupId || LargerOverlapping(c).Any(l => Gof(l) == Gof(c))) _claims.Remove(c);
            SaveClaims();
            // 0.4.1: a device follows the SMALLEST zone that is playing on its own (a claim); otherwise the first zone by order, like before
            var taken = new HashSet<long>();
            foreach (var (gid, dev) in rowsM.OrderBy(x => counts[x.Item1]).ThenBy(x => x.Item1)) if (_claims.ContainsKey(gid) && taken.Add(dev)) first[dev] = gid;
            // a link to a zone group that no longer exists is dropped
            if (m.Keys.Any(k => !zs.ContainsKey(k))) { foreach (var k in m.Keys.Where(k => !zs.ContainsKey(k)).ToList()) m.Remove(k); Save(m); }
            foreach (var (dev, player) in _db.Query("SELECT id,player_id FROM zone", r => (r.GetInt64(0), r.GetString(1))))
            {
                if (onlyPlayer != null && player != onlyPlayer) continue;
                if (jb.Contains(player)) { _reg.Assign(player, JukeboxGroup, "Jukebox"); continue; }
                if (first.TryGetValue(dev, out var zg) && m.TryGetValue(zg, out var gid) && gid != Conductor.DefaultGroupId) _reg.Assign(player, gid, GroupName(gid, m, zs));
                else _reg.Assign(player, Conductor.DefaultGroupId);
            }
        }
        if (onlyPlayer == null)
        {
            lock (_l)
            {
                // 0.4.1: every zone's playback group exists (even with 0 speakers); groups of removed zones go away with their queue
                var zs2 = Zones().ToDictionary(z => z.Id, z => z.Name); var m2 = Map(); var keep = new HashSet<string>();
                foreach (var kv in m2) if (zs2.ContainsKey(kv.Key) && kv.Value != Conductor.DefaultGroupId) { keep.Add(kv.Value); _reg.Ensure(kv.Value, GroupName(kv.Value, m2, zs2)); }
                foreach (var z in zs2) { var own = OwnId(z.Key); keep.Add(own); _reg.Ensure(own, z.Value); }   // a linked zone keeps its own group (and queue) for a later split
                _reg.Prune(keep);
            }
            try { Applied?.Invoke(); } catch { }
        }
    }
    private static string GroupName(string gid, Dictionary<long, string> m, Dictionary<long, string> zs)
    {
        var names = m.Where(kv => kv.Value == gid).Select(kv => zs.TryGetValue(kv.Key, out var n) ? n : null).Where(n => n != null).ToList();
        return names.Count == 0 ? gid : string.Join(" + ", names);
    }

    // ---------------- what the UI shows ----------------
    private static object? NowDto(Conductor? c)
    {
        if (c == null) return null; var n = c.Now(); var it = n.Item;
        return new { state = n.State, title = it?.Title, artist = it?.Artist, album = it?.Album, kind = it?.Kind, refId = it?.RefId, artUrl = it?.ArtUrl, positionMs = n.PositionMs, durationMs = n.DurationMs, live = it != null && Conductor.IsLive(it.Kind) };
    }
    /// <summary>The zone list plus, per zone: playbackId, linked (names of the other zones playing the same music) and now (its group's song).</summary>
    public JsonArray Decorate(List<ZoneGroupDto> groups)
    {
        Sweep(); var claimed = ClaimedDevices(); var mem = Members();
        var m = Map(); string Of(long z) => m.TryGetValue(z, out var g) ? g : Conductor.DefaultGroupId; var arr = new JsonArray();
        foreach (var g in groups)
        {
            var o = JsonSerializer.SerializeToNode(g, EventHub.Json)!.AsObject(); var pid = Of(g.Id);
            o["playbackId"] = pid; o["linked"] = new JsonArray(groups.Where(x => x.Id != g.Id && Of(x.Id) == pid).Select(x => (JsonNode?)JsonValue.Create(x.Name)).ToArray());
            o["linkedIds"] = new JsonArray(groups.Where(x => x.Id != g.Id && Of(x.Id) == pid).Select(x => (JsonNode?)JsonValue.Create(x.Id)).ToArray());
            o["now"] = JsonSerializer.SerializeToNode(NowDto(_reg.Get(pid) ?? _reg.Default), EventHub.Json);
            var mine = mem.TryGetValue(g.Id, out var hs) ? hs : new HashSet<long>(); var lost = mine.Where(d => claimed.TryGetValue(d, out var c) && c.ZoneId != g.Id).ToList();
            o["playingHere"] = mine.Count - lost.Count; o["of"] = mine.Count; o["claiming"] = _claims.ContainsKey(g.Id); o["overlapsLarger"] = LargerOverlapping(g.Id).Count > 0;
            o["claims"] = new JsonArray(lost.Select(d => (JsonNode?)new JsonObject { ["deviceId"] = d, ["zoneId"] = claimed[d].ZoneId, ["zone"] = claimed[d].Zone }).ToArray());
            arr.Add(o);
        }
        return arr;
    }
    public object JukeboxView() { var c = JukeboxConductor(); return new { zoneId = JukeboxGroup, name = "Jukebox", deviceIds = JukeboxDeviceIds(), own = c != null, now = NowDto(c ?? _reg.Default) }; }
}
