using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;

namespace WavWiz.Core.Playback;

public sealed class EngineOptions
{
    public int OutputRate { get; init; } = 48000;
    /// <summary>Beyond this error a hard resync (fade out, jump, fade in) is done. Spec 7.3 says 50 ms; the +-500 ppm clamp can only
    /// remove ~10 ms in 20 s, so the default is 25 ms.</summary>
    public double HardResyncMs { get; init; } = 25;
    public double MaxRatioPpm { get; init; } = 500;
    /// <summary>Time constant (s) over which the PI controller removes an error.</summary>
    public double SettleSeconds { get; init; } = 8;
    public double FadeMs { get; init; } = 10;
}

/// <summary>
/// The player-side sync engine (spec 5.2, 7.3). Platform independent: the WASAPI sink (or the simulator's virtual sound card)
/// calls <see cref="Render"/> once per period with the local time at which the first rendered frame will reach the DAC.
/// Audio-thread rules: no allocation, no locks, no I/O in <see cref="Render"/>.
/// </summary>
public sealed class PlaybackEngine
{
    private sealed class EpochState
    {
        public EpochState(uint id, long startUs) { Id = id; StartUs = startUs; }
        public readonly uint Id; public readonly long StartUs;
        public readonly JitterBuffer Jitter = new();
        public long StopAtUs = long.MaxValue;
    }

    private sealed class TestSignal { public float[] Mono = Array.Empty<float>(); public long AtUs; }
    private volatile TestSignal? _test;

    private enum Mode { Idle, Playing, FadingOut, Stopped }

    private readonly ClockModel _clock;
    private readonly EngineOptions _o;
    private IAudioProcessor _processor = new PassThroughProcessor();
    private volatile EpochState? _state;
    private long _latencyUs;           // saved device latency offset (spec 7.5), microseconds, may be negative
    private double _baseRatio;         // source samples per output frame at nominal rates
    private int _rate;

    // audio-thread state
    private EpochState? _active;
    private Mode _mode = Mode.Idle;
    private double _pos;               // source-sample position of the next output frame
    private double _integ;             // integral of error (s*s)
    private int _fadeInLeft, _fadeInTotal;
    private int _fadeFrames;
    private float _lastL, _lastR, _holdGain;   // last good sample, decayed to silence while data is missing (no click at an underrun)
    private bool _wasMissing;

    // stats (written by the audio thread, read anywhere)
    public double ErrorMs { get; private set; }
    public double RatioPpm { get; private set; }
    public int Underruns { get; private set; }
    /// <summary>Number of separate times the audio ran out (a 30 s outage is ONE event; <see cref="Underruns"/> counts every affected block).</summary>
    public int UnderrunEvents { get; private set; }
    private bool _prevMissing;
    public int HardResyncs { get; private set; }
    public double BufferMs { get; private set; }
    public bool IsPlaying => _mode == Mode.Playing || _mode == Mode.FadingOut;
    public uint CurrentEpoch => _state?.Id ?? 0;

    /// <summary>For the simulator and the diagnostics view: source position of the first/last frame of the last block, and whether the block
    /// was "clean" (playing normally, no silence, fade or jump), so it can be used for sync measurements.</summary>
    public (double StartPos, double EndPos, bool Clean) LastBlock { get; private set; }

    public PlaybackEngine(ClockModel clock, EngineOptions? options = null)
    {
        _clock = clock; _o = options ?? new EngineOptions();
        SetOutputRate(_o.OutputRate);
    }

    /// <summary>The device's mix rate (44.1/48/96 kHz). Call while the sink is stopped (output switch).</summary>
    public void SetOutputRate(int rate)
    {
        _rate = rate; _baseRatio = (double)Wire.SampleRate / rate;
        _fadeFrames = Math.Max(1, (int)(_o.FadeMs * rate / 1000));
    }
    public int OutputRate => _rate;

    public void SetProcessor(IAudioProcessor p) => Volatile.Write(ref _processor!, p);

    /// <summary>Active output's saved latency offset (ms): the sound of this device comes out this much later than the reference.</summary>
    public void SetDeviceLatencyMs(double ms) => Interlocked.Exchange(ref _latencyUs, (long)Math.Round(ms * 1000));
    public double DeviceLatencyMs => Interlocked.Read(ref _latencyUs) / 1000.0;

