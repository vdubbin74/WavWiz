using System.Collections.Concurrent;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// 0.5.0 stage 10: an AirPlay 2 speaker as a WavWiz stream subscriber (like <see cref="AirPlaySink"/> for AirPlay 1).
/// House frames (48 kHz, playAtUs) are resampled to 44.1 kHz and mapped to RTP with the same delay-compensated mapping;
/// the RTP timeline is tied to WavWiz's PTP clock (house clock + fixed offset).
/// Buffered mode (default): AAC-LC via ffmpeg over TCP, one SETRATEANCHORTIME at start, FLUSHBUFFERED on epoch change /
/// STOP_AT (instant pause/seek), a fresh encoder per continuous segment. Realtime mode (fallback): ALAC over UDP,
/// 0xD7 announces every second, RTSP FLUSH on discontinuities.
/// </summary>
public sealed class Ap2Sink : IStreamSubscriber, IAsyncDisposable
{
    readonly Ap2Session _s; readonly PtpMaster _ptp; readonly IMonotonicClock _clock; readonly bool _buffered; readonly string? _ff;
    readonly object _l = new(); readonly Resampler48To44 _rs = new();
    readonly short[] _acc = new short[1024 * 2 * 4]; int _accN; uint _accRtp;
    readonly Queue<(uint Rtp, byte[] Payload)> _pending = new();
    readonly CancellationTokenSource _cts = new();
    readonly long _t0; readonly uint _base; readonly long _ptpOffsetNs;
    uint _epoch; bool _stopFired; long _stopAt = long.MaxValue; long _expectNextRtp = -1; bool _first = true;
    ushort _seq = (ushort)Random.Shared.Next(); uint _bseq = (uint)Random.Shared.Next(0, 1 << 23);
    volatile bool _paused; uint _nextTs; long _nextAnnUs; ushort _annSeq; Task? _pump;
    // buffered: current encoder segment
    AacLiveEncoder? _enc; ConcurrentQueue<uint>? _encRtps; System.Threading.Channels.Channel<short[]>? _pcmCh; Task? _encReader; readonly SemaphoreSlim _tx = new(1, 1);

    public string Id { get; }
    public bool Buffered => _buffered;
    public int BufferDepthMs { get; set; } = 3000;
    public int DelayMs { get; set; }
    public int SendAheadMs { get; set; } = 1500;
    public uint Ssrc { get; } = (uint)Random.Shared.Next();
    public long Packets, Announces, Flushes, FramesIn, Segments;
    public Action<string>? Log;
    int Chunk => _buffered ? AacLiveEncoder.FramesPerPacket : Ap2Session.Spf;

    public Ap2Sink(string id, Ap2Session s, PtpMaster ptp, IMonotonicClock clock, bool buffered, string? ffmpeg)
    {
        if (buffered && string.IsNullOrEmpty(ffmpeg)) throw new ArgumentException("buffered AirPlay 2 needs ffmpeg");
        Id = id; _s = s; _ptp = ptp; _clock = clock; _buffered = buffered; _ff = ffmpeg;
        _t0 = clock.NowUs; _base = (uint)Random.Shared.Next();
        _ptpOffsetNs = (long)ptp.NowNs - clock.NowUs * 1000;
    }

    public uint RtpAt(long tUs) => (uint)(_base + (long)Math.Round((tUs - _t0 - DelayMs * 1000L) * 0.0441));
    public uint RtpRaw(long tUs) => (uint)(_base + (long)Math.Round((tUs - _t0) * 0.0441));
    public long TimeOfRtp(uint rtp) => _t0 + (long)Math.Round((int)(rtp - _base) / 0.0441);
    public ulong PtpOf(long tUs) => (ulong)(tUs * 1000 + _ptpOffsetNs);

