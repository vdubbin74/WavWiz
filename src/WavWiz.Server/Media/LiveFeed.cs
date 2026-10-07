namespace WavWiz.Server.Media;

/// <summary>
/// 0.1.1: audio pushed by an outside sender (AirPlay, Spotify Connect) at the sender's own clock. The receiver thread writes 16-bit PCM (any rate,
/// converted to the house format 48 kHz stereo float with a 4-point cubic resampler); the house stream reads it through <see cref="OpenDecoder"/>.
/// Never blocks the writer: if nobody is reading (WavWiz stopped) the oldest audio is dropped. The decoder keeps about <see cref="TargetMs"/> buffered
/// (the "~2 s AirPlay buffer" together with the house lead) and trims when the sender's clock runs fast, re-buffers when it runs dry.
/// </summary>
public sealed class LiveFeed
{
    private readonly PcmRing _ring = new(48000 * 8);
    private double _pos; private readonly float[] _hist = new float[8]; private int _histN;        // resampler state (last 4 stereo input frames)
    private long _lastDataTicks; private long _framesIn;
    private readonly object _wl = new();
    public int TargetMs { get; init; } = 1800;
    public volatile float Gain = 1f;
    public long FramesIn => Interlocked.Read(ref _framesIn);
    public int BufferedMs => _ring.Count / 48;
    /// <summary>Audio arrived within the last 1.5 s (the sender is playing, not paused).</summary>
    public bool Active => Environment.TickCount64 - Interlocked.Read(ref _lastDataTicks) < 1500;
    internal int FlushGen;
    // 0.1.3 receiver health
    private int _underruns; private long _lastReadTicks, _lastUnderrunTicks;
    /// <summary>Times the house ran dry while the sender was still sending (network hiccup, Wi-Fi drop) since the service started.</summary>
    public int Underruns => Volatile.Read(ref _underruns);
    public long? LastUnderrunAgoMs => Interlocked.Read(ref _lastUnderrunTicks) is var t && t > 0 ? Environment.TickCount64 - t : null;
    /// <summary>Milliseconds since audio last arrived from the sender (null = never).</summary>
    public long? DataAgeMs => Interlocked.Read(ref _lastDataTicks) is var t && t > 0 ? Environment.TickCount64 - t : null;
    /// <summary>The house stream read from this feed within the last 2 s.</summary>
    public bool Reading => Environment.TickCount64 - Interlocked.Read(ref _lastReadTicks) < 2000;
    internal void NoteRead() => Interlocked.Exchange(ref _lastReadTicks, Environment.TickCount64);
    internal void NoteUnderrun() { Interlocked.Increment(ref _underruns); Interlocked.Exchange(ref _lastUnderrunTicks, Environment.TickCount64); }

    /// <summary>Interleaved little-endian 16-bit PCM from the receiver process.</summary>
    public void WriteS16(ReadOnlySpan<byte> bytes, int rate, int channels = 2)
    {
        int frames = bytes.Length / (2 * channels); if (frames == 0) return;
        var src = new float[frames * 2];
        for (int i = 0; i < frames; i++)
        {
            int o = i * 2 * channels;
            float l = (short)(bytes[o] | bytes[o + 1] << 8) / 32768f, r = channels > 1 ? (short)(bytes[o + 2] | bytes[o + 3] << 8) / 32768f : l;
            src[i * 2] = l; src[i * 2 + 1] = r;
        }
        WriteFloat(src, rate);
    }

    public void WriteFloat(ReadOnlySpan<float> src, int rate)
    {
        lock (_wl)
        {
            var outBuf = rate == 48000 ? src.ToArray() : Resample(src, rate);
            int room = _ring.Capacity - _ring.Count, n = outBuf.Length / 2;
            if (n > room) { var junk = new float[(n - room) * 2]; _ring.Read(junk, n - room); }        // nobody reading: drop the oldest
            _ring.Write(outBuf, CancellationToken.None);
            Interlocked.Add(ref _framesIn, src.Length / 2); Interlocked.Exchange(ref _lastDataTicks, Environment.TickCount64);
        }
    }

    /// <summary>Catmull-Rom interpolation from <paramref name="rate"/> to 48 kHz. State carries across calls so packet joins are seamless.</summary>
    private float[] Resample(ReadOnlySpan<float> src, int rate)
    {
        double step = rate / 48000.0; int inFrames = src.Length / 2;
        var all = new float[(_histN + inFrames) * 2];
        Array.Copy(_hist, 0, all, 0, _histN * 2); src.CopyTo(all.AsSpan(_histN * 2));
        int total = _histN + inFrames; var res = new List<float>((int)(inFrames / step) * 2 + 8);
        // _pos indexes "all"; frame k needs k-1..k+2
        while (_pos + 2 < total)
        {
            int k = (int)_pos; double t = _pos - k;
            for (int c = 0; c < 2; c++)
            {
                float p0 = all[Math.Max(0, k - 1) * 2 + c], p1 = all[k * 2 + c], p2 = all[(k + 1) * 2 + c], p3 = all[(k + 2) * 2 + c];
                double v = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
                res.Add((float)v);
            }
            _pos += step;
        }
        int keep = Math.Min(4, total); int drop = total - keep;
        Array.Copy(all, drop * 2, _hist, 0, keep * 2); _histN = keep; _pos -= drop;
        return res.ToArray();
    }

    /// <summary>The sender paused, skipped or seeked: forget what is buffered.</summary>
    public void Flush() { lock (_wl) { _ring.Clear(); _histN = 0; _pos = 0; FlushGen++; } }

    public IPcmDecoder OpenDecoder() => new Decoder(this);

    private sealed class Decoder : IPcmDecoder
    {
        private readonly LiveFeed _f; private bool _buffering = true; private int _gen;
        public Decoder(LiveFeed f) { _f = f; _gen = f.FlushGen; }
        public bool Finished => false;
        public string? Error => null;
        public void Dispose() { }
        public int Read(Span<float> dst, int frames)
        {
            int target = _f.TargetMs * 48; _f.NoteRead();
            if (_gen != _f.FlushGen) { _gen = _f.FlushGen; _buffering = true; }
            if (_buffering) { if (_f._ring.Count < target) return 0; _buffering = false; }
            int have = _f._ring.Count;
            if (have > target + 48000) { var junk = new float[(have - target) * 2]; _f._ring.Read(junk, have - target); }   // sender clock ran ahead: trim back to the target
            int n = _f._ring.Read(dst, frames);
            if (n == 0) { _buffering = true; if (_f.Active) _f.NoteUnderrun(); return 0; }                                                  // dry (paused / network gap): the house stream pads silence
            float g = _f.Gain; if (g != 1f) for (int i = 0; i < n * 2; i++) dst[i] *= g;
            return n;
        }
    }
}
