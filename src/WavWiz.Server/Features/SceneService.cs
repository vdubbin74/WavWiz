using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>One-tap scenes: named sets of per-device volume/on-off (Party, Night, …).</summary>
public sealed class SceneService
{
    private readonly Db _db;
    private readonly Zones.ZoneManager _zones;
    private readonly EventHub _ev;
    public SceneService(Db db, Zones.ZoneManager zones, EventHub ev) { _db = db; _zones = zones; _ev = ev; }
    /// <summary>0.3.6 K7: set by the host; scenes can load a speaker profile per device.</summary>
    public DeviceProfileService? Profiles;
    /// <summary>0.4.2: set by the host; used to save and re-apply which zones are linked.</summary>
    public Zones.ZoneLinks? Links;

    /// <summary>0.4.2: the zone layout of right now: each zone's speakers, and the sets of zones that play the same music.</summary>
    public string LayoutJson()
    {
        var gs = _zones.Groups().OrderBy(g => g.Id).ToList();
        var sets = new List<List<long>>(); if (Links != null) foreach (var grp in gs.GroupBy(g => Links.PlaybackId(g.Id)).Where(x => x.Count() > 1)) sets.Add(grp.Select(g => g.Id).ToList());
        return JsonSerializer.Serialize(new { v = 1, zones = gs.Select(g => new { id = g.Id, name = g.Name, deviceIds = g.DeviceIds }), links = sets });
    }
    /// <summary>0.4.2: put the speakers back in their zones and re-link the zones, as the scene saved them. A zone or speaker that no longer exists is skipped.</summary>
    private void ApplyLayout(string json)
    {
        try
        {
            using var d = JsonDocument.Parse(json); var root = d.RootElement;
            var have = _zones.Groups().ToDictionary(g => g.Id); var devs = _zones.Zones().Select(z => z.Id).ToHashSet();
            if (root.TryGetProperty("zones", out var zs))
                foreach (var z in zs.EnumerateArray())
                {
                    var id = z.GetProperty("id").GetInt64(); if (!have.ContainsKey(id)) continue;
                    var ids = z.GetProperty("deviceIds").EnumerateArray().Select(e => e.GetInt64()).Where(devs.Contains).ToList();
                    _zones.UpdateGroup(id, null, ids);
                }
            if (Links != null && root.TryGetProperty("links", out var ls))
            {
                var sets = ls.EnumerateArray().Select(a => a.EnumerateArray().Select(e => e.GetInt64()).Where(have.ContainsKey).ToList()).Where(a => a.Count > 0).ToList();
                foreach (var id in sets.SelectMany(x => x)) Links.SplitOff(id);
                foreach (var set in sets) foreach (var other in set.Skip(1)) Links.Link(other, set[0]);
            }
        }
        catch { /* a layout that cannot be read never stops the scene */ }
    }
    public string? Layout(long id) => _db.Scalar("SELECT layout FROM scene WHERE id=$i", ("$i", id)) as string;

    /// <summary>0.3.0: the scene whose members match the current setup (on/off and volume within 1), or null.</summary>
    public long? ActiveSceneId()
    {
        var zones = _zones.Zones().ToDictionary(z => z.Id);
        foreach (var id in _db.Query("SELECT id FROM scene ORDER BY id", r => r.GetInt64(0)))
        {
            var ms = _db.Query("SELECT device_id,volume,enabled FROM scene_member WHERE scene_id=$s", m => (m.GetInt64(0), m.GetDouble(1), m.GetInt32(2) != 0), ("$s", id));
            if (ms.Count > 0 && ms.All(m => zones.TryGetValue(m.Item1, out var z) && z.Enabled == m.Item3 && (!m.Item3 || Math.Abs(z.Volume - m.Item2) <= 1))) return id;
        }
        return null;
    }

    public object List() { var act = ActiveSceneId(); return ListRows(act); }
    private object ListRows(long? act) => _db.Query("SELECT id,name,icon,created_at,updated_at,layout FROM scene ORDER BY name COLLATE NOCASE",
        r => new { active = r.GetInt64(0) == act, id = r.GetInt64(0), name = r.GetString(1), icon = r.IsDBNull(2) ? null : r.GetString(2), createdAt = r.GetString(3), updatedAt = r.GetString(4),
            hasLayout = !r.IsDBNull(5), layout = r.IsDBNull(5) ? null : (object?)JsonSerializer.Deserialize<JsonElement>(r.GetString(5)),
            members = _db.Query("SELECT device_id,volume,enabled,profile_id FROM scene_member WHERE scene_id=$s", m => new { deviceId = m.GetInt64(0), volume = m.GetDouble(1), enabled = m.GetInt32(2) != 0, profileId = m.IsDBNull(3) ? (long?)null : m.GetInt64(3) }, ("$s", r.GetInt64(0))) });

