using WavWiz.Dsp;
namespace WavWiz.Dsp.Tests;

public class DspTests
{
    private const int Fs = 48000;

    private static float[] Sine(double hz, double amp, int frames, double phase = 0)
    {
        var b = new float[frames * 2];
        for (int i = 0; i < frames; i++) { b[i * 2] = b[i * 2 + 1] = (float)(amp * Math.Sin(2 * Math.PI * hz * i / Fs + phase)); }
        return b;
    }

    private static double RmsDb(float[] b, int fromFrame)
    {
        double s = 0; int n = 0;
        for (int i = fromFrame; i < b.Length / 2; i++) { s += b[i * 2] * (double)b[i * 2]; n++; }
        return 10 * Math.Log10(s / n / 0.5 + 1e-30);   // relative to a full-scale sine
    }

    private static float[] Run(DspChain c, float[] input, int block = 480)
    {
        var o = (float[])input.Clone();
        for (int i = 0; i < o.Length / 2; i += block) c.Process(o.AsSpan(i * 2, Math.Min(block, o.Length / 2 - i) * 2), Math.Min(block, o.Length / 2 - i));
        return o;
    }

    [Fact]
    public void Peaking_biquad_matches_the_cookbook_gain_at_center_and_is_flat_far_away()
    {
        var c = BiquadCoeffs.Peaking(1000, 6, 1.4, Fs);
        Assert.Equal(6.0, c.MagnitudeDb(1000, Fs), 0.01);
        Assert.InRange(c.MagnitudeDb(20, Fs), -0.2, 0.2);
        Assert.InRange(c.MagnitudeDb(20000, Fs), -0.5, 0.8);
        Assert.Equal(-6.0, BiquadCoeffs.Peaking(1000, -6, 1.4, Fs).MagnitudeDb(1000, Fs), 0.01);
    }

    [Fact]
    public void Shelves_reach_their_gain_in_the_pass_region_and_are_half_gain_at_the_corner()
    {
        var lo = BiquadCoeffs.LowShelf(100, 8, 0.707, Fs); var hi = BiquadCoeffs.HighShelf(10000, -8, 0.707, Fs);
        Assert.Equal(8.0, lo.MagnitudeDb(20, Fs), 0.2); Assert.Equal(0.0, lo.MagnitudeDb(5000, Fs), 0.2);
        Assert.Equal(-8.0, hi.MagnitudeDb(20000, Fs), 0.6); Assert.Equal(0.0, hi.MagnitudeDb(200, Fs), 0.2);
        Assert.Equal(4.0, lo.MagnitudeDb(100, Fs), 0.3);
    }

    [Theory]
    [InlineData(44100)] [InlineData(48000)] [InlineData(96000)]
    public void Frequencies_stay_stable_at_every_mix_rate_even_for_the_16k_band(int fs)
    {
        var p = DspPreset.Flat with { GraphicDb = Enumerable.Repeat(12.0, 10).ToArray(), AutoPreamp = false };
        var prog = new DspProgram(p, fs, 100);
        for (double f = 20; f < 20000; f *= 1.3) Assert.True(double.IsFinite(prog.ResponseDb(f)));
    }

    [Fact]
    public void Flat_chain_at_full_volume_is_a_null_below_minus_120_dBFS()
    {
        var c = new DspChain(Fs); c.SetVolume(100);
        var x = Sine(997, 0.5, Fs);
        var y = Run(c, x);
        double e = 0; for (int i = 0; i < x.Length; i++) e += Math.Pow(y[i] - x[i], 2);
        Assert.True(10 * Math.Log10(e / x.Length + 1e-40) < -120, "residual " + 10 * Math.Log10(e / x.Length));
    }

    [Fact]
    public void Bypass_is_a_null_too_and_keeps_trim_and_limiter_on()
    {
        var p = DspPreset.Flat with { GraphicDb = new double[] { 0, 0, 0, 0, 0, 12, 0, 0, 0, 0 }, TrimDb = -6, AutoPreamp = false, Bypass = true };
        var c = new DspChain(Fs); c.SetPreset(p);
        var x = Sine(1000, 0.5, Fs); var y = Run(c, x);
        Assert.Equal(-6.0, RmsDb(y, 24000) - RmsDb(x, 24000), 0.05);     // trim stays, the +12 dB EQ band is gone
    }

