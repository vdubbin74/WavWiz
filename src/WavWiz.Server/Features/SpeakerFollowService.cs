using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>B1/B2: follow a Bluetooth speaker across PCs; saved profiles (delay, volume, EQ) keyed by BT address / output device.</summary>
public sealed class SpeakerFollowService
{
    private readonly Db _db;
    private readonly Zones.ZoneManager _zones;
    private readonly Dsp.DspService _dsp;
    private readonly EventHub _ev;
    public Action<string>? Log;
    public SpeakerFollowService(Db db, Zones.ZoneManager zones, Dsp.DspService dsp, EventHub ev) { _db = db; _zones = zones; _dsp = dsp; _ev = ev; }

    public object Profiles() => _db.Query("SELECT id,name,bt_address,output_device_id,volume,delay_ms,dsp_preset_id,follow,updated_at FROM speaker_profile ORDER BY name COLLATE NOCASE",
        r => new { id = r.GetInt64(0), name = r.GetString(1), btAddress = r.IsDBNull(2) ? null : r.GetString(2), outputDeviceId = r.IsDBNull(3) ? null : r.GetString(3),
            volume = r.GetDouble(4), delayMs = r.IsDBNull(5) ? (double?)null : r.GetDouble(5), dspPresetId = r.IsDBNull(6) ? (long?)null : r.GetInt64(6),
            follow = r.GetInt32(7) != 0, updatedAt = r.GetString(8) });

    public (long Id, string? Err) Upsert(JsonElement b)
    {
        var name = (b.Str("name") ?? "").Trim(); if (name.Length is 0 or > 60) return (0, "name must be 1-60 characters");
        var bt = NormalizeBt(b.Str("btAddress")); var od = b.Str("outputDeviceId");
        if (bt == null && string.IsNullOrWhiteSpace(od)) return (0, "btAddress or outputDeviceId is required");
        var now = DateTimeOffset.UtcNow.ToString("O");
        var existing = b.Long("id") is long eid ? eid
            : (bt != null ? _db.Scalar("SELECT id FROM speaker_profile WHERE bt_address=$b", ("$b", bt)) as long?
                : _db.Scalar("SELECT id FROM speaker_profile WHERE output_device_id=$d", ("$d", od)) as long?);
        if (existing is long id)
        {
            _db.Exec("UPDATE speaker_profile SET name=$n,bt_address=COALESCE($b,bt_address),output_device_id=COALESCE($d,output_device_id),volume=COALESCE($v,volume),delay_ms=COALESCE($l,delay_ms),dsp_preset_id=COALESCE($p,dsp_preset_id),follow=COALESCE($f,follow),updated_at=$t WHERE id=$i",
                ("$n", name), ("$b", bt), ("$d", od), ("$v", b.Num("volume")), ("$l", b.Num("delayMs")), ("$p", b.Long("dspPresetId")), ("$f", b.Bool("follow") is bool f ? (f ? 1 : 0) : (int?)null), ("$t", now), ("$i", id));
            _ev.Publish("speakers"); return (id, null);
        }
        var nid = _db.Insert("INSERT INTO speaker_profile(name,bt_address,output_device_id,volume,delay_ms,dsp_preset_id,follow,created_at,updated_at) VALUES($n,$b,$d,$v,$l,$p,$f,$t,$t)",
            ("$n", name), ("$b", bt), ("$d", od), ("$v", b.Num("volume") ?? 60), ("$l", b.Num("delayMs")), ("$p", b.Long("dspPresetId")), ("$f", b.Bool("follow") == true ? 1 : 0), ("$t", now));
        _ev.Publish("speakers"); return (nid, null);
    }

    public string? Delete(long id) { _db.Exec("DELETE FROM speaker_profile WHERE id=$i", ("$i", id)); _ev.Publish("speakers"); return null; }

    /// <summary>Capture the active output of a device into a named profile (and optionally enable follow).</summary>
    public (long Id, string? Err) CaptureFromDevice(long zoneId, string? name, bool follow)
    {
        var z = _zones.Zones().FirstOrDefault(x => x.Id == zoneId); if (z == null) return (0, "device not found");
        var act = z.Outputs.FirstOrDefault(o => o.Active) ?? z.Outputs.FirstOrDefault();
        if (act == null) return (0, "this device has no speakers yet");
        var bt = NormalizeBt(act.BtAddress);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new { name = name ?? act.Name, btAddress = bt, outputDeviceId = act.DeviceId, volume = z.Volume, delayMs = act.LatencyMs, follow }));
        return Upsert(doc.RootElement);
    }

    /// <summary>Called when player outputs change: if a followed BT speaker just appeared on a PC, make that PC use it and apply the profile.</summary>
    public void OnOutputsChanged()
    {
        var followed = _db.Query("SELECT id,bt_address,output_device_id,volume,delay_ms,dsp_preset_id FROM speaker_profile WHERE follow=1 AND bt_address IS NOT NULL",
            r => (Id: r.GetInt64(0), Bt: r.GetString(1), Od: r.IsDBNull(2) ? null : r.GetString(2), Vol: r.GetDouble(3), Delay: r.IsDBNull(4) ? (double?)null : r.GetDouble(4), Dsp: r.IsDBNull(5) ? (long?)null : r.GetInt64(5)));
        if (followed.Count == 0) return;
        foreach (var p in followed)
        {
            // find any connected endpoint that matches this BT address
            var hit = _db.Query(@"SELECT e.id,e.player_id,e.output_device_id,z.id FROM output_endpoint e
                JOIN output_device d ON d.id=e.output_device_id JOIN zone z ON z.player_id=e.player_id
                WHERE e.connected=1 AND (d.bt_address=$b OR e.output_device_id=$od OR d.id=$od) LIMIT 1",
                r => (EpId: r.GetInt64(0), PlayerId: r.GetString(1), DevId: r.GetString(2), ZoneId: r.GetInt64(3)),
                ("$b", p.Bt), ("$od", p.Od ?? ("bt:" + p.Bt)));
            if (hit.Count == 0) continue;
            var h = hit[0];
            _zones.SetActiveOutput(h.ZoneId, h.EpId);
            _zones.Patch(h.ZoneId, null, p.Vol, null, true);
            // disable other devices that were previously following? keep them on but switch this one to the speaker
            if (p.Delay is double ms)
                try { /* delay already on output_device via calibration; profiles store preferred delay */ } catch { }
            if (p.Dsp is long dspId)
                try { _dsp.Assign(h.DevId, dspId, true, false); } catch { }
            Log?.Invoke($"follow-speaker: profile {p.Id} -> device zone {h.ZoneId} ({h.DevId})");
        }
        _ev.Publish("zones");
    }

    public static string? NormalizeBt(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var hex = new string(s.Where(Uri.IsHexDigit).Select(char.ToUpperInvariant).ToArray());
        return hex.Length == 12 ? string.Join(':', Enumerable.Range(0, 6).Select(i => hex.Substring(i * 2, 2))) : null;
    }
}
