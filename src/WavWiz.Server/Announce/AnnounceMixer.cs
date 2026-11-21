using WavWiz.Core.Stream;
using WavWiz.Dsp;

namespace WavWiz.Server.Announce;

/// <summary>
/// 0.7.2 Announce: mixes a live voice over a zone's stream. The music is turned DOWN (ducked, -12 dB by default) - never paused, stopped or
/// skipped - an optional chime plays first, then the voice; when the talker lets go and the voice has played out, the music fades back up.
/// One mixer per zone (playback group). Voice comes in as 48 kHz mono float from any thread (<see cref="Push"/>); <see cref="Mix"/> runs on the
/// group's pump thread at production time. A 96 kHz epoch gets the same voice, each sample held for two output samples (speech needs no more).
/// </summary>
public sealed class AnnounceMixer : IFrameMixer
{
    public const int VoiceRate = 48000;
    public const double DefaultDuckDb = -12;
    public const int DuckDownMs = 200, FadeBackMs = 1000, TailMs = 250, PrebufferMs = 120;
    /// <summary>Anything longer is cut (a stuck button or a page that never said "done").</summary>
    public const int MaxVoiceSeconds = 120;

    private readonly object _l = new();
    private readonly Queue<float[]> _chunks = new(); private float[]? _cur; private int _curPos; private int _queued;
    private bool _ended, _started, _done; private int _tailLeft = -1;
    private double _gain = 1; private readonly double _duck; private long _pushed;
    private PeakLimiter? _lim; private int _limRate;
    private float _hold; private int _holdLeft;

    public double DuckGain => _duck;
    public bool Done { get { lock (_l) return _done; } }
    /// <summary>The music gain now (1 = full, <see cref="DuckGain"/> = ducked) - tests and the UI meter.</summary>
    public double MusicGain { get { lock (_l) return _gain; } }
    public bool Ended { get { lock (_l) return _ended; } }
    /// <summary>Voice samples waiting to be mixed (chime included).</summary>
    public int Queued { get { lock (_l) return _queued + (_cur == null ? 0 : _cur.Length - _curPos); } }

    public AnnounceMixer(bool chime = true, double duckDb = DefaultDuckDb)
    {
        _duck = Math.Pow(10, Math.Clamp(duckDb, -40, 0) / 20);
        if (chime) { var c = Chime(VoiceRate); _chunks.Enqueue(c); _queued += c.Length; }
    }

    /// <summary>Voice from the talker (48 kHz mono, -1..1). Ignored after <see cref="End"/> or past <see cref="MaxVoiceSeconds"/>.</summary>
    public void Push(ReadOnlySpan<float> mono)
    {
        if (mono.Length == 0) return;
        lock (_l)
        {
            if (_ended) return;
            if (_pushed + mono.Length > (long)MaxVoiceSeconds * VoiceRate) { _ended = true; return; }
            _pushed += mono.Length; _chunks.Enqueue(mono.ToArray()); _queued += mono.Length;
        }
    }

    /// <summary>The talker let go (or left): play out what is queued, then fade the music back.</summary>
    public void End() { lock (_l) _ended = true; }

    public void Mix(Span<float> buf, int frames, int rate)
    {
        lock (_l)
        {
            if (_done) return;
            int hold = Math.Max(1, rate / VoiceRate);
            double down = (1 - _duck) / (DuckDownMs * 0.001 * rate), up = (1 - _duck) / (FadeBackMs * 0.001 * rate);
            // the voice starts once a little is buffered (no stutter at the start), or right away for the chime / a short last bit
            if (!_started && (Queued >= PrebufferMs * VoiceRate / 1000 || _ended || _chunks.Count > 0 && _pushed == 0)) _started = true;
            for (int i = 0; i < frames; i++)
            {
                float v = 0; bool have = false;
                if (_started)
                {
                    if (_holdLeft > 0) { v = _hold; _holdLeft--; have = true; }
                    else if (NextVoice(out var s)) { _hold = s; _holdLeft = hold - 1; v = s; have = true; }
                }
                bool releasing = _ended && !have && _holdLeft == 0 && _cur == null && _chunks.Count == 0;
                if (releasing && _tailLeft < 0) _tailLeft = TailMs * rate / 1000;
                if (releasing && _tailLeft > 0) _tailLeft--;
                if (releasing && _tailLeft == 0) _gain = Math.Min(1, _gain + up);
                else _gain = Math.Max(_duck, _gain - down);
                buf[i * 2] = (float)(buf[i * 2] * _gain + v); buf[i * 2 + 1] = (float)(buf[i * 2 + 1] * _gain + v);
            }
            if (_lim == null || _limRate != rate) { _lim = new PeakLimiter(rate); _limRate = rate; }
            _lim.Process(buf, frames, LimiterDefaults);
            if (_tailLeft == 0 && _gain >= 1) _done = true;
        }
    }
    private static readonly LimiterSettings LimiterDefaults = new();

    private bool NextVoice(out float s)
    {
        while (_cur == null || _curPos >= _cur.Length)
        {
            if (_chunks.Count == 0) { _cur = null; s = 0; return false; }
            _cur = _chunks.Dequeue(); _queued -= _cur.Length; _curPos = 0;
        }
        s = _cur[_curPos++]; return true;
    }

    /// <summary>The "ding-dong" before an announcement: two soft bell tones (G5 then E5) with a quick attack and an exponential decay, ~0.9 s, peak about -10 dBFS.</summary>
    public static float[] Chime(int rate = VoiceRate)
    {
        int n1 = rate * 38 / 100, n2 = rate * 55 / 100; var o = new float[n1 + n2];
        void Tone(int at, int len, double f, double tau)
        {
            for (int i = 0; i < len; i++)
            {
                double t = (double)i / rate, env = Math.Min(1, t / 0.006) * Math.Exp(-t / tau);
                double x = Math.Sin(2 * Math.PI * f * t) + 0.28 * Math.Sin(2 * Math.PI * 2 * f * t) + 0.08 * Math.Sin(2 * Math.PI * 3 * f * t);
                o[at + i] += (float)(0.3 * env * x / 1.36);
            }
        }
        Tone(0, n1, 783.99, 0.16); Tone(n1, n2, 659.25, 0.22);
        return o;
    }

    /// <summary>16-bit little-endian PCM (what the page sends) to float, resampled to 48 kHz from <paramref name="rate"/> (linear; speech only).</summary>
    public static float[] FromPcm16(ReadOnlySpan<byte> pcm, int rate)
    {
        int n = pcm.Length / 2; var x = new float[n];
        for (int i = 0; i < n; i++) x[i] = (short)(pcm[i * 2] | pcm[i * 2 + 1] << 8) / 32768f;
        return Resample(x, rate);
    }
    public static float[] Resample(float[] x, int rate)
    {
        if (rate == VoiceRate || rate <= 0 || x.Length == 0) return x;
        int m = (int)((long)x.Length * VoiceRate / rate); var y = new float[m]; double step = (double)rate / VoiceRate;
        for (int i = 0; i < m; i++) { double p = i * step; int a = (int)p; double f = p - a; float b = a + 1 < x.Length ? x[a + 1] : x[a]; y[i] = (float)(x[a] * (1 - f) + b * f); }
        return y;
    }
}
