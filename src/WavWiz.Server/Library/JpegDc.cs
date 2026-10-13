namespace WavWiz.Server.Library;

/// <summary>0.3.2 F10/F11: a tiny managed JPEG reader that returns the 8x8 block averages (the DC terms) of a baseline JPEG as 8-bit RGB.
/// The thumbnail validator uses it instead of "ffmpeg -f rawvideo", which the shipped LGPL ffmpeg does not have. Baseline / extended
/// Huffman only (that is what our own mjpeg thumbnails are); anything else throws NotSupportedException so the caller can tell
/// "could not check" apart from "checked and bad".</summary>
public static class JpegDc
{
    sealed class Huff { public int[] Min = new int[17], Max = new int[17], Ptr = new int[17]; public byte[] Vals = Array.Empty<byte>(); }
    sealed class Comp { public int Id, H, V, Tq, Td, Ta, Pred; public int[] Dc = Array.Empty<int>(); public int Bw, Bh; }

    public static (byte[] Rgb, int W, int H) Decode(byte[] d)
    {
        if (d.Length < 4 || d[0] != 0xFF || d[1] != 0xD8) throw new FormatException("not a JPEG");
        var q = new int[4][]; var dc = new Huff?[4]; var ac = new Huff?[4]; Comp[]? comps = null; int w = 0, h = 0, dri = 0, pos = 2;
        while (pos + 4 <= d.Length)
        {
            if (d[pos] != 0xFF) throw new FormatException("bad marker");
            int m = d[pos + 1]; pos += 2;
            if (m == 0xFF) { pos--; continue; }
            if (m == 0xD8 || (m >= 0xD0 && m <= 0xD7) || m == 0x01) continue;
            if (m == 0xD9) break;
            int len = (d[pos] << 8) | d[pos + 1]; int seg = pos + 2, end = pos + len; if (end > d.Length) throw new FormatException("truncated");
            switch (m)
            {
                case 0xDB:
                    for (int p = seg; p < end;) { int pq = d[p] >> 4, tq = d[p] & 3; p++; var t = new int[64]; for (int i = 0; i < 64; i++) { t[i] = pq == 0 ? d[p] : (d[p] << 8) | d[p + 1]; p += pq == 0 ? 1 : 2; } q[tq] = t; }
                    break;
                case 0xC4:
                    for (int p = seg; p < end;)
                    {
                        int tc = d[p] >> 4, th = d[p] & 3; p++; var cnt = new int[17]; int tot = 0; for (int i = 1; i <= 16; i++) { cnt[i] = d[p++]; tot += cnt[i]; }
                        var hf = new Huff { Vals = d.AsSpan(p, tot).ToArray() }; p += tot;
                        int code = 0, k = 0; for (int l = 1; l <= 16; l++) { hf.Ptr[l] = k; hf.Min[l] = code; code += cnt[l]; k += cnt[l]; hf.Max[l] = cnt[l] > 0 ? code - 1 : -1; code <<= 1; }
                        if (tc == 0) dc[th] = hf; else ac[th] = hf;
                    }
                    break;
                case 0xC0: case 0xC1:
                    h = (d[seg + 1] << 8) | d[seg + 2]; w = (d[seg + 3] << 8) | d[seg + 4]; int n = d[seg + 5];
                    if (d[seg] != 8 || w == 0 || h == 0 || n is not (1 or 3)) throw new NotSupportedException("JPEG layout");
                    comps = new Comp[n]; for (int i = 0; i < n; i++) { int o = seg + 6 + i * 3; comps[i] = new Comp { Id = d[o], H = Math.Max(1, d[o + 1] >> 4), V = Math.Max(1, d[o + 1] & 15), Tq = d[o + 2] & 3 }; }
                    break;
                case 0xC2: case 0xC3: case 0xC5: case 0xC6: case 0xC7: case 0xC9: case 0xCA: case 0xCB: case 0xCD: case 0xCE: case 0xCF:
                    throw new NotSupportedException("progressive/lossless/arithmetic JPEG");
                case 0xDD: dri = (d[seg] << 8) | d[seg + 1]; break;
                case 0xDA:
                    if (comps == null) throw new FormatException("scan before frame");
                    int ns = d[seg]; if (ns != comps.Length) throw new NotSupportedException("non-interleaved scan");
                    for (int i = 0; i < ns; i++) { var c = comps.First(x => x.Id == d[seg + 1 + i * 2]); c.Td = d[seg + 2 + i * 2] >> 4; c.Ta = d[seg + 2 + i * 2] & 3; }
                    return Scan(d, end, comps, q, dc, ac, w, h, dri);
            }
            pos = end;
        }
        throw new FormatException("no image data");
    }

