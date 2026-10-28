using System.Buffers.Binary;
using System.Text;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// Minimal Apple binary property list ("bplist00") writer/reader for AirPlay 2 RTSP bodies. Written from the public
/// format description (header, object table, offset table, 32-byte trailer). Supports dict (string keys), array,
/// string (ASCII / UTF-16BE), integer, real, bool, data. Values: Dictionary&lt;string, object?&gt;, IList&lt;object?&gt;,
/// string, long/int/uint/ulong, double, bool, byte[].
/// </summary>
public static class BPlist
{
    public static byte[] Write(object root)
    {
        var objs = new List<object>(); Flatten(root, objs);
        int refSize = objs.Count < 256 ? 1 : 2;
        var index = new Dictionary<object, int>(ReferenceEqualityComparer.Instance);
        for (int i = 0; i < objs.Count; i++) index[objs[i]] = i;
        var ms = new MemoryStream(); ms.Write("bplist00"u8);
        var offsets = new long[objs.Count];
        for (int i = 0; i < objs.Count; i++) { offsets[i] = ms.Position; WriteObj(ms, objs[i], index, refSize); }
        long table = ms.Position;
        int offSize = table < 256 ? 1 : table < 65536 ? 2 : 4;
        foreach (var o in offsets) WriteBe(ms, (ulong)o, offSize);
        var tr = new byte[32]; tr[6] = (byte)offSize; tr[7] = (byte)refSize;
        BinaryPrimitives.WriteUInt64BigEndian(tr.AsSpan(8), (ulong)objs.Count);
        BinaryPrimitives.WriteUInt64BigEndian(tr.AsSpan(16), 0);
        BinaryPrimitives.WriteUInt64BigEndian(tr.AsSpan(24), (ulong)table);
        ms.Write(tr); return ms.ToArray();
    }

    // Boxed primitives are each their own object (no uniquing), which every reader accepts.
    static void Flatten(object o, List<object> objs)
    {
        objs.Add(o);
        if (o is IDictionary<string, object?> d)
        {
            var keys = d.Keys.Select(k => (object)new KeyBox(k)).ToList();
            var vals = d.Values.Select(v => v ?? "").ToList();
            _children[o] = (keys, vals);
            foreach (var k in keys) objs.Add(k);
            foreach (var v in vals) Flatten(v, objs);
        }
        else if (o is System.Collections.IList l && o is not byte[])
        {
            var items = l.Cast<object?>().Select(v => v ?? "").ToList();
            _children[o] = (items, null);
            foreach (var v in items) Flatten(v, objs);
        }
    }
    sealed record KeyBox(string K);
    [ThreadStatic] static Dictionary<object, (List<object>, List<object>?)>? _ch;
    static Dictionary<object, (List<object>, List<object>?)> _children => _ch ??= new(ReferenceEqualityComparer.Instance);

    static void WriteObj(System.IO.Stream s, object o, Dictionary<object, int> idx, int rs)
    {
        switch (o)
        {
            case KeyBox k: WriteString(s, k.K); break;
            case string str: WriteString(s, str); break;
            case bool b: s.WriteByte(b ? (byte)0x09 : (byte)0x08); break;
            case byte[] data: Marker(s, 0x4, data.Length); s.Write(data); break;
            case double dv: s.WriteByte(0x23); var db = new byte[8]; BinaryPrimitives.WriteDoubleBigEndian(db, dv); s.Write(db); break;
            case float fv: s.WriteByte(0x23); var fb = new byte[8]; BinaryPrimitives.WriteDoubleBigEndian(fb, fv); s.Write(fb); break;
            case IDictionary<string, object?>:
            {
                var (keys, vals) = _children[o]; _children.Remove(o);
                Marker(s, 0xD, keys.Count);
                foreach (var k in keys) WriteBe(s, (ulong)idx[k], rs);
                foreach (var v in vals!) WriteBe(s, (ulong)idx[v], rs);
                break;
            }
            case System.Collections.IList:
            {
                var (items, _) = _children[o]; _children.Remove(o);
                Marker(s, 0xA, items.Count);
                foreach (var v in items) WriteBe(s, (ulong)idx[v], rs);
                break;
            }
            default:
            {
                long v = Convert.ToInt64(o);
                if (v < 0) { s.WriteByte(0x13); WriteBe(s, (ulong)v, 8); }
                else if (v < 256) { s.WriteByte(0x10); s.WriteByte((byte)v); }
                else if (v < 65536) { s.WriteByte(0x11); WriteBe(s, (ulong)v, 2); }
                else if (v <= uint.MaxValue) { s.WriteByte(0x12); WriteBe(s, (ulong)v, 4); }
                else { s.WriteByte(0x13); WriteBe(s, (ulong)v, 8); }
                break;
            }
        }
    }
    static void WriteString(System.IO.Stream s, string str)
    {
        if (str.All(c => c < 128)) { Marker(s, 0x5, str.Length); s.Write(Encoding.ASCII.GetBytes(str)); }
        else { Marker(s, 0x6, str.Length); s.Write(Encoding.BigEndianUnicode.GetBytes(str)); }
    }
    static void Marker(System.IO.Stream s, int type, int len)
    {
        if (len < 15) { s.WriteByte((byte)(type << 4 | len)); return; }
        s.WriteByte((byte)(type << 4 | 0xF));
        if (len < 256) { s.WriteByte(0x10); s.WriteByte((byte)len); }
        else if (len < 65536) { s.WriteByte(0x11); WriteBe(s, (ulong)len, 2); }
        else { s.WriteByte(0x12); WriteBe(s, (ulong)len, 4); }
    }
    static void WriteBe(System.IO.Stream s, ulong v, int n) { for (int i = n - 1; i >= 0; i--) s.WriteByte((byte)(v >> (8 * i))); }