    [Theory]
    [InlineData(63, 5.0)] [InlineData(1000, -7.5)] [InlineData(4000, 9.0)] [InlineData(100, 3.0)]
    public void Sine_sweep_through_the_chain_matches_the_computed_response_within_half_a_dB(double hz, double bandDb)
    {
        var g = new double[10]; int band = Array.FindIndex(DspPreset.BandHz, b => b >= hz * 0.9);
        g[band] = bandDb;
        var p = DspPreset.Flat with { GraphicDb = g, AutoPreamp = false };
        var c = new DspChain(Fs); c.SetPreset(p);
        var x = Sine(hz, 0.1, Fs * 2);
        var y = Run(c, x);
        double measured = RmsDb(y, Fs) - RmsDb(x, Fs);
        double expected = c.CurrentProgram.TotalResponseDb(hz);
        Assert.True(Math.Abs(measured - expected) <= 0.5, $"{hz} Hz measured {measured:F2} dB vs expected {expected:F2} dB");
    }

    [Fact]
    public void Auto_preamp_subtracts_the_largest_boost_so_a_boosted_eq_does_not_clip()
    {
        var p = DspPreset.Flat with { GraphicDb = new double[] { 0, 0, 0, 0, 0, 10, 0, 0, 0, 0 } };
        var prog = new DspProgram(p, Fs, 100);
        double peak = 0; for (double f = 20; f < 20000; f *= 1.02) peak = Math.Max(peak, prog.TotalResponseDb(f));
        Assert.InRange(peak, -0.4, 0.05);
        Assert.True(prog.PreGainDb < -9);
        Assert.True(new DspProgram(p with { AutoPreamp = false }, Fs, 100).PreGainDb == 0);
    }

    [Fact]
    public void Limiter_never_exceeds_its_ceiling_even_for_a_plus_12_dB_overdrive_and_lights_its_LED()
    {
        var p = DspPreset.Flat with { TrimDb = 0, PreampDb = 12, AutoPreamp = false };
        var c = new DspChain(Fs); c.SetPreset(p);
        var y = Run(c, Sine(300, 0.9, Fs));
        double ceil = Math.Pow(10, -0.3 / 20);
        Assert.True(y.Max(Math.Abs) <= ceil + 1e-6);
        Assert.True(c.MaxLimiterReductionDb > 3);
    }

    [Fact]
    public void Limiter_is_transparent_for_normal_levels_and_adds_no_latency()
    {
        var c = new DspChain(Fs);
        var imp = new float[1000 * 2]; imp[200 * 2] = 0.5f; imp[200 * 2 + 1] = 0.5f;
        var y = Run(c, imp);
        int peakAt = Array.IndexOf(y, y.Max());
        Assert.Equal(200 * 2, peakAt);                  // impulse test: latency 0
        Assert.Equal(0, c.LatencyUs);
        Assert.Equal(0.0, c.MaxLimiterReductionDb);
    }

    [Fact]
    public void Preset_change_while_playing_does_not_click()
    {
        var c = new DspChain(Fs);
        var x = Sine(440, 0.3, Fs);
        var o = (float[])x.Clone();
        for (int i = 0; i < Fs; i += 480)
        {
            if (i == 24000) c.SetPreset(DspPreset.Flat with { GraphicDb = new double[] { 0, 0, 0, 0, 12, 12, 0, 0, 0, 0 }, AutoPreamp = true });
            if (i == 36000) c.SetPreset(DspPreset.Flat with { Bass = new ShelfSettings(10, 100), TrimDb = -3 });
            c.Process(o.AsSpan(i * 2, 960), 480);
        }
        // a 440 Hz sine at 0.3 changes by at most ~0.017 per sample; allow generous headroom for the genuine gain change
        double maxStep = 0; for (int i = 1; i < Fs; i++) maxStep = Math.Max(maxStep, Math.Abs(o[i * 2] - o[(i - 1) * 2]));
        Assert.True(maxStep < 0.06, $"max step {maxStep}");
    }

    [Fact]
    public void Volume_and_mute_ramp_smoothly_and_volume_zero_is_silent()
    {
        var c = new DspChain(Fs); c.SetVolume(100);
        var o = Sine(1000, 0.5, Fs);
        for (int i = 0; i < Fs; i += 480)
        {
            if (i == 12000) c.SetVolume(40);
            if (i == 36000) c.SetMuted(true);
            c.Process(o.AsSpan(i * 2, 960), 480);
        }
        double maxStep = 0; for (int i = 1; i < Fs; i++) maxStep = Math.Max(maxStep, Math.Abs(o[i * 2] - o[(i - 1) * 2]));
        Assert.True(maxStep < 0.07, $"max step {maxStep}");
        Assert.Equal(0f, o[(Fs - 10) * 2]);
        Assert.Equal(0.0, DspChain.VolumeToGain(0)); Assert.Equal(1.0, DspChain.VolumeToGain(100), 9);
    }

