namespace WavWiz.Core.AirPlay;

/// <summary>
/// AirPlay 2 buffered (type 103) streamer: PCM from the source is encoded live to AAC-LC (ffmpeg), sent over the TCP
/// data channel up to <see cref="AheadMs"/> ahead of the play head, and placed on the PTP timeline with
/// SETRATEANCHORTIME. Pause = rate 0 + FLUSHBUFFERED of everything queued (silent at once); resume/seek = a fresh
/// anchor <see cref="ResumeLeadMs"/> ahead, so neither waits for the receiver's buffer to drain.
/// </summary>
public sealed class Ap2BufferedStreamer : IAsyncDisposable
{
    readonly Ap2Session _s; readonly PtpMaster _ptp; readonly Func<short[], int> _fill; readonly AacLiveEncoder _enc;
    readonly CancellationTokenSource _cts = new(); Task? _pump, _send; readonly SemaphoreSlim _lk = new(1, 1);
    public uint Seq = (uint)Random.Shared.Next(0, 1 << 23), Ssrc = (uint)Random.Shared.Next();
    public uint NextRtp; uint _pcmRtp; bool _primed;
    public uint AnchorRtp; public ulong AnchorNs; public bool Playing { get; private set; }
    public int AheadMs { get; set; } = 1500;
    public int ResumeLeadMs { get; set; } = 500;
    public long PacketsSent, Flushes;

    public Ap2BufferedStreamer(Ap2Session s, PtpMaster ptp, Func<short[], int> fill, string ffmpeg)
    { _s = s; _ptp = ptp; _fill = fill; _enc = new AacLiveEncoder(ffmpeg); NextRtp = _pcmRtp = (uint)Random.Shared.Next(); }

    /// <summary>RTP frame heard now (only meaningful while playing).</summary>
    public uint PlayHead(ulong now) => AnchorRtp + (uint)((long)(now - AnchorNs) * Ap2Session.Rate / 1_000_000_000L);

    public Task StartAsync(int startLeadMs = 1000) => StartAtAsync(_ptp.NowNs + (ulong)startLeadMs * 1_000_000);

    /// <summary>Start so the first frame is heard at PTP time <paramref name="anchorNs"/>; speakers started with the same
    /// anchor (and fed the same source) play in step.</summary>
    public async Task StartAtAsync(ulong anchorNs)
    {
        AnchorRtp = NextRtp; AnchorNs = anchorNs; Playing = true;
        _pump = Task.Run(() => Pump(_cts.Token)); _send = Task.Run(() => Send(_cts.Token));
        var r = await _s.SetRateAnchorAsync(1, AnchorRtp, AnchorNs); if (!r.Ok) throw new IOException($"SETRATEANCHORTIME: {r.Status}");
    }

    async Task Pump(CancellationToken ct)
    {
        var pcm = new short[AacLiveEncoder.FramesPerPacket * 2];
        while (!ct.IsCancellationRequested)
        {
            ulong now = _ptp.NowNs;
            long ahead = Playing ? (int)(_pcmRtp - PlayHead(now)) : (int)(_pcmRtp - AnchorRtp);
            if (ahead < (long)AheadMs * Ap2Session.Rate / 1000)
            {
                Array.Clear(pcm); _fill(pcm); await _enc.WriteAsync(pcm, ct); _pcmRtp += AacLiveEncoder.FramesPerPacket;
            }
            else try { await Task.Delay(10, ct); } catch (OperationCanceledException) { }
        }
    }

    async Task Send(CancellationToken ct)
    {
        await foreach (var au in _enc.Frames.ReadAllAsync(ct))
        {
            if (!_primed) { _primed = true; continue; } // first access unit is encoder priming (AacLiveEncoder.PrimingFrames)
            await _lk.WaitAsync(ct);
            try { await _s.SendBufferedAsync(_s.BufferedPacket(Seq++ & 0xFFFFFF, NextRtp, Ssrc, au), ct); NextRtp += AacLiveEncoder.FramesPerPacket; PacketsSent++; }
            finally { _lk.Release(); }
        }
    }

    /// <summary>Instant pause: stop the clock and drop what the receiver has queued past the play head.</summary>
    public async Task PauseAsync()
    {
        await _lk.WaitAsync();
        try
        {
            uint head = PlayHead(_ptp.NowNs);
            await _s.SetRateAnchorAsync(0);
            await _s.FlushBufferedAsync(Seq & 0xFFFFFF, NextRtp);
            Flushes++; Playing = false; AnchorRtp = NextRtp;
            _ = head;
        }
        finally { _lk.Release(); }
    }

    /// <summary>Resume (or seek: the source has already moved): new audio from <see cref="NextRtp"/> plays ResumeLeadMs from now.</summary>
    public async Task ResumeAsync()
    {
        await _lk.WaitAsync();
        try { AnchorRtp = NextRtp; AnchorNs = _ptp.NowNs + (ulong)ResumeLeadMs * 1_000_000; Playing = true; await _s.SetRateAnchorAsync(1, AnchorRtp, AnchorNs); }
        finally { _lk.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        try { if (_pump != null) await _pump; } catch { }
        await _enc.DisposeAsync();
        try { if (_send != null) await _send; } catch { }
    }
}
