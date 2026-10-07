using WavWiz.Core.Playback;
using WavWiz.Core.Stream;
namespace WavWiz.Sim.Harness;

/// <summary>Latency-bearing DSP block stand-in (FIR/lookahead): really delays by DelayFrames, reports ReportedUs.</summary>
public sealed class DelayProcessor : IAudioProcessor
{
    private readonly float[] _line; private int _w;
    public DelayProcessor(int delayFrames, long reportedUs) { _line = new float[Math.Max(1, delayFrames) * 2]; DelayFrames = delayFrames; LatencyUs = reportedUs; }
    public int DelayFrames { get; }
    public long LatencyUs { get; }
    public void Process(Span<float> b, int frames)
    {
        if (DelayFrames == 0) return;
        for (int i = 0; i < frames * 2; i++) { float o = _line[_w]; _line[_w] = b[i]; b[i] = o; _w = (_w + 1) % _line.Length; }
    }
}

/// <summary>Wraps a source and returns nothing while Stalled() is true (an internet radio stream that stops delivering).</summary>
public sealed class StallableSource : ISampleSource
{
    private readonly ISampleSource _inner; private readonly Func<bool> _stalled;
    public StallableSource(ISampleSource inner, Func<bool> stalled) { _inner = inner; _stalled = stalled; }
    public bool Ended => _inner.Ended;
    public int Read(Span<float> dst, int frames) => _stalled() ? 0 : _inner.Read(dst, frames);
}
