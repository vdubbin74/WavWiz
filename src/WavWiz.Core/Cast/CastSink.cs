using System.Buffers.Binary;
using System.Threading.Channels;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;
namespace WavWiz.Core.Cast;

/// <summary>
/// A Cast device as a WavWiz stream subscriber. The Cast device PULLS audio over HTTP, so this sink turns the house stream (48 kHz float frames
/// stamped with playAtUs) into one endless, real-time-paced 16-bit PCM WAV stream that any number of HTTP readers can attach to.
/// Output slot k (20 ms) is written at wall time W_k (W_k = start + k*20 ms, written <see cref="PrerollMs"/> ahead) and carries the house frame
/// whose playAt is W_k + <see cref="LatencyMs"/> + DelayMs, i.e. the audio the rest of the house plays when the Cast device (which buffers
/// about LatencyMs behind what it receives) plays this slot. Nothing to play (paused, stopped, between songs) = silence, so the receiver never starves.
/// The Cast buffer depth is not reported by the device: sync with other speakers is approximate until it is ear-calibrated (DelayMs).
/// </summary>
public sealed class CastSink : IStreamSubscriber, IAsyncDisposable
{
    public const int Rate = Wire.SampleRate, FrameSamples = Rate / 50; const long SlotUs = 20_000;
    readonly IMonotonicClock _clock; readonly object _l = new();
    readonly SortedList<long, float[]> _pending = new();
    readonly List<Channel<byte[]>> _readers = new();
    readonly CancellationTokenSource _cts = new();
    uint _epoch; long _stopAt = long.MaxValue; long _start = -1, _k; Task? _pump;
    public string Id { get; }
    /// <summary>Frames arrive this far ahead of their play time; must exceed LatencyMs + DelayMs + PrerollMs.</summary>
    public int BufferDepthMs { get; set; } = 4500;
    /// <summary>Estimated Cast receiver buffer (time from our write to its speaker). Unknown per model; tuned on real hardware.</summary>
    public int LatencyMs { get; set; } = 2000;
    public int DelayMs { get; set; }
    public int PrerollMs { get; set; } = 300;
    public float Gain = 1f;
    public long FramesIn, SlotsOut, SlotsSilent, Late;
    public int Readers { get { lock (_readers) return _readers.Count; } }
    public Action<string>? Log;

    public CastSink(string id, IMonotonicClock clock) { Id = id; _clock = clock; }

    /// <summary>The 44-byte WAV header: PCM 16-bit stereo 48 kHz, RIFF and data sizes 0xFFFFFFFF (FFmpeg's wav demuxer reads that as "until the end").</summary>
    public static byte[] WavHeader(int rate = Rate, int channels = 2)
    {
        var h = new byte[44]; void S(int o, string s) { for (int i = 0; i < 4; i++) h[o + i] = (byte)s[i]; }
        S(0, "RIFF"); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(4), 0xFFFFFFFF); S(8, "WAVE");
        S(12, "fmt "); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(16), 16); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(20), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(22), (ushort)channels); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(24), (uint)rate);
        BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(28), (uint)(rate * channels * 2)); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(32), (ushort)(channels * 2));
        BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(34), 16); S(36, "data"); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(40), 0xFFFFFFFF);
        return h;
    }

    public static void ToS16(ReadOnlySpan<float> src, Span<byte> dst, float gain = 1f)
    {
        for (int i = 0; i < src.Length; i++)
        {
            float v = Math.Clamp(src[i] * gain, -1f, 1f);
            BinaryPrimitives.WriteInt16LittleEndian(dst[(i * 2)..], (short)Math.Round(v * 32767f));
        }
    }

    public void Start() { _pump ??= Task.Run(() => Pump(_cts.Token)); }

    public void Send(byte[] m)
    {
        if (!Wire.TryReadHeader(m, out var h, out _)) return;
        var p = m.AsSpan(Wire.HeaderSize, (int)h.PayloadLen);
        lock (_l)
        {
            switch (h.Type)
            {
                case MsgType.Epoch:
                    if (Wire.TryDecodeEpoch(p, out var ep, out _)) { if (ep != _epoch) _pending.Clear(); _epoch = ep; _stopAt = long.MaxValue; }
                    break;
                case MsgType.StopAt:
                    if (Wire.TryDecodeStopAt(p, out var se, out var at) && se == _epoch)
                    { _stopAt = at; foreach (var k in _pending.Keys.Where(k => k >= at).ToList()) _pending.Remove(k); }
                    break;
                case MsgType.Audio:
                    if (!Wire.TryDecodeAudio(p, out var f, out _) || f == null || f.Epoch != _epoch || f.PlayAtUs >= _stopAt || f.SampleCount != FrameSamples) return;
                    FramesIn++; _pending[f.PlayAtUs] = f.Samples;
                    while (_pending.Count > 600) _pending.RemoveAt(0);
                    break;
            }
        }
    }

    /// <summary>Attaches an HTTP reader: the header first, then live PCM from the next slot on.</summary>
    public ChannelReader<byte[]> Attach()
    {
        var ch = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        ch.Writer.TryWrite(WavHeader());
        lock (_readers) _readers.Add(ch);
        Log?.Invoke("http reader attached");
        return ch.Reader;
    }
    public void Detach(ChannelReader<byte[]> r) { lock (_readers) _readers.RemoveAll(c => c.Reader == r); }

    /// <summary>Builds the PCM for output slot k due at wall time w (pure apart from the pending queue). Public for tests.</summary>
    public byte[] Slot(long w)
    {
        long want = w + (LatencyMs + DelayMs) * 1000L; float[]? hit = null;
        lock (_l)
        {
            while (_pending.Count > 0 && _pending.Keys[0] < want - SlotUs / 2) { _pending.RemoveAt(0); Late++; }
            if (_pending.Count > 0 && _pending.Keys[0] < want + SlotUs / 2) { hit = _pending.Values[0]; _pending.RemoveAt(0); }
        }
        var b = new byte[FrameSamples * 4];
        if (hit != null) ToS16(hit, b, Gain); else SlotsSilent++;
        SlotsOut++;
        return b;
    }

    /// <summary>Writes every slot due by <paramref name="nowUs"/> (+ preroll). Public so tests can drive it with a fake clock.</summary>
    public int Tick(long nowUs)
    {
        if (_start < 0) _start = nowUs;
        int n = 0;
        while (_start + _k * SlotUs <= nowUs + PrerollMs * 1000L)
        {
            var pcm = Slot(_start + _k * SlotUs); _k++; n++;
            lock (_readers) foreach (var c in _readers) c.Writer.TryWrite(pcm);
        }
        return n;
    }

    async Task Pump(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { Tick(_clock.NowUs); await Task.Delay(10, ct); }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { Log?.Invoke("pump: " + e.Message); }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel(); if (_pump != null) try { await _pump; } catch { }
        lock (_readers) { foreach (var c in _readers) c.Writer.TryComplete(); _readers.Clear(); }
    }
}
