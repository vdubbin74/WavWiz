using WavWiz.Core.Calibration;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
namespace WavWiz.PlayerCore;

/// <summary>A finished microphone recording: mono samples and the local monotonic time (µs) of the first sample.</summary>
public sealed record MicRecording(float[] Mono, int Rate, long FirstSampleLocalUs);

/// <summary>0.2.5: this PC's microphones (WASAPI capture in the Windows app; a fake capture device in tests and headless runs).</summary>
public interface IMicProvider
{
    IReadOnlyList<MicInfo> List();
    /// <summary>Open the mic now and record until local time <paramref name="untilLocalUs"/>; samples before <paramref name="fromLocalUs"/> may be dropped.</summary>
    Task<MicRecording> RecordAsync(string micId, long fromLocalUs, long untilLocalUs, CancellationToken ct);
    /// <summary>Live input meter: <paramref name="onPeakDb"/> about 8 times a second until disposed.</summary>
    IDisposable Meter(string micId, Action<double> onPeakDb);
}

/// <summary>A PC with no microphone.</summary>
public sealed class NoMicProvider : IMicProvider
{
    public IReadOnlyList<MicInfo> List() => Array.Empty<MicInfo>();
    public Task<MicRecording> RecordAsync(string micId, long fromLocalUs, long untilLocalUs, CancellationToken ct) => throw new InvalidOperationException("this PC has no microphone");
    public IDisposable Meter(string micId, Action<double> onPeakDb) => throw new InvalidOperationException("this PC has no microphone");
}

/// <summary>
/// Fake capture device (tests, headless): waits in real time until the window is over, then asks <see cref="Synth"/> what the mic "heard"
/// from <c>fromLocalUs</c> (the test mixes the speakers' rendered audio in at their hidden delays).
/// </summary>
public sealed class SynthMicProvider : IMicProvider
{
    private readonly IMonotonicClock _clock;
    public List<MicInfo> Mics { get; } = new() { new MicInfo("mic-usb-1", "USB Microphone (Test)", "usb", false, true) };
    public Func<string, long, int, float[]> Synth { get; set; } = (_, _, n) => new float[n];
    public int Rate { get; set; } = 48000;
    public double MeterDb { get; set; } = -32;
    public int Recordings;
    public SynthMicProvider(IMonotonicClock? clock = null) { _clock = clock ?? new StopwatchClock(); }
    public IReadOnlyList<MicInfo> List() => Mics;
    public async Task<MicRecording> RecordAsync(string micId, long fromLocalUs, long untilLocalUs, CancellationToken ct)
    {
        if (!Mics.Any(m => m.Id == micId)) throw new InvalidOperationException("that microphone is not connected any more");
        var wait = untilLocalUs - _clock.NowUs; if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait / 1000.0), ct);
        Interlocked.Increment(ref Recordings);
        int n = (int)Math.Max(0, (untilLocalUs - fromLocalUs) * Rate / 1_000_000);
        return new MicRecording(Synth(micId, fromLocalUs, n), Rate, fromLocalUs);
    }
    public IDisposable Meter(string micId, Action<double> onPeakDb)
    {
        var t = new Timer(_ => onPeakDb(MeterDb), null, 0, 125); return t;
    }
}

/// <summary>
/// 0.2.5: the Player side of PC-mic calibration. The server says "record mic X from server time A to B"; this converts the times with the player's
/// clock model, records natively, and sends the samples back (with the server time of the first sample) in parts. Also the mic list and a live level meter.
/// </summary>
public sealed class MicResponder : IDisposable
{
    private readonly IMicProvider _mics; private readonly ClockModel _clock; private readonly Func<CalResult, Task> _send; private readonly Action<string> _log;
    private IDisposable? _meter; private Timer? _meterStop; private readonly object _l = new();
    public static readonly TimeSpan MeterMax = TimeSpan.FromSeconds(60);
    public MicResponder(IMicProvider mics, ClockModel clock, Func<CalResult, Task> send, Action<string>? log = null) { _mics = mics; _clock = clock; _send = send; _log = log ?? (_ => { }); }

    public static bool Handles(string action) => action is "mic-list" or "mic-record" or "mic-level";

    public void Handle(CalCmd c)
    {
        switch (c.Action)
        {
            case "mic-list": _ = _send(new CalResult(c.SessionId, "mic-list", null, c.Req, Mics: SafeList())); break;
            case "mic-level": Level(c); break;
            case "mic-record": _ = Task.Run(() => Record(c)); break;
        }
    }

    public MicInfo[] SafeList() { try { return _mics.List().ToArray(); } catch (Exception e) { _log("mic list failed: " + e.Message); return Array.Empty<MicInfo>(); } }

    private void Level(CalCmd c)
    {
        lock (_l)
        {
            _meter?.Dispose(); _meter = null; _meterStop?.Dispose(); _meterStop = null;
            if (c.LevelDb <= 0 || c.MicId == null) return;
            try
            {
                var mic = c.MicId; long last = 0;
                _meter = _mics.Meter(mic, db => { var now = Environment.TickCount64; if (now - Interlocked.Read(ref last) < 100) return; Interlocked.Exchange(ref last, now); _ = _send(new CalResult(c.SessionId, "mic-level", null, c.Req, PeakDb: db, MicId: mic)); });
                _meterStop = new Timer(_ => { lock (_l) { _meter?.Dispose(); _meter = null; } }, null, MeterMax, Timeout.InfiniteTimeSpan);
            }
            catch (Exception e) { _ = _send(new CalResult(c.SessionId, "mic-error", e.Message, c.Req, MicId: c.MicId)); }
        }
    }

    private async Task Record(CalCmd c)
    {
        try
        {
            if (c.MicId == null) throw new InvalidOperationException("no microphone was chosen");
            if (!_clock.IsValid) throw new InvalidOperationException("this PC's clock is not synced with the server yet - try again in a few seconds");
            long from = _clock.ToLocalUs(c.AtUs), until = _clock.ToLocalUs(c.ToUs);
            if (until <= from || until - from > 30_000_000) throw new InvalidOperationException("bad recording window");
            using var cts = new CancellationTokenSource(TimeSpan.FromMicroseconds(until - from) + TimeSpan.FromSeconds(10));
            var rec = await _mics.RecordAsync(c.MicId, from, until, cts.Token);
            long startServer = _clock.ToServerUs(rec.FirstSampleLocalUs);
            _log($"mic recording {rec.Mono.Length} samples at {rec.Rate} Hz ({c.Label})");
            foreach (var part in MicPcm.Encode(c.SessionId, c.Req ?? "", c.MicId, rec.Mono, rec.Rate, startServer)) await _send(part);
        }
        catch (Exception e) { _log("mic recording failed: " + e.Message); await _send(new CalResult(c.SessionId, "mic-error", e.Message, c.Req, MicId: c.MicId)); }
    }

    public void Dispose() { lock (_l) { _meter?.Dispose(); _meter = null; _meterStop?.Dispose(); _meterStop = null; } }
}
