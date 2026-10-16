using System.Numerics;
namespace WavWiz.Measure;

/// <summary>0.3.7 L25/L26: the detector's <c>Confidence</c> is a peak-to-noise RATIO (about 4 = just found, 20-70 = clear), NOT a 0-1 value. Showing it x100 as a percent
/// gave "6800%". <c>Quality</c> is the same measurement mapped to 0..1 (4 = 12 dB -> 0, 40 = 32 dB -> 1); SnrDb / PeakDb / RmsDb are the raw numbers for the log and the live meter.</summary>
public static class CalQuality
{
    public static double SnrDb(double ratio) => double.IsFinite(ratio) && ratio > 0 ? 20 * Math.Log10(ratio) : -120;
    public static double Clamp01(double v) => double.IsFinite(v) ? Math.Clamp(v, 0, 1) : 0;
    public static double FromRatio(double ratio) => Clamp01((SnrDb(ratio) - 12) / 20);
    /// <summary>Time-domain signal-to-noise (dB, peak of the test sound over the quiet-room noise): 6 dB -> 0, 30 dB -> 1.</summary>
    public static double FromTime(double snrDb) => Clamp01((snrDb - 6) / 24);
    public static int Pct(double c) => (int)Math.Round(Clamp01(c) * 100);
    /// <summary>good / weak / quiet from the recording's peak level and the pattern's quality (the same words the pre-check shows).</summary>
    public static string Rate(double peakDb, double quality) => peakDb < -50 ? "quiet" : quality >= 0.5 ? "good" : quality > 0 ? "weak" : "quiet";
}

public sealed record PatternHit(double StartSec, double SpreadMs, double Confidence, int ChirpsFound, string? Warning, double Quality = 0, double PeakDb = -120, double RmsDb = -120, double NoiseDb = -120, double SnrDb = 0)
{
    public bool Found => ChirpsFound >= 5 && Confidence >= 4;
}

/// <summary>Matched-filter (cross-correlation) detection of the chirp pattern in a mono recording (phone capture or PC mic).</summary>
public sealed class ChirpDetector
{
    private readonly ChirpPattern _p;
    public ChirpDetector(ChirpPattern? p = null) { _p = p ?? new ChirpPattern(); }

    /// <summary>Envelope of the matched-filter output, one value per recording sample (index = chirp start position).</summary>
    public double[] Envelope(float[] rec)
    {
        int n = Fft.NextPow2(rec.Length + _p.Chirp.Length);
        var a = new Complex[n]; var b = new Complex[n];
        for (int i = 0; i < rec.Length; i++) a[i] = rec[i];
        for (int i = 0; i < _p.Chirp.Length; i++) b[i] = _p.Chirp[i];
        Fft.Transform(a, false); Fft.Transform(b, false);
        for (int i = 0; i < n; i++) a[i] *= Complex.Conjugate(b[i]);
        Fft.Transform(a, true);
        // local normalization by recording energy so AGC level pumping does not decide the winner
        var env = new double[rec.Length];
        for (int i = 0; i < rec.Length; i++) env[i] = Math.Abs(a[i].Real);
        return Normalize(env, rec);
    }

    private double[] Normalize(double[] env, float[] rec)
    {
        // divide by sqrt of running energy over a chirp length (+ small floor) = normalized cross-correlation
        int L = _p.Chirp.Length;
        double e = 0; var run = new double[rec.Length];
        for (int i = 0; i < rec.Length; i++)
        {
            e += (double)rec[i] * rec[i];
            if (i >= L) e -= (double)rec[i - L] * rec[i - L];
            run[i] = e;
        }
        double ch = 0; foreach (var c in _p.Chirp) ch += (double)c * c;
        var o = new double[env.Length];
        for (int i = 0; i < env.Length; i++)
        {
            int end = Math.Min(i + L - 1, rec.Length - 1);
            double energy = run[end];
            o[i] = env[i] / (Math.Sqrt(Math.Max(energy, 1e-12) * ch));
        }
        return o;
    }