    // ---------- network thread ----------
    public void OnEpoch(uint epoch, long startUs)
    {
        var cur = _state;
        if (cur != null && cur.Id == epoch && cur.StartUs == startUs) return;
        _state = new EpochState(epoch, startUs);
    }

    public bool OnAudio(AudioFrame f)
    {
        var st = _state;
        if (st == null || f.Epoch != st.Id) return false; // stale or unknown epoch: drop (spec 6.1)
        long idx = (long)Math.Round((f.PlayAtUs - st.StartUs) * (Wire.SampleRate / 1e6));
        return st.Jitter.Put(idx, f.Samples, f.SampleCount);
    }

    public void OnStopAt(uint epoch, long atUs)
    {
        var st = _state;
        if (st != null && st.Id == epoch) st.StopAtUs = atUs;
    }

    /// <summary>Calibration (spec 8): play a mono 48 kHz pattern so that its first sample reaches the DAC at server time <paramref name="atUs"/>.
    /// The saved device offset is NOT applied (it is being measured); the house stream is muted while the pattern plays.</summary>
    public void PlayTestSignal(float[] mono48k, long atUs) => _test = new TestSignal { Mono = mono48k, AtUs = atUs };
    public void ClearTestSignal() => _test = null;
    public bool TestSignalActive => _test != null;

    /// <summary>Drop everything (reconnect, device change, sleep/resume).</summary>
    public void Flush() { _state = null; }

