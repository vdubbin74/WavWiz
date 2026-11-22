using WavWiz.Dsp;
namespace WavWiz.Dsp.Tests;

/// <summary>0.7.3: Auto pre-gain takes back only half of a boost (at most 6 dB), looks at the user's EQ + Bass/Treble between 40 Hz and
/// 12 kHz (not the loudness shelves), and the peak limiter after the volume catches what is left.</summary>
public class PreGain073Tests
{
    private const int Fs = 48000;
    // the built-in "Bass Boost" (DspService.BuiltIns)
    private static readonly DspPreset BassBoost = DspPreset.Flat with { GraphicDb = new double[] { 5, 4, 2, 1, 0, -1, 0, 1, 2, 1 }, Bass = new ShelfSettings(3, 90) };

    [Fact]
    public void Bass_Boost_keeps_1_kHz_within_5_dB()
    {
        var prog = new DspProgram(BassBoost, Fs, 100);
        Assert.True(prog.TotalResponseDb(1000) >= -5, $"1 kHz {prog.TotalResponseDb(1000):F2} dB");
        Assert.InRange(prog.PreGainDb, -4.5, -3.0);
    }

    [Fact]
    public void Bass_and_treble_plus_12_cost_the_track_about_6_dB_not_12()
    {
        var prog = new DspProgram(DspPreset.Flat with { Bass = new ShelfSettings(12, 100), Treble = new ShelfSettings(12, 10000) }, Fs, 100);
        Assert.InRange(prog.PreGainDb, -6.0, -5.5);   // half the 40 Hz-12 kHz peak (~11.6 dB)
        Assert.InRange(prog.TotalResponseDb(1000), -6.5, -5.5);
        Assert.Equal(6.0, DspProgram.AutoCutDb(40), 9);
        Assert.Equal(0.0, DspProgram.AutoCutDb(-3), 9);
        Assert.Equal(0.0, DspProgram.AutoCutDb(double.NaN), 9);
    }

    [Fact]
    public void Loudness_at_40_percent_raises_50_Hz_by_3_dB_or_more_and_does_not_move_the_pre_gain()
    {
        var on = new DspProgram(DspPreset.Flat with { Loudness = new LoudnessSettings(true, 80) }, Fs, 40);
        Assert.True(on.TotalResponseDb(50) >= 3, $"50 Hz {on.TotalResponseDb(50):F2} dB");
        Assert.Equal(0.0, on.PreGainDb, 9);
        var withEq = new DspProgram(BassBoost with { Loudness = new LoudnessSettings(true, 80) }, Fs, 40);
        Assert.Equal(new DspProgram(BassBoost, Fs, 40).PreGainDb, withEq.PreGainDb, 9);
    }

    [Fact]
    public void Limiter_output_never_exceeds_the_ceiling_with_every_boost_maxed()
    {
        foreach (var ceil in new[] { -0.3, -3.0 })
        {
            var p = DspPreset.Flat with
            {
                GraphicDb = Enumerable.Repeat(12.0, 10).ToArray(), Bass = new ShelfSettings(12, 100), Treble = new ShelfSettings(12, 10000),
                Loudness = new LoudnessSettings(true, 100), PreampDb = 12, Limiter = new LimiterSettings(true, ceil, 50),
            };
            var c = new DspChain(Fs); c.SetVolume(60); c.SetPreset(p);
            var x = new float[Fs * 2];
            var rng = new Random(7);
            for (int i = 0; i < Fs; i++)
            {
                double t = i / (double)Fs, v = 0.4 * Math.Sin(2 * Math.PI * 50 * t) + 0.3 * Math.Sin(2 * Math.PI * 1000 * t) + 0.2 * Math.Sin(2 * Math.PI * 9000 * t) + 0.09 * (rng.NextDouble() * 2 - 1);
                x[i * 2] = (float)v; x[i * 2 + 1] = (float)-v;
            }
            for (int i = 0; i < Fs; i += 480) c.Process(x.AsSpan(i * 2, 960), 480);
            double limit = Math.Pow(10, ceil / 20) + 1e-6;
            Assert.True(x.Max(Math.Abs) <= limit, $"ceiling {ceil}: peak {x.Max(Math.Abs)}");
            Assert.True(c.MaxLimiterReductionDb > 1);
        }
    }

    [Fact]
    public void Cuts_need_no_pre_gain_and_auto_off_is_zero()
    {
        Assert.Equal(0.0, new DspProgram(DspPreset.Flat with { Bass = new ShelfSettings(-12, 100) }, Fs, 100).PreGainDb, 9);
        Assert.Equal(0.0, new DspProgram(BassBoost with { AutoPreamp = false }, Fs, 100).PreGainDb, 9);
        Assert.Equal(0.0, new DspProgram(BassBoost with { Bypass = true }, Fs, 100).PreGainDb, 9);
    }
}
