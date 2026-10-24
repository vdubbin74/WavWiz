using System.Collections.Concurrent;
using WavWiz.Core.Calibration;
using WavWiz.Core.Protocol;
using WavWiz.Measure;
using WavWiz.Server.Net;
namespace WavWiz.Server.Calibration;

/// <summary>
/// 0.2.5: talks to the Players' microphones for PC-mic calibration. A Player records natively (WASAPI) when asked ("mic-record" with a server-time
/// window) and sends the samples back over its audio connection in parts; this collects the parts per request and hands back one recording.
/// Also relays the live input meter ("miclevel" events) to the Calibrate screen.
/// </summary>
public sealed class PcMicBroker
{
    private sealed class Pending { public readonly List<CalResult> Parts = new(); public readonly TaskCompletionSource<(float[] Mono, int Rate, long StartUs)> Tcs = new(TaskCreationOptions.RunContinuationsAsynchronously); }
    private readonly ConcurrentDictionary<string, Pending> _reqs = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _acks = new();
    private readonly EventHub _ev;
    public PcMicBroker(EventHub ev) { _ev = ev; }

    public void OnCalResult(PlayerSession s, CalResult r)
    {
        switch (r.Status)
        {
            case "pattern-ack": if (r.Req != null && _acks.TryGetValue(r.Req, out var ak)) ak.TrySetResult(r.Note ?? "ok"); break;
            case "mic-list": if (r.Mics != null) { s.Mics = r.Mics; _ev.Publish("calmics"); } break;
            case "mic-level": _ev.Publish("miclevel", new { playerId = s.Id, micId = r.MicId, db = r.PeakDb ?? -100 }); break;
            case "mic-error":
                if (r.Req != null && _reqs.TryRemove(r.Req, out var pe)) pe.Tcs.TrySetException(new InvalidOperationException(r.Note ?? "the microphone failed"));
                else _ev.Publish("miclevel", new { playerId = s.Id, micId = r.MicId, error = r.Note });
                break;
            case "mic-data":
                if (r.Req == null || !_reqs.TryGetValue(r.Req, out var p)) return;
                lock (p.Parts)
                {
                    if (r.Parts is < 1 or > 64 || p.Parts.Any(x => x.Part == r.Part)) return;
                    p.Parts.Add(r);
                    if (p.Parts.Count < r.Parts) return;
                }
                _reqs.TryRemove(r.Req, out _);
                if (r.Rate is < 8000 or > 192000) { p.Tcs.TrySetException(new InvalidOperationException("bad sample rate from the microphone")); return; }
                p.Tcs.TrySetResult((MicPcm.Decode(p.Parts), r.Rate, r.StartServerUs));
                break;
        }
    }

    /// <summary>Asks <paramref name="mic"/>'s Player to record from server time <paramref name="fromUs"/> to <paramref name="toUs"/> and waits for the samples.</summary>
    public async Task<(float[] Mono, int Rate, long StartUs)> Record(PlayerSession mic, string sessionId, string micId, long fromUs, long toUs, string label, long nowUs, CancellationToken ct)
    {
        var req = Guid.NewGuid().ToString("N")[..12]; var p = new Pending(); _reqs[req] = p;
        try
        {
            mic.SendJson(MsgType.CalCmd, new CalCmd("mic-record", sessionId, fromUs, 0, label, micId, toUs, req));
            var wait = TimeSpan.FromMicroseconds(Math.Max(0, toUs - nowUs)) + TimeSpan.FromSeconds(8);
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(wait);
            using (cts.Token.Register(() => p.Tcs.TrySetException(ct.IsCancellationRequested ? new OperationCanceledException() : new TimeoutException("the PC with the microphone did not send its recording - is WavWiz Player still running there?"))))
                return await p.Tcs.Task;
        }
        finally { _reqs.TryRemove(req, out _); }
    }

    /// <summary>0.3.7 L24: a Player acknowledges every test pattern it was asked to schedule ("ok;lead=1432" or why it cannot: "no-clock", "late=-300").
    /// Returns null when no acknowledgement comes (an older Player never sends one - that is not treated as a failure).</summary>
    public void ExpectAck(string req) => _acks[req] = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task<string?> WaitAck(string req, TimeSpan timeout, CancellationToken ct)
    {
        if (!_acks.TryGetValue(req, out var t)) return null;
        try { var done = await Task.WhenAny(t.Task, Task.Delay(timeout, ct)); return done == t.Task ? t.Task.Result : null; }
        finally { _acks.TryRemove(req, out _); }
    }
    public static bool AckProblem(string? ack) => ack != null && !ack.StartsWith("ok", StringComparison.Ordinal);

    public void Level(PlayerSession mic, string micId, bool on) => mic.SendJson(MsgType.CalCmd, new CalCmd("mic-level", "meter", 0, on ? 1 : 0, null, micId));
    public void RefreshList(PlayerSession mic) => mic.SendJson(MsgType.CalCmd, new CalCmd("mic-list", "list", 0));
}

/// <summary>One step of a measurement plan. Thorough = reference x3, each speaker x3, reference again for the drift check. 0.4.1 Quick (the default) = ONE test per speaker (the reference once, each speaker once, no drift check on the PC's own mic).</summary>
public sealed record PlanStep(long ZoneId, string Kind, string Label);

public static class CalPlan
{
    public static List<PlanStep> Build(long referenceZoneId, string referenceName, IEnumerable<(long Id, string Name)> speakers, int runs = 3, bool driftCheck = true)
    {
        var plan = new List<PlanStep>();
        for (int i = 0; i < runs; i++) plan.Add(new PlanStep(referenceZoneId, "ref", $"{referenceName} (reference, {i + 1}/{runs})"));
        foreach (var (id, name) in speakers) if (id != referenceZoneId) for (int i = 0; i < runs; i++) plan.Add(new PlanStep(id, "dev", $"{name} ({i + 1}/{runs})"));
        if (driftCheck) plan.Add(new PlanStep(referenceZoneId, "ref-end", $"{referenceName} again (drift check)"));
        return plan;
    }
}