    public async Task StartAsync()
    {
        // buffered: each continuous segment anchors its first packet (rtp, play time) on the same linear timeline
        _paused = true;
        await Task.CompletedTask;
        _pump = Task.Run(() => Pump(_cts.Token));
    }

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
                    if (!Wire.TryDecodeAudio(p, out var f, out _) || f == null || f.Epoch != _epoch || f.PlayAtUs >= _stopAt) return;
                    FramesIn++;
                    uint rtp = RtpAt(f.PlayAtUs);
                    if (_expectNextRtp < 0 || Math.Abs((int)(rtp - (uint)_expectNextRtp)) > 2) { _accN = 0; _rs.Reset(); _accRtp = rtp; NewSegmentLocked(); }
                    else rtp = (uint)_expectNextRtp;
                    if (_accN == 0) _accRtp = rtp;
                    var outPcm = new short[882 * 2];
                    _rs.Process(f.Samples.AsSpan(0, f.SampleCount * 2), outPcm);
                    outPcm.CopyTo(_acc, _accN * 2); _accN += 882; _expectNextRtp = rtp + 882;
                    while (_accN >= Chunk)
                    {
                        var pk = new short[Chunk * 2]; Array.Copy(_acc, pk, pk.Length);
                        Array.Copy(_acc, Chunk * 2, _acc, 0, (_accN - Chunk) * 2); _accN -= Chunk;
                        if (_buffered) { _encRtps!.Enqueue(_accRtp); _pcmCh!.Writer.TryWrite(pk); }
                        else { var alac = new byte[AlacRaw.Size(Chunk)]; int n = AlacRaw.Encode(pk, alac); _pending.Enqueue((_accRtp, alac[..n])); }
                        _accRtp += (uint)Chunk;
                    }
                    break;
            }
        }
    }

    void NewSegmentLocked()
    {
        if (!_buffered) return;
        _pcmCh?.Writer.TryComplete(); var old = _enc; _ = old?.DisposeAsync().AsTask();
        _enc = new AacLiveEncoder(_ff!); _encRtps = new ConcurrentQueue<uint>(); Segments++;
        var enc = _enc; var q = _encRtps; var ch = _pcmCh = System.Threading.Channels.Channel.CreateUnbounded<short[]>(new() { SingleReader = true });
        _ = Task.Run(async () =>
        {
            try { await foreach (var pk in ch.Reader.ReadAllAsync(_cts.Token)) await enc.WriteAsync(pk, _cts.Token); }
            catch (Exception e) when (e is not OperationCanceledException) { if (ReferenceEquals(enc, _enc)) Log?.Invoke("encoder: " + e.Message); }
            catch { }
        });
        _encReader = Task.Run(async () =>
        {
            bool primed = false;
            try
            {
                await foreach (var au in enc.Frames.ReadAllAsync(_cts.Token))
                {
                    if (!primed) { primed = true; continue; }
                    if (!q.TryDequeue(out var rtp)) continue;
                    if (!ReferenceEquals(enc, _enc)) return; // superseded by a flush
                    await _tx.WaitAsync(_cts.Token);
                    try
                    {
                        if (_paused) { _paused = false; var r = await _s.SetRateAnchorAsync(1, rtp, PtpOf(TimeOfRtp(rtp))); if (!r.Ok) Log?.Invoke($"SETRATEANCHORTIME {r.Status}"); }
                        _nextTs = rtp + (uint)AacLiveEncoder.FramesPerPacket;
                        await _s.SendBufferedAsync(_s.BufferedPacket(_bseq++ & 0xFFFFFF, rtp, Ssrc, au), _cts.Token); Interlocked.Increment(ref Packets);
                    }
                    finally { _tx.Release(); }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception e) { Log?.Invoke("buffered send: " + e.Message); }
        });
    }

    void FlushLocked()
    {
        _pending.Clear(); _accN = 0; _rs.Reset(); _expectNextRtp = -1; _first = true; Flushes++;
        if (_buffered)
        {
            _pcmCh?.Writer.TryComplete(); var old = _enc; _enc = null; _ = old?.DisposeAsync().AsTask();
            // like a pause: rate 0 + flush everything sent so far; the next segment re-anchors (same timeline) before its first packet
            _paused = true;
            _ = Task.Run(async () => { try { await _tx.WaitAsync(); try { await _s.SetRateAnchorAsync(0); await _s.FlushBufferedAsync(_bseq & 0xFFFFFF, _nextTs); } finally { _tx.Release(); } } catch (Exception e) { Log?.Invoke("flush: " + e.Message); } });
        }
        else
        {
            var seq = _seq; var rtp = RtpRaw(_clock.NowUs);
            _ = Task.Run(async () => { try { await _s.FlushAsync(seq, rtp); } catch (Exception e) { Log?.Invoke("flush: " + e.Message); } });
        }
    }

    async Task Pump(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            long now = _clock.NowUs; var send = new List<byte[]>(); byte[]? ann = null;
            lock (_l)
            {
                if (_stopAt != long.MaxValue && !_stopFired && now >= _stopAt) { FlushLocked(); _stopFired = true; }
                while (_pending.Count > 0 && TimeOfRtp(_pending.Peek().Rtp) - now <= SendAheadMs * 1000L)
                {
                    var (rtp, payload) = _pending.Dequeue();
                    if (TimeOfRtp(rtp) < now) continue;
                    send.Add(_s.AudioPacket(_seq++, rtp, Ssrc, payload, _first)); _first = false;
                }
                if (!_buffered && now >= _nextAnnUs) { ann = _s.TimeAnnounce(_annSeq++, RtpRaw(now), PtpOf(now), _ptp.ClockId); _nextAnnUs = now + 1_000_000; }
            }
            try
            {
                if (ann != null) { await _s.SendControlAsync(ann, ct); Announces++; }
                foreach (var pk in send) { await _s.SendAudioAsync(pk, ct); Packets++; }
                await Task.Delay(4, ct);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { Log?.Invoke("pump: " + e.Message); }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel(); if (_pump != null) try { await _pump; } catch { }
        if (_enc != null) await _enc.DisposeAsync();
    }
}