    /// <summary>Best start of the whole pattern within [fromSample, toSample] (recording sample index of the first chirp).</summary>
    public PatternHit Find(float[] rec, int fromSample = 0, int toSample = int.MaxValue, double[]? env = null)
    {
        env ??= Envelope(rec);
        var offs = _p.OffsetSamples;
        int last = offs[^1];
        int lo = Math.Max(0, fromSample), hi = Math.Min(toSample, env.Length - 1 - last);
        if (hi <= lo) return new PatternHit(0, double.NaN, 0, 0, "recording too short");

        // score(t) = sum of the envelope peaks at t + offset_k (+-3 samples tolerance)
        double best = -1; int bestT = lo;
        for (int t = lo; t <= hi; t++)
        {
            double s = 0;
            for (int k = 0; k < offs.Length; k++) s += Peak(env, t + offs[k], 3);
            if (s > best) { best = s; bestT = t; }
        }
        // noise floor: median of the envelope
        var sample = new List<double>(); for (int i = 0; i < env.Length; i += 37) sample.Add(env[i]);
        sample.Sort(); double floor = sample[sample.Count / 2] + 1e-9;
        double conf = best / offs.Length / floor;

        // refine every chirp (parabolic interpolation) and collect per-chirp start estimates
        var est = new List<double>();
        foreach (var o in offs)
        {
            int c = ArgPeak(env, bestT + o, 4);
            if (env[c] < 3 * floor || c <= 0 || c >= env.Length - 1) continue;
            double y0 = env[c - 1], y1 = env[c], y2 = env[c + 1], d = y0 - 2 * y1 + y2;
            double frac = d == 0 ? 0 : 0.5 * (y0 - y2) / d;
            est.Add(c + frac - o);
        }
        if (est.Count == 0) return new PatternHit(0, double.NaN, 0, 0, "no chirps found");
        est.Sort();
        double med = est[est.Count / 2];
        double spread = (est[^1] - est[0]) * 1000.0 / ChirpPattern.SampleRate;
        string? warn = null;
        if (est.Count < offs.Length) warn = $"only {est.Count} of {offs.Length} chirps found";
        double peak = 0; foreach (var v in rec) peak = Math.Max(peak, Math.Abs(v));
        if (peak >= 0.99) warn = "recording is clipping - lower the volume";
        else if (peak < 0.003) warn = "recording is very quiet - move the phone closer";
        double ss = 0; foreach (var v in rec) ss += (double)v * v;
        double rmsDb = rec.Length == 0 ? -120 : 10 * Math.Log10(Math.Max(1e-12, ss / rec.Length)), peakDb = 20 * Math.Log10(Math.Max(1e-6, peak));
        // 0.3.7 L25: what a person can act on - how far the test sound stands above the room/mic noise AT THE MIC (peak vs the quiet blocks of the same recording).
        // The matched filter alone finds a chirp 30 dB below the noise, so a far, quiet mic still "found it" while timing jittered; this keeps distance visible.
        var blocks = new List<double>(); for (int b = 0; b + 2400 <= rec.Length; b += 2400) { double e = 0; for (int k = b; k < b + 2400; k++) e += (double)rec[k] * rec[k]; blocks.Add(e / 2400); }
        blocks.Sort(); double noiseDb = blocks.Count == 0 ? -120 : 10 * Math.Log10(Math.Max(1e-12, blocks[blocks.Count / 4])), snr = peakDb - noiseDb;
        double quality = Math.Min(CalQuality.FromRatio(conf), CalQuality.FromTime(snr));
        return new PatternHit(med / ChirpPattern.SampleRate, spread, conf, est.Count, warn, quality, peakDb, rmsDb, noiseDb, snr);
    }

    /// <summary>Same-recording mode: two patterns (reference, then device) in ONE capture, <paramref name="gapSec"/> apart.</summary>
    public (PatternHit First, PatternHit Second) FindTwo(float[] rec, double gapSec, double windowSec = 0.5)
    {
        var env = Envelope(rec);
        var h1 = Find(rec, env: env);
        int gap = (int)(gapSec * ChirpPattern.SampleRate), win = (int)(windowSec * ChirpPattern.SampleRate);
        int c = (int)Math.Round(h1.StartSec * ChirpPattern.SampleRate);
        var after = Find(rec, c + gap - win, c + gap + win, env);
        var before = Find(rec, c - gap - win, c - gap + win, env);
        if (after.Confidence >= before.Confidence) return (h1, after);
        return (before, h1);
    }

    private static double Peak(double[] e, int c, int tol)
    {
        double m = 0; for (int i = Math.Max(0, c - tol); i <= Math.Min(e.Length - 1, c + tol); i++) if (e[i] > m) m = e[i];
        return m;
    }

    private static int ArgPeak(double[] e, int c, int tol)
    {
        int b = Math.Clamp(c, 0, e.Length - 1);
        for (int i = Math.Max(0, c - tol); i <= Math.Min(e.Length - 1, c + tol); i++) if (e[i] > e[b]) b = i;
        return b;
    }
}
