using System.Buffers.Binary;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace WavWiz.Core.AirPlay;

/// <summary>HomeKit-style TLV8: type, length (≤255), value; longer values are split into consecutive same-type items.</summary>
public static class Tlv8
{
    public const byte Method = 0, Identifier = 1, Salt = 2, PublicKey = 3, Proof = 4, EncryptedData = 5, State = 6, Error = 7, Signature = 10, Flags = 19;

    public static byte[] Encode(params (byte Type, byte[] Value)[] items)
    {
        var ms = new MemoryStream();
        foreach (var (t, v) in items)
        {
            int o = 0;
            do { int n = Math.Min(255, v.Length - o); ms.WriteByte(t); ms.WriteByte((byte)n); ms.Write(v, o, n); o += n; } while (o < v.Length);
        }
        return ms.ToArray();
    }

    public static Dictionary<byte, byte[]> Decode(ReadOnlySpan<byte> b)
    {
        var d = new Dictionary<byte, byte[]>(); int i = 0; byte last = 255;
        while (i + 2 <= b.Length)
        {
            byte t = b[i]; int n = b[i + 1]; var v = b.Slice(i + 2, n).ToArray(); i += 2 + n;
            d[t] = t == last && d.TryGetValue(t, out var prev) ? prev.Concat(v).ToArray() : v; last = t;
        }
        return d;
    }
}

/// <summary>
/// SRP-6a client (RFC 5054 math): k = H(N | PAD(g)), x = H(s | H(I ":" P)), u = H(PAD(A) | PAD(B)),
/// S = (B - k·g^x)^(a + u·x) mod N, K = H(S), M1 = H(H(N) xor H(g) | H(I) | s | A | B | K), M2 = H(A | M1 | K).
/// AirPlay 2 / HomeKit use the 3072-bit group with g = 5 and SHA-512.
/// </summary>
public sealed class Srp6aClient
{
    public static readonly BigInteger N3072 = Hex("FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF");
    public readonly BigInteger N, G; readonly HashAlgorithmName _h; readonly int _len;
    public BigInteger a, A, x, u, k, S;
    public byte[] K = Array.Empty<byte>(), M1 = Array.Empty<byte>();

    public Srp6aClient(BigInteger n, int g, HashAlgorithmName h, byte[]? a = null)
    {
        N = n; G = g; _h = h; _len = Bytes(N).Length;
        this.a = a != null ? FromBytes(a) : FromBytes(RandomNumberGenerator.GetBytes(32));
        A = BigInteger.ModPow(G, this.a, N);
        k = FromBytes(H(Pad(N), Pad(G)));
    }
    public static Srp6aClient AirPlay() => new(N3072, 5, HashAlgorithmName.SHA512);

    public byte[] PublicA => Bytes(A);

    /// <summary>Process the server's salt and B; returns M1 (client proof).</summary>
    public byte[] Process(string user, string pass, byte[] salt, byte[] serverB)
    {
        var B = FromBytes(serverB);
        if (B % N == 0) throw new CryptographicException("SRP: bad B");
        x = FromBytes(H(salt, H(Encoding.UTF8.GetBytes(user + ":" + pass))));
        u = FromBytes(H(Pad(A), Pad(B)));
        var gx = BigInteger.ModPow(G, x, N);
        var bas = ((B - k * gx) % N + N) % N;
        S = BigInteger.ModPow(bas, a + u * x, N);
        K = H(Bytes(S));
        var hn = H(Bytes(N)); var hg = H(Bytes(G));
        for (int i = 0; i < hn.Length; i++) hn[i] ^= hg[i];
        M1 = H(hn, H(Encoding.UTF8.GetBytes(user)), salt, Bytes(A), Bytes(B), K);
        return M1;
    }
    public bool Verify(byte[] m2) => CryptographicOperations.FixedTimeEquals(m2, H(Bytes(A), M1, K));

    byte[] H(params byte[][] parts)
    {
        using var ih = IncrementalHash.CreateHash(_h);
        foreach (var p in parts) ih.AppendData(p);
        return ih.GetHashAndReset();
    }
    byte[] Pad(BigInteger v) { var b = Bytes(v); if (b.Length >= _len) return b; var r = new byte[_len]; b.CopyTo(r, _len - b.Length); return r; }
    public static byte[] Bytes(BigInteger v) => v.ToByteArray(isUnsigned: true, isBigEndian: true);
    public static BigInteger FromBytes(byte[] b) => new(b, isUnsigned: true, isBigEndian: true);
    public static BigInteger Hex(string h) => FromBytes(Convert.FromHexString(h));
}

/// <summary>
/// HAP-style encrypted framing for the AirPlay 2 control connection after pairing: each block is a 2-byte little-endian
/// length (also the AAD), the ChaCha20-Poly1305 ciphertext and a 16-byte tag; nonce = 4 zero bytes + 64-bit LE counter
/// per direction. Plaintext blocks are at most 1024 bytes.
/// </summary>
public sealed class HapStream : System.IO.Stream
{
    readonly System.IO.Stream _inner; readonly ChaCha20Poly1305 _w, _r; ulong _wn, _rn;
    byte[] _rbuf = Array.Empty<byte>(); int _rpos;
    public HapStream(System.IO.Stream inner, byte[] writeKey, byte[] readKey) { _inner = inner; _w = new(writeKey); _r = new(readKey); }

    public static byte[] Nonce(ulong n) { var b = new byte[12]; BinaryPrimitives.WriteUInt64LittleEndian(b.AsSpan(4), n); return b; }

