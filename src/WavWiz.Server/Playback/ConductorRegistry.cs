using System.Text.Json;
using WavWiz.Core.Clock;
using WavWiz.Core.Stream;
namespace WavWiz.Server.Playback;

/// <summary>One playback group: a Conductor (own queue, engine, epoch, now-playing) plus the devices that listen to it.</summary>
public sealed record PlaybackGroupInfo(string Id, string Name, bool IsDefault, bool Materialized, bool Idle, IReadOnlyList<string> PlayerIds, string State, int QueueCount);

/// <summary>
/// 0.4.0 Stage 1. Replaces "the one Conductor" with a set of playback groups (the UI will call them zones in Stage 2).
/// Rules:
///  - "default" is the house group: it is today's Conductor, always exists, and every device belongs to it unless it was split off. With only the default group nothing behaves differently from 0.3.9.
///  - A device belongs to exactly ONE group at a time. <see cref="Split"/> (unlink) moves it into its own group ("p:&lt;playerId&gt;") that resumes its own saved queue, STOPPED; <see cref="Link"/> moves it (or a whole group) back into another group. The default group keeps playing through a split.
///  - Non-default Conductors are created lazily (first use) and keep their queue while empty so Unlink can bring it back. An idle Conductor has no decoder, no pump timer and no DSP (see Conductor.PumpArmed).
///  - Linked devices share one Conductor, so decode and the frame encode happen once per group, not once per device.
///  - All groups share the default group's monotonic clock.
/// The group layout (which devices are split off) is saved in the setting <c>playback.groups</c>; each group's last queue is saved under its own key (the default group keeps the 0.3.7 key <c>playback.lastQueue</c>, which is therefore its migrated queue).
/// </summary>
public sealed class ConductorRegistry : IDisposable
{
    public const string LayoutKey = "playback.groups";
    private readonly Conductor _default; private readonly Func<string, Conductor> _make; private readonly Db? _db; private readonly EventHub? _events;
    private readonly object _l = new();
    private readonly Dictionary<string, Conductor> _live = new();                       // materialized groups (default always present)
    private readonly Dictionary<string, string> _names = new();                         // non-default group names
    private readonly Dictionary<string, string> _groupOf = new();                       // playerId -> non-default groupId (absent = default)
    private readonly Dictionary<string, IStreamSubscriber> _sessions = new();           // connected sessions we may re-subscribe on moves
    private readonly HashSet<string> _enabled = new();                                  // players that are currently switched on (subscribed somewhere)
    private Timer? _saveTimer;

    /// <summary>Production: <paramref name="make"/> builds a Conductor for a group id (must reuse the default clock).</summary>
    public ConductorRegistry(Conductor defaultGroup, Func<string, Conductor> make, Db? db = null, EventHub? events = null)
    {
        _default = defaultGroup; _make = make; _db = db; _events = events; _live[Conductor.DefaultGroupId] = defaultGroup; LoadLayout();
    }
    /// <summary>Single group only (tests that build a ZoneManager around one Conductor).</summary>
    public static ConductorRegistry Single(Conductor c) => new(c, id => throw new InvalidOperationException("this registry has only the default group"));

    public Conductor Default => _default;
    public IMonotonicClock Clock => _default.Clock;

    // ---------------- lookup ----------------
    public static bool IsDefault(string? id) => string.IsNullOrEmpty(id) || id == Conductor.DefaultGroupId;
    public bool Exists(string? id) { if (IsDefault(id)) return true; lock (_l) return _names.ContainsKey(id!); }
    /// <summary>The Conductor for a group id; null/empty = the default group. Unknown id = null. Creates the Conductor on first use.</summary>
    public Conductor? Get(string? id)
    {
        if (IsDefault(id)) return _default;
        lock (_l)
        {
            if (!_names.ContainsKey(id!)) return null;
            return Materialize(id!);
        }
    }
    private Conductor Materialize(string id)
    {
        if (_live.TryGetValue(id, out var c)) return c;
        c = _make(id); _live[id] = c; if (_db != null) c.RestoreLast(); return c;
    }
    public string GroupOf(string playerId) { lock (_l) return _groupOf.TryGetValue(playerId, out var g) ? g : Conductor.DefaultGroupId; }
    public Conductor ForPlayer(string playerId) => Get(GroupOf(playerId)) ?? _default;
    /// <summary>Every materialized Conductor (default first).</summary>
    public IReadOnlyList<Conductor> Live() { lock (_l) return _live.Values.OrderBy(c => c.GroupId != Conductor.DefaultGroupId).ToList(); }

    public IReadOnlyList<PlaybackGroupInfo> Groups()
    {
        lock (_l)
        {
            var res = new List<PlaybackGroupInfo>();
            var ids = new List<string> { Conductor.DefaultGroupId }; ids.AddRange(_names.Keys.OrderBy(x => x, StringComparer.Ordinal));
            foreach (var id in ids)
            {
                _live.TryGetValue(id, out var c); var members = _groupOf.Where(kv => kv.Value == id).Select(kv => kv.Key).OrderBy(x => x).ToList();
                if (id == Conductor.DefaultGroupId) members = _sessions.Keys.Where(k => !_groupOf.ContainsKey(k)).OrderBy(x => x).ToList();
                res.Add(new(id, id == Conductor.DefaultGroupId ? "Everything" : _names[id], id == Conductor.DefaultGroupId, c != null, c?.IsIdle ?? true, members, c?.State.ToString().ToLowerInvariant() ?? "stopped", c?.Queue().Count ?? 0));
            }
            return res;
        }
    }

