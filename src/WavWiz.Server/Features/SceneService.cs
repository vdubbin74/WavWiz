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

    public object List() => _db.Query("SELECT id,name,icon,created_at,updated_at FROM scene ORDER BY name COLLATE NOCASE",
        r => new { id = r.GetInt64(0), name = r.GetString(1), icon = r.IsDBNull(2) ? null : r.GetString(2), createdAt = r.GetString(3), updatedAt = r.GetString(4),
            members = _db.Query("SELECT device_id,volume,enabled FROM scene_member WHERE scene_id=$s", m => new { deviceId = m.GetInt64(0), volume = m.GetDouble(1), enabled = m.GetInt32(2) != 0 }, ("$s", r.GetInt64(0))) });

    public (long Id, string? Err) Create(string? name, string? icon, IEnumerable<(long DeviceId, double Volume, bool Enabled)>? members)
    {
        name = (name ?? "").Trim(); if (name.Length is 0 or > 60) return (0, "name must be 1-60 characters");
        var now = DateTimeOffset.UtcNow.ToString("O");
        var id = _db.Insert("INSERT INTO scene(name,icon,created_at,updated_at) VALUES($n,$i,$t,$t)", ("$n", name), ("$i", icon), ("$t", now));
        if (members != null) foreach (var m in members)
            _db.Exec("INSERT INTO scene_member(scene_id,device_id,volume,enabled) VALUES($s,$d,$v,$e)", ("$s", id), ("$d", m.DeviceId), ("$v", Math.Clamp(m.Volume, 0, 100)), ("$e", m.Enabled ? 1 : 0));
        _ev.Publish("scenes"); return (id, null);
    }

    public string? Update(long id, string? name, string? icon, IEnumerable<(long DeviceId, double Volume, bool Enabled)>? members)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM scene WHERE id=$i", ("$i", id))) == 0) return "scene not found";
        if (name != null) { name = name.Trim(); if (name.Length is 0 or > 60) return "name must be 1-60 characters"; _db.Exec("UPDATE scene SET name=$n WHERE id=$i", ("$n", name), ("$i", id)); }
        if (icon != null) _db.Exec("UPDATE scene SET icon=$n WHERE id=$i", ("$n", icon), ("$i", id));
        if (members != null)
        {
            _db.Exec("DELETE FROM scene_member WHERE scene_id=$s", ("$s", id));
            foreach (var m in members)
                _db.Exec("INSERT INTO scene_member(scene_id,device_id,volume,enabled) VALUES($s,$d,$v,$e)", ("$s", id), ("$d", m.DeviceId), ("$v", Math.Clamp(m.Volume, 0, 100)), ("$e", m.Enabled ? 1 : 0));
        }
        _db.Exec("UPDATE scene SET updated_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        _ev.Publish("scenes"); return null;
    }

    public string? Delete(long id) { _db.Exec("DELETE FROM scene_member WHERE scene_id=$i", ("$i", id)); _db.Exec("DELETE FROM scene WHERE id=$i", ("$i", id)); _ev.Publish("scenes"); return null; }

    public string? Apply(long id)
    {
        var members = _db.Query("SELECT device_id,volume,enabled FROM scene_member WHERE scene_id=$s", r => (r.GetInt64(0), r.GetDouble(1), r.GetInt32(2) != 0), ("$s", id));
        if (members.Count == 0 && Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM scene WHERE id=$i", ("$i", id))) == 0) return "scene not found";
        foreach (var (dev, vol, en) in members) _zones.Patch(dev, null, vol, null, en);
        _ev.Publish("zones"); _ev.Publish("scenes"); return null;
    }

    /// <summary>Snapshot the current device volumes/on-off into a new or existing scene.</summary>
    public (long Id, string? Err) Capture(string? name, long? existingId)
    {
        var zones = _zones.Zones();
        var members = zones.Select(z => (z.Id, z.Volume, z.Enabled));
        if (existingId is long eid) { var err = Update(eid, name, null, members); return (eid, err); }
        return Create(name ?? "Scene", null, members);
    }
}
