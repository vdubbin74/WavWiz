using System.Collections.Concurrent;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Measure;
using WavWiz.Server.Net;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Calibration;

public sealed record RunResult(string ZoneId, string Kind, bool Ok, double? RawLatencyMs, double Confidence, string? Note);
public sealed record Proposal(long ZoneId, string ZoneName, string DeviceId, double OffsetMs, double ProposedLatencyMs, double SpreadMs, double Confidence, string? Warning, bool Commit);

public sealed class CalSession
{
    public string Id = Guid.NewGuid().ToString("N")[..16];
    public DateTime Created = DateTime.UtcNow;
    public string Mode = "phone";               // phone | same-recording
    public long ReferenceZoneId;
    public string MicSource = "phone", MicProcessing = "unknown";
    public readonly ConcurrentDictionary<string, (long ZoneId, long AtUs, double Distance, string Kind, long RunId)> Pending = new();
    public readonly List<(long Zone, string Kind, double Raw, double Conf)> Runs = new();
    public readonly List<string> Notes = new();
    public long RunSeq;
    public List<Proposal>? Proposals;
    public readonly object L = new();
}

/// <summary>
/// Phone-mic calibration (spec 8). The server schedules a chirp pattern at a DAC time T on a chosen player, the phone records, the server finds the pattern
/// in the recording. Raw latency = arrival - T - 2.9 ms/m; the saved value is the DIFFERENCE to the reference speaker, so the phone's own input delay cancels.
/// </summary>
public sealed class CalibrationService
{
    private readonly Db _db; private readonly IMonotonicClock _clock; private readonly ZoneManager _zones; private readonly AudioHost _host; private readonly EventHub _ev;
    private readonly ConcurrentDictionary<string, CalSession> _sessions = new();
    private readonly ChirpDetector _det = new();
    public const long LeadUs = 1_500_000;
    public const double PairGapSec = 5.0;

    public CalibrationService(Db db, IMonotonicClock clock, ZoneManager zones, AudioHost host, EventHub ev) { _db = db; _clock = clock; _zones = zones; _host = host; _ev = ev; }

    public CalSession? Get(string id) { Purge(); return _sessions.TryGetValue(id, out var s) ? s : null; }
    private void Purge() { foreach (var k in _sessions.Where(x => x.Value.Created < DateTime.UtcNow.AddHours(-1)).Select(x => x.Key).ToList()) _sessions.TryRemove(k, out _); }

    public (CalSession? S, string? Error) Start(string mode, long referenceZoneId, string? micSource, string? micProcessing)
    {
        if (mode is not ("phone" or "same-recording")) return (null, "mode must be phone or same-recording");
        var z = _zones.Zone(referenceZoneId);
        if (z == null) return (null, "reference zone not found");
        if (!z.Connected) return (null, $"the reference zone \"{z.Name}\" is offline - start its player first");
        if (z.ActiveDeviceId == null) return (null, $"the reference zone \"{z.Name}\" has no active output");
        var s = new CalSession { Mode = mode, ReferenceZoneId = referenceZoneId, MicSource = micSource ?? "phone", MicProcessing = micProcessing ?? "unknown" };
        _sessions[s.Id] = s; return (s, null);
    }

    private PlayerSession? SessionOfZone(long zoneId, out string? error)
    {
        error = null;
        var pid = _zones.ZonePlayer(zoneId); if (pid == null) { error = "zone not found"; return null; }
        var ps = _host.Get(pid); if (ps == null) { error = "that zone's player is offline"; return null; }
        if (ps.Outputs.FirstOrDefault(o => o.Active) == null) { error = "that zone has no active output"; return null; }
        return ps;
    }

    /// <summary>Schedule the pattern on one zone. Returns the DAC time T (server clock) so the phone can mark it.</summary>
    public (long AtUs, string? Error) Play(CalSession s, long zoneId, string kind, double distanceM, double levelDb = -20)
    {
        var ps = SessionOfZone(zoneId, out var err); if (ps == null) return (0, err);
        long at = _clock.NowUs + LeadUs;
        long run = Interlocked.Increment(ref s.RunSeq);
        s.Pending[$"{zoneId}:{kind}"] = (zoneId, at, distanceM, kind, run);
        ps.SendJson(MsgType.CalCmd, new CalCmd("play-pattern", s.Id, at, levelDb, kind));
        return (at, null);
    }