    // ---------- audio thread ----------
    public int Render(Span<float> dst, int frames, long dacLocalUs)
    {
        var st = _state;
        if (!ReferenceEquals(st, _active)) { _active = st; _mode = st == null ? Mode.Stopped : Mode.Idle; _integ = 0; _fadeInLeft = 0; }
        dst[..(frames * 2)].Clear();
        var ts = _test;
        if (ts != null && _clock.IsValid)
        {
            double t0 = _clock.ToServerUsExact(dacLocalUs);
            bool any = false;
            for (int i = 0; i < frames; i++)
            {
                long idx = (long)Math.Round((t0 + i * 1e6 / _rate - ts.AtUs) * (Wire.SampleRate / 1e6));
                if (idx >= 0 && idx < ts.Mono.Length) { dst[i * 2] = dst[i * 2 + 1] = ts.Mono[idx]; any = true; }
            }
            if (!any && t0 > ts.AtUs + (ts.Mono.Length + Wire.SampleRate) * (1e6 / Wire.SampleRate)) _test = null;
            LastBlock = (0, 0, false);
            if (any || _test != null) { Volatile.Read(ref _processor).Process(dst, frames); return frames; }
        }
        if (st == null || _mode == Mode.Stopped || !_clock.IsValid)
        {
            LastBlock = (0, 0, false);
            return frames;
        }
        var proc = Volatile.Read(ref _processor);
        long latUs = Interlocked.Read(ref _latencyUs) + proc.LatencyUs;
        double serverUs = _clock.ToServerUsExact(dacLocalUs) + latUs;
        double target = (serverUs - st.StartUs) * (Wire.SampleRate / 1e6);   // source-sample index that should be at the DAC
        double stopPos = st.StopAtUs == long.MaxValue ? double.PositiveInfinity : (st.StopAtUs - st.StartUs) * (Wire.SampleRate / 1e6);
        double ratio = _baseRatio;
        int first = 0;
        bool clean = true;

        if (_mode == Mode.Idle)
        {
            double lastTarget = target + (frames - 1) * _baseRatio;
            if (lastTarget < 0) { LastBlock = (0, 0, false); return frames; }   // lead time not over yet
            first = target >= 0 ? 0 : (int)Math.Ceiling(-target / _baseRatio);
            _pos = target + first * _baseRatio;
            _mode = Mode.Playing; _integ = 0;
            _fadeInTotal = _fadeInLeft = _fadeFrames;
            clean = false;
        }
        else if (_mode == Mode.Playing)
        {
            double err = _pos - target;                       // + : playing ahead of where we should be
            ErrorMs = err / (Wire.SampleRate / 1000.0);
            if (Math.Abs(ErrorMs) > _o.HardResyncMs)
            {
                _mode = Mode.FadingOut; HardResyncs++;
            }
            else
            {
                double dt = (double)frames / _rate, eS = err / Wire.SampleRate;
                double tau = _o.SettleSeconds, max = _o.MaxRatioPpm * 1e-6;
                double newInteg = _integ + eS * dt;
                double adj = -(2.0 / tau * eS + newInteg / (tau * tau));
                if (Math.Abs(adj) <= max) _integ = newInteg;  // anti-windup
                else adj = Math.Clamp(adj, -max, max);
                ratio = _baseRatio * (1 + adj);
                RatioPpm = adj * 1e6;
            }
        }
        if (_mode == Mode.FadingOut)
        {
            // keep playing the old position while fading to silence over this block, then jump next block
            clean = false;
        }

        double p = _pos;
        int missing = 0;
        bool fading = _mode == Mode.FadingOut;
        bool stopped = false;
        int fadeOutLen = Math.Max(frames - first, 1);
        for (int i = first; i < frames; i++)
        {
            if (p >= stopPos) { stopped = true; clean = false; break; }
            int before = missing;
            Sample(st.Jitter, p, out float l, out float r, ref missing);
            if (missing != before)
            {
                // data not there (outage, radio stall): decay the last sample to silence over ~10 ms instead of cutting off
                if (!_wasMissing) { _wasMissing = true; _holdGain = 1f; }
                _holdGain *= 0.998f; l = _lastL * _holdGain; r = _lastR * _holdGain;
                clean = false;
            }
            else
            {
                if (_wasMissing) { _wasMissing = false; _fadeInTotal = _fadeInLeft = _fadeFrames; }
                _lastL = l; _lastR = r;
            }
            float g = 1f;
            if (_fadeInLeft > 0) { g = 1f - (float)_fadeInLeft / _fadeInTotal; _fadeInLeft--; }
            if (fading) g *= 1f - (float)(i - first + 1) / fadeOutLen;
            double toStop = stopPos - p;
            if (toStop < _fadeFrames * 2 * _baseRatio) { g *= (float)Math.Max(0, toStop / (_fadeFrames * 2 * _baseRatio)); clean = false; }
            dst[i * 2] = l * g; dst[i * 2 + 1] = r * g;
            p += ratio;
        }
        double startPos = _pos;
        _pos = p;
        if (stopped) { _mode = Mode.Stopped; }
        if (fading)
        {
            // next block starts at the current target, fading in
            _mode = Mode.Playing;
            _pos = target + frames * _baseRatio;   // first frame of the next block should be here
            _integ = 0; _fadeInTotal = _fadeInLeft = _fadeFrames;
        }
        if (missing > 0) { Underruns++; if (!_prevMissing) UnderrunEvents++; _prevMissing = true; clean = false; } else _prevMissing = false;
        BufferMs = Math.Max(0, (st.Jitter.HighWater - _pos) / (Wire.SampleRate / 1000.0));
        LastBlock = (startPos, p, clean && _fadeInLeft == 0);
        proc.Process(dst, frames);
        return frames;
    }

    private static void Sample(JitterBuffer jb, double p, out float l, out float r, ref int missing)
    {
        long i = (long)Math.Floor(p);
        float x = (float)(p - i);
        bool h1 = jb.TryGet(i, out float l1, out float r1);
        bool h2 = jb.TryGet(i + 1, out float l2, out float r2);
        if (!h1 && !h2) { l = r = 0; if (i >= 0) missing++; return; }
        if (!h1) { l1 = l2; r1 = r2; missing++; }
        if (!h2) { l2 = l1; r2 = r1; }
        if (!jb.TryGet(i - 1, out float l0, out float r0)) { l0 = l1; r0 = r1; }
        if (!jb.TryGet(i + 2, out float l3, out float r3)) { l3 = l2; r3 = r2; }
        l = Hermite(l0, l1, l2, l3, x); r = Hermite(r0, r1, r2, r3, x);
    }

    private static float Hermite(float c0, float c1, float c2, float c3, float x)
        => c1 + 0.5f * x * (c2 - c0 + x * (2f * c0 - 5f * c1 + 4f * c2 - c3 + x * (3f * (c1 - c2) + c3 - c0)));
}
