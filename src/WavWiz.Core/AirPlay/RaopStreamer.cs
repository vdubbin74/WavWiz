using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// 0.5.0 AirPlay 1 audio pump: pulls 16-bit stereo PCM, packs 352-frame ALAC escape frames (optionally AES et=1),
/// sends RTP audio paced to the wall clock with a small lead, a sync packet every second, and answers resend
/// requests (0xD5) from a 1024-packet history.
/// </summary>
public sealed class RaopStreamer : IAsyncDisposable
{
    readonly RaopSession _s;
    readonly Func<short[], int> _fill;
    readonly CancellationTokenSource _cts = new();
    readonly byte[]?[] _hist = new byte[1024][];
    readonly Aes? _aes;
    Task? _task;
    public ushort Seq { get; private set; }
    public uint RtpTime { get; private set; }
    public uint Ssrc { get; } = (uint)Random.Shared.Next();
    public long PacketsSent, SyncsSent, ResendRequests, ResendsServed, ResendsMissed;
    /// <summary>Test hook: sequence numbers to skip once (forced loss).</summary>
    public HashSet<ushort> DropOnce { get; } = new();
    /// <summary>Audio sent ahead of real time, ms.</summary>
    public int LeadMs { get; set; } = 250;
    public ushort StartSeq { get; }
    public uint StartRtp { get; }

    public RaopStreamer(RaopSession s, Func<short[], int> fill, ushort seq, uint rtp)
    {
        _s = s; _fill = fill; Seq = StartSeq = seq; RtpTime = StartRtp = rtp;
        if (s.AesKey != null) _aes = RaopCrypto.MakeAes(s.AesKey);
        s.ControlPacket += OnControl;
    }

    public void Start() => _task = Task.Run(() => Run(_cts.Token));

    void OnControl(byte[] p, IPEndPoint from)
    {
        if (p.Length < 8 || (p[1] & 0x7F) != 0x55) return;
        Interlocked.Increment(ref ResendRequests);
        ushort first = Rtp.Rd16(p, 4), count = Rtp.Rd16(p, 6);
        for (int i = 0; i < count; i++)
        {
            ushort q = (ushort)(first + i);
            var pk = _hist[q % _hist.Length];
            if (pk != null && Rtp.Rd16(pk, 2) == q)
            {
                try { _s.Control.Send(Rtp.Resend(q, pk), _s.ServerControl); Interlocked.Increment(ref ResendsServed); } catch { }
            }
            else Interlocked.Increment(ref ResendsMissed);
        }
    }

    async Task Run(CancellationToken ct)
    {
        int fpp = _s.Opt.FramesPerPacket, rate = _s.Opt.SampleRate;
        var pcm = new short[fpp * 2]; var alac = new byte[AlacRaw.Size(fpp)];
        var sw = Stopwatch.StartNew(); long framesSent = 0; long nextSync = 0; bool first = true;
        while (!ct.IsCancellationRequested)
        {
            long dueFrames = (long)(sw.Elapsed.TotalSeconds * rate) + rate * LeadMs / 1000;
            if (framesSent >= dueFrames) { await Task.Delay(2, ct).ContinueWith(_ => { }); continue; }
            if (framesSent >= nextSync)
            {
                // sync: the frame that is playing "now" (sent minus lead) maps to NTP now
                uint rtpNow = (uint)(StartRtp + Math.Max(0, framesSent - rate * LeadMs / 1000));
                var sp = Rtp.Sync(rtpNow, _s.Opt.LatencyFrames, Ntp.Now(), first);
                try { await _s.Control.SendAsync(sp, _s.ServerControl, ct); SyncsSent++; } catch (OperationCanceledException) { return; } catch { }
                nextSync += rate;
            }
            Array.Clear(pcm);
            _fill(pcm);
            int n = AlacRaw.Encode(pcm, alac);
            if (_aes != null) RaopCrypto.EncryptPayload(_aes, _s.AesIv!, alac.AsSpan(0, n));
            var pk = Rtp.Audio(Seq, RtpTime, Ssrc, alac.AsSpan(0, n), first);
            _hist[Seq % _hist.Length] = pk;
            if (!DropOnce.Remove(Seq))
                try { await _s.Audio.SendAsync(pk, _s.ServerAudio, ct); } catch (OperationCanceledException) { return; } catch { }
            PacketsSent++; first = false; Seq++; RtpTime += (uint)fpp; framesSent += fpp;
        }
    }

    public async Task StopAsync()
    {
        _cts.Cancel();
        if (_task != null) try { await _task; } catch { }
        _s.ControlPacket -= OnControl;
    }

    public async ValueTask DisposeAsync() { await StopAsync(); _aes?.Dispose(); }

    /// <summary>Simple PCM source: a sine tone at <paramref name="hz"/>, amplitude in dBFS.</summary>
    public static Func<short[], int> Tone(double hz, double dbfs = -12, int rate = 44100)
    {
        long n = 0; double a = 32767 * Math.Pow(10, dbfs / 20);
        return buf => { for (int i = 0; i < buf.Length / 2; i++, n++) { short v = (short)(a * Math.Sin(2 * Math.PI * hz * n / rate)); buf[2 * i] = v; buf[2 * i + 1] = v; } return buf.Length / 2; };
    }
}