    /// <summary>Same-recording mode: reference at T, device at T + gap, one recording.</summary>
    public (long AtUs, double GapSec, string? Error) PlayPair(CalSession s, long deviceZoneId, double levelDb = -20)
    {
        var rp = SessionOfZone(s.ReferenceZoneId, out var e1); if (rp == null) return (0, 0, "reference: " + e1);
        var dp = SessionOfZone(deviceZoneId, out var e2); if (dp == null) return (0, 0, e2);
        long at = _clock.NowUs + LeadUs;
        s.Pending[$"{deviceZoneId}:pair"] = (deviceZoneId, at, 0, "pair", Interlocked.Increment(ref s.RunSeq));
        rp.SendJson(MsgType.CalCmd, new CalCmd("play-pattern", s.Id, at, levelDb, "reference"));
        dp.SendJson(MsgType.CalCmd, new CalCmd("play-pattern", s.Id, at + (long)(PairGapSec * 1e6), levelDb, "device"));
        return (at, PairGapSec, null);
    }

    /// <summary>By-ear helper: the device's pattern is played <paramref name="candidateMs"/> EARLIER than the reference's, so when the candidate equals the real extra delay they sound together.</summary>
    public (long AtUs, string? Error) PlayEar(long referenceZoneId, long deviceZoneId, double candidateMs, double levelDb = -20)
    {
        var rp = SessionOfZone(referenceZoneId, out var e1); if (rp == null) return (0, "reference: " + e1);
        var dp = SessionOfZone(deviceZoneId, out var e2); if (dp == null) return (0, e2);
        candidateMs = Math.Clamp(candidateMs, 0, 1500);
        long at = _clock.NowUs + LeadUs;
        rp.SendJson(MsgType.CalCmd, new CalCmd("play-pattern", "ear", at, levelDb, "reference"));
        dp.SendJson(MsgType.CalCmd, new CalCmd("play-pattern", "ear", at - (long)(candidateMs * 1000), levelDb, "device"));
        return (at, null);
    }

    public static float[] ToMono48k(float[] samples, int rate)
    {
        if (rate == ChirpPattern.SampleRate) return samples;
        int n = (int)((long)samples.Length * ChirpPattern.SampleRate / rate); var o = new float[n];
        for (int i = 0; i < n; i++) { double src = i * (double)rate / ChirpPattern.SampleRate; int j = (int)src; double f = src - j; o[i] = j + 1 < samples.Length ? (float)(samples[j] * (1 - f) + samples[j + 1] * f) : samples[Math.Min(j, samples.Length - 1)]; }
        return o;
    }

    /// <summary>Analyze an uploaded recording. <paramref name="startServerUs"/> = server time of its first sample (phone clock sync); ignored in same-recording mode.</summary>
    public RunResult Capture(CalSession s, long zoneId, string kind, float[] mono48k, double startServerUs)
    {
        if (!s.Pending.TryRemove($"{zoneId}:{kind}", out var p)) return new RunResult(zoneId.ToString(), kind, false, null, 0, "no test sound is pending for that speaker - play it again");
        if (mono48k.Length < 48000) return new RunResult(zoneId.ToString(), kind, false, null, 0, "the recording is too short");
        if (kind == "pair")
        {
            var (a, b) = _det.FindTwo(mono48k, PairGapSec);
            if (!a.Found) return Fail(s, zoneId, kind, $"could not hear the reference speaker ({a.ChirpsFound}/8 chirps){(a.Warning != null ? ": " + a.Warning : "")}");
            if (!b.Found) return Fail(s, zoneId, kind, $"heard the reference but not the speaker being measured ({b.ChirpsFound}/8 chirps) - turn it up or move the phone closer");
            double off = LatencyMath.SameRecordingOffsetMs(a.StartSec, b.StartSec, PairGapSec);
            lock (s.L) s.Runs.Add((zoneId, "pair", off, Math.Min(a.Confidence, b.Confidence)));
            return new RunResult(zoneId.ToString(), kind, true, off, Math.Min(a.Confidence, b.Confidence), null);
        }
        var hit = _det.Find(mono48k);
        if (!hit.Found) return Fail(s, zoneId, kind, $"could not hear the test sound ({hit.ChirpsFound}/8 chirps){(hit.Warning != null ? ": " + hit.Warning : "")} - turn the speaker up, move the phone closer, or quieten the room");
        double arrival = startServerUs + hit.StartSec * 1e6;
        double raw = LatencyMath.RawLatencyMs(arrival, p.AtUs, p.Distance);
        lock (s.L) s.Runs.Add((zoneId, kind, raw, hit.Confidence));
        return new RunResult(zoneId.ToString(), kind, true, raw, hit.Confidence, hit.Warning);
    }

    private RunResult Fail(CalSession s, long zoneId, string kind, string note) { lock (s.L) s.Notes.Add(note); return new RunResult(zoneId.ToString(), kind, false, null, 0, note); }

