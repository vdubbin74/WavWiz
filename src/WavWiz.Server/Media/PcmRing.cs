namespace WavWiz.Server.Media;

/// <summary>Thread-safe ring of interleaved stereo float frames. The writer blocks (backpressure) when full; the reader never blocks.</summary>
public sealed class PcmRing
{
    private readonly float[] _buf; private readonly int _cap; private int _r, _count; private readonly object _l = new();
    public PcmRing(int capacityFrames) { _cap = capacityFrames; _buf = new float[capacityFrames * 2]; }
    public int Count { get { lock (_l) return _count; } }
    public int Capacity => _cap;

    /// <summary>Returns false if canceled while waiting for room.</summary>
    public bool Write(ReadOnlySpan<float> interleaved, CancellationToken ct)
    {
        int frames = interleaved.Length / 2, done = 0;
        while (done < frames)
        {
            lock (_l)
            {
                int room = _cap - _count, n = Math.Min(room, frames - done);
                int w = (_r + _count) % _cap;
                for (int i = 0; i < n; i++) { int p = (w + i) % _cap; _buf[p * 2] = interleaved[(done + i) * 2]; _buf[p * 2 + 1] = interleaved[(done + i) * 2 + 1]; }
                _count += n; done += n;
            }
            if (done < frames) { if (ct.IsCancellationRequested) return false; Thread.Sleep(5); }
        }
        return true;
    }

    public int Read(Span<float> dst, int frames)
    {
        lock (_l)
        {
            int n = Math.Min(frames, _count);
            for (int i = 0; i < n; i++) { int p = (_r + i) % _cap; dst[i * 2] = _buf[p * 2]; dst[i * 2 + 1] = _buf[p * 2 + 1]; }
            _r = (_r + n) % _cap; _count -= n;
            return n;
        }
    }

    public void Clear() { lock (_l) { _r = 0; _count = 0; } }
}

public interface IPcmDecoder : IDisposable
{
    int Read(Span<float> dst, int frames);
    /// <summary>All audio has been delivered (end of file) or the decoder failed.</summary>
    bool Finished { get; }
    string? Error { get; }
}
