using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using WavWiz.Core.AirPlay;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 stage 7: AirPlay 2 pairing primitives. SRP math checked against the RFC 5054 Appendix B vectors
/// (1024-bit group, SHA-1); the AirPlay flavour (3072-bit, SHA-512) against a test-side SRP verifier; HAP framing round trip.</summary>
public class Ap2PairingTests
{
    static byte[] H(string s) => Convert.FromHexString(s.Replace(" ", ""));
    const string N1024 = "EEAF0AB9ADB38DD69C33F80AFA8FC5E86072618775FF3C0B9EA2314C9C256576D674DF7496EA81D3383B4813D692C6E0E0D5D8E250B98BE48E495C1D6089DAD15DC7D7B46154D6B6CE8EF4AD69B15D4982559B297BCF1885C529F566660E57EC68EDBC3C05726CC02FD4CBF4976EAA9AFD5138FE8376435B9FC61D2FC0EB06E3";

    [Fact]
    public void Srp_matches_rfc5054_vectors()
    {
        var c = new Srp6aClient(Srp6aClient.Hex(N1024), 2, HashAlgorithmName.SHA1, H("60975527 035CF2AD 1989806F 0407210B C81EDC04 E2762A56 AFD529DD DA2D4393"));
        Assert.Equal(H("7556AA04 5AEF2CDD 07ABAF0F 665C3E81 8913186F"), Srp6aClient.Bytes(c.k));
        Assert.Equal(H("61D5E490 F6F1B795 47B0704C 436F523D D0E560F0 C64115BB 72557EC4 4352E890 3211C046 92272D8B 2D1A5358 A2CF1B6E 0BFCF99F 921530EC 8E393561 79EAE45E 42BA92AE ACED8251 71E1E8B9 AF6D9C03 E1327F44 BE087EF0 6530E69F 66615261 EEF54073 CA11CF58 58F0EDFD FE15EFEA B349EF5D 76988A36 72FAC47B 0769447B"), c.PublicA);
        c.Process("alice", "password123", H("BEB25379 D1A8581E B5A72767 3A2441EE"), H("BD0C6151 2C692C0C B6D041FA 01BB152D 4916A1E7 7AF46AE1 05393011 BAF38964 DC46A067 0DD125B9 5A981652 236F99D9 B681CBF8 7837EC99 6C6DA044 53728610 D0C6DDB5 8B318885 D7D82C7F 8DEB75CE 7BD4FBAA 37089E6F 9C6059F3 88838E7A 00030B33 1EB76840 910440B1 B27AAEAE EB4012B7 D7665238 A8E3FB00 4B117B58"));
        Assert.Equal(H("94B7555A ABE9127C C58CCF49 93DB6CF8 4D16C124"), Srp6aClient.Bytes(c.x));
        Assert.Equal(H("CE38B959 3487DA98 554ED47D 70A7AE5F 462EF019"), Srp6aClient.Bytes(c.u));
        Assert.StartsWith("B0DC82BABCF30674AE450C0287745E7990A3381F63B387AAF271A10D233861E359B48220F7C4693C9AE12B0A6F67809F0876E2D013800D6C41BB59B6D5979B5C00A172B4A2A5903A0BDCAF8A709585EB2AFAFA8F3499B200210DCC1F10EB33943CD67FC88A2F39A4BE5BEC4EC0A3212D", Convert.ToHexString(Srp6aClient.Bytes(c.S)));
    }