    /// <summary>Median of the runs per speaker, offsets relative to the reference, reference drift check (spec 8.6).</summary>
    public (List<Proposal> Proposals, List<string> Messages) Finish(CalSession s)
    {
        var msgs = new List<string>(); var props = new List<Proposal>();
        List<(long Zone, string Kind, double Raw, double Conf)> runs; lock (s.L) runs = s.Runs.ToList();
        var refZone = _zones.Zone(s.ReferenceZoneId);
        double refLatency = refZone?.Outputs.FirstOrDefault(o => o.Active)?.LatencyMs ?? 0;
        var raw = new List<(long Zone, double Offset, double Spread, double Conf, string? Warn)>();

        if (s.Mode == "same-recording")
        {
            foreach (var g in runs.Where(r => r.Kind == "pair").GroupBy(r => r.Zone))
            {
                var m = LatencyMath.Median(g.Select(r => r.Raw).ToList());
                if (m.Verdict == MeasureVerdict.NotFound) { msgs.Add($"zone {g.Key}: {m.Note}"); continue; }
                raw.Add((g.Key, m.RawLatencyMs, m.SpreadMs, Math.Clamp(1 - m.SpreadMs / 10.0, 0.2, 1.0), m.Verdict == MeasureVerdict.Noisy ? m.Note : null));
            }
        }
        else
        {
            var refStart = runs.Where(r => r.Zone == s.ReferenceZoneId && r.Kind == "ref").Select(r => r.Raw).ToList();
            var refEnd = runs.Where(r => r.Zone == s.ReferenceZoneId && r.Kind == "ref-end").Select(r => r.Raw).ToList();
            var rm = LatencyMath.Median(refStart);
            if (rm.Verdict == MeasureVerdict.NotFound) { msgs.Add("the reference speaker was not heard - nothing can be calibrated without it"); return (props, msgs); }
            if (rm.Verdict == MeasureVerdict.Noisy) msgs.Add("reference: " + rm.Note);
            double refEndMs = refEnd.Count > 0 ? LatencyMath.Median(refEnd).RawLatencyMs : rm.RawLatencyMs;
            if (refEnd.Count == 0) msgs.Add("the reference was not re-checked at the end of the session; phone timing drift could not be ruled out");
            foreach (var g in runs.Where(r => r.Kind == "dev").GroupBy(r => r.Zone))
            {
                var m = LatencyMath.Median(g.Select(r => r.Raw).ToList());
                if (m.Verdict == MeasureVerdict.NotFound) { msgs.Add($"zone {g.Key}: {m.Note}"); continue; }
                var sess = LatencyMath.Session(LatencyMath.Offset(m.RawLatencyMs, rm.RawLatencyMs), rm.RawLatencyMs, refEndMs, Math.Max(m.SpreadMs, rm.SpreadMs));
                raw.Add((g.Key, sess.OffsetMs, m.SpreadMs, sess.Confidence, sess.Warning ?? (m.Verdict == MeasureVerdict.Noisy ? m.Note : null)));
            }
        }

        // absolute = reference's applied delay + offset; if anything would go below 0, shift the whole house up (the reference included) so the earliest speaker is 0
        double shift = Math.Max(0, -(raw.Select(r => refLatency + r.Offset).Append(refLatency).Min()));
        if (shift > 0.5) msgs.Add($"some speakers sound EARLIER than the reference, so every speaker (including the reference) gets +{shift:0} ms to keep them aligned");
        foreach (var r in raw)
        {
            var z = _zones.Zone(r.Zone); if (z == null) continue;
            var act = z.Outputs.FirstOrDefault(o => o.Active); if (act == null) continue;
            double prop = Math.Round(Math.Clamp(refLatency + r.Offset + shift, 0, 2000), 1);
            props.Add(new Proposal(z.Id, z.Name, act.DeviceId, Math.Round(r.Offset, 1), prop, Math.Round(r.Spread, 1), Math.Round(r.Conf, 2), r.Warn, r.Conf >= 0.4));
        }
        if (shift > 0.5 && refZone?.Outputs.FirstOrDefault(o => o.Active) is { } ra && !props.Any(p => p.ZoneId == refZone.Id))
            props.Add(new Proposal(refZone.Id, refZone.Name, ra.DeviceId, 0, Math.Round(refLatency + shift, 1), 0, 1, "reference shifted to keep every speaker non-negative", true));
        return (props, msgs);
    }

