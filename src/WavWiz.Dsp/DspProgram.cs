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
        bool eq = !Preset.Bypass && !Preset.Direct;    // bypass = EQ, bass/treble, loudness off; trim + limiter stay (spec 11.3). 0.7.3: Direct = all off
        for (int i = 0; i < 10; i++)
            Filters[i] = eq ? BiquadCoeffs.Peaking(DspPreset.BandHz[i], Preset.GraphicDb[i], DspPreset.BandQ, fs) : BiquadCoeffs.Identity;
        Filters[10] = eq ? BiquadCoeffs.LowShelf(Preset.Bass.Hz, Preset.Bass.GainDb, 0.707, fs) : BiquadCoeffs.Identity;
        Filters[11] = eq ? BiquadCoeffs.HighShelf(Preset.Treble.Hz, Preset.Treble.GainDb, 0.707, fs) : BiquadCoeffs.Identity;
        var (lb, lt) = eq && Preset.Loudness.Enabled ? LoudnessGains(volumePercent, Preset.Loudness.RefVolume) : (0.0, 0.0);
        Filters[12] = BiquadCoeffs.LowShelf(100, lb, 0.707, fs);
        Filters[13] = BiquadCoeffs.HighShelf(10000, lt, 0.707, fs);
        for (int i = 0; i < FilterCount; i++) Active[i] = !Filters[i].IsIdentity;

        // 0.7.3: Auto pre-gain only takes back part of the boost. Until 0.7.2 it subtracted the WHOLE peak of every stage summed from 20 Hz
        // to 20 kHz, so Bass +12 (a shelf stays +12 down to 20 Hz) turned the whole track down 12 dB and Bass Boost ~9 dB, and Loudness
        // cancelled itself. Now: the user's EQ + Bass/Treble only (not the loudness shelves), scanned 40 Hz..12 kHz, half the peak, at most 6 dB.
        // The rest is headroom the peak limiter after the volume catches (the browser path has its soft clip guard, roomeq.js).
        double auto = 0;
        if (eq && Preset.AutoPreamp) auto = -AutoCutDb(UserPeakDb());
        PreGainDb = Preset.Direct ? 0 : Preset.TrimDb + (eq ? Preset.PreampDb : 0) + auto;   // 0.7.3: Direct has no trim either
        PreGain = Math.Pow(10, PreGainDb / 20);
    }

    /// <summary>0.7.3: the range Auto pre-gain looks at (Hz) and the most it ever turns down (dB).</summary>
    public const double AutoScanLoHz = 40, AutoScanHiHz = 12000, AutoMaxCutDb = 6;
    /// <summary>0.7.3: Auto pre-gain cut (dB, positive = turn down) for a peak boost: half of it, never more than <see cref="AutoMaxCutDb"/>.</summary>
    public static double AutoCutDb(double peakDb) => double.IsFinite(peakDb) ? Math.Min(AutoMaxCutDb, 0.5 * Math.Max(0, peakDb)) : 0;

    /// <summary>0.7.3: highest boost of the user's EQ + Bass/Treble (filters 0..11, not the loudness shelves) between 40 Hz and 12 kHz.</summary>
    public double UserPeakDb()
    {
        double max = 0;
        for (double f = AutoScanLoHz; ; f *= 1.06)
        {
            double hz = Math.Min(f, AutoScanHiHz), db = 0;
            for (int i = 0; i < 12; i++) if (Active[i]) db += Filters[i].MagnitudeDb(hz, SampleRate);
            max = Math.Max(max, db);
            if (hz >= AutoScanHiHz) break;
        }
        return max;
    }

    /// <summary>Loudness: 0 dB at/above the reference volume, rising linearly to +10 dB bass (+3 dB treble) at volume 0 (D15: one fixed curve).</summary>
    public static (double BassDb, double TrebleDb) LoudnessGains(double volumePercent, double refVolume)
    {
        double k = Math.Clamp((refVolume - volumePercent) / Math.Max(refVolume, 1), 0, 1);
        return (10 * k, 3 * k);
    }

    /// <summary>Combined magnitude (dB) of all the EQ stages (loudness included) at a frequency, same code as the audio path.</summary>
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