    // ---------------- device <-> engine ----------------
    /// <summary>A device connected / switched on: it listens to its group's engine.</summary>
    public void Subscribe(IStreamSubscriber s)
    {
        lock (_l) { _sessions[s.Id] = s; _enabled.Add(s.Id); }
        ForPlayer(s.Id).Subscribe(s);
    }
    /// <summary>A device disconnected / switched off / was removed: it leaves whatever engine it was on.</summary>
    public void Unsubscribe(string playerId)
    {
        List<Conductor> all; lock (_l) { _enabled.Remove(playerId); all = _live.Values.ToList(); }
        foreach (var c in all) c.Unsubscribe(playerId);
    }
    /// <summary>A device disconnected: forget the session (membership in a group stays, so it comes back to the same group).</summary>
    public void Disconnected(string playerId) { Unsubscribe(playerId); lock (_l) _sessions.Remove(playerId); }
    /// <summary>The device was removed for good: it leaves its engine and its group membership.</summary>
    public void Forget(string playerId)
    {
        Unsubscribe(playerId); bool had; lock (_l) { _sessions.Remove(playerId); had = _groupOf.Remove(playerId); }
        if (had) SaveLayout();
    }
    /// <summary>The player's group is playing (what the room health check needs).</summary>
    public bool Playing(string playerId) { var c = ForPlayer(playerId); return c.State == PlayState.Playing && c.Engine.Playing; }
    public long StreamAgeMs(string playerId) { var c = ForPlayer(playerId); return c.Engine.Playing ? (c.Clock.NowUs - c.Engine.EpochStartUs) / 1000 : 0; }
    /// <summary>Everyone listening to anything (Diagnostics).</summary>
    public List<IStreamSubscriber> Subscribers() { var r = new List<IStreamSubscriber>(); foreach (var c in Live()) r.AddRange(c.Subscribers()); return r; }

    // ---------------- link / unlink ----------------
    public static string OwnGroupId(string playerId) => "p:" + playerId;

    /// <summary>Unlink: the device leaves its group and gets its own, which resumes its own saved queue (stopped, not auto-playing). The group it left keeps playing for everyone else. Returns the new group id.</summary>
    public string Split(string playerId, string? name = null)
    {
        string id = OwnGroupId(playerId);
        lock (_l) { if (_groupOf.TryGetValue(playerId, out var cur) && cur == id) return id; _names[id] = string.IsNullOrWhiteSpace(name) ? (_names.TryGetValue(id, out var old) ? old : "Zone " + (_names.Count + 1)) : name!.Trim(); }
        Move(playerId, id); return id;
    }

    /// <summary>0.4.0 Stage 2: put a device into a named group (created on first use). Used by ZoneLinks to mirror the Zones screen; the default group needs no name.</summary>
    public void Assign(string playerId, string groupId, string? name = null)
    {
        if (!IsDefault(groupId)) { bool added; lock (_l) { added = !_names.ContainsKey(groupId) || (!string.IsNullOrWhiteSpace(name) && _names[groupId] != name); if (added) _names[groupId] = string.IsNullOrWhiteSpace(name) ? (_names.TryGetValue(groupId, out var o) ? o : groupId) : name!; } if (added) SaveLayout(); }
        Move(playerId, IsDefault(groupId) ? Conductor.DefaultGroupId : groupId);
    }
    /// <summary>0.4.1: a zone's playback group exists even with 0 speakers (so a zoneId for it always resolves).</summary>
    public void Ensure(string groupId, string name)
    {
        if (IsDefault(groupId)) return; bool changed = false;
        lock (_l) { if (!_names.TryGetValue(groupId, out var o) || (!string.IsNullOrWhiteSpace(name) && o != name)) { _names[groupId] = string.IsNullOrWhiteSpace(name) ? groupId : name; changed = true; } }
        if (changed) SaveLayout();
    }
    /// <summary>0.4.1: drop zone groups ("zg:...") nobody refers to and nobody is in: stops them, forgets their saved queue. Returns how many were dropped.</summary>
    public int Prune(ISet<string> keep)
    {
        List<(string Id, Conductor? C)> gone = new();
        lock (_l)
        {
            foreach (var id in _names.Keys.Where(k => k.StartsWith("zg:") && !keep.Contains(k) && !_groupOf.ContainsValue(k)).ToList())
            { _live.TryGetValue(id, out var c); _live.Remove(id); _names.Remove(id); gone.Add((id, c)); }
        }
        foreach (var (id, c) in gone) { if (c != null) { try { c.Stop(); c.Dispose(); c.ForgetSaved(); } catch { } } else { try { _db?.DeleteSetting(LastQueueKeyFor(id)); } catch { } } }
        if (gone.Count > 0) SaveLayout();
        return gone.Count;
    }
    private static string LastQueueKeyFor(string id) => Conductor.LastQueueKey + "." + id;
    /// <summary>The name a group shows (the house group is "Everything").</summary>
    public string NameOf(string? groupId) { if (IsDefault(groupId)) return "Everything"; lock (_l) return _names.TryGetValue(groupId!, out var n) ? n : groupId!; }

