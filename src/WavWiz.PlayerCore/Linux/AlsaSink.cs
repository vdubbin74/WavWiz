using WavWiz.Core.Clock;
namespace WavWiz.PlayerCore.Linux;

/// <summary>
/// 0.7.0 Linux/Pi local output through alsa-lib: blocking interleaved writes of 10 ms periods, S32_LE stereo at <see cref="MixRate"/> (48 kHz)
/// with soft-resample allowed, so the "plughw:" / "default" plug layer converts to whatever the jack, HDMI or USB DAC really runs at
/// (16-bit, 44.1/96 kHz, more channels). The render callback gets the DAC time of each period's first frame = now + snd_pcm_delay()
/// (the documented write-to-audible latency), the same contract WASAPI uses, so zone volume, per-speaker delay and sync work unchanged
/// (they live in PlayerClient / PlaybackEngine). Underruns (-EPIPE) and suspend (-ESTRPIPE) recover with snd_pcm_recover; anything
/// else (a USB DAC unplugged = -ENODEV) raises <see cref="Faulted"/>.
/// PCMs that never block (the ALSA "null" and "file" plugins used by tests) are paced by the wall clock instead.
/// </summary>
public sealed class AlsaSink : IAudioSink
{
    private readonly IntPtr _pcm; private readonly SinkRender _render; private readonly IMonotonicClock _clock; private readonly Thread _t; private volatile bool _stop;
    private readonly int _period; private readonly int _bufferFrames;
    public string DeviceName { get; }
    public int MixRate { get; }
    public double ReportedLatencyMs { get; }
    public event Action<string>? Faulted;
    public long Periods, Underruns, FramesWritten;
    public bool WallPaced { get; private set; }
    /// <summary>libasound.so.2 can be loaded on this machine.</summary>
    public static bool LibraryAvailable => AlsaNative.Available;

    public AlsaSink(string deviceName, SinkRender render, IMonotonicClock clock, int rate = 48000, int latencyUs = 100_000)
    {
        if (!AlsaNative.Available) throw new PlatformNotSupportedException("ALSA (libasound.so.2) is not installed. On Raspberry Pi OS / Debian: sudo apt install libasound2t64 (or libasound2).");
        DeviceName = deviceName; _render = render; _clock = clock; MixRate = rate;
        int r = AlsaNative.snd_pcm_open(out _pcm, deviceName, AlsaNative.StreamPlayback, 0);
        if (r < 0) throw new InvalidOperationException($"ALSA could not open \"{deviceName}\": {AlsaNative.Error(r)}" + (r == -AlsaNative.EBUSY ? " (another program is using it)" : r == -13 ? " (permission denied: the WavWiz user must be in the 'audio' group)" : ""));
        r = AlsaNative.snd_pcm_set_params(_pcm, AlsaNative.FormatS32Le, AlsaNative.AccessRwInterleaved, 2, (uint)rate, 1, (uint)latencyUs);
        if (r < 0) { AlsaNative.snd_pcm_close(_pcm); throw new InvalidOperationException($"ALSA \"{deviceName}\" refused 2-channel {rate} Hz: {AlsaNative.Error(r)}"); }
        _bufferFrames = AlsaNative.snd_pcm_get_params(_pcm, out var buf, out var per) >= 0 && buf > 0 ? (int)buf : rate * latencyUs / 1_000_000;
        _period = Math.Clamp(per > 0 ? (int)per : rate / 100, rate / 200, rate / 25);
        ReportedLatencyMs = _bufferFrames * 1000.0 / rate;
        _t = new Thread(Loop) { IsBackground = true, Name = "wavwiz-alsa", Priority = ThreadPriority.Highest };
    }

    public void Start() => _t.Start();

    /// <summary>DAC time of the next frame written. Device-clocked (running, delay &gt; 0): now + delay. Otherwise (prepared/never-blocking plugins):
    /// the wall-clock schedule t0 + frames/rate.</summary>
    public static long DacTime(long nowUs, bool deviceClocked, long delayFrames, long t0Us, long written, int rate)
        => deviceClocked ? nowUs + delayFrames * 1_000_000L / rate : Math.Max(nowUs, t0Us + written * 1_000_000L / rate);

    private unsafe void Loop()
    {
        var f = new float[_period * 2]; var pcm = new int[_period * 2];
        long t0 = _clock.NowUs;
        try
        {
            while (!_stop)
            {
                int st = AlsaNative.snd_pcm_state(_pcm);
                if (st == AlsaNative.StateDisconnected) { Faulted?.Invoke("ALSA device disconnected"); return; }
                long delay = 0; bool clocked = false;
                if (AlsaNative.snd_pcm_delay(_pcm, out var d) >= 0) { delay = d; clocked = st == AlsaNative.StateRunning && d > 0; }
                long now = _clock.NowUs;
                if (!clocked)
                {
                    // never-blocking PCM (or not started yet): keep at most one buffer ahead of the wall clock
                    long ahead = t0 + FramesWritten * 1_000_000L / MixRate - now - (long)_bufferFrames * 1_000_000L / MixRate;
                    if (ahead > 2000 && st != AlsaNative.StateRunning && FramesWritten > _bufferFrames) { WallPaced = true; Thread.Sleep((int)Math.Min(ahead / 1000, 50)); continue; }
                }
                else if (WallPaced) WallPaced = false;
                if (clocked) t0 = now + delay * 1_000_000L / MixRate - FramesWritten * 1_000_000L / MixRate;   // keep the fallback schedule glued to the device clock
                long dac = DacTime(now, clocked, delay, t0, FramesWritten, MixRate);
                int got = _render(f, _period, dac);
                if (got < _period) f.AsSpan(got * 2).Clear();
                for (int i = 0; i < f.Length; i++) { float x = f[i]; pcm[i] = x >= 1f ? int.MaxValue : x <= -1f ? int.MinValue : (int)(x * 2147483647.0); }
                int off = 0;
                while (off < _period && !_stop)
                {
                    nint w;
                    fixed (int* p = &pcm[off * 2]) w = AlsaNative.snd_pcm_writei(_pcm, p, (nuint)(_period - off));
                    if (w >= 0) { off += (int)w; FramesWritten += w; continue; }
                    int e = (int)w;
                    if (e == -AlsaNative.EAGAIN) { Thread.Sleep(2); continue; }
                    if (e == -AlsaNative.EPIPE) Underruns++;
                    if (AlsaNative.snd_pcm_recover(_pcm, e, 1) < 0) { Faulted?.Invoke($"ALSA write failed: {AlsaNative.Error(e)}"); return; }
                    if (e == -AlsaNative.EPIPE || e == -AlsaNative.ESTRPIPE) { t0 = _clock.NowUs - FramesWritten * 1_000_000L / MixRate; break; }   // re-anchor after an xrun; this period is dropped
                }
                Periods++;
            }
        }
        catch (Exception e) when (!_stop) { Faulted?.Invoke(e.GetType().Name + ": " + e.Message); }
    }

    public void Dispose()
    {
        _stop = true;
        try { if (_t.IsAlive) _t.Join(1000); } catch { }
        try { AlsaNative.snd_pcm_drop(_pcm); } catch { }
        try { AlsaNative.snd_pcm_close(_pcm); } catch { }
    }
}