    static (byte[], int, int) Scan(byte[] d, int pos, Comp[] comps, int[][] q, Huff?[] dct, Huff?[] act, int w, int h, int dri)
    {
        int hm = comps.Max(c => c.H), vm = comps.Max(c => c.V), mx = (w + 8 * hm - 1) / (8 * hm), my = (h + 8 * vm - 1) / (8 * vm);
        foreach (var c in comps) { c.Bw = mx * c.H; c.Bh = my * c.V; c.Dc = new int[c.Bw * c.Bh]; if (q[c.Tq] == null || dct[c.Td] == null || act[c.Ta] == null) throw new FormatException("missing table"); }
        int bitBuf = 0, bits = 0; bool hitMarker = false;
        int Bit()
        {
            if (bits == 0)
            {
                int b = 0;
                if (!hitMarker && pos < d.Length)
                {
                    b = d[pos];
                    if (b == 0xFF) { int nx = pos + 1 < d.Length ? d[pos + 1] : 0xD9; if (nx == 0) pos += 2; else { hitMarker = true; b = 0; } }
                    else pos++;
                }
                bitBuf = b; bits = 8;
            }
            bits--; return (bitBuf >> bits) & 1;
        }
        int Get(int n) { int v = 0; for (int i = 0; i < n; i++) v = (v << 1) | Bit(); return v; }
        int Dec(Huff hf) { int code = 0; for (int l = 1; l <= 16; l++) { code = (code << 1) | Bit(); if (hf.Max[l] >= code && code >= hf.Min[l] && hf.Max[l] >= 0) return hf.Vals[hf.Ptr[l] + code - hf.Min[l]]; } throw new FormatException("bad Huffman code"); }
        int Ext(int v, int s) => s == 0 ? 0 : v < (1 << (s - 1)) ? v - (1 << s) + 1 : v;
        int mcu = 0;
        for (int y = 0; y < my; y++)
            for (int x = 0; x < mx; x++)
            {
                if (dri > 0 && mcu > 0 && mcu % dri == 0)
                {
                    bits = 0; hitMarker = false;
                    while (pos + 1 < d.Length && !(d[pos] == 0xFF && d[pos + 1] >= 0xD0 && d[pos + 1] <= 0xD7)) pos++;
                    pos += 2; foreach (var c in comps) c.Pred = 0;
                }
                mcu++;
                foreach (var c in comps)
                    for (int v = 0; v < c.V; v++)
                        for (int u = 0; u < c.H; u++)
                        {
                            int s = Dec(dct[c.Td]!); if (s > 11) throw new FormatException("bad DC");
                            c.Pred += Ext(Get(s), s);
                            c.Dc[(y * c.V + v) * c.Bw + x * c.H + u] = c.Pred * q[c.Tq][0];
                            for (int k = 1; k < 64;)
                            {
                                int rs = Dec(act[c.Ta]!), r = rs >> 4, sz = rs & 15;
                                if (sz == 0) { if (r == 15) { k += 16; continue; } break; }
                                k += r; Get(sz); k++;
                            }
                        }
            }
        int ow = (w + 7) / 8, oh = (h + 7) / 8; var rgb = new byte[ow * oh * 3];
        static byte Cl(double v) => (byte)Math.Clamp((int)Math.Round(v), 0, 255);
        for (int by = 0; by < oh; by++)
            for (int bx = 0; bx < ow; bx++)
            {
                double S(Comp c) { int cx = Math.Min(c.Bw - 1, bx * c.H / hm), cy = Math.Min(c.Bh - 1, by * c.V / vm); return c.Dc[cy * c.Bw + cx] / 8.0 + 128; }
                double Y = S(comps[0]); int i = (by * ow + bx) * 3;
                if (comps.Length == 1) { rgb[i] = rgb[i + 1] = rgb[i + 2] = Cl(Y); continue; }
                double cb = S(comps[1]) - 128, cr = S(comps[2]) - 128;
                rgb[i] = Cl(Y + 1.402 * cr); rgb[i + 1] = Cl(Y - 0.344136 * cb - 0.714136 * cr); rgb[i + 2] = Cl(Y + 1.772 * cb);
            }
        return (rgb, ow, oh);
    }
}
