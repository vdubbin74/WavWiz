using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using WavWiz.Core.Clock;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>
/// WASAPI shared-mode, event-driven render (spec 9.2/9.3). The render callback is given the DAC time of the first frame of each period
/// (now + queued frames + driver stream latency); the PlaybackEngine uses it to line the audio up with the house timeline.
/// UNVERIFIED ON WINDOWS: written against the NAudio API and compiled on Linux only. First things to check on a real PC: the DAC-time formula,
/// multichannel (HDMI 5.1/7.1) mix formats, and device-removal handling.
/// </summary>
public sealed class WasapiSink : IAudioSink
{
    private readonly MMDevice _dev; private readonly AudioClient _client; private readonly SinkRender _render; private readonly IMonotonicClock _clock;
    private readonly EventWaitHandle _event = new(false, EventResetMode.AutoReset); private readonly Thread _thread; private volatile bool _stop;
    private AudioRenderClient _rc = null!; private readonly int _channels; private readonly int _bufferFrames; private readonly bool _float; private readonly int _bits;
    public int MixRate { get; }
    public double ReportedLatencyMs { get; private set; }
    public event Action<string>? Faulted;

    public WasapiSink(string endpointId, SinkRender render, IMonotonicClock clock)
    {
        _render = render; _clock = clock;
        using var en = new MMDeviceEnumerator();
        _dev = en.GetDevice(endpointId);
        _client = _dev.CreateAudioClient();
        var mix = _client.MixFormat;
        MixRate = mix.SampleRate; _channels = mix.Channels; _bits = mix.BitsPerSample;
        _float = mix.Encoding == WaveFormatEncoding.IeeeFloat || (mix is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
        if (!(_float && _bits == 32) && !(!_float && _bits == 16))
            throw new NotSupportedException($"Unsupported mix format {mix.Encoding} {_bits}-bit. Change the device format in Windows Sound settings to 24-bit/48000 Hz.");
        // 100 ms buffer, event driven; the engine's own jitter buffer absorbs everything else
        _client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.EventCallback, 1_000_000, 0, mix, Guid.Empty);
        _client.SetEventHandle(_event.SafeWaitHandle.DangerousGetHandle());
        _bufferFrames = _client.BufferSize;
        _rc = _client.AudioRenderClient;
        ReportedLatencyMs = _client.StreamLatency / 10_000.0;
        _thread = new Thread(Loop) { IsBackground = true, Name = "wavwiz-wasapi", Priority = ThreadPriority.Highest };
    }

    public void Start()
    {
        // pre-fill with silence so the first period is not an underrun
        var n = _bufferFrames; var p = _rc.GetBuffer(n); Silence(p, n); _rc.ReleaseBuffer(n, AudioClientBufferFlags.None);
        _client.Start(); _thread.Start();
    }

    [DllImport("avrt.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr AvSetMmThreadCharacteristicsW(string task, ref uint index);
    [DllImport("avrt.dll", SetLastError = true)] private static extern bool AvRevertMmThreadCharacteristics(IntPtr h);

    private void Loop()
    {
        uint idx = 0; var mmcss = AvSetMmThreadCharacteristicsW("Pro Audio", ref idx);        // MMCSS: keeps the callback on time under load
        var stereo = new float[_bufferFrames * 2];
        try
        {
            while (!_stop)
            {
                if (!_event.WaitOne(200)) { continue; }
                if (_stop) break;
                int padding = _client.CurrentPadding; int avail = _bufferFrames - padding;
                if (avail <= 0) continue;
                // DAC time of the first frame we are about to write: now + what is already queued + the driver's stream latency
                long dac = _clock.NowUs + (long)((double)padding / MixRate * 1e6) + (long)(_client.StreamLatency / 10);
                int got = _render(stereo.AsSpan(0, avail * 2), avail, dac);
                if (got < avail) stereo.AsSpan(got * 2, (avail - got) * 2).Clear();
                var p = _rc.GetBuffer(avail);
                WriteOut(p, stereo, avail);
                _rc.ReleaseBuffer(avail, AudioClientBufferFlags.None);
            }
        }
        catch (Exception e) when (!_stop) { Faulted?.Invoke(e.GetType().Name + ": " + e.Message); }
        finally { if (mmcss != IntPtr.Zero) AvRevertMmThreadCharacteristics(mmcss); }
    }

    private void Silence(IntPtr p, int frames) { int bytes = frames * _channels * (_bits / 8); unsafe { new Span<byte>((void*)p, bytes).Clear(); } }

    private unsafe void WriteOut(IntPtr p, float[] stereo, int frames)
    {
        if (_float && _bits == 32)
        {
            var dst = new Span<float>((void*)p, frames * _channels);
            if (_channels == 2) stereo.AsSpan(0, frames * 2).CopyTo(dst);
            else for (int i = 0; i < frames; i++) { for (int c = 0; c < _channels; c++) dst[i * _channels + c] = 0; dst[i * _channels] = stereo[2 * i]; if (_channels > 1) dst[i * _channels + 1] = stereo[2 * i + 1]; }   // front L/R only on multichannel devices
        }
        else
        {
            var dst = new Span<short>((void*)p, frames * _channels);
            for (int i = 0; i < frames; i++)
            {
                for (int c = 0; c < _channels; c++) dst[i * _channels + c] = 0;
                dst[i * _channels] = (short)Math.Clamp(stereo[2 * i] * 32767f, -32768f, 32767f);
                if (_channels > 1) dst[i * _channels + 1] = (short)Math.Clamp(stereo[2 * i + 1] * 32767f, -32768f, 32767f);
            }
        }
    }

    public void Dispose()
    {
        _stop = true; _event.Set();
        try { if (_thread.IsAlive) _thread.Join(500); } catch { }
        try { _client.Stop(); } catch { }
        try { _rc.Dispose(); } catch { }
        try { _client.Dispose(); } catch { }
        try { _dev.Dispose(); } catch { }
        _event.Dispose();
    }
}