    public static byte[] Seal(ChaCha20Poly1305 c, ref ulong counter, ReadOnlySpan<byte> plain)
    {
        var ms = new MemoryStream();
        for (int o = 0; o < plain.Length || (o == 0 && plain.Length == 0); )
        {
            int n = Math.Min(1024, plain.Length - o);
            var aad = new byte[2]; BinaryPrimitives.WriteUInt16LittleEndian(aad, (ushort)n);
            var ct = new byte[n]; var tag = new byte[16];
            c.Encrypt(Nonce(counter++), plain.Slice(o, n), ct, tag, aad);
            ms.Write(aad); ms.Write(ct); ms.Write(tag); o += n;
            if (n == 0) break;
        }
        return ms.ToArray();
    }

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default)
    { var b = Seal(_w, ref _wn, buffer.Span); await _inner.WriteAsync(b, ct); }
    public override void Write(byte[] buffer, int offset, int count) => WriteAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        if (_rpos >= _rbuf.Length)
        {
            var hdr = new byte[2]; await ReadExactly(hdr, ct);
            int n = BinaryPrimitives.ReadUInt16LittleEndian(hdr);
            var body = new byte[n + 16]; await ReadExactly(body, ct);
            var plain = new byte[n];
            _r.Decrypt(Nonce(_rn++), body.AsSpan(0, n), body.AsSpan(n, 16), plain, hdr);
            _rbuf = plain; _rpos = 0;
            if (n == 0) return 0;
        }
        int c = Math.Min(buffer.Length, _rbuf.Length - _rpos);
        _rbuf.AsSpan(_rpos, c).CopyTo(buffer.Span); _rpos += c; return c;
    }
    async Task ReadExactly(byte[] b, CancellationToken ct) { int g = 0; while (g < b.Length) { int n = await _inner.ReadAsync(b.AsMemory(g), ct); if (n == 0) throw new IOException("closed"); g += n; } }
    public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override bool CanRead => true; public override bool CanWrite => true; public override bool CanSeek => false;
    public override long Length => throw new NotSupportedException(); public override long Position { get => 0; set => throw new NotSupportedException(); }
    public override void Flush() => _inner.Flush(); public override Task FlushAsync(CancellationToken ct) => _inner.FlushAsync(ct);
    public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException(); public override void SetLength(long v) => throw new NotSupportedException();
    protected override void Dispose(bool d) { if (d) { _w.Dispose(); _r.Dispose(); } base.Dispose(d); }
}

/// <summary>
/// AirPlay 2 transient pairing (no PIN entry, fixed setup code "3939", Flags = transient): pair-setup M1..M4 over SRP-6a,
/// then the control channel keys come straight from the SRP session key with HKDF-SHA512 ("Control-Salt",
/// "Control-Write-Encryption-Key" / "Control-Read-Encryption-Key"). Clean-room from the public HAP/AirPlay 2 descriptions.
/// </summary>
public static class Ap2Pairing
{
    public const string TransientUser = "Pair-Setup", TransientPin = "3939";
    public static readonly Dictionary<string, string> Hdr = new() { ["X-Apple-HKP"] = "4" };

    public static async Task<byte[]> TransientAsync(RtspClient c, CancellationToken ct = default)
    {
        var r1 = await c.SendAsync("POST", "/pair-setup", Hdr, Tlv8.Encode((Tlv8.Method, new byte[] { 0 }), (Tlv8.State, new byte[] { 1 }), (Tlv8.Flags, new byte[] { 0x10 })), "application/octet-stream", ct);
        if (!r1.Ok) throw new IOException($"pair-setup M1: {r1.Status} {r1.Reason}");
        var m2 = Tlv8.Decode(r1.Body);
        if (m2.TryGetValue(Tlv8.Error, out var e2)) throw new IOException($"pair-setup M2 error {e2[0]}");
        var srp = Srp6aClient.AirPlay();
        var proof = srp.Process(TransientUser, TransientPin, m2[Tlv8.Salt], m2[Tlv8.PublicKey]);
        var r3 = await c.SendAsync("POST", "/pair-setup", Hdr, Tlv8.Encode((Tlv8.State, new byte[] { 3 }), (Tlv8.PublicKey, srp.PublicA), (Tlv8.Proof, proof)), "application/octet-stream", ct);
        if (!r3.Ok) throw new IOException($"pair-setup M3: {r3.Status} {r3.Reason}");
        var m4 = Tlv8.Decode(r3.Body);
        if (m4.TryGetValue(Tlv8.Error, out var e4)) throw new IOException($"pair-setup M4 error {e4[0]} (wrong code or not transient-capable)");
        if (!srp.Verify(m4[Tlv8.Proof])) throw new IOException("pair-setup: server proof mismatch");
        return srp.K;
    }

    public static (byte[] Write, byte[] Read) ControlKeys(byte[] sessionKey) =>
        (HKDF.DeriveKey(HashAlgorithmName.SHA512, sessionKey, 32, Encoding.ASCII.GetBytes("Control-Salt"), Encoding.ASCII.GetBytes("Control-Write-Encryption-Key")),
         HKDF.DeriveKey(HashAlgorithmName.SHA512, sessionKey, 32, Encoding.ASCII.GetBytes("Control-Salt"), Encoding.ASCII.GetBytes("Control-Read-Encryption-Key")));

    /// <summary>Pairs transiently and switches the connection to encrypted framing.</summary>
    public static async Task<byte[]> PairAndEncryptAsync(RtspClient c, CancellationToken ct = default)
    {
        var k = await TransientAsync(c, ct);
        var (w, r) = ControlKeys(k);
        c.Wrap(s => new HapStream(s, w, r));
        return k;
    }
}
