namespace WavWiz.Core.Playback;

/// <summary>The "Test sound" for a device: a short, pleasant two-note chime (mono, 48 kHz) so the person can tell WHICH speaker it is and that it works. Not a calibration signal.</summary>
public static class TestTone
{
    public const int Rate = 48000;
    public static float[] Generate(double levelDb = -18)
    {
        double amp = Math.Pow(10, Math.Clamp(levelDb, -40, -6) / 20);
        var notes = new (double Hz, double StartS, double LenS)[] { (659.26, 0.0, 0.55), (880.0, 0.45, 0.8) };
        int total = (int)(1.3 * Rate); var x = new float[total];
        foreach (var (hz, st, len) in notes)
        {
            int a = (int)(st * Rate), n = (int)(len * Rate);
            for (int i = 0; i < n && a + i < total; i++)
            {
                double t = (double)i / Rate, env = Math.Min(1, i / (0.01 * Rate)) * Math.Exp(-3.2 * t / len * 1.6) * Math.Min(1, (n - i) / (0.03 * Rate));
                x[a + i] += (float)(amp * env * (Math.Sin(2 * Math.PI * hz * t) + 0.25 * Math.Sin(4 * Math.PI * hz * t)) / 1.25);
            }
        }
        return x;
    }
}