    /// <summary>Save accepted proposals. Old values stay in the table (is_current = 0) so a result can be rolled back.</summary>
    public string? Commit(CalSession s, IEnumerable<long> zoneIds, List<Proposal> proposals)
    {
        foreach (var id in zoneIds.Distinct())
        {
            var p = proposals.FirstOrDefault(x => x.ZoneId == id); if (p == null) continue;
            var z = _zones.Zone(id); if (z == null) continue; var act = z.Outputs.FirstOrDefault(o => o.Active); if (act == null) continue;
            Save(act.DeviceId, z.PlayerId, p.ProposedLatencyMs, s.Mode == "same-recording" ? "mic" : "mic", p.Confidence, act, s, p.OffsetMs);
        }
        return null;
    }

    public void Save(string deviceKey, string playerId, double latencyMs, string method, double confidence, OutputDto? act = null, CalSession? s = null, double? rawOffset = null, string? notes = null)
    {
        _db.Exec("UPDATE calibration SET is_current=0 WHERE output_device_id=$d AND player_id=$p", ("$d", deviceKey), ("$p", playerId));
        _db.Insert("INSERT INTO calibration(output_device_id,player_id,latency_ms,raw_latency_ms,reference_device_id,method,mic_source,mic_processing,same_recording,confidence,win_reported_latency_ms,codec,dsp_latency_ms,measured_at,is_current,notes) " +
                   "VALUES($d,$p,$l,$r,$ref,$m,$ms,$mp,$sr,$c,$w,$codec,0,$t,1,$n)",
            ("$d", deviceKey), ("$p", playerId), ("$l", Math.Clamp(latencyMs, 0, 2000)), ("$r", rawOffset), ("$ref", s == null ? null : _zones.ZoneActiveDevice(s.ReferenceZoneId)),
            ("$m", method), ("$ms", s?.MicSource), ("$mp", s?.MicProcessing), ("$sr", s?.Mode == "same-recording" ? 1 : 0), ("$c", confidence), ("$w", act?.WinLatencyMs), ("$codec", act?.Codec),
            ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$n", notes));
        _zones.RefreshLatency(deviceKey);
    }

    /// <summary>0.0.8: live slider edits. If the current entry for this output is a by-hand one made in the last 10 minutes, update it in place
    /// (so dragging the slider does not add dozens of history rows). Returns false when a new entry should be saved instead.</summary>
    public bool UpdateLive(string deviceKey, string playerId, double latencyMs, string method)
    {
        var cur = _db.Query("SELECT id,method,measured_at FROM calibration WHERE output_device_id=$d AND player_id=$p AND is_current=1 ORDER BY id DESC LIMIT 1",
            r => (Id: r.GetInt64(0), M: r.GetString(1), T: r.GetString(2)), ("$d", deviceKey), ("$p", playerId)).FirstOrDefault();
        if (cur == default || cur.M != method || !DateTimeOffset.TryParse(cur.T, out var t) || DateTimeOffset.UtcNow - t > TimeSpan.FromMinutes(10)) return false;
        _db.Exec("UPDATE calibration SET latency_ms=$l, measured_at=$t WHERE id=$i", ("$l", Math.Clamp(latencyMs, 0, 2000)), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", cur.Id));
        _zones.RefreshLatency(deviceKey); return true;
    }

    public List<object> History(string deviceKey) => _db.Query("SELECT id,player_id,latency_ms,raw_latency_ms,method,confidence,measured_at,is_current,codec,notes FROM calibration WHERE output_device_id=$d ORDER BY id DESC LIMIT 50",
        r => (object)new { id = r.GetInt64(0), playerId = r.IsDBNull(1) ? null : r.GetString(1), latencyMs = r.GetDouble(2), rawMs = r.IsDBNull(3) ? (double?)null : r.GetDouble(3), method = r.GetString(4), confidence = r.IsDBNull(5) ? (double?)null : r.GetDouble(5), measuredAt = r.GetString(6), current = r.GetInt32(7) != 0, codec = r.IsDBNull(8) ? null : r.GetString(8), notes = r.IsDBNull(9) ? null : r.GetString(9) }, ("$d", deviceKey));

    public string? Restore(long calibrationId)
    {
        var row = _db.Query("SELECT output_device_id,player_id FROM calibration WHERE id=$i", r => (D: r.GetString(0), P: r.IsDBNull(1) ? null : r.GetString(1)), ("$i", calibrationId)).FirstOrDefault();
        if (row == default) return "not found";
        _db.Exec("UPDATE calibration SET is_current=0 WHERE output_device_id=$d AND player_id IS $p", ("$d", row.D), ("$p", row.P));
        _db.Exec("UPDATE calibration SET is_current=1 WHERE id=$i", ("$i", calibrationId));
        _zones.RefreshLatency(row.D); return null;
    }
}
