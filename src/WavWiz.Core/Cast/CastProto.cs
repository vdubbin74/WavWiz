using System.Buffers.Binary;
using System.Text;
namespace WavWiz.Core.Cast;

// 0.7.0 F169 Google Cast sender. Clean-room from the published wire format: openscreen cast_channel.proto (BSD, field numbers only) and
// Google's Cast media message docs. pychromecast (MIT) and SharpCaster (MIT) were read as references; no code was copied.

/// <summary>One CASTV2 message (cast_channel.proto CastMessage). Only STRING payloads are used by the sender.</summary>
public sealed record CastMessage(string SourceId, string DestinationId, string Namespace, string? PayloadUtf8, byte[]? PayloadBinary = null, int ProtocolVersion = 0)
{
    public bool IsBinary => PayloadBinary != null && PayloadUtf8 == null;
}

/// <summary>Hand-rolled proto2 encoder/decoder for CastMessage (fields 1..7) and the 4-byte big-endian length framing on the TLS socket.</summary>
public static class CastProto
{
    /// <summary>Google: "The transport message maximum size is currently 64 KBytes."</summary>
    public const int MaxMessage = 64 * 1024;
    public const string NsConnection = "urn:x-cast:com.google.cast.tp.connection", NsHeartbeat = "urn:x-cast:com.google.cast.tp.heartbeat",
        NsReceiver = "urn:x-cast:com.google.cast.receiver", NsMedia = "urn:x-cast:com.google.cast.media";
    public const string SenderId = "sender-0", ReceiverId = "receiver-0";
    /// <summary>Default Media Receiver app id (chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID).</summary>
    public const string DefaultMediaReceiver = "CC1AD845";

    public static byte[] Encode(CastMessage m)
    {
        var b = new List<byte>(64 + (m.PayloadUtf8?.Length ?? 0));
        Varint(b, 1 << 3 | 0); Varint(b, (ulong)m.ProtocolVersion);
        Str(b, 2, m.SourceId); Str(b, 3, m.DestinationId); Str(b, 4, m.Namespace);
        bool bin = m.PayloadUtf8 == null && m.PayloadBinary != null;
        Varint(b, 5 << 3 | 0); Varint(b, bin ? 1UL : 0UL);
        if (bin) Bytes(b, 7, m.PayloadBinary!); else Str(b, 6, m.PayloadUtf8 ?? "");
        return b.ToArray();
    }

    /// <summary>Length-prefixed frame ready for the socket.</summary>
    public static byte[] Frame(CastMessage m)
    {
        var body = Encode(m); if (body.Length > MaxMessage) throw new InvalidOperationException($"cast message too large ({body.Length} bytes)");
        var f = new byte[4 + body.Length]; BinaryPrimitives.WriteUInt32BigEndian(f, (uint)body.Length); body.CopyTo(f, 4); return f;
    }

    public static bool TryDecode(ReadOnlySpan<byte> p, out CastMessage? m)
    {
        m = null; int pos = 0; int ver = 0; string? src = null, dst = null, ns = null, utf = null; byte[]? bin = null;
        try
        {
            while (pos < p.Length)
            {
                ulong key = ReadVarint(p, ref pos); int field = (int)(key >> 3), wt = (int)(key & 7);
                switch (wt)
                {
                    case 0: { ulong v = ReadVarint(p, ref pos); if (field == 1) ver = (int)v; break; }
                    case 2:
                        {
                            int len = checked((int)ReadVarint(p, ref pos)); if (len < 0 || pos + len > p.Length) return false;
                            var s = p.Slice(pos, len); pos += len;
                            switch (field) { case 2: src = Encoding.UTF8.GetString(s); break; case 3: dst = Encoding.UTF8.GetString(s); break; case 4: ns = Encoding.UTF8.GetString(s); break; case 6: utf = Encoding.UTF8.GetString(s); break; case 7: bin = s.ToArray(); break; }
                            break;
                        }
                    case 5: pos += 4; break;
                    case 1: pos += 8; break;
                    default: return false;
                }
                if (pos > p.Length) return false;
            }
        }
        catch (Exception) { return false; }
        if (src == null || dst == null || ns == null) return false;
        m = new CastMessage(src, dst, ns, utf, bin, ver); return true;
    }

    /// <summary>Reads one framed message; null at end of stream.</summary>
    public static async Task<CastMessage?> ReadAsync(System.IO.Stream s, CancellationToken ct)
    {
        var hdr = new byte[4];
        if (!await Fill(s, hdr, ct)) return null;
        uint len = BinaryPrimitives.ReadUInt32BigEndian(hdr);
        if (len > MaxMessage) throw new InvalidDataException($"cast frame too large ({len})");
        var body = new byte[len];
        if (!await Fill(s, body, ct)) return null;
        return TryDecode(body, out var m) ? m : throw new InvalidDataException("bad cast message");
    }

    static async Task<bool> Fill(System.IO.Stream s, byte[] buf, CancellationToken ct)
    {
        int got = 0;
        while (got < buf.Length) { int n = await s.ReadAsync(buf.AsMemory(got), ct); if (n == 0) return false; got += n; }
        return true;
    }

    static void Varint(List<byte> b, ulong v) { while (v >= 0x80) { b.Add((byte)(v | 0x80)); v >>= 7; } b.Add((byte)v); }
    static void Str(List<byte> b, int field, string s) => Bytes(b, field, Encoding.UTF8.GetBytes(s));
    static void Bytes(List<byte> b, int field, byte[] d) { Varint(b, (ulong)(field << 3 | 2)); Varint(b, (ulong)d.Length); b.AddRange(d); }
    static ulong ReadVarint(ReadOnlySpan<byte> p, ref int pos)
    {
        ulong v = 0; int shift = 0;
        while (true)
        {
            if (pos >= p.Length || shift > 63) throw new InvalidDataException("varint");
            byte x = p[pos++]; v |= (ulong)(x & 0x7F) << shift; if ((x & 0x80) == 0) return v; shift += 7;
        }
    }
}
