using WavWiz.Measure;
namespace WavWiz.Measure.Tests;

public class ChirpTests
{
    private const int Fs = ChirpPattern.SampleRate;
    private static readonly ChirpPattern P = new();

    /// <summary>A phone capture: pattern placed at delayMs, with noise, optional AGC "pumping", room echo and clipping.</summary>
    private static float[] Capture(double seconds, double[] delaysMs, int seed, double noise = 0.01, double agcDepth = 0, double echo = 0, double gain = 1.0)
    {
        var rng = new Random(seed);
        var rec = new float[(int)(seconds * Fs)];
        for (int i = 0; i < rec.Length; i++) rec[i] = (float)((rng.NextDouble() * 2 - 1) * noise);
        foreach (var d in delaysMs)
        {
            int off = (int)Math.Round(d * Fs / 1000.0);
            for (int i = 0; i < P.Signal.Length && off + i < rec.Length; i++)
            {
                rec[off + i] += P.Signal[i] * (float)gain;
                int e = off + i + (int)(0.012 * Fs);                         // 12 ms room reflection
                if (echo > 0 && e < rec.Length) rec[e] += (float)(P.Signal[i] * echo * gain);
            }
        }
        if (agcDepth > 0)   // slow level pumping like phone AGC
            for (int i = 0; i < rec.Length; i++) rec[i] *= (float)(1 + agcDepth * Math.Sin(2 * Math.PI * 1.7 * i / Fs));
        return rec;
    }

    [Theory]
    [InlineData(187.3)] [InlineData(5.0)] [InlineData(412.55)] [InlineData(1000.0)]
    public void Pattern_is_found_within_1_ms_in_noise(double delayMs)
    {
        var rec = Capture(6, new[] { delayMs }, 1, noise: 0.02);
        var hit = new ChirpDetector().Find(rec);
        Assert.True(hit.Found, hit.Warning);
        Assert.InRange(hit.StartSec * 1000, delayMs - 1, delayMs + 1);
        Assert.True(hit.SpreadMs < 1.0);
        Assert.Equal(8, hit.ChirpsFound);
    }

    [Fact]
    public void Survives_level_pumping_and_a_room_reflection_like_a_phone_with_AGC_on()
    {
        var rec = Capture(6, new[] { 250.0 }, 2, noise: 0.03, agcDepth: 0.6, echo: 0.5);
        var hit = new ChirpDetector().Find(rec);
        Assert.True(hit.Found);
        Assert.InRange(hit.StartSec * 1000, 249, 251);
    }

    [Fact]
    public void Quiet_pattern_far_from_the_phone_is_still_found_when_it_is_6_dB_over_the_noise()
    {
        var rec = Capture(6, new[] { 600.0 }, 3, noise: 0.03, gain: 0.5);
        Assert.InRange(new ChirpDetector().Find(rec).StartSec * 1000, 599, 601);
    }

    [Fact]
    public void Pure_noise_is_reported_as_not_found_never_as_a_delay()
    {
        var rec = Capture(6, Array.Empty<double>(), 4, noise: 0.05);
        var hit = new ChirpDetector().Find(rec);
        Assert.False(hit.Found);
    }

    [Fact]
    public void Silence_and_clipping_get_clear_warnings()
    {
        var quiet = new float[6 * Fs];
        Assert.False(new ChirpDetector().Find(quiet).Found);
        var loud = Capture(6, new[] { 100.0 }, 5, noise: 0.01, gain: 80);
        Assert.Contains("clipping", new ChirpDetector().Find(loud).Warning ?? "");
    }

    [Fact]
    public void Same_recording_mode_gets_the_offset_without_any_clock_sync()
    {
        // reference plays at 300 ms, the Bluetooth speaker 2 s later PLUS its own 183.4 ms of extra delay
        double extra = 183.4;
        var rec = Capture(9, new[] { 300.0, 300.0 + 4000 + extra }, 6, noise: 0.02, agcDepth: 0.3);
        var (a, b) = new ChirpDetector().FindTwo(rec, gapSec: 4.0);
        Assert.True(a.Found && b.Found);
        double off = LatencyMath.SameRecordingOffsetMs(a.StartSec, b.StartSec, 4.0);
        Assert.InRange(off, extra - 1, extra + 1);
    }

    [Fact]
    public void Separate_recordings_cancel_the_unknown_mic_input_delay()
    {
        double micDelay = 63.0;   // phone capture latency, unknown to us
        double refTrue = 22.0, btTrue = 22.0 + 187.0;     // end to end, server timestamp to sound
        var ref1 = new ChirpDetector().Find(Capture(6, new[] { refTrue + micDelay }, 7)); var bt1 = new ChirpDetector().Find(Capture(6, new[] { btTrue + micDelay }, 8));
        double lRef = LatencyMath.RawLatencyMs(ref1.StartSec * 1e6, 0), lBt = LatencyMath.RawLatencyMs(bt1.StartSec * 1e6, 0);
        Assert.InRange(LatencyMath.Offset(lBt, lRef), 186, 188);
        Assert.Equal(lBt - 2.9 * 2, LatencyMath.RawLatencyMs(bt1.StartSec * 1e6, 0, 2.0), 6);
    }

    [Fact]
    public void Median_of_three_flags_a_noisy_room_when_spread_exceeds_5_ms()
    {
        Assert.Equal(MeasureVerdict.Ok, LatencyMath.Median(new[] { 187.0, 188.2, 186.5 }).Verdict);
        var noisy = LatencyMath.Median(new[] { 187.0, 196.0, 186.5 });
        Assert.Equal(MeasureVerdict.Noisy, noisy.Verdict); Assert.Equal(187.0, noisy.RawLatencyMs);
        Assert.Equal(MeasureVerdict.NotFound, LatencyMath.Median(Array.Empty<double>()).Verdict);
        Assert.Equal(MeasureVerdict.Noisy, LatencyMath.Median(new[] { 100.0, 100.5 }).Verdict);
    }

    [Fact]
    public void Reference_that_moved_more_than_5_ms_during_the_session_lowers_confidence_and_asks_for_a_repeat()
    {
        var good = LatencyMath.Session(180, 20.0, 21.5, 1.0); Assert.Null(good.Warning); Assert.True(good.Confidence > 0.7);
        var bad = LatencyMath.Session(180, 20.0, 31.0, 1.0); Assert.NotNull(bad.Warning); Assert.True(bad.Confidence < 0.5);
    }
}