    [Fact]
    public void Srp_airplay_flavour_agrees_with_a_verifier()
    {
        var N = Srp6aClient.N3072; var g = new BigInteger(5); var salt = RandomNumberGenerator.GetBytes(16);
        static byte[] Sha(params byte[][] p) { using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA512); foreach (var x in p) h.AppendData(x); return h.GetHashAndReset(); }
        byte[] Pad(BigInteger v) { var b = Srp6aClient.Bytes(v); var r = new byte[384]; b.CopyTo(r, 384 - b.Length); return r; }
        var x = Srp6aClient.FromBytes(Sha(salt, Sha(Encoding.UTF8.GetBytes("Pair-Setup:3939"))));
        var v = BigInteger.ModPow(g, x, N); var k = Srp6aClient.FromBytes(Sha(Pad(N), Pad(g)));
        var b = Srp6aClient.FromBytes(RandomNumberGenerator.GetBytes(32));
        var B = (k * v + BigInteger.ModPow(g, b, N)) % N;
        var c = Srp6aClient.AirPlay();
        var m1 = c.Process("Pair-Setup", "3939", salt, Srp6aClient.Bytes(B));
        var u = Srp6aClient.FromBytes(Sha(Pad(c.A), Pad(B)));
        var S = BigInteger.ModPow(c.A * BigInteger.ModPow(v, u, N) % N, b, N);
        var K = Sha(Srp6aClient.Bytes(S)); Assert.Equal(K, c.K);
        var hn = Sha(Srp6aClient.Bytes(N)); var hg = Sha(Srp6aClient.Bytes(g)); for (int i = 0; i < 64; i++) hn[i] ^= hg[i];
        Assert.Equal(Sha(hn, Sha(Encoding.UTF8.GetBytes("Pair-Setup")), salt, c.PublicA, Srp6aClient.Bytes(B), K), m1);
        Assert.True(c.Verify(Sha(c.PublicA, m1, K)));
        Assert.Equal(64, c.K.Length);
    }

    [Fact]
    public void Tlv8_splits_and_joins_long_values()
    {
        var big = RandomNumberGenerator.GetBytes(384);
        var e = Tlv8.Encode((Tlv8.State, new byte[] { 2 }), (Tlv8.PublicKey, big), (Tlv8.Salt, new byte[16]));
        Assert.Equal(3 + (2 + 255) + (2 + 129) + 18, e.Length);
        var d = Tlv8.Decode(e); Assert.Equal(big, d[Tlv8.PublicKey]); Assert.Equal(2, d[Tlv8.State][0]); Assert.Equal(16, d[Tlv8.Salt].Length);
    }

    [Fact]
    public async Task Hap_stream_round_trips_multi_block()
    {
        var (w, r) = Ap2Pairing.ControlKeys(RandomNumberGenerator.GetBytes(64));
        Assert.NotEqual(w, r);
        var wire = new MemoryStream();
        var tx = new HapStream(wire, w, r);
        var msg = Encoding.ASCII.GetBytes(new string('x', 2500));
        await tx.WriteAsync(msg);
        Assert.Equal(2500 + 3 * 18, wire.Length);
        wire.Position = 0;
        var rx = new HapStream(wire, r, w); // peer: reads with our write key
        var got = new byte[2500]; int n = 0; while (n < got.Length) n += await rx.ReadAsync(got.AsMemory(n));
        Assert.Equal(msg, got);
    }

    /// <summary>Live: WW_AIRPLAY2_BENCH=host:7000 (shairport-sync built --with-airplay-2 + nqptp). Transient pair-setup,
    /// then an encrypted GET /info must return a binary plist.</summary>
    [Fact]
    public async Task Live_transient_pairing_and_encrypted_info()
    {
        var bench = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH"); if (string.IsNullOrEmpty(bench)) return;
        using var c = new RtspClient();
        await c.ConnectAsync(System.Net.IPEndPoint.Parse(bench));
        c.DefaultHeaders["User-Agent"] = "AirPlay/409.16";
        var k = await Ap2Pairing.PairAndEncryptAsync(c);
        Assert.Equal(64, k.Length);
        var info = await c.SendAsync("GET", "/info");
        Assert.True(info.Ok, info.Status + " " + info.Reason);
        Assert.StartsWith("bplist00", Encoding.ASCII.GetString(info.Body, 0, 8));
        var outDir = Environment.GetEnvironmentVariable("WW_AIRPLAY_OUT");
        if (outDir != null) File.WriteAllLines(Path.Combine(outDir, "ap2-s7-transcript.txt"), c.Transcript.Append($"(encrypted /info body {info.Body.Length} bytes)"));
    }
}
