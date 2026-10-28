using System.Net;
using System.Security.Cryptography;
using System.Text;
using WavWiz.Core.AirPlay;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 stage 8: AirPlay 2 realtime (type 96). Offline: bplist codec, PTP message layout, AEAD audio
/// packets, 0xD7 announce. Live (WW_AIRPLAY2_BENCH + WW_AIRPLAY2_LOCAL): tone over AP2 realtime with WavWiz as PTP grandmaster.</summary>
public class Ap2RealtimeTests
{
    [Fact]
    public void Bplist_round_trips()
    {
        var big = RandomNumberGenerator.GetBytes(300);
        var d = new Dictionary<string, object?>
        {
            ["type"] = 96, ["big"] = 5_000_000_000L, ["neg"] = -3, ["sr"] = 44100.0, ["ok"] = true, ["no"] = false,
            ["shk"] = big, ["name"] = "Kitchen ünicode", ["long"] = new string('a', 40),
            ["streams"] = new List<object?> { new Dictionary<string, object?> { ["dataPort"] = 6001 } },
        };
        var b = BPlist.Write(d);
        Assert.Equal("bplist00", Encoding.ASCII.GetString(b, 0, 8));
        var r = BPlist.Dict(b);
        Assert.Equal(96L, r["type"]); Assert.Equal(5_000_000_000L, r["big"]); Assert.Equal(-3L, r["neg"]);
        Assert.Equal(44100.0, r["sr"]); Assert.Equal(true, r["ok"]); Assert.Equal(false, r["no"]);
        Assert.Equal(big, r["shk"]); Assert.Equal("Kitchen ünicode", r["name"]); Assert.Equal(new string('a', 40), r["long"]);
        Assert.Equal(6001L, ((Dictionary<string, object?>)((List<object?>)r["streams"]!)[0]!).Int("dataPort"));
        var many = Enumerable.Range(0, 300).Select(i => (object?)i).ToList();
        Assert.Equal(299L, ((List<object?>)BPlist.Read(BPlist.Write(many))!)[299]);
    }

    [Fact]
    public void Ptp_messages_have_standard_layout()
    {
        using var m = new PtpMaster(0x0011223344556677UL); // builder only: binds nothing
        var s = m.Sync(7); Assert.Equal(44, s.Length); Assert.Equal(0x10, s[0]); Assert.Equal(2, s[1]); Assert.Equal(0x02, s[6] & 0x02);
        var f = m.FollowUp(7, 1_700_000_000_123_456_789UL); Assert.Equal(0x18, f[0]); Assert.Equal(76, f.Length);
        Assert.Equal(1_700_000_000_123_456_789UL, PtpMaster.ReadTimestamp(f.AsSpan(34)));
        Assert.Equal(0x0011223344556677UL, Rtp.Rd64(f, 20)); Assert.Equal(7, Rtp.Rd16(f, 30));
        var a = m.Announce(1); Assert.Equal(0x1B, a[0]); Assert.Equal(0x0011223344556677UL, Rtp.Rd64(a, 53));
        var req = m.Sync(9); req[0] = 0x11;
        var dr = m.DelayResp(req, 42); Assert.Equal(0x19, dr[0]); Assert.Equal(9, Rtp.Rd16(dr, 30)); Assert.Equal(42UL, PtpMaster.ReadTimestamp(dr.AsSpan(34)));
        Assert.Equal(req.AsSpan(20, 10).ToArray(), dr.AsSpan(44, 10).ToArray());
    }

    [Fact]
    public async Task Audio_packets_decrypt_like_a_receiver()
    {
        await using var s = new Ap2Session(new Ap2Options { Endpoint = new IPEndPoint(IPAddress.Loopback, 7000), Timing = Ap2Timing.Ntp }, null);
        typeof(Ap2Session).GetField("_aead", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.SetValue(s, new ChaCha20Poly1305(s.Shk));
        var pcm = new short[704]; RaopStreamer.Tone(1000)(pcm);
        var alac = new byte[AlacRaw.Size(352)]; int n = AlacRaw.Encode(pcm, alac);
        for (int k = 0; k < 2; k++)
        {
            var p = s.AudioPacket((ushort)(100 + k), 4410u, 0xABCD, alac.AsSpan(0, n), k == 0);
            Assert.Equal(12 + n + 24, p.Length);
            var n12 = new byte[12]; Array.Copy(p, p.Length - 8, n12, 4, 8);
            var plain = new byte[n];
            using var c = new ChaCha20Poly1305(s.Shk);
            c.Decrypt(n12, p.AsSpan(12, n), p.AsSpan(12 + n, 16), plain, p.AsSpan(4, 8));
            Assert.Equal(pcm, AlacRaw.Decode(plain, 352));
        }
        var ann = s.TimeAnnounce(3, 1000, 123456789UL, 0x77);
        Assert.Equal(0xD7, ann[1]); Assert.Equal(1000u + 11035, Rtp.Rd32(ann, 4)); Assert.Equal(123456789UL, Rtp.Rd64(ann, 8));
        Assert.Equal(77175u, Rtp.Rd32(ann, 16) - Rtp.Rd32(ann, 4)); Assert.Equal(0x77UL, Rtp.Rd64(ann, 20));
    }

    /// <summary>Live: WW_AIRPLAY2_BENCH=10.77.0.2:7000, WW_AIRPLAY2_LOCAL=10.77.0.1 (ports 319/320 bindable),
    /// WW_AIRPLAY_SECONDS (default 40, i.e. past the 30 s session-drop point).</summary>
    [Fact]
    public async Task Live_realtime_tone_with_ptp()
    {
        var bench = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH"); var local = Environment.GetEnvironmentVariable("WW_AIRPLAY2_LOCAL");
        if (string.IsNullOrEmpty(bench) || string.IsNullOrEmpty(local)) return;
        int secs = int.TryParse(Environment.GetEnvironmentVariable("WW_AIRPLAY_SECONDS"), out var x) ? x : 40;
        using var ptp = new PtpMaster(IPAddress.Parse(local)); ptp.Start();
        await using var s = new Ap2Session(new Ap2Options { Endpoint = IPEndPoint.Parse(bench), Name = "WavWiz test", VolumeDb = -6 }, ptp);
        await s.ConnectAsync();
        Assert.True(s.DataPort > 0 && s.ControlPort > 0);
        await using (var st = new Ap2Streamer(s, ptp, RaopStreamer.Tone(1000)))
        {
            st.Start();
            await Task.Delay(TimeSpan.FromSeconds(secs));
            Assert.True(st.PacketsSent > secs * 120);
        }
        Assert.True(s.Feedbacks >= secs / 2 - 2, $"feedbacks {s.Feedbacks}");
        Assert.True(ptp.SyncsSent > secs * 7);
        await s.TeardownAsync();
        var outDir = Environment.GetEnvironmentVariable("WW_AIRPLAY_OUT");
        if (outDir != null) File.WriteAllLines(Path.Combine(outDir, "ap2-s8-transcript.txt"), s.Rtsp.Transcript);
    }
}
