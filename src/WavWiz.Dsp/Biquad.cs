namespace WavWiz.Dsp;

/// <summary>RBJ Audio EQ Cookbook coefficients (a0 normalized to 1). Frequencies are kept below 0.45*fs; Q &gt; 0.</summary>
public readonly record struct BiquadCoeffs(double B0, double B1, double B2, double A1, double A2)
{
    public static readonly BiquadCoeffs Identity = new(1, 0, 0, 0, 0);
    public bool IsIdentity => B0 == 1 && B1 == 0 && B2 == 0 && A1 == 0 && A2 == 0;

    private static (double w0, double cos, double sin) W(double hz, double fs)
    {
        hz = Math.Clamp(hz, 10, 0.45 * fs);
        double w0 = 2 * Math.PI * hz / fs;
        return (w0, Math.Cos(w0), Math.Sin(w0));
    }

    public static BiquadCoeffs Peaking(double hz, double gainDb, double q, double fs)
    {
        if (Math.Abs(gainDb) < 1e-4) return Identity;
        q = Math.Max(q, 0.05);
        var (_, c, s) = W(hz, fs);
        double A = Math.Pow(10, gainDb / 40), alpha = s / (2 * q);
        double a0 = 1 + alpha / A;
        return new((1 + alpha * A) / a0, -2 * c / a0, (1 - alpha * A) / a0, -2 * c / a0, (1 - alpha / A) / a0);
    }

    public static BiquadCoeffs LowShelf(double hz, double gainDb, double q, double fs)
    {
        if (Math.Abs(gainDb) < 1e-4) return Identity;
        var (_, c, s) = W(hz, fs);
        double A = Math.Pow(10, gainDb / 40), alpha = s / (2 * Math.Max(q, 0.05)), sq = 2 * Math.Sqrt(A) * alpha;
        double a0 = (A + 1) + (A - 1) * c + sq;
        return new(A * ((A + 1) - (A - 1) * c + sq) / a0, 2 * A * ((A - 1) - (A + 1) * c) / a0, A * ((A + 1) - (A - 1) * c - sq) / a0,
                   -2 * ((A - 1) + (A + 1) * c) / a0, ((A + 1) + (A - 1) * c - sq) / a0);
    }

    public static BiquadCoeffs HighShelf(double hz, double gainDb, double q, double fs)
    {
        if (Math.Abs(gainDb) < 1e-4) return Identity;
        var (_, c, s) = W(hz, fs);
        double A = Math.Pow(10, gainDb / 40), alpha = s / (2 * Math.Max(q, 0.05)), sq = 2 * Math.Sqrt(A) * alpha;
        double a0 = (A + 1) - (A - 1) * c + sq;
        return new(A * ((A + 1) + (A - 1) * c + sq) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - sq) / a0,
                   2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - sq) / a0);
    }

    /// <summary>Magnitude in dB at <paramref name="hz"/>.</summary>
    public double MagnitudeDb(double hz, double fs)
    {
        double w = 2 * Math.PI * hz / fs, c1 = Math.Cos(w), s1 = Math.Sin(w), c2 = Math.Cos(2 * w), s2 = Math.Sin(2 * w);
        double nr = B0 + B1 * c1 + B2 * c2, ni = -(B1 * s1 + B2 * s2);
        double dr = 1 + A1 * c1 + A2 * c2, di = -(A1 * s1 + A2 * s2);
        return 10 * Math.Log10((nr * nr + ni * ni) / (dr * dr + di * di));
    }
}
