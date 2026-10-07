using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>Time-of-day schedules (e.g. radio in kitchen at 7am, all off at midnight). Evaluated once a minute.</summary>
public sealed class ScheduleService
{
    private readonly Db _db;
    private readonly Zones.ZoneManager _zones;
    private readonly Playback.Conductor _cond;
    private readonly EventHub _ev;
    private readonly object _l = new();
    public ScheduleService(Db db, Zones.ZoneManager zones, Playback.Conductor cond, EventHub ev) { _db = db; _zones = zones; _cond = cond; _ev = ev; }

    public object List() => _db.Query("SELECT id,name,enabled,days,time_hm,action,payload_json,last_run_at,created_at FROM schedule ORDER BY time_hm,id",
        r => new { id = r.GetInt64(0), name = r.GetString(1), enabled = r.GetInt32(2) != 0, days = r.GetString(3), time = r.GetString(4), action = r.GetString(5),
            payload = JsonDocument.Parse(r.IsDBNull(6) ? "{}" : r.GetString(6)).RootElement.Clone(), lastRunAt = r.IsDBNull(7) ? null : r.GetString(7), createdAt = r.GetString(8) });

    public (long Id, string? Err) Create(JsonElement b)
    {
        var name = (b.Str("name") ?? "").Trim(); if (name.Length is 0 or > 60) return (0, "name must be 1-60 characters");
        var time = b.Str("time") ?? b.Str("timeHm") ?? ""; if (!IsHm(time)) return (0, "time must be HH:MM (24-hour)");
        var action = b.Str("action") ?? ""; if (action is not ("play_radio" or "stop" or "scene" or "volumes" or "all_off")) return (0, "action must be play_radio, stop, scene, volumes or all_off");
        var days = b.Str("days") ?? "0123456"; if (days.Length == 0 || days.Any(c => c is < '0' or > '6')) return (0, "days must be digits 0-6 (Sun-Sat)");
        var payload = b.Prop("payload") is JsonElement p ? p.GetRawText() : "{}";
        var now = DateTimeOffset.UtcNow.ToString("O");
        var id = _db.Insert("INSERT INTO schedule(name,enabled,days,time_hm,action,payload_json,created_at) VALUES($n,$e,$d,$t,$a,$p,$c)",
            ("$n", name), ("$e", b.Bool("enabled") != false ? 1 : 0), ("$d", days), ("$t", time), ("$a", action), ("$p", payload), ("$c", now));
        _ev.Publish("schedules"); return (id, null);
    }

    public string? Update(long id, JsonElement b)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM schedule WHERE id=$i", ("$i", id))) == 0) return "schedule not found";
        if (b.Str("name") is string n) { n = n.Trim(); if (n.Length is 0 or > 60) return "name must be 1-60 characters"; _db.Exec("UPDATE schedule SET name=$n WHERE id=$i", ("$n", n), ("$i", id)); }
        {
            var timeVal = b.Str("time") ?? b.Str("timeHm");
            if (timeVal != null) { if (!IsHm(timeVal)) return "time must be HH:MM (24-hour)"; _db.Exec("UPDATE schedule SET time_hm=$t WHERE id=$i", ("$t", timeVal), ("$i", id)); }
        }
        if (b.Str("action") is string a) { if (a is not ("play_radio" or "stop" or "scene" or "volumes" or "all_off")) return "bad action"; _db.Exec("UPDATE schedule SET action=$a WHERE id=$i", ("$a", a), ("$i", id)); }
        if (b.Str("days") is string d) { if (d.Length == 0 || d.Any(c => c is < '0' or > '6')) return "bad days"; _db.Exec("UPDATE schedule SET days=$d WHERE id=$i", ("$d", d), ("$i", id)); }
        if (b.Bool("enabled") is bool en) _db.Exec("UPDATE schedule SET enabled=$e WHERE id=$i", ("$e", en ? 1 : 0), ("$i", id));
        if (b.Prop("payload") is JsonElement p) _db.Exec("UPDATE schedule SET payload_json=$p WHERE id=$i", ("$p", p.GetRawText()), ("$i", id));
        _ev.Publish("schedules"); return null;
    }

    public string? Delete(long id) { _db.Exec("DELETE FROM schedule WHERE id=$i", ("$i", id)); _ev.Publish("schedules"); return null; }

    public void Tick(DateTimeOffset localNow)
    {
        lock (_l)
        {
            var hm = localNow.ToString("HH:mm");
            var day = ((int)localNow.DayOfWeek).ToString(); // 0=Sun
            var due = _db.Query("SELECT id,action,payload_json,last_run_at FROM schedule WHERE enabled=1 AND time_hm=$t AND instr(days,$d)>0",
                r => (Id: r.GetInt64(0), Action: r.GetString(1), Payload: r.IsDBNull(2) ? "{}" : r.GetString(2), Last: r.IsDBNull(3) ? null : r.GetString(3)),
                ("$t", hm), ("$d", day));
            foreach (var s in due)
            {
                // skip if already run in this local minute
                if (s.Last != null && DateTimeOffset.TryParse(s.Last, out var lr) && lr.ToLocalTime().ToString("yyyy-MM-dd HH:mm") == localNow.ToLocalTime().ToString("yyyy-MM-dd HH:mm")) continue;
                try { Run(s.Action, s.Payload); } catch { /* logged by caller */ }
                _db.Exec("UPDATE schedule SET last_run_at=$t WHERE id=$i", ("$t", localNow.ToString("O")), ("$i", s.Id));
            }
        }
    }

    private void Run(string action, string payloadJson)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson);
        var p = doc.RootElement;
        switch (action)
        {
            case "stop": case "all_off":
                _cond.Stop();
                foreach (var z in _zones.Zones()) _zones.Patch(z.Id, null, null, null, false);
                break;
            case "play_radio":
            {
                var rid = p.Long("radioId");
                if (rid != null) { var it = _cond.StationToItem(rid.Value); if (it != null) _cond.PlayItems(new[] { it }); }
                break;
            }
            case "scene":
            {
                var sid = p.Long("sceneId");
                if (sid != null) new SceneService(_db, _zones, _ev).Apply(sid.Value);
                break;
            }
            case "volumes":
                if (p.Prop("devices") is JsonElement arr && arr.ValueKind == JsonValueKind.Array)
                    foreach (var e in arr.EnumerateArray())
                    {
                        var id = e.Long("deviceId") ?? e.Long("id"); if (id == null) continue;
                        _zones.Patch(id.Value, null, e.Num("volume"), null, e.Bool("enabled"));
                    }
                break;
        }
        _ev.Publish("zones"); _ev.Publish("now");
    }

    private static bool IsHm(string t) => t.Length == 5 && t[2] == ':' && int.TryParse(t.AsSpan(0, 2), out var h) && int.TryParse(t.AsSpan(3, 2), out var m) && h is >= 0 and <= 23 && m is >= 0 and <= 59;
}
