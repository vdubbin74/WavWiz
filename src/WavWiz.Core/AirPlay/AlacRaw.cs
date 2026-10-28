namespace WavWiz.Core.AirPlay;

/// <summary>
/// Packs 16-bit stereo PCM into an ALAC "uncompressed" (escape) frame, which every ALAC decoder accepts:
/// 3-bit channel tag (1 = stereo pair), 4+12 reserved bits, has-size=0, 2 unused bits, is-not-compressed=1,
/// then big-endian interleaved samples, then the 3-bit END tag (7). Layout per Apple's open-source ALAC (Apache-2.0).
/// </summary>
public static class AlacRaw
{
    public static int Size(int frames) => (23 + frames * 32 + 3 + 7) / 8;

    /// <summary>Encodes interleaved L/R samples (frames*2 values) into <paramref name="dst"/>; returns bytes written.</summary>
    public static int Encode(ReadOnlySpan<short> pcm, Span<byte> dst)
    {
        int frames = pcm.Length / 2;
        var w = new BitWriter(dst);
        w.Write(1, 3); w.Write(0, 4); w.Write(0, 12); w.Write(0, 1); w.Write(0, 2); w.Write(1, 1);
        for (int i = 0; i < frames * 2; i++) w.Write((ushort)pcm[i], 16);
        w.Write(7, 3);
        return w.Bytes;
    }

    /// <summary>Decodes an escape frame back to PCM (used by tests and the loopback receiver).</summary>
    public static short[] Decode(ReadOnlySpan<byte> src, int frames)
    {
        var r = new BitReader(src);
        if (r.Read(3) != 1) throw new InvalidDataException("not a stereo element");
        r.Read(4); r.Read(12); bool hasSize = r.Read(1) == 1; r.Read(2);
        if (hasSize) frames = (int)r.Read(32);
        if (r.Read(1) != 1) throw new InvalidDataException("compressed ALAC frame");
        var pcm = new short[frames * 2];
        for (int i = 0; i < pcm.Length; i++) pcm[i] = (short)r.Read(16);
        return pcm;
    }

    ref struct BitWriter
    {
        readonly Span<byte> _b; int _bit;
        public BitWriter(Span<byte> b) { _b = b; _bit = 0; b.Clear(); }
        public void Write(uint v, int n)
        {
            for (int i = n - 1; i >= 0; i--)
            {
                if (((v >> i) & 1) != 0) _b[_bit >> 3] |= (byte)(0x80 >> (_bit & 7));
                _bit++;
            }
        }
        public int Bytes => (_bit + 7) >> 3;
    }

    ref struct BitReader
    {
        readonly ReadOnlySpan<byte> _b; int _bit;
        public BitReader(ReadOnlySpan<byte> b) { _b = b; _bit = 0; }
        public uint Read(int n)
        {
            uint v = 0;
            for (int i = 0; i < n; i++) { v = (v << 1) | (uint)((_b[_bit >> 3] >> (7 - (_bit & 7))) & 1); _bit++; }
            return v;
        }
    }
}
