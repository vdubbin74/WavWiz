using WavWiz.Core.Playback;

namespace WavWiz.Dsp;

/// <summary>
/// The per-speaker chain (spec 5.2 step 5, 11.2): trim/preamp -> graphic EQ -> bass/treble -> loudness -> zone volume -> limiter.
/// Latency-neutral (IIR only, zero lookahead): <see cref="LatencyUs"/> is always 0 until a latency-bearing block exists (spec 11.6).
/// Control methods may be called from any thread; <see cref="Process"/> runs on the audio thread and never allocates or locks.
/// </summary>
public sealed class DspChain : IAudioProcessor
{
    public const int MaxBlock = 4096;
    private readonly int _fs;
    private volatile DspProgram _pending;
    private DspProgram _cur, _old = null!;
    private int _fadeLeft, _fadeTotal;
    private readonly float[] _scratch = new float[MaxBlock * 2];

    // control state (volatile reads on the audio thread)
    private DspPreset _preset = DspPreset.Flat;
    private double _volumePercent = 100;
    private volatile bool _muted;
    private double _gainTarget = 1, _gainNow = 1;

    // limiter state
    private double _limGain = 1;
    public double LimiterReductionDb { get; private set; }          // current
    public double MaxLimiterReductionDb { get; private set; }
    public int ClipCount { get; private set; }                       // input samples above 0 dBFS (before the limiter)
    public int NonFiniteResets { get; private set; }
    public bool LimiterActive => LimiterReductionDb > 0.05;

    public DspChain(int sampleRate = 48000)
    {
        _fs = sampleRate;
        _cur = new DspProgram(DspPreset.Flat, sampleRate, 100);
        _pending = _cur;
    }

    public long LatencyUs => 0;
    public DspPreset Preset => _preset;
    public double VolumePercent => _volumePercent;

    /// <summary>Apply a preset (builds coefficients here, off the audio thread).</summary>
    public void SetPreset(DspPreset p)
    {
        _preset = p.Normalize();
        _pending = new DspProgram(_preset, _fs, _volumePercent);
    }

    public void SetBypass(bool on) => SetPreset(_preset with { Bypass = on });

    /// <summary>Zone volume 0..100 (log taper). Rebuilds coefficients only when loudness is on.</summary>
    public void SetVolume(double percent)
    {
        _volumePercent = Math.Clamp(double.IsFinite(percent) ? percent : 0, 0, 100);
        _gainTarget = _muted ? 0 : VolumeToGain(_volumePercent);
        if (_preset.Loudness.Enabled && !_preset.Bypass) _pending = new DspProgram(_preset, _fs, _volumePercent);
    }

    public void SetMuted(bool muted) { _muted = muted; _gainTarget = muted ? 0 : VolumeToGain(_volumePercent); }

    /// <summary>Log taper: 100 = 0 dB, each 10 points = 5 dB down, 0 = silence.</summary>
    public static double VolumeToGain(double percent) => percent <= 0 ? 0 : Math.Pow(10, -(100 - percent) * 0.5 / 20);

    public DspProgram CurrentProgram => _cur;

    public void Process(Span<float> interleavedStereo, int frames)
    {
        int done = 0;
        while (done < frames)
        {
            int n = Math.Min(frames - done, MaxBlock);
            ProcessBlock(interleavedStereo.Slice(done * 2, n * 2), n);
            done += n;
        }
    }

    private void ProcessBlock(Span<float> buf, int n)
    {
        var pend = _pending;
        if (!ReferenceEquals(pend, _cur))
        {
            // pick up the new program at a block boundary: carry the filter state over, crossfade old -> new over ~20 ms
            pend.CopyStateFrom(_cur);
            _old = _cur; _cur = pend;
            _fadeTotal = _fadeLeft = Math.Max(n, _fs / 50);
        }
        var cur = _cur;
        // count clipping on the raw input (before any gain)
        for (int i = 0; i < n * 2; i++) if (buf[i] > 1f || buf[i] < -1f) ClipCount++;

        if (_fadeLeft > 0 && _old != null)
        {
            buf[..(n * 2)].CopyTo(_scratch);
            _old.Process(_scratch.AsSpan(0, n * 2), n);
            if (!cur.Process(buf, n)) NonFiniteResets++;
            for (int i = 0; i < n; i++)
            {
                float w = _fadeLeft > 0 ? 1f - (float)_fadeLeft / _fadeTotal : 1f;
                if (_fadeLeft > 0) _fadeLeft--;
                buf[i * 2] = _scratch[i * 2] * (1 - w) + buf[i * 2] * w;
                buf[i * 2 + 1] = _scratch[i * 2 + 1] * (1 - w) + buf[i * 2 + 1] * w;
            }
            if (_fadeLeft == 0) _old = null!;
        }
        else if (!cur.Process(buf, n)) NonFiniteResets++;

        // zone volume: ramp linearly across the block (no zipper noise)
        double g0 = _gainNow, g1 = _gainTarget;
        if (g0 != g1 || g1 != 1)
        {
            for (int i = 0; i < n; i++)
            {
                float g = (float)(g0 + (g1 - g0) * (i + 1) / n);
                buf[i * 2] *= g; buf[i * 2 + 1] *= g;
            }
        }
        _gainNow = g1;
        Limit(buf, n, cur.Preset.Limiter);
    }

    /// <summary>Zero-lookahead peak limiter: instant attack, smooth release (50..200 ms). Adds no latency.</summary>
    private void Limit(Span<float> buf, int n, LimiterSettings s)
    {
        double ceil = Math.Pow(10, s.CeilingDb / 20);
        double rel = Math.Exp(-1.0 / (s.ReleaseMs * 0.001 * _fs));
        double maxRed = 0;
        for (int i = 0; i < n; i++)
        {
            double l = buf[i * 2], r = buf[i * 2 + 1];
            double peak = Math.Max(Math.Abs(l), Math.Abs(r));
            double need = s.Enabled && peak > ceil ? ceil / peak : 1;
            if (need < _limGain) _limGain = need; else _limGain = 1 - (1 - _limGain) * rel;
            double ol = l * _limGain, orr = r * _limGain;
            // final safety: nothing may pass the ceiling (or the NaN guard) even with limiting disabled
            double hard = s.Enabled ? ceil : 1.0;
            if (ol > hard) ol = hard; else if (ol < -hard) ol = -hard;
            if (orr > hard) orr = hard; else if (orr < -hard) orr = -hard;
            buf[i * 2] = (float)ol; buf[i * 2 + 1] = (float)orr;
            if (_limGain < 0.9999) { double red = -20 * Math.Log10(_limGain); if (red > maxRed) maxRed = red; }
        }
        LimiterReductionDb = maxRed;
        if (maxRed > MaxLimiterReductionDb) MaxLimiterReductionDb = maxRed;
    }

    /// <summary>Magnitude response of a preset for the EQ graph (same code path as the player).</summary>
    public static double[] Response(DspPreset p, int sampleRate, double[] hz)
    {
        var prog = new DspProgram(p, sampleRate, 100);
        return hz.Select(prog.TotalResponseDb).ToArray();
    }
}
