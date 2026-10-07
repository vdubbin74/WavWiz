using System.Buffers.Binary;
using System.Net;
using System.Text;
namespace WavWiz.Core.Discovery;

/// <summary>Just enough DNS wire format for multicast DNS service discovery (RFC 6762/6763): PTR, SRV, TXT and A records. No compression on output; compression pointers are understood on input.</summary>
public static class DnsWire
{
    public const ushort TypeA = 1, TypePtr = 12, TypeTxt = 16, TypeSrv = 33, TypeAny = 255;
    public sealed record Question(string Name, ushort Type, bool UnicastResponse);
    public sealed record Record(string Name, ushort Type, uint Ttl, byte[] Data);
    public sealed record Message(bool IsResponse, List<Question> Questions, List<Record> Records);

    public static byte[] EncodeName(string name)
    {
        using var ms = new MemoryStream();
        foreach (var label in name.TrimEnd('.').Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            var b = Encoding.UTF8.GetBytes(label); if (b.Length is 0 or > 63) throw new ArgumentException("bad DNS label");
            ms.WriteByte((byte)b.Length); ms.Write(b);
        }
        ms.WriteByte(0); return ms.ToArray();
    }

    public static byte[] Query(string name, ushort type, bool unicastResponse = true)
    {
        using var ms = new MemoryStream(); Span<byte> h = stackalloc byte[12]; h.Clear(); BinaryPrimitives.WriteUInt16BigEndian(h[4..], 1); ms.Write(h);
        ms.Write(EncodeName(name)); Span<byte> t = stackalloc byte[4]; BinaryPrimitives.WriteUInt16BigEndian(t, type); BinaryPrimitives.WriteUInt16BigEndian(t[2..], (ushort)(unicastResponse ? 0x8001 : 1)); ms.Write(t);
        return ms.ToArray();
    }

    public static byte[] Response(IEnumerable<Record> records)
    {
        var list = records.ToList(); using var ms = new MemoryStream(); Span<byte> h = stackalloc byte[12]; h.Clear(); Span<byte> t = stackalloc byte[10];
        BinaryPrimitives.WriteUInt16BigEndian(h[2..], 0x8400); BinaryPrimitives.WriteUInt16BigEndian(h[6..], (ushort)list.Count); ms.Write(h);
        foreach (var r in list)
        {
            ms.Write(EncodeName(r.Name)); t.Clear();
            BinaryPrimitives.WriteUInt16BigEndian(t, r.Type); BinaryPrimitives.WriteUInt16BigEndian(t[2..], 0x8001);        // class IN + cache-flush
            BinaryPrimitives.WriteUInt32BigEndian(t[4..], r.Ttl); BinaryPrimitives.WriteUInt16BigEndian(t[8..], (ushort)r.Data.Length); ms.Write(t); ms.Write(r.Data);
        }
        return ms.ToArray();
    }

    public static Record Ptr(string name, string target, uint ttl = 4500) => new(name, TypePtr, ttl, EncodeName(target));
    public static Record A(string name, IPAddress ip, uint ttl = 120) => new(name, TypeA, ttl, ip.GetAddressBytes());
    public static Record Srv(string name, string target, int port, uint ttl = 120)
    {
        var t = EncodeName(target); var d = new byte[6 + t.Length]; BinaryPrimitives.WriteUInt16BigEndian(d.AsSpan(4), (ushort)port); t.CopyTo(d, 6); return new Record(name, TypeSrv, ttl, d);
    }
    public static Record Txt(string name, IEnumerable<string> kv, uint ttl = 4500)
    {
        using var ms = new MemoryStream();
        foreach (var s in kv) { var b = Encoding.UTF8.GetBytes(s); if (b.Length is 0 or > 255) continue; ms.WriteByte((byte)b.Length); ms.Write(b); }
        if (ms.Length == 0) ms.WriteByte(0);
        return new Record(name, TypeTxt, ttl, ms.ToArray());
    }

    public static bool TryParse(ReadOnlySpan<byte> p, out Message? msg)
    {
        msg = null;
        try
        {
            if (p.Length < 12) return false;
            ushort flags = BinaryPrimitives.ReadUInt16BigEndian(p[2..]); int qd = BinaryPrimitives.ReadUInt16BigEndian(p[4..]), an = BinaryPrimitives.ReadUInt16BigEndian(p[6..]);
            int ns = BinaryPrimitives.ReadUInt16BigEndian(p[8..]), ar = BinaryPrimitives.ReadUInt16BigEndian(p[10..]);
            int pos = 12; var qs = new List<Question>(); var rs = new List<Record>();
            for (int i = 0; i < qd; i++)
            {
                var n = ReadName(p, ref pos); if (pos + 4 > p.Length) return false;
                ushort t = BinaryPrimitives.ReadUInt16BigEndian(p[pos..]), c = BinaryPrimitives.ReadUInt16BigEndian(p[(pos + 2)..]); pos += 4; qs.Add(new Question(n, t, (c & 0x8000) != 0));
            }
            for (int i = 0; i < an + ns + ar; i++)
            {
                var n = ReadName(p, ref pos); if (pos + 10 > p.Length) return false;
                ushort t = BinaryPrimitives.ReadUInt16BigEndian(p[pos..]); uint ttl = BinaryPrimitives.ReadUInt32BigEndian(p[(pos + 4)..]); int len = BinaryPrimitives.ReadUInt16BigEndian(p[(pos + 8)..]); pos += 10;
                if (pos + len > p.Length) return false;
                // names inside rdata may use compression pointers: expand PTR/SRV targets so Data is self-contained
                byte[] data;
                if (t == TypePtr) { int q = pos; data = EncodeName(ReadName(p, ref q)); }
                else if (t == TypeSrv && len >= 7) { int q = pos + 6; var tn = EncodeName(ReadName(p, ref q)); data = new byte[6 + tn.Length]; p.Slice(pos, 6).CopyTo(data); tn.CopyTo(data, 6); }
                else data = p.Slice(pos, len).ToArray();
                pos += len; rs.Add(new Record(n, t, ttl, data));
            }
            msg = new Message((flags & 0x8000) != 0, qs, rs); return true;
        }
        catch { return false; }
    }

    public static string ReadName(ReadOnlySpan<byte> p, ref int pos)
    {
        var sb = new StringBuilder(); int cur = pos; bool jumped = false; int guard = 0;
        while (true)
        {
            if (cur >= p.Length || guard++ > 64) throw new FormatException("bad name");
            int len = p[cur];
            if (len == 0) { cur++; break; }
            if ((len & 0xC0) == 0xC0) { int ptr = ((len & 0x3F) << 8) | p[cur + 1]; if (!jumped) pos = cur + 2; jumped = true; cur = ptr; continue; }
            if (cur + 1 + len > p.Length) throw new FormatException("bad label");
            if (sb.Length > 0) sb.Append('.'); sb.Append(Encoding.UTF8.GetString(p.Slice(cur + 1, len))); cur += 1 + len;
        }
        if (!jumped) pos = cur;
        return sb.ToString();
    }

    public static string NameOf(byte[] data) { int p = 0; return ReadName(data, ref p); }
    public static (int Port, string Target) SrvOf(byte[] data) { int p = 6; return (BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(4)), ReadName(data, ref p)); }
    public static Dictionary<string, string> TxtOf(byte[] data)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); int i = 0;
        while (i < data.Length) { int l = data[i++]; if (l == 0 || i + l > data.Length) break; var s = Encoding.UTF8.GetString(data, i, l); i += l; int eq = s.IndexOf('='); if (eq > 0) d[s[..eq]] = s[(eq + 1)..]; }
        return d;
    }
}
