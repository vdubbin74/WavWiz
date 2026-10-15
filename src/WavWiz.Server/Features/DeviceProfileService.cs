using System.Text.Json;
using System.Text.Json.Nodes;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>0.3.6 K6 / K7: speaker settings profiles. A profile is a named snapshot of ONE speaker's settings - volume, volume cap (and its lock),
/// delay, EQ (graphic bands, bass, treble, balance and the rest of the DSP preset) and the output it uses - that can be loaded onto ANY speaker.
/// Scenes can reference a profile per device (K7): the profile is applied first, then the scene's own on/off and volume (zone volume still scales; the cap is enforced).
/// Zones are not touched by profiles.</summary>
public sealed class DeviceProfileService
{
    private readonly Db _db; private readonly Zones.ZoneManager _zones; private readonly Dsp.DspService _dsp; private readonly Calibration.CalibrationService _cal; private readonly EventHub _ev;
    public DeviceProfileService(Db db, Zones.ZoneManager zones, Dsp.DspService dsp, Calibration.CalibrationService cal, EventHub ev) { _db = db; _zones = zones; _dsp = dsp; _cal = cal; _ev = ev; }

    public sealed record Row(long Id, string Name, JsonElement Data, string UpdatedAt);
    private static Row Map(Microsoft.Data.Sqlite.SqliteDataReader r) => new(r.GetInt64(0), r.GetString(1), JsonDocument.Parse(r.GetString(2)).RootElement.Clone(), r.GetString(3));
    public List<Row> List() => _db.Query("SELECT id,name,json,updated_at FROM device_profile ORDER BY name COLLATE NOCASE", Map);
    public Row? Get(long id) => _db.Query("SELECT id,name,json,updated_at FROM device_profile WHERE id=$i", Map, ("$i", id)).FirstOrDefault();
    public bool Exists(long id) => Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM device_profile WHERE id=$i", ("$i", id))) > 0;

    /// <summary>What a speaker is set to right now, as profile data.</summary>
    public JsonObject Capture(long zoneId)
    {
        var z = _zones.Zone(zoneId) ?? throw new KeyNotFoundException("speaker not found");
        var act = z.Outputs.FirstOrDefault(o => o.Active) ?? z.Outputs.FirstOrDefault(o => o.DeviceId == z.ChosenDeviceId) ?? z.Outputs.FirstOrDefault();
        var o = new JsonObject { ["volume"] = Math.Round(z.Volume, 1), ["volCap"] = z.VolCap, ["volLocked"] = z.VolLocked };
        if (act != null)
        {
            o["delayMs"] = Math.Round(act.LatencyMs, 1);
            o["output"] = new JsonObject { ["kind"] = act.Kind, ["name"] = act.Name };
            var a = _dsp.AssignmentFor(act.DeviceId); var p = a?.PresetId is long pid ? _dsp.Get(pid) : null;
            var eq = p != null ? JsonNode.Parse(p.Json.GetRawText())!.AsObject() : JsonNode.Parse(JsonSerializer.Serialize(WavWiz.Dsp.DspPreset.Flat, Dsp.DspService.J))!.AsObject();
            eq["bypass"] = a?.Bypass ?? false; o["eq"] = eq;
        }
        return o;
    }

    public (long Id, string? Err) Save(string? name, long? id, long zoneId)
    {
        name = (name ?? "").Trim(); if (name.Length is 0 or > 60) return (0, "name must be 1-60 characters");
        JsonObject data; try { data = Capture(zoneId); } catch (KeyNotFoundException e) { return (0, e.Message); }
        var now = DateTimeOffset.UtcNow.ToString("O"); var json = data.ToJsonString();
        var existing = id;   // Save as (no id) always makes a new profile; a name that is taken is refused below
        if (existing is long eid && Exists(eid))
        {
            if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM device_profile WHERE name=$n COLLATE NOCASE AND id<>$i", ("$n", name), ("$i", eid))) > 0) return (0, "a profile with that name already exists");
            _db.Exec("UPDATE device_profile SET name=$n,json=$j,updated_at=$t WHERE id=$i", ("$n", name), ("$j", json), ("$t", now), ("$i", eid)); MarkLoaded(zoneId, eid); _ev.Publish("profiles"); return (eid, null);
        }
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM device_profile WHERE name=$n COLLATE NOCASE", ("$n", name))) > 0) return (0, "a profile with that name already exists");
        var nid = _db.Insert("INSERT INTO device_profile(name,json,updated_at) VALUES($n,$j,$t)", ("$n", name), ("$j", json), ("$t", now));
        MarkLoaded(zoneId, nid); _ev.Publish("profiles"); return (nid, null);
    }

    public string? Delete(long id)
    {
        _db.Exec("DELETE FROM device_profile WHERE id=$i", ("$i", id));
        _db.Exec("UPDATE scene_member SET profile_id=NULL WHERE profile_id=$i", ("$i", id));
        _ev.Publish("profiles"); _ev.Publish("scenes"); return null;
    }

    private void MarkLoaded(long zoneId, long profileId) => _db.SetSetting("profile.zone." + zoneId, profileId.ToString());
    public long? LoadedOn(long zoneId) => long.TryParse(_db.Setting("profile.zone." + zoneId), out var v) && Exists(v) ? v : null;

