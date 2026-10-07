using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;

namespace WavWiz.Sim.Harness;

/// <summary>Deterministic content: sample n of the house stream has value (n mod 2^20)/2^20 on both channels, so any
/// output sample reveals its stream position (a ramp survives resampling exactly).</summary>
public sealed class RampSource : ISampleSource
{
    public const int Mod = 1 << 20;
    private long _n;
    public long TotalFrames { get; init; } = long.MaxValue;
    public bool Ended => _n >= TotalFrames;
    public int Read(Span<float> dst, int frames)
    {
        int i = 0;
        for (; i < frames && _n < TotalFrames; i++, _n++)
        {
            float v = (float)(_n % Mod) / Mod;
            dst[i * 2] = v; dst[i * 2 + 1] = v;
        }
        return i;
    }
}

public sealed class SimServer
{
    public StreamEngine Stream { get; }
    public SimServer(SimKernel k)
    {
        Stream = new StreamEngine(k);
        void Tick() { Stream.Pump(); k.After(10_000, Tick); }  // the real server pumps from a 10 ms timer
        k.After(0, Tick);
    }
}