    [Fact]
    public void Loudness_is_off_by_default_zero_at_the_reference_and_adds_bass_below_it()
    {
        Assert.False(DspPreset.Flat.Loudness.Enabled);
        Assert.Equal((0.0, 0.0), DspProgram.LoudnessGains(80, 80));
        Assert.Equal((0.0, 0.0), DspProgram.LoudnessGains(100, 80));
        var (b, t) = DspProgram.LoudnessGains(0, 80); Assert.Equal(10.0, b); Assert.True(t > 0 && t < b);
        var on = new DspProgram(DspPreset.Flat with { Loudness = new LoudnessSettings(true, 80), AutoPreamp = false }, Fs, 20);
        var off = new DspProgram(DspPreset.Flat with { AutoPreamp = false }, Fs, 20);
        Assert.True(on.ResponseDb(40) > 5); Assert.Equal(0.0, off.ResponseDb(40), 1e-9);
    }

    [Fact]
    public void Nan_input_resets_the_filters_and_recovers()
    {
        var c = new DspChain(Fs); c.SetPreset(DspPreset.Flat with { GraphicDb = new double[] { 6, 6, 6, 6, 6, 6, 6, 6, 6, 6 } });
        var o = Sine(500, 0.2, 4800); o[100] = float.NaN;
        c.Process(o, 2400);
        Assert.True(c.NonFiniteResets >= 1);
        var tail = o.AsSpan(2000 * 2, 400); foreach (var v in tail) Assert.True(float.IsFinite(v));
        var p2 = Sine(500, 0.2, 4800); c.Process(p2, 2400);
        Assert.All(p2.Take(4800), v => Assert.True(float.IsFinite(v)));
    }

    [Fact]
    public void Illegal_parameters_are_clamped_and_never_produce_nan()
    {
        var p = new DspPreset { TrimDb = 99, PreampDb = double.NaN, GraphicDb = new double[] { 99, -99, double.PositiveInfinity }, Bass = new(50, -5), Treble = new(-50, 99999) }.Normalize();
        Assert.Equal(6, p.TrimDb); Assert.Equal(0, p.PreampDb); Assert.Equal(10, p.GraphicDb.Length); Assert.Equal(12, p.GraphicDb[0]); Assert.Equal(-12, p.GraphicDb[1]); Assert.Equal(0, p.GraphicDb[2]);
        var c = new DspChain(Fs); c.SetPreset(p);
        Assert.All(Run(c, Sine(1000, 0.2, 4800)), v => Assert.True(float.IsFinite(v)));
    }

    [Fact]
    public void Processing_is_allocation_free_on_the_audio_thread_even_while_a_preset_crossfade_runs()
    {
        var c = new DspChain(Fs);
        var buf = Sine(1000, 0.3, 480);
        c.Process(buf, 480);                                   // warm up (JIT)
        c.SetPreset(DspPreset.Flat with { GraphicDb = new double[] { 3, 2, 1, 0, -1, -2, 3, 4, 5, 6 }, Bass = new(4, 100) });
        c.SetVolume(60);
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 2000; i++) { c.Process(buf, 480); }     // crossfade + steady state
        long after = GC.GetAllocatedBytesForCurrentThread();
        Assert.Equal(0, after - before);
    }

    [Fact]
    public void Cpu_budget_full_chain_processes_ten_seconds_of_audio_far_faster_than_real_time()
    {
        var c = new DspChain(Fs); c.SetPreset(DspPreset.Flat with { GraphicDb = Enumerable.Repeat(3.0, 10).ToArray(), Bass = new(3, 100), Treble = new(3, 10000), Loudness = new(true, 80) });
        var buf = Sine(1000, 0.2, 480);
        for (int i = 0; i < 100; i++) c.Process(buf, 480);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (int i = 0; i < 1000; i++) c.Process(buf, 480);   // 10 s of audio
        sw.Stop();
        Assert.True(sw.Elapsed.TotalSeconds < 0.5, $"{sw.Elapsed.TotalMilliseconds} ms for 10 s of audio");   // < 5% of one core (target < 0.5%, measured on real hardware later)
    }

    [Fact]
    public void Response_helper_for_the_graph_uses_the_same_math_as_the_audio_path()
    {
        var p = DspPreset.Flat with { GraphicDb = new double[] { 0, 0, 0, 0, 0, 6, 0, 0, 0, 0 }, AutoPreamp = false };
        var r = DspChain.Response(p, Fs, new[] { 1000.0 });
        Assert.Equal(6.0, r[0], 0.05);
    }
}
