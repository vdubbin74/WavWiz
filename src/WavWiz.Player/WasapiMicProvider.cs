using NAudio.CoreAudioApi;
using NAudio.Wave;
using WavWiz.Core.Calibration;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>
/// 0.2.5: this PC's microphones for PC-mic calibration, captured natively with WASAPI (shared mode), so calibration needs no browser, no HTTPS and no
/// certificate. Each packet's QPC time (IAudioCaptureClient::GetBuffer) gives the local monotonic time of its first sample - the same clock the
/// player's StopwatchClock reads - so the recording is placed exactly on the server timeline. USB, 3.5 mm, audio-interface and laptop mics are
/// supported; Bluetooth headsets are listed and flagged (Windows switches them to hands-free mode, which adds its own delay).
/// UNVERIFIED ON WINDOWS: compiled on Linux and exercised through the same MicResponder with a fake capture device; first things to check on a
/// real PC are the QPC units (100 ns) and the mix formats of USB mics.
/// </summary>
public sealed class WasapiMicProvider : IMicProvider, IDisposable
{
    private readonly IMonotonicClock _clock; private readonly MMDeviceEnumerator _enum = new();
    private static readonly PropertyKey FormFactor = new(new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), 0);
    private static readonly PropertyKey ControllerDeviceId = new(new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc"), 2);
    private static readonly PropertyKey EnumeratorName = new(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);
    public WasapiMicProvider(IMonotonicClock clock) { _clock = clock; }

    public IReadOnlyList<MicInfo> List()
    {
        var res = new List<MicInfo>(); string? def = null;
        try { if (_enum.TryGetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications, out var d) && d != null) { def = d.ID; d.Dispose(); } } catch { }
        try
        {
            foreach (var d in _enum.EnumerateAudioEndPoints(DataFlow.Capture, NAudio.CoreAudioApi.DeviceState.Active))
                using (d)
                {
                    string name = Safe(() => d.FriendlyName) ?? d.ID; string? ctl = Prop(d, ControllerDeviceId), en = Prop(d, EnumeratorName);
                    int ff = int.TryParse(Prop(d, FormFactor), out var f) ? f : 10;
                    var kind = MicKinds.Classify(name, ctl, en, ff);
                    res.Add(new MicInfo(d.ID, name, kind, kind == "bluetooth", d.ID == def));
                }
        }
        catch { /* audio service restarting: what we have */ }
        return res;
    }

    public async Task<MicRecording> RecordAsync(string micId, long fromLocalUs, long untilLocalUs, CancellationToken ct)
    {
        var mono = new List<float>(); long first = -1; int rate = 48000;
        await Task.Run(() => Capture(micId, (blk, r, t0) =>
        {
            rate = r;
            if (first < 0) { long skip = Math.Max(0, (fromLocalUs - t0) * r / 1_000_000); if (skip >= blk.Length) return _clock.NowUs < untilLocalUs; first = t0 + skip * 1_000_000 / r; mono.AddRange(blk.AsSpan((int)skip).ToArray()); }
            else mono.AddRange(blk);
            return _clock.NowUs < untilLocalUs;
        }, ct), ct);
        if (first < 0) throw new InvalidOperationException("the microphone delivered no sound");
        return new MicRecording(mono.ToArray(), rate, first);
    }

    public IDisposable Meter(string micId, Action<double> onPeakDb)
    {
        var cts = new CancellationTokenSource();
        _ = Task.Run(() => { try { Capture(micId, (blk, _, _) => { onPeakDb(MicPcm.PeakDb(blk)); return !cts.IsCancellationRequested; }, cts.Token); } catch { } });
        return cts;
    }

    /// <summary>Shared-mode, polled capture. <paramref name="onBlock"/> gets each packet as mono plus the local time (µs) of its first sample; return false to stop.</summary>
    private void Capture(string micId, Func<float[], int, long, bool> onBlock, CancellationToken ct)
    {
        using var dev = _enum.GetDevice(micId);
        using var client = dev.CreateAudioClient();
        var mix = client.MixFormat; int ch = mix.Channels, bits = mix.BitsPerSample, rate = mix.SampleRate;
        bool isFloat = mix.Encoding == WaveFormatEncoding.IeeeFloat || (mix is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
        if (!(isFloat && bits == 32) && bits != 16) throw new NotSupportedException($"unsupported microphone format {mix.Encoding} {bits}-bit");
        client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.None, 1_000_000, 0, mix, Guid.Empty);
        var cap = client.AudioCaptureClient;
        client.Start();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                Thread.Sleep(5);
                while (cap.GetNextPacketSize() > 0)
                {
                    var p = cap.GetBuffer(out int frames, out var flags, out long _, out long qpc100ns);
                    var mono = new float[frames];
                    if ((flags & AudioClientBufferFlags.Silent) == 0) unsafe
                    {
                        if (isFloat) { var src = new ReadOnlySpan<float>((void*)p, frames * ch); for (int i = 0; i < frames; i++) { float s = 0; for (int c = 0; c < ch; c++) s += src[i * ch + c]; mono[i] = s / ch; } }
                        else { var src = new ReadOnlySpan<short>((void*)p, frames * ch); for (int i = 0; i < frames; i++) { float s = 0; for (int c = 0; c < ch; c++) s += src[i * ch + c] / 32768f; mono[i] = s / ch; } }
                    }
                    cap.ReleaseBuffer(frames);
                    // QPC position is in 100 ns units; StopwatchClock is QPC in µs. A glitched packet (no timestamp) falls back to "now minus its length".
                    long t0 = qpc100ns > 0 ? qpc100ns / 10 : _clock.NowUs - (long)frames * 1_000_000 / rate;
                    if (!onBlock(mono, rate, t0)) return;
                }
            }
        }
        finally { try { client.Stop(); } catch { } }
    }

    private static string? Safe(Func<string> f) { try { return f(); } catch { return null; } }
    private static string? Prop(MMDevice d, PropertyKey k) { try { return d.Properties.Contains(k) ? d.Properties[k].Value?.ToString() : null; } catch { return null; } }
    public void Dispose() => _enum.Dispose();
}
