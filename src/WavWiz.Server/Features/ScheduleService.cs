using System.Globalization;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
namespace WavWiz.Server.Features;

/// <summary>Pure schedule maths (unit tested): the next run on the SERVER clock, across midnight, weekend-only and once-only.</summary>
public static class ScheduleMath
{
    public static bool IsHm(string t) => t.Length == 5 && t[2] == ':' && int.TryParse(t.AsSpan(0, 2), out var h) && int.TryParse(t.AsSpan(3, 2), out var m) && h is >= 0 and <= 23 && m is >= 0 and <= 59;
    public static bool IsDate(string? d) => d != null && DateTime.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    /// <summary>Next time this schedule fires strictly after <paramref name="now"/> (local server time), or null (disabled / once-only in the past).
    /// skipUntil: occurrences at or before it are skipped ("Skip next").</summary>
    public static DateTime? NextRun(bool enabled, string days, string hm, string? onceDate, DateTime? skipUntil, DateTime now)
    {
        if (!enabled || !IsHm(hm)) return null;
        var t = TimeSpan.ParseExact(hm, "hh\\:mm", CultureInfo.InvariantCulture);
        if (IsDate(onceDate))
        {
            var at = DateTime.ParseExact(onceDate!, "yyyy-MM-dd", CultureInfo.InvariantCulture) + t;
            return at > now && (skipUntil == null || at > skipUntil) ? at : null;
        }
        for (int i = 0; i <= 14; i++)
        {
            var d = now.Date.AddDays(i); var at = d + t;
            if (at <= now) continue;
            if (!days.Contains(((int)d.DayOfWeek).ToString())) continue;
            if (skipUntil != null && at <= skipUntil) continue;
            return at;
        }
        return null;
    }

    /// <summary>Does it fire in this local minute?</summary>
    public static bool DueAt(string days, string hm, string? onceDate, DateTime minute)
    {
        if (minute.ToString("HH:mm", CultureInfo.InvariantCulture) != hm) return false;
        if (IsDate(onceDate)) return minute.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) == onceDate;
        return days.Contains(((int)minute.DayOfWeek).ToString());
    }

    /// <summary>Volume of a fade ramp at time <paramref name="sec"/> after start (linear, reaches end exactly at fadeSec).</summary>
    public static double Ramp(double start, double end, double fadeSec, double sec) => fadeSec <= 0 ? end : start + (end - start) * Math.Clamp(sec / fadeSec, 0, 1);

    /// <summary>A plain-English label for an action key (never "all_off" in the UI).</summary>
    public static string Label(string action) => action switch
    {
        "play" => "Play something", "play_radio" => "Play radio", "scene" => "Apply a scene", "volumes" => "Set volumes", "stop" => "Stop playback", "all_off" => "All off", _ => action
    };
}

/// <summary>Time-of-day schedules and alarms (0.3.0: play action, once-only, skip next, fade ramp, snooze/stop, auto-stop). Evaluated every second.</summary>
public sealed class ScheduleService
{
    public static readonly string[] Actions = { "play", "play_radio", "stop", "scene", "volumes", "all_off" };
    private readonly Db _db;
    private readonly Zones.ZoneManager _zones;
    private readonly Playback.Conductor _cond;
    private readonly EventHub _ev;
    private readonly object _l = new();
    /// <summary>Resolves a play source to queue items (wired to PlaybackApi.ResolveItems). Tests inject a fake.</summary>
    public Func<JsonElement, List<QueueItem>>? Resolve { get; set; }
    public Func<DateTime> Clock { get; set; } = () => DateTime.Now;
    /// <summary>0.4.0: the Conductor a zone key ("g:3" / "jukebox" / null = everything) plays in, the key's devices, its name, and "stop every group". Wired by the server; tests may leave them (house group).</summary>
    public Func<string?, Playback.Conductor>? CondFor { get; set; }
    public Func<string?, List<long>?>? DevicesOf { get; set; }
    public Func<string?, string?>? KeyName { get; set; }
    public Action? StopAll { get; set; }
    private Playback.Conductor CondOf(string? key) => CondFor?.Invoke(key) ?? _cond;
    private static string? KeyIn(string payloadJson) { try { using var d = JsonDocument.Parse(string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson); var k = d.RootElement.Str("zoneKey"); return string.IsNullOrWhiteSpace(k) ? null : k; } catch { return null; } }

