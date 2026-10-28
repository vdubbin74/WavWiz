using System.Buffers.Binary;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;

namespace WavWiz.Core.AirPlay;

/// <summary>48 kHz -> 44.1 kHz stereo resampler (exactly 960 -> 882 frames per 20 ms), 24-tap Blackman-windowed sinc,
/// phase carried across calls so consecutive frames are seamless.</summary>
public sealed class Resampler48To44
{
    const int Taps = 24, Half = Taps / 2;
    const double Step = 48000.0 / 44100.0, Cut = 0.92 * 44100.0 / 48000.0;
    readonly float[] _hist = new float[Taps * 2];   // last Taps input frames (stereo)
    double _pos;                                     // position of the next output in "input frames since history start"
    public void Reset() { Array.Clear(_hist); _pos = 0; }

    /// <summary>Consumes 960 stereo frames, writes 882 stereo frames (int16 interleaved).</summary>
    public void Process(ReadOnlySpan<float> input, Span<short> output)
    {
        int nIn = input.Length / 2;
        var buf = new float[(Taps + nIn) * 2];
        _hist.CopyTo(buf, 0); input.CopyTo(buf.AsSpan(Taps * 2));
        int outN = output.Length / 2;
        for (int o = 0; o < outN; o++)
        {
            double p = _pos + Half; int i0 = (int)Math.Floor(p); double frac = p - i0;
            double l = 0, r = 0;
            for (int k = -Half + 1; k <= Half; k++)
            {
                int idx = i0 + k; if (idx < 0 || idx >= Taps + nIn) continue;
                double x = k - frac, w = Kernel(x);
                l += buf[idx * 2] * w; r += buf[idx * 2 + 1] * w;
            }
            output[o * 2] = Clip(l); output[o * 2 + 1] = Clip(r);
            _pos += Step;
        }
        _pos -= nIn;
        buf.AsSpan(nIn * 2, Taps * 2).CopyTo(_hist);
    }
    static double Kernel(double x)
    {
        double s = x == 0 ? Cut : Math.Sin(Math.PI * Cut * x) / (Math.PI * x);
        double n = (x + Half) / Taps; if (n < 0 || n > 1) return 0;
        double w = 0.42 - 0.5 * Math.Cos(2 * Math.PI * n) + 0.08 * Math.Cos(4 * Math.PI * n);
        return s * w;
    }
    static short Clip(double v) { v *= 32767; return (short)(v > 32767 ? 32767 : v < -32768 ? -32768 : Math.Round(v)); }
}

/// <summary>
/// 0.5.0 stage 6: an AirPlay 1 speaker as a WavWiz stream subscriber. It receives the house stream's 20 ms frames
/// (PCM24 @ 48 kHz with a server-monotonic play time), resamples to 44.1 kHz, and maps play time to RTP time with one
/// linear clock: R(t) = base + (t - t0) * 44.1 kHz. Sync packets tell the receiver that R(now) is playing now, so a frame
/// scheduled for time P is given RTP time R(P - DelayMs) so it leaves the speaker at P once the speaker's own output delay (<see cref="DelayMs"/>) is added.
/// New epochs and STOP_AT become RTSP FLUSH. Packets go out <see cref="SendAheadMs"/> before their play time.
/// </summary>
public sealed class AirPlaySink : IStreamSubscriber, IAsyncDisposable
{
    readonly RaopSession _s;
    readonly IMonotonicClock _clock;
    readonly object _l = new();
    readonly Queue<(uint Rtp, byte[] Pcm)> _pending = new();
    readonly Resampler48To44 _rs = new();
    readonly short[] _acc = new short[352 * 2 * 8]; int _accN; uint _accRtp;
    readonly byte[]?[] _hist = new byte[1024][];
    readonly CancellationTokenSource _cts = new();
    readonly long _t0; readonly uint _base;
    readonly System.Security.Cryptography.Aes? _aes;
    uint _epoch; bool _stopFired; long _stopAt = long.MaxValue; bool _first = true, _syncFirst = true; ushort _seq;
    long _nextSyncUs; long _expectNextRtp = -1;
    Task? _pump;

    public string Id { get; }
    public int BufferDepthMs { get; set; } = 3000;
    public int SendAheadMs { get; set; } = 1500;
    /// <summary>Speaker output delay to compensate (positive: the speaker plays late).</summary>
    public int DelayMs { get; set; }
    public uint Ssrc { get; } = (uint)Random.Shared.Next();
    public long Packets, Syncs, Flushes, Resends, FramesIn;
    public Action<string>? Log;

    public AirPlaySink(string id, RaopSession s, IMonotonicClock clock, ushort startSeq, uint startRtp)
    {
        Id = id; _s = s; _clock = clock; _seq = startSeq; _base = startRtp; _t0 = clock.NowUs;
        if (s.AesKey != null) _aes = RaopCrypto.MakeAes(s.AesKey);
        s.ControlPacket += OnControl;
    }

    /// <summary>RTP time for server time t (us), with speaker delay compensation.</summary>
    public uint RtpAt(long tUs) => (uint)(_base + (long)Math.Round((tUs - _t0 - DelayMs * 1000L) * 0.0441));
    /// <summary>Uncompensated clock: what the receiver is told is playing at server time t (sync packets).</summary>
    public uint RtpRaw(long tUs) => (uint)(_base + (long)Math.Round((tUs - _t0) * 0.0441));
    /// <summary>Nominal receiver play time (server us) of an RTP time.</summary>
    public long TimeOfRtp(uint rtp) => _t0 + (long)Math.Round((int)(rtp - _base) / 0.0441);

