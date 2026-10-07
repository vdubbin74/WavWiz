namespace WavWiz.Core.Playback;

/// <summary>
/// Ring of 20 ms frames keyed by absolute sample index within one epoch. One writer (network thread), one reader
/// (audio thread). The slot start index is published last, so a reader never sees a half-written frame.
/// </summary>
public sealed class JitterBuffer
{
    public const int Capacity = 1024; // 20.48 s of frames
    private readonly long[] _start = new long[Capacity];
    private readonly float[]?[] _data = new float[]?[Capacity];
    private readonly int[] _count = new int[Capacity];
    private long _highWater; // one past the last buffered sample index

    public JitterBuffer() { Array.Fill(_start, -1L); }

    public long HighWater => Volatile.Read(ref _highWater);

    public bool Put(long startIdx, ReadOnlySpan<float> interleaved, int sampleCount, int frameSamples = Wire_FrameSamples)
    {
        if (startIdx < 0 || startIdx % frameSamples != 0 || sampleCount <= 0 || sampleCount > frameSamples) return false;
        int slot = (int)((startIdx / frameSamples) % Capacity);
        var arr = _data[slot] ??= new float[frameSamples * 2];
        Volatile.Write(ref _start[slot], -1L);         // invalidate while rewriting
        interleaved[..(sampleCount * 2)].CopyTo(arr);
        _count[slot] = sampleCount;
        Volatile.Write(ref _start[slot], startIdx);
        long end = startIdx + sampleCount;
        if (end > _highWater) Volatile.Write(ref _highWater, end);
        return true;
    }

    public bool TryGet(long idx, out float left, out float right, int frameSamples = Wire_FrameSamples)
    {
        left = right = 0;
        if (idx < 0) return false;
        long frameStart = idx - idx % frameSamples;
        int slot = (int)((frameStart / frameSamples) % Capacity);
        if (Volatile.Read(ref _start[slot]) != frameStart) return false;
        int off = (int)(idx - frameStart);
        if (off >= _count[slot]) return false;
        var arr = _data[slot]!;
        left = arr[off * 2]; right = arr[off * 2 + 1];
        return true;
    }

    private const int Wire_FrameSamples = Protocol.Wire.FrameSamples;
}
