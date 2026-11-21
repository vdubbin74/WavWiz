namespace WavWiz.Dsp;

/// <summary>
/// 0.7.2: the zero-lookahead peak limiter, as its own component so the per-speaker <see cref="DspChain"/> and the server's live inputs
/// (AirPlay / Spotify Connect boost, and audio inputs) use exactly the same code. Instant attack, smooth exponential release (50..200 ms),
/// no lookahead and no added latency. Interleaved stereo float. Not thread safe: one instance per audio stream, called from its audio thread.
/// Never allocates.
/// </summary>
public sealed class PeakLimiter
{
    private readonly int _fs;
    private double _gain = 1;

    public PeakLimiter(int sampleRate = 48000) => _fs = sampleRate;

    /// <summary>Gain reduction in the last processed block (dB, 0 = not limiting).</summary>
    public double ReductionDb { get; private set; }
    /// <summary>Largest gain reduction seen since this limiter was made or <see cref="ResetMax"/> was called (dB).</summary>
    public double MaxReductionDb { get; private set; }
    public bool Active => ReductionDb > 0.05;

    /// <summary>Forget the release state (a new stream starts at unity gain).</summary>
    public void Reset() { _gain = 1; ReductionDb = 0; }
    public void ResetMax() => MaxReductionDb = 0;

    /// <summary>
    /// Limit <paramref name="frames"/> stereo frames of <paramref name="buf"/> in place. With <see cref="LimiterSettings.Enabled"/> off nothing is
    /// turned down, but a final safety clamp still keeps every sample inside 0 dBFS (and the ceiling when on), the same rule DspChain always had.
    /// </summary>
    public void Process(Span<float> buf, int frames, LimiterSettings s)
    {
        double ceil = Math.Pow(10, s.CeilingDb / 20);
        double rel = Math.Exp(-1.0 / (s.ReleaseMs * 0.001 * _fs));
        double hard = s.Enabled ? ceil : 1.0;
        double maxRed = 0;
        for (int i = 0; i < frames; i++)
        {
            double l = buf[i * 2], r = buf[i * 2 + 1];
            double peak = Math.Max(Math.Abs(l), Math.Abs(r));
            double need = s.Enabled && peak > ceil ? ceil / peak : 1;
            if (need < _gain) _gain = need; else _gain = 1 - (1 - _gain) * rel;
            double ol = l * _gain, orr = r * _gain;
            // final safety: nothing may pass the ceiling (or the NaN guard) even with limiting disabled
            if (ol > hard) ol = hard; else if (ol < -hard) ol = -hard;
            if (orr > hard) orr = hard; else if (orr < -hard) orr = -hard;
            buf[i * 2] = (float)ol; buf[i * 2 + 1] = (float)orr;
            if (_gain < 0.9999) { double red = -20 * Math.Log10(_gain); if (red > maxRed) maxRed = red; }
        }
        ReductionDb = maxRed;
        if (maxRed > MaxReductionDb) MaxReductionDb = maxRed;
    }
}
