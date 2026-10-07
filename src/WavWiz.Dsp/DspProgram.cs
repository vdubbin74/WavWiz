namespace WavWiz.Dsp;

/// <summary>
/// Immutable-ish "DSP program" (spec 11.5): the coefficients for one preset at one sample rate. Built OFF the audio thread; the audio
/// thread swaps it in with one reference write. Only the filter state arrays are mutated, and only by the audio thread.
/// </summary>
public sealed class DspProgram
{
    public const int FilterCount = 14; // 10 graphic + bass + treble + 2 loudness shelves (flat ones are skipped)
    public readonly double PreGain;                   // trim + preamp (+ auto-preamp), linear
    public readonly double PreGainDb;
    public readonly BiquadCoeffs[] Filters = new BiquadCoeffs[FilterCount];
    public readonly bool[] Active = new bool[FilterCount];
    public readonly double[] Z1 = new double[FilterCount * 2];
    public readonly double[] Z2 = new double[FilterCount * 2];
    public readonly DspPreset Preset;
    public readonly int SampleRate;

    public DspProgram(DspPreset preset, int sampleRate, double volumePercent)
    {
        Preset = preset.Normalize(); SampleRate = sampleRate;
        double fs = sampleRate;
        bool eq = !Preset.Bypass;                      // bypass = EQ, bass/treble, loudness off; trim + limiter stay (spec 11.3)
        for (int i = 0; i < 10; i++)
            Filters[i] = eq ? BiquadCoeffs.Peaking(DspPreset.BandHz[i], Preset.GraphicDb[i], DspPreset.BandQ, fs) : BiquadCoeffs.Identity;
        Filters[10] = eq ? BiquadCoeffs.LowShelf(Preset.Bass.Hz, Preset.Bass.GainDb, 0.707, fs) : BiquadCoeffs.Identity;
        Filters[11] = eq ? BiquadCoeffs.HighShelf(Preset.Treble.Hz, Preset.Treble.GainDb, 0.707, fs) : BiquadCoeffs.Identity;
        var (lb, lt) = eq && Preset.Loudness.Enabled ? LoudnessGains(volumePercent, Preset.Loudness.RefVolume) : (0.0, 0.0);
        Filters[12] = BiquadCoeffs.LowShelf(100, lb, 0.707, fs);
        Filters[13] = BiquadCoeffs.HighShelf(10000, lt, 0.707, fs);
        for (int i = 0; i < FilterCount; i++) Active[i] = !Filters[i].IsIdentity;

        double auto = 0;
        if (eq && Preset.AutoPreamp)
        {
            double max = 0;
            for (double f = 20; f <= 20000; f *= 1.06) max = Math.Max(max, ResponseDb(f));
            auto = -Math.Max(0, max);
        }
        PreGainDb = Preset.TrimDb + (eq ? Preset.PreampDb : 0) + auto;
        PreGain = Math.Pow(10, PreGainDb / 20);
    }

    /// <summary>Loudness: 0 dB at/above the reference volume, rising linearly to +10 dB bass (+3 dB treble) at volume 0 (D15: one fixed curve).</summary>
    public static (double BassDb, double TrebleDb) LoudnessGains(double volumePercent, double refVolume)
    {
        double k = Math.Clamp((refVolume - volumePercent) / Math.Max(refVolume, 1), 0, 1);
        return (10 * k, 3 * k);
    }

    /// <summary>Combined magnitude (dB) of the EQ stages at a frequency (graph + auto-preamp), same code as the audio path.</summary>
    public double ResponseDb(double hz)
    {
        double db = 0;
        for (int i = 0; i < FilterCount; i++) if (Active[i]) db += Filters[i].MagnitudeDb(hz, SampleRate);
        return db;
    }

    /// <summary>Total response incl. trim/preamp (what a sine sweep through the chain at unity volume would show).</summary>
    public double TotalResponseDb(double hz) => ResponseDb(hz) + PreGainDb;

    public void CopyStateFrom(DspProgram o)
    {
        Array.Copy(o.Z1, Z1, Z1.Length); Array.Copy(o.Z2, Z2, Z2.Length);
    }

    /// <summary>In place, stereo interleaved. Allocation-free. Returns false if a NaN/Inf appeared (state is reset).</summary>
    public bool Process(Span<float> buf, int frames)
    {
        bool ok = true;
        double g = PreGain;
        for (int n = 0; n < frames; n++)
        {
            for (int ch = 0; ch < 2; ch++)
            {
                double x = buf[n * 2 + ch] * g;
                for (int f = 0; f < FilterCount; f++)
                {
                    if (!Active[f]) continue;
                    ref readonly var c = ref Filters[f];
                    int s = f * 2 + ch;
                    double y = c.B0 * x + Z1[s];
                    Z1[s] = c.B1 * x - c.A1 * y + Z2[s];
                    Z2[s] = c.B2 * x - c.A2 * y;
                    x = y;
                }
                if (!double.IsFinite(x)) { ok = false; x = 0; }
                buf[n * 2 + ch] = (float)x;
            }
        }
        if (!ok) { Array.Clear(Z1); Array.Clear(Z2); }
        return ok;
    }
}