    public void Start() => _pump = Task.Run(() => Pump(_cts.Token));

    public void Send(byte[] m)
    {
        if (!Wire.TryReadHeader(m, out var h, out _)) return;
        var p = m.AsSpan(Wire.HeaderSize, (int)h.PayloadLen);
        lock (_l)
        {
            switch (h.Type)
            {
                case MsgType.Epoch:
                    if (Wire.TryDecodeEpoch(p, out var ep, out _)) { if (ep != _epoch && _epoch != 0) FlushLocked(); _epoch = ep; _stopAt = long.MaxValue; _stopFired = false; }
                    break;
                case MsgType.StopAt:
                    if (Wire.TryDecodeStopAt(p, out var se, out var at) && se == _epoch) _stopAt = at;
                    break;
                case MsgType.Audio:
                    if (!Wire.TryDecodeAudio(p, out var f, out _) || f == null || f.Epoch != _epoch) return;
                    if (f.PlayAtUs >= _stopAt) return;
                    FramesIn++;
                    uint rtp = RtpAt(f.PlayAtUs);
                    // discontinuity (first frame, gap, or re-anchor): drop the partial accumulator and restart the resampler
                    if (_expectNextRtp < 0 || Math.Abs((int)(rtp - (uint)_expectNextRtp)) > 2)
                    { _accN = 0; _rs.Reset(); _accRtp = rtp; }
                    else rtp = (uint)_expectNextRtp;
                    if (_accN == 0) _accRtp = rtp;
                    var outPcm = new short[882 * 2];
                    _rs.Process(f.Samples.AsSpan(0, f.SampleCount * 2), outPcm);
                    outPcm.CopyTo(_acc, _accN * 2); _accN += 882;
                    _expectNextRtp = rtp + 882;
                    while (_accN >= 352)
                    {
                        var pk = new short[352 * 2]; Array.Copy(_acc, pk, pk.Length);
                        Array.Copy(_acc, 352 * 2, _acc, 0, (_accN - 352) * 2); _accN -= 352;
                        var alac = new byte[AlacRaw.Size(352)]; int n = AlacRaw.Encode(pk, alac);
                        if (_aes != null) RaopCrypto.EncryptPayload(_aes, _s.AesIv!, alac.AsSpan(0, n));
                        _pending.Enqueue((_accRtp, alac[..n])); _accRtp += 352;
                    }
                    break;
            }
        }
    }

    void FlushLocked()
    {
        _pending.Clear(); _accN = 0; _rs.Reset(); _expectNextRtp = -1; _first = true; Flushes++;
        var seq = _seq; var rtp = RtpRaw(_clock.NowUs);
        _ = Task.Run(async () => { try { await _s.FlushAsync(seq, rtp); } catch (Exception e) { Log?.Invoke("flush: " + e.Message); } });
    }

    async Task Pump(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            long now = _clock.NowUs;
            List<byte[]> send = new(); byte[]? sync = null;
            lock (_l)
            {
                if (_stopAt != long.MaxValue && !_stopFired && now >= _stopAt) { FlushLocked(); _stopFired = true; } // keep _stopAt: later frames of this epoch stay dropped
                while (_pending.Count > 0 && TimeOfRtp(_pending.Peek().Rtp) - now <= SendAheadMs * 1000L)
                {
                    var (rtp, payload) = _pending.Dequeue();
                    if (TimeOfRtp(rtp) < now) continue; // too late to be useful
                    var pk = Rtp.Audio(_seq, rtp, Ssrc, payload, _first); _first = false;
                    _hist[_seq % _hist.Length] = pk; _seq++; send.Add(pk);
                }
                if (now >= _nextSyncUs)
                {
                    uint playing = RtpRaw(now);
                    sync = Rtp.Sync((uint)(playing + _s.Opt.LatencyFrames), _s.Opt.LatencyFrames, Ntp.Now(), _syncFirst);
                    _syncFirst = false; _nextSyncUs = now + 1_000_000;
                }
            }
            try
            {
                if (sync != null) { await _s.Control.SendAsync(sync, _s.ServerControl, ct); Syncs++; }
                foreach (var pk in send) { await _s.Audio.SendAsync(pk, _s.ServerAudio, ct); Packets++; }
                await Task.Delay(4, ct);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { Log?.Invoke("pump: " + e.Message); }
        }
    }

    void OnControl(byte[] p, System.Net.IPEndPoint from)
    {
        if (p.Length < 8 || (p[1] & 0x7F) != 0x55) return;
        ushort first = Rtp.Rd16(p, 4), count = Rtp.Rd16(p, 6);
        for (int i = 0; i < count; i++)
        {
            ushort q = (ushort)(first + i); var pk = _hist[q % _hist.Length];
            if (pk != null && Rtp.Rd16(pk, 2) == q) { try { _s.Control.Send(Rtp.Resend(q, pk), _s.ServerControl); Interlocked.Increment(ref Resends); } catch { } }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel(); if (_pump != null) try { await _pump; } catch { }
        _s.ControlPacket -= OnControl; _aes?.Dispose();
    }
}