    /// <summary>True when the speaker's settings differ from the profile it last loaded / saved (the accent dot in the profile row).</summary>
    public bool Modified(long zoneId, long profileId)
    {
        var p = Get(profileId); if (p == null) return false;
        JsonObject now; try { now = Capture(zoneId); } catch { return false; }
        var then = JsonNode.Parse(p.Data.GetRawText())!.AsObject();
        static double D(JsonNode? n) => n == null ? double.NaN : (double.TryParse(n.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : double.NaN);
        bool Num(string k, double tol) { var a = D(now[k]); var b = D(then[k]); return (double.IsNaN(a) && double.IsNaN(b)) || (!double.IsNaN(a) && !double.IsNaN(b) && Math.Abs(a - b) <= tol); }
        if (!Num("volume", 0.6) || !Num("volCap", 0.6) || !Num("delayMs", 0.6)) return true;
        if ((now["volLocked"]?.GetValue<bool>() ?? false) != (then["volLocked"]?.GetValue<bool>() ?? false)) return true;
        var eqA = now["eq"]?.AsObject(); var eqB = then["eq"]?.AsObject();
        if (eqA == null || eqB == null) return (eqA == null) != (eqB == null);
        foreach (var k in new[] { "trimDb", "preampDb", "balance" }) if (Math.Abs(D(eqA[k]) is var x && double.IsNaN(x) ? 0 : x - (D(eqB[k]) is var y && double.IsNaN(y) ? 0 : y)) > 0.05) return true;
        for (int i = 0; i < 10; i++) if (Math.Abs((D(eqA["graphicDb"]?[i]) is var g1 && double.IsNaN(g1) ? 0 : g1) - (D(eqB["graphicDb"]?[i]) is var g2 && double.IsNaN(g2) ? 0 : g2)) > 0.05) return true;
        foreach (var k in new[] { "bass", "treble" }) if (Math.Abs(D(eqA[k]?["gainDb"]) is var a1 && double.IsNaN(a1) ? 0 : a1 - (D(eqB[k]?["gainDb"]) is var b1 && double.IsNaN(b1) ? 0 : b1)) > 0.05) return true;
        return false;
    }

    /// <summary>Loads a profile onto a speaker: cap, then volume (the cap is enforced), delay, EQ and output. A part the speaker cannot take (no such output, offline) is skipped and listed.</summary>
    public (string? Err, List<string> Skipped) Apply(long profileId, long zoneId, bool withVolume = true, bool withCap = true)
    {
        var skipped = new List<string>();
        var p = Get(profileId); if (p == null) return ("profile not found", skipped);
        var z = _zones.Zone(zoneId); if (z == null) return ("speaker not found", skipped);
        var d = p.Data;
        // output first, so delay and EQ land on the output that is going to be used
        if (d.TryGetProperty("output", out var o) && o.ValueKind == JsonValueKind.Object)
        {
            var kind = o.TryGetProperty("kind", out var k) ? k.GetString() : null; var name = o.TryGetProperty("name", out var n) ? n.GetString() : null;
            var want = z.Outputs.FirstOrDefault(x => x.Name == name && x.Kind == kind && (x.Connected || x.Active));
            if (want != null) { if (!want.Active) _zones.SetActiveOutput(zoneId, want.EndpointDbId); }
            else if (!(z.Outputs.FirstOrDefault(x => x.Active)?.Name == name)) skipped.Add("output");
            z = _zones.Zone(zoneId) ?? z;
        }
        if (withCap && d.TryGetProperty("volCap", out var cap) && (cap.ValueKind == JsonValueKind.Number || cap.ValueKind == JsonValueKind.Null))
            _zones.SetVolCap(zoneId, cap.ValueKind == JsonValueKind.Number ? cap.GetDouble() : 100, d.TryGetProperty("volLocked", out var lk) && lk.ValueKind == JsonValueKind.True);
        if (withVolume && d.TryGetProperty("volume", out var vol) && vol.ValueKind == JsonValueKind.Number) _zones.Patch(zoneId, null, vol.GetDouble(), null, null);
        var act = z.Outputs.FirstOrDefault(x => x.Active) ?? z.Outputs.FirstOrDefault(x => x.DeviceId == z.ChosenDeviceId) ?? z.Outputs.FirstOrDefault();
        if (act != null)
        {
            if (d.TryGetProperty("delayMs", out var dl) && dl.ValueKind == JsonValueKind.Number && Math.Abs(dl.GetDouble() - act.LatencyMs) > 0.5)
                try { _cal.Save(act.DeviceId, z.PlayerId, Math.Clamp(dl.GetDouble(), 0, 2000), "manual", 1.0); } catch { skipped.Add("delay"); }
            if (d.TryGetProperty("eq", out var eq) && eq.ValueKind == JsonValueKind.Object)
            {
                var pname = ("Profile: " + p.Name); if (pname.Length > 60) pname = pname[..60];
                var existing = _dsp.Presets().FirstOrDefault(x => x.Source != "builtin" && x.Name == pname);
                bool bypass = eq.TryGetProperty("bypass", out var bp) && bp.ValueKind == JsonValueKind.True;
                long? pid = existing?.Id;
                if (pid != null) _dsp.Update(pid.Value, pname, eq); else pid = _dsp.Create(pname, eq).Id;
                if (pid != null) _dsp.Assign(act.DeviceId, pid, true, bypass); else skipped.Add("EQ");
            }
        }
        MarkLoaded(zoneId, profileId); _ev.Publish("zones"); _ev.Publish("profiles");
        return (null, skipped);
    }
}
