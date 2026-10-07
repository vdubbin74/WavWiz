namespace WavWiz.Dsp;

public sealed record ShelfSettings(double GainDb = 0, double Hz = 100);
public sealed record LoudnessSettings(bool Enabled = false, double RefVolume = 80);   // off by default, one slider (D15)
public sealed record LimiterSettings(bool Enabled = true, double CeilingDb = -0.3, double ReleaseMs = 120, double LookaheadMs = 0);

/// <summary>Per-speaker DSP preset (spec 11.3, 11.7). Global across PCs (D14). Loudness is OFF unless the user turns it on (D15).</summary>
public sealed record DspPreset
{
    public static readonly double[] BandHz = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
    public const double BandQ = 1.4;

    public string Name { get; init; } = "Flat";
    public int SchemaVersion { get; init; } = 1;
    public int Revision { get; init; } = 1;
    public double TrimDb { get; init; }
    public double PreampDb { get; init; }
    public bool AutoPreamp { get; init; } = true;
    public bool Bypass { get; init; }
    public double[] GraphicDb { get; init; } = new double[10];
    public ShelfSettings Bass { get; init; } = new(0, 100);
    public ShelfSettings Treble { get; init; } = new(0, 10000);
    public LoudnessSettings Loudness { get; init; } = new();
    public LimiterSettings Limiter { get; init; } = new();

    public static DspPreset Flat => new();

    /// <summary>Clamp everything to legal ranges (spec 11.5 numerical safety): +-12 dB bands, trim -24..+6, Q fixed, shelves +-12.</summary>
    public DspPreset Normalize()
    {
        var g = new double[10];
        for (int i = 0; i < 10; i++) g[i] = i < GraphicDb.Length ? Clamp(Fix(GraphicDb[i]), -12, 12) : 0;
        return this with
        {
            TrimDb = Clamp(Fix(TrimDb), -24, 6),
            PreampDb = Clamp(Fix(PreampDb), -24, 12),
            GraphicDb = g,
            Bass = new ShelfSettings(Clamp(Fix(Bass.GainDb), -12, 12), Clamp(Fix(Bass.Hz), 40, 400)),
            Treble = new ShelfSettings(Clamp(Fix(Treble.GainDb), -12, 12), Clamp(Fix(Treble.Hz), 3000, 16000)),
            Loudness = new LoudnessSettings(Loudness.Enabled, Clamp(Fix(Loudness.RefVolume), 10, 100)),
            Limiter = new LimiterSettings(Limiter.Enabled, Clamp(Fix(Limiter.CeilingDb), -12, 0), Clamp(Fix(Limiter.ReleaseMs), 50, 200), 0),
        };
    }

    private static double Fix(double v) => double.IsFinite(v) ? v : 0;
    private static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;
}