    public (long Id, string? Err) Create(string? name, string? icon, IEnumerable<(long DeviceId, double Volume, bool Enabled, long? ProfileId)>? members)
    {
        name = (name ?? "").Trim(); if (name.Length is 0 or > 60) return (0, "name must be 1-60 characters");
        var now = DateTimeOffset.UtcNow.ToString("O");
        var id = _db.Insert("INSERT INTO scene(name,icon,created_at,updated_at) VALUES($n,$i,$t,$t)", ("$n", name), ("$i", icon), ("$t", now));
        if (members != null) foreach (var m in members)
            _db.Exec("INSERT INTO scene_member(scene_id,device_id,volume,enabled,profile_id) VALUES($s,$d,$v,$e,$p)", ("$s", id), ("$d", m.DeviceId), ("$v", Math.Clamp(m.Volume, 0, 100)), ("$e", m.Enabled ? 1 : 0), ("$p", m.ProfileId is long pr && (Profiles?.Exists(pr) ?? false) ? pr : null));
        _db.Exec("UPDATE scene SET layout=$l WHERE id=$i", ("$l", LayoutJson()), ("$i", id));      // 0.4.2: every new scene remembers the zone layout
        _ev.Publish("scenes"); return (id, null);
    }

    public string? Update(long id, string? name, string? icon, IEnumerable<(long DeviceId, double Volume, bool Enabled, long? ProfileId)>? members)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM scene WHERE id=$i", ("$i", id))) == 0) return "scene not found";
        if (name != null) { name = name.Trim(); if (name.Length is 0 or > 60) return "name must be 1-60 characters"; _db.Exec("UPDATE scene SET name=$n WHERE id=$i", ("$n", name), ("$i", id)); }
        if (icon != null) _db.Exec("UPDATE scene SET icon=$n WHERE id=$i", ("$n", icon), ("$i", id));
        if (members != null)
        {
            _db.Exec("DELETE FROM scene_member WHERE scene_id=$s", ("$s", id));
            foreach (var m in members)
                _db.Exec("INSERT INTO scene_member(scene_id,device_id,volume,enabled,profile_id) VALUES($s,$d,$v,$e,$p)", ("$s", id), ("$d", m.DeviceId), ("$v", Math.Clamp(m.Volume, 0, 100)), ("$e", m.Enabled ? 1 : 0), ("$p", m.ProfileId is long pr && (Profiles?.Exists(pr) ?? false) ? pr : null));
        }
        _db.Exec("UPDATE scene SET updated_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        _ev.Publish("scenes"); return null;
    }

    public string? Delete(long id) { _db.Exec("DELETE FROM scene_member WHERE scene_id=$i", ("$i", id)); _db.Exec("DELETE FROM scene WHERE id=$i", ("$i", id)); _ev.Publish("scenes"); return null; }

    public string? Apply(long id)
    {
        var members = _db.Query("SELECT device_id,volume,enabled,profile_id FROM scene_member WHERE scene_id=$s", r => (r.GetInt64(0), r.GetDouble(1), r.GetInt32(2) != 0, r.IsDBNull(3) ? (long?)null : r.GetInt64(3)), ("$s", id));
        if (members.Count == 0 && Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM scene WHERE id=$i", ("$i", id))) == 0) return "scene not found";
        var lay = Layout(id); if (lay != null) ApplyLayout(lay);      // 0.4.2: regroup first, then volumes and on/off
        foreach (var (dev, vol, en, prof) in members)
        {
            // K7: the device's profile first (without its own volume), then the scene's on/off and volume - zone volume still scales and the cap is still enforced by Patch
            if (en && prof is long pr && Profiles != null) { try { Profiles.Apply(pr, dev, withVolume: false, withCap: false); } catch { /* a profile that cannot load never stops the scene */ } }
            _zones.Patch(dev, null, vol, null, en);
        }
        _ev.Publish("zones"); _ev.Publish("scenes"); return null;
    }

    /// <summary>Snapshot the current device volumes/on-off into a new or existing scene.</summary>
    public (long Id, string? Err) Capture(string? name, long? existingId)
    {
        var zones = _zones.Zones();
        var keep = existingId is long ex0 ? _db.Query("SELECT device_id,profile_id FROM scene_member WHERE scene_id=$s AND profile_id IS NOT NULL", r => (r.GetInt64(0), r.GetInt64(1)), ("$s", ex0)).ToDictionary(x => x.Item1, x => x.Item2) : new();
        var members = zones.Select(z => (z.Id, z.Volume, z.Enabled, keep.TryGetValue(z.Id, out var kp) ? (long?)kp : null));
        if (existingId is long eid) { var err = Update(eid, name, null, members); if (err == null) _db.Exec("UPDATE scene SET layout=$l WHERE id=$i", ("$l", LayoutJson()), ("$i", eid)); return (eid, err); }
        var made = Create(name ?? "Scene", null, members); if (made.Err == null) _db.Exec("UPDATE scene SET layout=$l WHERE id=$i", ("$l", LayoutJson()), ("$i", made.Id)); return made;
    }
}
