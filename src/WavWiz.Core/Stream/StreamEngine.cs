using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;

namespace WavWiz.Core.Stream;

/// <summary>Decoded audio at the stream format (48 kHz stereo float). Implemented by the queue/decoder (server) and by test sources.</summary>
public interface ISampleSource
{
    /// <summary>Fill up to <paramref name="frames"/> stereo frames. Returns the number produced; fewer than requested means the source ended or
    /// has nothing available right now (see <see cref="Ended"/>).</summary>
    int Read(Span<float> interleavedStereo, int frames);
    bool Ended { get; }
}

public interface IStreamSubscriber
{
    string Id { get; }
    /// <summary>How far ahead of "now" this subscriber wants audio (3 s Ethernet / 4 s Wi-Fi by default, spec 7.4).</summary>
    int BufferDepthMs { get; }
    void Send(byte[] message);
}

/// <summary>
/// Server-side house stream (spec 5.1, 7.4). One timeline for all zones: frame n of an epoch has playAt = epochStart + n*20 ms in
/// SERVER monotonic time; the timeline is paced by the server's monotonic clock, never by a sound card (spec 9.4).
/// Single-threaded by contract: the caller serializes Play/Stop/Pump/Subscribe (the server host runs it on one timer thread).
/// </summary>
public delegate void FrameTapHandler(long playAtUs, ReadOnlySpan<float> interleavedStereo);

public sealed class StreamEngine
{
    /// <summary>Optional listener for each produced 20 ms frame (the visualizer feed). Runs on the pump thread: keep it tiny.</summary>
    public FrameTapHandler? FrameTap;
    public const long FrameUs = 20_000;
    private sealed record Sent(long Index, byte[] Message);

    private readonly IMonotonicClock _clock;
    private readonly List<IStreamSubscriber> _subs = new();
    private readonly Dictionary<string, long> _nextIdx = new();
    private readonly List<Sent> _ring = new();
    private readonly float[] _buf = new float[Wire.FrameSamples * 2];
    private ISampleSource? _src;
    private long _produced;          // next frame index to produce
    private int _fill;               // frames already in _buf for the frame being assembled
    private bool _sourceDone;
    private long _stopAtUs = long.MaxValue;
    private uint _seq;

    public uint Epoch { get; private set; }
    public long EpochStartUs { get; private set; }
    public bool Playing { get; private set; }
    public long RingKeepUs { get; init; } = 10_000_000;
    /// <summary>A starved source is padded with silence for frames due within this horizon (default 500 ms).</summary>
    public long StarveFillAheadUs { get; init; } = 500_000;
    public int FramesProduced => (int)_produced;

    public StreamEngine(IMonotonicClock clock) { _clock = clock; }

    /// <summary>Start (or restart: seek, skip, jump) a new epoch at now + lead. Players drop older frames (spec 7.4).</summary>
    public void Play(ISampleSource source, long leadUs)
    {
        _src = source; _sourceDone = false; _fill = 0; _stopAtUs = long.MaxValue;
        Epoch++; EpochStartUs = _clock.NowUs + leadUs; _produced = 0; _ring.Clear(); _nextIdx.Clear();
        Playing = true;
        var msg = Wire.EncodeEpoch(_seq++, Epoch, EpochStartUs);
        foreach (var s in _subs) { s.Send(msg); _nextIdx[s.Id] = 0; }
    }

    /// <summary>Pause/stop = STOP_AT now + lead with a short fade on the players (spec 7.4).</summary>
    public void Stop(long leadUs)
    {
        if (!Playing) return;
        long at = _clock.NowUs + leadUs;
        BroadcastStopAt(at);
        _stopAtUs = at;
    }

    private void BroadcastStopAt(long at)
    {
        var msg = Wire.EncodeStopAt(_seq++, Epoch, at);
        foreach (var s in _subs) s.Send(msg);
    }

