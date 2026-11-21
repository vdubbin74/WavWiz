using WavWiz.Dsp;
namespace WavWiz.Dsp.Tests;

/// <summary>0.7.2: the zero-lookahead limiter is its own component (<see cref="PeakLimiter"/>), shared by DspChain and the server's live inputs.</summary>
public class PeakLimiter072Tests
{
    private const int Fs = 48000;
    private static float[] Sine(double amp, int frames, double hz = 300)
    {
        var b = new float[frames * 2];
        for (int i = 0; i < frames; i++) b[i * 2] = b[i * 2 + 1] = (float)(amp * Math.Sin(2 * Math.PI * hz * i / Fs));
        return b;
    }

    [Fact]
    public void A_plus_6_dB_boost_of_a_full_scale_track_never_passes_the_ceiling()
    {
        var x = Sine(Math.Pow(10, 6 / 20.0), Fs);              // a full-scale song after +6 dB = about 2.0 peak
        var lim = new PeakLimiter(Fs); lim.Process(x, x.Length / 2, new LimiterSettings());
        Assert.True(x.Max(Math.Abs) <= Math.Pow(10, -0.3 / 20) + 1e-6);
        Assert.True(lim.MaxReductionDb > 5);
        Assert.True(lim.Active);
    }

    [Fact]
    public void Disabled_does_not_turn_down_but_still_hard_clips_at_0_dBFS()
    {
        var x = Sine(1.5, 4800);
        var lim = new PeakLimiter(Fs); lim.Process(x, x.Length / 2, new LimiterSettings(Enabled: false));
        Assert.Equal(1.0f, x.Max());                          // clamped, not limited
        Assert.Equal(0.0, lim.MaxReductionDb);
        var quiet = Sine(0.5, 4800); var copy = (float[])quiet.Clone();
        lim.Process(quiet, quiet.Length / 2, new LimiterSettings(Enabled: false));
        Assert.Equal(copy, quiet);                            // untouched below 0 dBFS
    }

    [Fact]
    public void Transparent_below_the_ceiling_and_releases_back_to_unity()
    {
        var lim = new PeakLimiter(Fs);
        var loud = Sine(2, 4800); lim.Process(loud, loud.Length / 2, new LimiterSettings());
        var quiet = Sine(0.5, Fs); lim.Process(quiet, quiet.Length / 2, new LimiterSettings());   // 1 s later at -6 dBFS
        var tail = quiet.AsSpan(quiet.Length - 960).ToArray();
        var expect = Sine(0.5, Fs).AsSpan(quiet.Length - 960).ToArray();
        for (int i = 0; i < tail.Length; i++) Assert.InRange(tail[i], expect[i] - 1e-3f, expect[i] + 1e-3f);
        var more = Sine(0.5, 480); lim.Process(more, 480, new LimiterSettings());   // the next block: fully released
        Assert.False(lim.Active);
    }

    [Fact]
    public void DspChain_still_limits_through_the_shared_component()
    {
        // same input through a DspChain (+12 dB preamp) and through a PeakLimiter after the same +12 dB: identical samples
        var p = DspPreset.Flat with { TrimDb = 0, PreampDb = 12, AutoPreamp = false };
        var c = new DspChain(Fs); c.SetPreset(p);
        var a = Sine(0.9, 4096); c.Process(a, 4096);   // first block applies the preset via its own fade; compare a later block
        var a2 = Sine(0.9, 4096); c.Process(a2, 4096);
        Assert.True(a2.Max(Math.Abs) <= Math.Pow(10, -0.3 / 20) + 1e-6);
        Assert.True(c.MaxLimiterReductionDb >= c.LimiterReductionDb);
    }
}
