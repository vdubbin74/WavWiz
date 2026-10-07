namespace WavWiz.Measure;

/// <summary>
/// The calibration test signal (spec 8.1): 8 log chirps (50 ms, 700 Hz - 7 kHz so they survive Bluetooth codecs and phone mics) at
/// irregular offsets, so one detection can never be off by a whole beat. Level -20 dBFS. Chirps survive AGC/noise suppression far
/// better than single clicks, and detection uses the cross-correlation peak, never the level.
/// </summary>
public sealed class ChirpPattern
{
    public const int SampleRate = 48000;
    public static readonly double[] OffsetsMs = { 0, 450, 1000, 1350, 2050, 2400, 3150, 3500 };
    public const double ChirpMs = 50, F0 = 700, F1 = 7000;

    public float[] Chirp { get; }
    public float[] Signal { get; }
    public int[] OffsetSamples { get; }
    public double LengthMs => OffsetsMs[^1] + ChirpMs;

    public ChirpPattern(double levelDb = -20)
    {
        int n = (int)(ChirpMs * SampleRate / 1000);
        Chirp = new float[n];
        double T = ChirpMs / 1000.0, k = Math.Log(F1 / F0) / T, amp = Math.Pow(10, levelDb / 20);
        for (int i = 0; i < n; i++)
        {
            double t = (double)i / SampleRate;
            double phase = 2 * Math.PI * F0 * (Math.Exp(k * t) - 1) / k;
            double w = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (n - 1));    // Hann edges: no click
            Chirp[i] = (float)(amp * w * Math.Sin(phase));
        }
        OffsetSamples = OffsetsMs.Select(ms => (int)Math.Round(ms * SampleRate / 1000)).ToArray();
        Signal = new float[OffsetSamples[^1] + n];
        foreach (var o in OffsetSamples) for (int i = 0; i < n; i++) Signal[o + i] += Chirp[i];
    }
}