    /// <summary>Zone turned on / late join / reconnect: start at the current timeline position (spec 7.6). Players do not resume where they stopped.</summary>
    public void Subscribe(IStreamSubscriber sub)
    {
        _subs.RemoveAll(s => s.Id == sub.Id);
        _subs.Add(sub);
        if (!Playing) return;
        sub.Send(Wire.EncodeEpoch(_seq++, Epoch, EpochStartUs));
        if (_stopAtUs != long.MaxValue) sub.Send(Wire.EncodeStopAt(_seq++, Epoch, _stopAtUs));
        long now = _clock.NowUs;
        long firstIdx = Math.Max(0, (now - 60_000 - EpochStartUs) / FrameUs);
        _nextIdx[sub.Id] = firstIdx;
    }

    /// <summary>After the stop time has passed: forget the source so nothing more is produced. Subscribers already got STOP_AT.</summary>
    public void Halt() { Playing = false; _src = null; _ring.Clear(); _nextIdx.Clear(); _stopAtUs = long.MaxValue; }
    public long StopAtUs => _stopAtUs;

    public IReadOnlyList<IStreamSubscriber> Subscribers => _subs;
    public void Unsubscribe(string id) { _subs.RemoveAll(s => s.Id == id); _nextIdx.Remove(id); }

    /// <summary>Produce frames up to the deepest subscriber's buffer horizon and deliver to each subscriber up to its own horizon.</summary>
    public void Pump()
    {
        if (!Playing || _src == null) return;
        long now = _clock.NowUs;
        int maxDepthMs = 0;
        foreach (var s in _subs) maxDepthMs = Math.Max(maxDepthMs, s.BufferDepthMs);
        long horizon = now + maxDepthMs * 1000L;
        while (!_sourceDone && EpochStartUs + _produced * FrameUs <= horizon)
        {
            // accumulate a whole 20 ms frame (a decoder may deliver it in pieces); never pad mid-stream unless the frame is due
            int got = _src.Read(_buf.AsSpan(_fill * 2), Wire.FrameSamples - _fill);
            _fill += got;
            if (_fill == Wire.FrameSamples) { AddFrame(); _fill = 0; continue; }
            if (_src.Ended)
            {
                _sourceDone = true;
                if (_fill > 0) { Array.Clear(_buf, _fill * 2, (Wire.FrameSamples - _fill) * 2); AddFrame(); _fill = 0; }
                long end = EpochStartUs + _produced * FrameUs;
                _stopAtUs = Math.Min(_stopAtUs, end);
                BroadcastStopAt(_stopAtUs);
                break;
            }
            // Nothing (more) available (radio stall / slow share). While there is still time, wait; once the frame would be due soon,
            // keep the house timeline moving with silence so every zone stays aligned when audio resumes.
            if (EpochStartUs + _produced * FrameUs > now + StarveFillAheadUs) break;
            Array.Clear(_buf, _fill * 2, (Wire.FrameSamples - _fill) * 2);
            AddFrame(); _fill = 0;
        }
        foreach (var s in _subs)
        {
            long next = _nextIdx.TryGetValue(s.Id, out var n) ? n : 0;
            long limit = now + s.BufferDepthMs * 1000L;
            foreach (var f in _ring)
            {
                if (f.Index < next) continue;
                if (EpochStartUs + f.Index * FrameUs > limit) break;
                s.Send(f.Message);
                next = f.Index + 1;
            }
            _nextIdx[s.Id] = next;
        }
        // prune frames older than the ring window
        long keepFrom = (now - RingKeepUs - EpochStartUs) / FrameUs;
        int drop = 0;
        while (drop < _ring.Count && _ring[drop].Index < keepFrom) drop++;
        if (drop > 0) _ring.RemoveRange(0, drop);
    }

    private void AddFrame()
    {
        long idx = _produced++;
        long playAt = EpochStartUs + idx * FrameUs;
        _ring.Add(new Sent(idx, Wire.EncodeAudio((uint)idx, playAt, Epoch, _buf)));
        FrameTap?.Invoke(playAt, _buf);
    }

    /// <summary>Position of the house stream in samples at a server time (for UI position and tests).</summary>
    public long PositionSamplesAt(long serverUs) => (long)((serverUs - EpochStartUs) * (Wire.SampleRate / 1e6));
}