    public static object? Read(byte[] b)
    {
        if (b.Length < 40 || Encoding.ASCII.GetString(b, 0, 6) != "bplist") throw new FormatException("not a bplist");
        var t = b.AsSpan(b.Length - 32);
        int offSize = t[6], refSize = t[7];
        int n = (int)BinaryPrimitives.ReadUInt64BigEndian(t[8..]); int top = (int)BinaryPrimitives.ReadUInt64BigEndian(t[16..]);
        long table = (long)BinaryPrimitives.ReadUInt64BigEndian(t[24..]);
        long Off(int i) => (long)Be(b, table + (long)i * offSize, offSize);
        object? Obj(int i, int depth)
        {
            if (depth > 64) throw new FormatException("too deep");
            long p = Off(i); byte m = b[p]; int hi = m >> 4, lo = m & 0xF; long q = p + 1;
            int Len() { if (lo != 0xF) return lo; int sz = 1 << (b[q] & 0xF); int l = (int)Be(b, q + 1, sz); q += 1 + sz; return l; }
            switch (hi)
            {
                case 0x0: return lo == 0x9 ? true : lo == 0x8 ? false : null;
                case 0x1: { int sz = 1 << lo; ulong v = Be(b, q, sz); return sz == 8 ? (long)v : (long)v; }
                case 0x2: return lo == 3 ? BinaryPrimitives.ReadDoubleBigEndian(b.AsSpan((int)q)) : BinaryPrimitives.ReadSingleBigEndian(b.AsSpan((int)q));
                case 0x3: return DateTime.UnixEpoch.AddSeconds(978307200 + BinaryPrimitives.ReadDoubleBigEndian(b.AsSpan((int)q)));
                case 0x4: { int l = Len(); return b.AsSpan((int)q, l).ToArray(); }
                case 0x5: { int l = Len(); return Encoding.ASCII.GetString(b, (int)q, l); }
                case 0x6: { int l = Len(); return Encoding.BigEndianUnicode.GetString(b, (int)q, l * 2); }
                case 0x8: return (long)Be(b, q, lo + 1);
                case 0xA: { int l = Len(); var r = new List<object?>(l); for (int k = 0; k < l; k++) r.Add(Obj((int)Be(b, q + (long)k * refSize, refSize), depth + 1)); return r; }
                case 0xD:
                {
                    int l = Len(); var r = new Dictionary<string, object?>();
                    for (int k = 0; k < l; k++)
                        r[(string)Obj((int)Be(b, q + (long)k * refSize, refSize), depth + 1)!] = Obj((int)Be(b, q + (long)(l + k) * refSize, refSize), depth + 1);
                    return r;
                }
                default: throw new FormatException($"bplist marker 0x{m:X2}");
            }
        }
        return Obj(top, 0);
    }
    static ulong Be(byte[] b, long o, int n) { ulong v = 0; for (int i = 0; i < n; i++) v = v << 8 | b[o + i]; return v; }

    public static Dictionary<string, object?> Dict(byte[] b) => Read(b) as Dictionary<string, object?> ?? throw new FormatException("bplist root is not a dict");
    public static long Int(this Dictionary<string, object?> d, string k) => d.TryGetValue(k, out var v) && v is long l ? l : 0;
}
