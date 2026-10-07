using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
namespace WavWiz.PlayerCore;

/// <summary>Headless output: renders in real time (10 ms periods) and records the stream position it produced; never touches a sound card.
/// Used by tests, the e2e check, and `--headless` runs (spec 18.3 "file sink" idea).</summary>
public sealed class CaptureSink : IAudioSink
{
    private readonly SinkRender _render; private readonly IMonotonicClock _clock; private readonly Thread _t; private volatile bool _stop;
    public int MixRate { get; }
    public double ReportedLatencyMs { get; }
    /// <summary>Tests: sees every rendered block with the DAC time of its first frame (lets a test synthesise a microphone recording).</summary>
    public Action<float[], int, long>? OnBlock { get; set; }
    public long Blocks;
    public float LastPeak;
    public CaptureSink(SinkRender render, IMonotonicClock clock, int mixRate = 48000, double latencyMs = 20)
    { _render = render; _clock = clock; MixRate = mixRate; ReportedLatencyMs = latencyMs; _t = new Thread(Loop) { IsBackground = true, Name = "capture-sink" }; }
    public event Action<string>? Faulted;
    public void Fault(string why) => Faulted?.Invoke(why);          // tests: simulate an unplugged device
    public void Start() => _t.Start();
    private void Loop()
    {
        int frames = MixRate / 100; var buf = new float[frames * 2];
        long next = _clock.NowUs;
        while (!_stop)
        {
            long dac = _clock.NowUs + (long)(ReportedLatencyMs * 1000);
            _render(buf, frames, dac);
            OnBlock?.Invoke(buf, frames, dac);
            float p = 0; for (int i = 0; i < buf.Length; i++) p = Math.Max(p, Math.Abs(buf[i]));
            LastPeak = p; Interlocked.Increment(ref Blocks);
            next += 10_000;
            long wait = next - _clock.NowUs;
            if (wait > 0) Thread.Sleep((int)(wait / 1000)); else if (wait < -200_000) next = _clock.NowUs;
        }
    }
    public void Dispose() { _stop = true; if (_t.IsAlive) _t.Join(500); }
}

public sealed class CaptureOutputProvider : IOutputProvider
{
    private readonly IMonotonicClock _clock;
    public CaptureOutputProvider(IMonotonicClock? clock = null) { _clock = clock ?? new StopwatchClock(); }
    public List<OutputInfo> Outputs { get; } = new() { new OutputInfo("capture-1", "Capture (no sound card)", "other", null, true, true) };
    public CaptureSink? LastSink { get; private set; }
    public Action<float[], int, long>? OnBlock { get; set; }
    public string? DefaultEndpointId => Outputs.FirstOrDefault()?.EndpointId;
    public IReadOnlyList<OutputInfo> List() => Outputs;
    public IAudioSink Open(string endpointId, SinkRender render)
    {
        var o = Outputs.FirstOrDefault(x => x.EndpointId == endpointId && x.Connected) ?? throw new InvalidOperationException("output not available: " + endpointId);
        LastSink = new CaptureSink(render, _clock) { OnBlock = OnBlock };
        return LastSink;
    }
}
