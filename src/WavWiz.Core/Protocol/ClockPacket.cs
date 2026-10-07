using System.Buffers.Binary;
using System.Security.Cryptography;
namespace WavWiz.Core.Protocol;

/// <summary>
/// UDP clock channel (spec 6.2). PING = 'UCLK' | 1 | sessionId | seq | t0 | mac16.  PONG = 'UCLK' | 2 | sessionId | seq | t0 | t1 | t2 | mac16.
/// The MAC is HMAC-SHA256(clockKey, everything before it) truncated to 16 bytes; the per-session key is handed to the player in WELCOME,
/// so time cannot be spoofed on the LAN and the server never answers (or amplifies) unauthenticated datagrams.
/// </summary>
public static class ClockPacket
{
    public const int MacLen = 16;
    public const int PingLen = 4 + 1 + 4 + 4 + 8 + MacLen;
    public const int PongLen = 4 + 1 + 4 + 4 + 8 + 8 + 8 + MacLen;
    private static readonly byte[] Tag = "UCLK"u8.ToArray();

    public static byte[] EncodePing(uint sessionId, uint seq, long t0, byte[] key)
    {
        var b = new byte[PingLen];
        Tag.CopyTo(b, 0); b[4] = 1;
        BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(5), sessionId);
        BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(9), seq);
        BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(13), t0);
        Mac(key, b.AsSpan(0, PingLen - MacLen)).CopyTo(b.AsSpan(PingLen - MacLen));
        return b;
    }

    public static bool TryReadSessionId(ReadOnlySpan<byte> b, out uint sessionId)
    {
        sessionId = 0;
        if (b.Length != PingLen || !b[..4].SequenceEqual(Tag) || b[4] != 1) return false;
        sessionId = BinaryPrimitives.ReadUInt32LittleEndian(b[5..]);
        return true;
    }

    public static bool TryDecodePing(ReadOnlySpan<byte> b, byte[] key, out uint seq, out long t0)
    {
        seq = 0; t0 = 0;
        if (b.Length != PingLen || !b[..4].SequenceEqual(Tag) || b[4] != 1) return false;
        if (!CryptographicOperations.FixedTimeEquals(Mac(key, b[..(PingLen - MacLen)]), b[(PingLen - MacLen)..])) return false;
        seq = BinaryPrimitives.ReadUInt32LittleEndian(b[9..]); t0 = BinaryPrimitives.ReadInt64LittleEndian(b[13..]);
        return true;
    }

    public static byte[] EncodePong(uint sessionId, uint seq, long t0, long t1, long t2, byte[] key)
    {
        var b = new byte[PongLen];
        Tag.CopyTo(b, 0); b[4] = 2;
        BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(5), sessionId);
        BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(9), seq);
        BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(13), t0);
        BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(21), t1);
        BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(29), t2);
        Mac(key, b.AsSpan(0, PongLen - MacLen)).CopyTo(b.AsSpan(PongLen - MacLen));
        return b;
    }

    public static bool TryDecodePong(ReadOnlySpan<byte> b, byte[] key, out uint seq, out long t0, out long t1, out long t2)
    {
        seq = 0; t0 = t1 = t2 = 0;
        if (b.Length != PongLen || !b[..4].SequenceEqual(Tag) || b[4] != 2) return false;
        if (!CryptographicOperations.FixedTimeEquals(Mac(key, b[..(PongLen - MacLen)]), b[(PongLen - MacLen)..])) return false;
        seq = BinaryPrimitives.ReadUInt32LittleEndian(b[9..]);
        t0 = BinaryPrimitives.ReadInt64LittleEndian(b[13..]); t1 = BinaryPrimitives.ReadInt64LittleEndian(b[21..]); t2 = BinaryPrimitives.ReadInt64LittleEndian(b[29..]);
        return true;
    }

    private static byte[] Mac(byte[] key, ReadOnlySpan<byte> data) => HMACSHA256.HashData(key, data)[..MacLen];
}
