using System.Numerics;
namespace WavWiz.Measure;

public sealed record PatternHit(double StartSec, double SpreadMs, double Confidence, int ChirpsFound, string? Warning)
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
        return new PatternHit(med / ChirpPattern.SampleRate, spread, conf, est.Count, warn);
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