    public sealed class Ringing { public long Id; public string Name = ""; public DateTime StartedAt; public double StartVol, EndVol, FadeSec; public List<long> Zones = new();
        public int SnoozeMin = 9; public int AutoStopMin = 30; public DateTime? SnoozedUntil; public string Payload = "{}"; public double Progress; public string? ZoneKey; }
    public Ringing? Active { get; private set; }

    public ScheduleService(Db db, Zones.ZoneManager zones, Playback.Conductor cond, EventHub ev) { _db = db; _zones = zones; _cond = cond; _ev = ev; }

    private sealed record Row(long Id, string Name, bool Enabled, string Days, string Time, string Action, string Payload, string? LastRunAt, string CreatedAt, string? OnceDate, string? SkipUntil, string? LastResult);
    private List<Row> Rows(string where = "", params (string, object?)[] ps) => _db.Query($"SELECT id,name,enabled,days,time_hm,action,payload_json,last_run_at,created_at,once_date,skip_until,last_result FROM schedule {where} ORDER BY time_hm,id",
        r => new Row(r.GetInt64(0), r.GetString(1), r.GetInt32(2) != 0, r.GetString(3), r.GetString(4), r.GetString(5), r.IsDBNull(6) ? "{}" : r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7), r.GetString(8),
            r.IsDBNull(9) ? null : r.GetString(9), r.IsDBNull(10) ? null : r.GetString(10), r.IsDBNull(11) ? null : r.GetString(11)), ps);
    private static DateTime? Dt(string? s) => s != null && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public object List()
    {
        var now = Clock();
        return Rows().Select(r =>
        {
            var next = ScheduleMath.NextRun(r.Enabled, r.Days, r.Time, r.OnceDate, Dt(r.SkipUntil), now); var zk = KeyIn(r.Payload);
            var skippedAt = Dt(r.SkipUntil) is DateTime su && su > now ? ScheduleMath.NextRun(r.Enabled, r.Days, r.Time, r.OnceDate, null, now) : null;
            return new { id = r.Id, name = r.Name, enabled = r.Enabled, days = r.Days, time = r.Time, action = r.Action, actionLabel = ScheduleMath.Label(r.Action),
                payload = JsonDocument.Parse(string.IsNullOrWhiteSpace(r.Payload) ? "{}" : r.Payload).RootElement.Clone(), lastRunAt = r.LastRunAt, createdAt = r.CreatedAt,
                zoneKey = zk, zoneName = KeyName?.Invoke(zk), onceDate = r.OnceDate, skipUntil = r.SkipUntil, lastResult = r.LastResult, alarm = r.Action == "play",
                nextRunAt = next?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture), skippedRunAt = skippedAt?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture) };
        }).OrderBy(x => x.nextRunAt ?? "9999").ThenBy(x => x.id).ToList();
    }

    public object ClockDto() => new { now = Clock().ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture), server = Environment.MachineName };
    public object AlarmState() => Active is { } a ? new { id = a.Id, name = a.Name, ringing = a.SnoozedUntil == null, snoozedUntil = a.SnoozedUntil?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture),
        zoneKey = a.ZoneKey, zoneName = KeyName?.Invoke(a.ZoneKey), startedAt = a.StartedAt.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture), progress = Math.Round(a.Progress, 3), snoozeMin = a.SnoozeMin, endVol = a.EndVol } : null!;

    private static string? Validate(JsonElement b, bool create, out string? days, out string? once)
    {
        days = b.Str("days"); once = b.Str("onceDate");
        if (create && (b.Str("name") ?? "").Trim().Length is 0 or > 60) return "Give it a name (up to 60 characters).";
        if (b.Str("action") is string a && !Actions.Contains(a)) return "Pick what should happen.";
        if (once != null && once != "" && !ScheduleMath.IsDate(once)) return "The date must look like 2026-10-31.";
        if (days != null && (days.Any(c => c is < '0' or > '6') || days.Distinct().Count() != days.Length)) return "Days must be 0-6 (Sunday-Saturday).";
        if (days != null && days.Length == 0 && string.IsNullOrEmpty(once)) return "Pick at least one day.";
        return null;
    }

    public (long Id, string? Err) Create(JsonElement b)
    {
        var err = Validate(b, true, out var days, out var once); if (err != null) return (0, err);
        var name = b.Str("name")!.Trim();
        var time = b.Str("time") ?? b.Str("timeHm") ?? ""; if (!ScheduleMath.IsHm(time)) return (0, "time must be HH:MM (24-hour)");
        var action = b.Str("action") ?? ""; if (!Actions.Contains(action)) return (0, "Pick what should happen.");
        days ??= "0123456"; if (string.IsNullOrEmpty(once)) once = null;
        var payload = b.Prop("payload") is JsonElement p ? p.GetRawText() : "{}";
        var id = _db.Insert("INSERT INTO schedule(name,enabled,days,time_hm,action,payload_json,created_at,once_date) VALUES($n,$e,$d,$t,$a,$p,$c,$o)",
            ("$n", name), ("$e", b.Bool("enabled") != false ? 1 : 0), ("$d", days), ("$t", time), ("$a", action), ("$p", payload), ("$c", DateTimeOffset.UtcNow.ToString("O")), ("$o", once));
        _ev.Publish("schedules"); return (id, null);
    }

    public string? Update(long id, JsonElement b)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM schedule WHERE id=$i", ("$i", id))) == 0) return "schedule not found";
        var err = Validate(b, false, out var days, out var once); if (err != null) return err;
        if (b.Str("name") is string n) { n = n.Trim(); if (n.Length is 0 or > 60) return "Give it a name (up to 60 characters)."; _db.Exec("UPDATE schedule SET name=$n WHERE id=$i", ("$n", n), ("$i", id)); }
        var timeVal = b.Str("time") ?? b.Str("timeHm");
        if (timeVal != null) { if (!ScheduleMath.IsHm(timeVal)) return "time must be HH:MM (24-hour)"; _db.Exec("UPDATE schedule SET time_hm=$t WHERE id=$i", ("$t", timeVal), ("$i", id)); }
        if (b.Str("action") is string a) _db.Exec("UPDATE schedule SET action=$a WHERE id=$i", ("$a", a), ("$i", id));
        if (days != null && days.Length > 0) _db.Exec("UPDATE schedule SET days=$d WHERE id=$i", ("$d", days), ("$i", id));
        if (b.Prop("onceDate") is JsonElement) _db.Exec("UPDATE schedule SET once_date=$o WHERE id=$i", ("$o", string.IsNullOrEmpty(once) ? null : once), ("$i", id));
        if (b.Bool("enabled") is bool en) _db.Exec("UPDATE schedule SET enabled=$e, skip_until=CASE WHEN $e=1 THEN skip_until ELSE NULL END WHERE id=$i", ("$e", en ? 1 : 0), ("$i", id));
        if (b.Prop("payload") is JsonElement p) _db.Exec("UPDATE schedule SET payload_json=$p WHERE id=$i", ("$p", p.GetRawText()), ("$i", id));
        _ev.Publish("schedules"); return null;
    }

    public string? Delete(long id) { _db.Exec("DELETE FROM schedule WHERE id=$i", ("$i", id)); _ev.Publish("schedules"); return null; }

    /// <summary>Names of schedules that use a scene (scene delete returns 409 with them unless forced).</summary>
    public List<string> UsingScene(long sceneId) => Rows().Where(r => { try { using var d = JsonDocument.Parse(r.Payload); return d.RootElement.Long("sceneId") == sceneId; } catch { return false; } }).Select(r => r.Name).ToList();

    /// <summary>Skip the next occurrence (toggle: calling again clears the skip).</summary>
    public (bool Skipped, string? Err) Skip(long id)
    {
        var r = Rows("WHERE id=$i", ("$i", id)).FirstOrDefault(); if (r == null) return (false, "schedule not found");
        var now = Clock();
        if (Dt(r.SkipUntil) is DateTime su && su > now) { _db.Exec("UPDATE schedule SET skip_until=NULL WHERE id=$i", ("$i", id)); _ev.Publish("schedules"); return (false, null); }
        var next = ScheduleMath.NextRun(r.Enabled, r.Days, r.Time, r.OnceDate, null, now); if (next == null) return (false, "Nothing to skip.");
        _db.Exec("UPDATE schedule SET skip_until=$s WHERE id=$i", ("$s", next.Value.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture)), ("$i", id));
        _ev.Publish("schedules"); return (true, null);
    }

    public string? RunNow(long id, double? testFadeSec = null)
    {
        var r = Rows("WHERE id=$i", ("$i", id)).FirstOrDefault(); if (r == null) return "schedule not found";
        lock (_l) { var res = Run(r.Id, r.Name, r.Action, r.Payload, Clock(), testFadeSec); Record(r.Id, Clock(), res); }
        return null;
    }

    public string? Snooze()
    {
        lock (_l)
        {
            if (Active is not { } a) return "No alarm is ringing.";
            a.SnoozedUntil = Clock().AddMinutes(Math.Clamp(a.SnoozeMin, 1, 60)); CondOf(a.ZoneKey).Stop();
            _ev.Publish("alarm", AlarmState()); return null;
        }
    }
    public string? StopAlarm() { lock (_l) { if (Active == null) return "No alarm is ringing."; var k = Active.ZoneKey; Active = null; CondOf(k).Stop(); _ev.Publish("alarm", new { stopped = true }); return null; } }

    private DateTime _lastMinute = DateTime.MinValue;
    /// <summary>Called every second by the server timer (and by tests with a fake time).</summary>
    public void Tick(DateTimeOffset localNowOff)
    {
        var now = localNowOff.DateTime;
        lock (_l)
        {
            RampActive(now);
            var minute = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0);
            if (minute == _lastMinute) return; _lastMinute = minute;
            foreach (var s in Rows("WHERE enabled=1"))
            {
                if (!ScheduleMath.DueAt(s.Days, s.Time, s.OnceDate, minute)) continue;
                // never twice in the same minute (also across a restart)
                if (Dt(s.LastRunAt) is DateTime lr && new DateTime(lr.Year, lr.Month, lr.Day, lr.Hour, lr.Minute, 0) == minute) continue;
                if (Dt(s.SkipUntil) is DateTime su && minute <= su)
                {
                    _db.Exec("UPDATE schedule SET skip_until=NULL, last_run_at=$t, last_result=$r WHERE id=$i", ("$t", minute.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture)), ("$r", "Skipped"), ("$i", s.Id));
                    _ev.Publish("schedules"); continue;
                }
                string res; try { res = Run(s.Id, s.Name, s.Action, s.Payload, now, null); } catch (Exception e) { res = "Failed: " + e.Message; }
                Record(s.Id, minute, res);
                if (s.OnceDate != null) _db.Exec("UPDATE schedule SET enabled=0 WHERE id=$i", ("$i", s.Id));   // once-only alarms switch themselves off
                _ev.Publish("schedules");
            }
        }
    }

    private void Record(long id, DateTime at, string result) =>
        _db.Exec("UPDATE schedule SET last_run_at=$t, last_result=$r WHERE id=$i", ("$t", at.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture)), ("$r", result), ("$i", id));

    private void RampActive(DateTime now)
    {
        if (Active is not { } a) return;
        if (a.SnoozedUntil is DateTime su)
        {
            if (now < su) return;
            a.SnoozedUntil = null; a.StartedAt = now; StartPlay(a.Payload, a, now);   // snooze re-fire
            _ev.Publish("alarm", AlarmState()); return;
        }
        var sec = (now - a.StartedAt).TotalSeconds;
        if (a.AutoStopMin > 0 && sec >= a.AutoStopMin * 60) { var k = a.ZoneKey; Active = null; CondOf(k).Stop(); _ev.Publish("alarm", new { stopped = true, auto = true }); return; }
        var v = ScheduleMath.Ramp(a.StartVol, a.EndVol, a.FadeSec, sec); a.Progress = a.FadeSec <= 0 ? 1 : Math.Clamp(sec / a.FadeSec, 0, 1);
        if (a.FadeSec > 0 && sec <= a.FadeSec + 1) { foreach (var z in a.Zones) _zones.Patch(z, null, v, null, null); _ev.Publish("zones"); }
    }

    private string Run(long id, string name, string action, string payloadJson, DateTime now, double? testFadeSec)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(payloadJson) ? "{}" : payloadJson);
        var p = doc.RootElement; string result = "OK"; var zkey = KeyIn(payloadJson); var cond = CondOf(zkey);
        switch (action)
        {
            case "stop": cond.Stop(); break;   // 0.4.0: only the target zone's music when the schedule names one
            case "all_off":
                if (StopAll != null) StopAll(); else _cond.Stop();   // everything off stops every playback group
                foreach (var z in _zones.Zones()) _zones.Patch(z.Id, null, null, null, false);
                break;
            case "play_radio":
            {
                var rid = p.Long("radioId");
                if (rid != null) { var it = cond.StationToItem(rid.Value); if (it != null) cond.PlayItems(new[] { it }); else result = "Station not found"; }
                break;
            }
            case "scene":
            {
                var sid = p.Long("sceneId");
                if (sid != null) result = new SceneService(_db, _zones, _ev).Apply(sid.Value) ?? "OK";
                break;
            }
            case "volumes":
                if (p.Prop("devices") is JsonElement arr && arr.ValueKind == JsonValueKind.Array)
                    foreach (var e in arr.EnumerateArray())
                    {
                        var did = e.Long("deviceId") ?? e.Long("id"); if (did == null) continue;
                        _zones.Patch(did.Value, null, e.Num("volume"), null, e.Bool("enabled"));
                    }
                break;
            case "play":
            {
                var a = new Ringing { Id = id, Name = name, StartedAt = now, Payload = payloadJson,
                    StartVol = Math.Clamp(p.Num("startVol") ?? 10, 0, 100), EndVol = Math.Clamp(p.Num("endVol") ?? 40, 0, 100),
                    FadeSec = testFadeSec ?? Math.Clamp(p.Num("fadeMin") ?? 0, 0, 30) * 60, SnoozeMin = (int)Math.Clamp(p.Num("snoozeMin") ?? 9, 1, 60), AutoStopMin = (int)Math.Clamp(p.Num("autoStopMin") ?? 30, 0, 24 * 60), ZoneKey = zkey };
                result = StartPlay(payloadJson, a, now);
                Active = a; _ev.Publish("alarm", AlarmState());
                break;
            }
        }
        _ev.Publish("zones"); _ev.Publish("now");
        return result;
    }

    private string StartPlay(string payloadJson, Ringing a, DateTime now)
    {
        using var doc = JsonDocument.Parse(payloadJson); var p = doc.RootElement;
        if (p.Long("sceneId") is long sc) new SceneService(_db, _zones, _ev).Apply(sc);
        var zones = p.LongList("deviceIds") ?? new List<long>();
        if (zones.Count == 0 && p.Long("sceneId") is long sc2) zones = _db.Query("SELECT device_id FROM scene_member WHERE scene_id=$s AND enabled=1", r => r.GetInt64(0), ("$s", sc2));
        // 0.4.0: an alarm for one zone rings in that zone only: its speakers come on, every other zone keeps its own music
        var tz = a.ZoneKey != null ? DevicesOf?.Invoke(a.ZoneKey) : null;
        if (zones.Count == 0 && tz is { Count: > 0 }) zones = tz;
        if (zones.Count > 0 && p.Long("sceneId") == null && a.ZoneKey == null) foreach (var z in _zones.Zones()) _zones.Patch(z.Id, null, null, null, zones.Contains(z.Id));
        a.Zones = zones.Count > 0 ? zones : _zones.Zones().Where(z => z.Enabled).Select(z => z.Id).ToList();
        foreach (var z in a.Zones) _zones.Patch(z, null, a.FadeSec > 0 ? a.StartVol : a.EndVol, null, true);
        var src = p.Str("source") ?? "radio";
        var q = new Dictionary<string, object?>();
        switch (src)
        {
            case "playlist": q["kind"] = "playlist"; q["id"] = p.Long("id"); break;
            case "album": q["kind"] = "node"; q["node"] = "album:" + (p.Str("ref") ?? ""); break;
            case "track": q["kind"] = "tracks"; q["ids"] = new[] { p.Long("id") ?? 0 }; break;
            default: q["kind"] = "radio"; q["id"] = p.Long("id") ?? p.Long("radioId"); break;
        }
        var items = Resolve?.Invoke(JsonSerializer.SerializeToElement(q)) ?? new();
        if (items.Count == 0) return "Nothing to play (the source is gone)";
        CondOf(a.ZoneKey).PlayItems(items); return "OK";
    }
}
