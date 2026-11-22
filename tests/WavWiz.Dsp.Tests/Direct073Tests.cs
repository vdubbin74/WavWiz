using System.Text.Json;
using WavWiz.Dsp;
namespace WavWiz.Dsp.Tests;

/// <summary>0.7.3 "Direct (no processing)": EQ, Bass/Treble, Balance, Trim, Loudness, pre-gain and the limiter's turning-down are off; only the
/// volume and the 0 dBFS safety clamp remain. Not called bit-perfect (resampling, shared mode and volume still apply; that is 0.8.0).</summary>
public class Direct073Tests
{
    private const int Fs = 48000;
    private static readonly DspPreset Busy = DspPreset.Flat with
    {
        GraphicDb = new double[] { 5, 4, 2, 1, 0, -1, 0, 1, 2, 1 }, Bass = new ShelfSettings(12, 100), Treble = new ShelfSettings(12, 10000),
        TrimDb = -4, PreampDb = 3, Balance = 60, Loudness = new LoudnessSettings(true, 100), Limiter = new LimiterSettings(true, -6, 50),
    };

    private static float[] Sine(double amp, int frames, double hz = 997)
    {
        var b = new float[frames * 2];
        for (int i = 0; i < frames; i++) { b[i * 2] = (float)(amp * Math.Sin(2 * Math.PI * hz * i / Fs)); b[i * 2 + 1] = (float)(amp * Math.Cos(2 * Math.PI * hz * i / Fs)); }
        return b;
    }

    private static float[] Run(DspChain c, float[] x)
    {
        var o = (float[])x.Clone();
        for (int i = 0; i < o.Length / 2; i += 480) c.Process(o.AsSpan(i * 2, 960), 480);
        return o;
    }

    [Fact]
    public void Direct_at_100_percent_passes_every_sample_unchanged_whatever_else_is_set()
    {
        var c = new DspChain(Fs); c.SetVolume(40); c.SetVolume(100); c.SetPreset(Busy with { Direct = true });
        var x = Sine(0.9, Fs); var y = Run(c, x);
        const int skip = 4800 * 2;   // past the ~20 ms crossfade from the Flat start-up program
        Assert.Equal(x.AsSpan(skip).ToArray(), y.AsSpan(skip).ToArray());
        Assert.Equal(0.0, c.MaxLimiterReductionDb);
        var prog = c.CurrentProgram;
        Assert.Equal(0.0, prog.PreGainDb); Assert.All(prog.Active, a => Assert.False(a));
    }

    [Fact]
    public void Direct_below_100_percent_only_scales_by_the_volume()
    {
        var c = new DspChain(Fs); c.SetPreset(Busy with { Direct = true }); c.SetVolume(70);
        var x = Sine(0.5, Fs); var y = Run(c, x);
        double g = DspChain.VolumeToGain(70);
        for (int i = 4800 * 2; i < y.Length; i++) Assert.True(Math.Abs(y[i] - x[i] * g) < 1e-6, $"sample {i}: {y[i]} vs {x[i] * g}");
        // balance 60 is ignored: both sides the same level
        Assert.True(Math.Abs(y[Fs] - (float)(x[Fs] * g)) < 1e-6 && Math.Abs(y[Fs + 1] - (float)(x[Fs + 1] * g)) < 1e-6);
    }

    [Fact]
    public void Direct_never_turns_down_but_keeps_the_0_dBFS_safety_clamp()
    {
        var c = new DspChain(Fs); c.SetPreset(Busy with { Direct = true });
        var x = Sine(1.5, 4800); var y = Run(c, x);
        Assert.True(y.Max(Math.Abs) <= 1.0f);
        Assert.Equal(1.0f, y.Max());
        Assert.Equal(0.0, c.MaxLimiterReductionDb);
        Assert.False(DspChain.DirectLimiter.Enabled);
    }

    [Fact]
    public void Direct_off_still_processes_and_old_presets_default_off()
    {
        Assert.False(DspPreset.Flat.Direct);
        var old = JsonSerializer.Deserialize<DspPreset>("{\"name\":\"Old\",\"graphicDb\":[1,2,3,0,0,0,0,0,0,0]}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.False(old.Normalize().Direct);
        var on = JsonSerializer.Deserialize<DspPreset>("{\"direct\":true}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.True(on.Normalize().Direct);
        var json = JsonSerializer.Serialize(Busy with { Direct = true }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"direct\":true", json);
        Assert.NotEqual(0.0, new DspProgram(Busy, Fs, 50).PreGainDb);
        Assert.Contains(new DspProgram(Busy, Fs, 50).Active, a => a);
    }

    [Fact]
    public void Direct_wins_over_bypass_and_the_graph_is_flat()
    {
        var p = Busy with { Direct = true, Bypass = true };
        var db = DspChain.Response(p, Fs, new[] { 50.0, 1000, 10000 });
        Assert.All(db, d => Assert.Equal(0.0, d, 9));
    }
}