    /// <summary>Link: a device joins another group (default = the house group) and listens to that group's music. Its own group keeps its queue (stopped) for the next Split.</summary>
    public void Link(string playerId, string? intoGroupId = null)
    {
        var into = IsDefault(intoGroupId) ? Conductor.DefaultGroupId : intoGroupId!;
        if (!Exists(into)) throw new ArgumentException("no such zone");
        Move(playerId, into);
    }

    /// <summary>Link a whole group into another: all its devices move, its Conductor goes idle (stopped, queue kept).</summary>
    public void LinkGroup(string fromGroupId, string? intoGroupId = null)
    {
        if (IsDefault(fromGroupId)) throw new ArgumentException("the house group cannot be linked into another");
        var into = IsDefault(intoGroupId) ? Conductor.DefaultGroupId : intoGroupId!;
        if (fromGroupId == into) return; if (!Exists(into) || !Exists(fromGroupId)) throw new ArgumentException("no such zone");
        string[] members; lock (_l) members = _groupOf.Where(kv => kv.Value == fromGroupId).Select(kv => kv.Key).ToArray();
        foreach (var m in members) Move(m, into);
    }

    private void Move(string playerId, string toGroup)
    {
        Conductor? from; Conductor to; bool wasOn; IStreamSubscriber? sess; string fromId;
        lock (_l)
        {
            fromId = _groupOf.TryGetValue(playerId, out var g) ? g : Conductor.DefaultGroupId;
            if (fromId == toGroup) return;
            _live.TryGetValue(fromId, out from);
            if (toGroup == Conductor.DefaultGroupId) _groupOf.Remove(playerId); else _groupOf[playerId] = toGroup;
            to = toGroup == Conductor.DefaultGroupId ? _default : Materialize(toGroup);
            wasOn = _enabled.Contains(playerId); _sessions.TryGetValue(playerId, out sess);
        }
        if (wasOn) from?.Release(playerId); else from?.Unsubscribe(playerId);
        if (wasOn && sess != null) to.Subscribe(sess);
        // a non-default group nobody listens to any more goes quiet (queue kept)
        if (from != null && fromId != Conductor.DefaultGroupId && !from.Subscribers().Any() && from.State != PlayState.Stopped) from.Stop();
        SaveLayout(); _events?.Publish("zones");
    }

    // ---------------- persistence ----------------
    private void LoadLayout()
    {
        try
        {
            var raw = _db?.Setting(LayoutKey); if (string.IsNullOrWhiteSpace(raw)) return;
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("groups", out var arr) || arr.ValueKind != JsonValueKind.Array) return;
            foreach (var e in arr.EnumerateArray())
            {
                var id = e.GetProperty("id").GetString(); if (string.IsNullOrWhiteSpace(id) || id == Conductor.DefaultGroupId) continue;
                _names[id] = e.TryGetProperty("name", out var n) ? n.GetString() ?? id : id;
                if (e.TryGetProperty("players", out var pl) && pl.ValueKind == JsonValueKind.Array) foreach (var p in pl.EnumerateArray()) if (p.GetString() is { Length: > 0 } pid) _groupOf[pid] = id;
            }
        }
        catch { /* a damaged layout means "everything linked", i.e. today's behavior */ }
    }
    private void SaveLayout()
    {
        if (_db == null) return;
        try
        {
            string json; lock (_l) json = JsonSerializer.Serialize(new { v = 1, groups = _names.Select(kv => new { id = kv.Key, name = kv.Value, players = _groupOf.Where(x => x.Value == kv.Key).Select(x => x.Key).OrderBy(x => x).ToList() }).ToList() });
            _db.SetSetting(LayoutKey, json);
        }
        catch { }
    }

    /// <summary>Restores the default group's saved queue and every split group's, then starts one shared 2 s save timer for all of them (idle groups write nothing: SaveLast skips unchanged queues).</summary>
    public void EnablePersistence()
    {
        _default.RestoreLast();
        string[] ids; lock (_l) ids = _names.Keys.ToArray();
        foreach (var id in ids) Get(id);          // Materialize restores the saved queue
        _saveTimer ??= new Timer(_ => SaveAll(), null, 2000, 2000);
    }
    public void SaveAll() { foreach (var c in Live()) { if (c.GroupId != Conductor.DefaultGroupId && c.IsIdle && c.Queue().Count == 0) continue; c.SaveLast(); } }

    public void Dispose()
    {
        _saveTimer?.Dispose(); SaveAll();
        foreach (var c in Live()) c.Dispose();
    }
}
