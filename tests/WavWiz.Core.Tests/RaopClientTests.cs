using System.Net;
using System.Text;
using WavWiz.Core.AirPlay;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 AirPlay sender stage 2+: RTSP/RAOP client. Unit tests always run; live tests run only when
/// WW_AIRPLAY_BENCH=ip:port points at a shairport-sync (AirPlay 1) bench receiver, and write their transcript to
/// WW_AIRPLAY_OUT (default /tmp).</summary>
public class RaopClientTests
{
    internal static IPEndPoint? Bench => Environment.GetEnvironmentVariable("WW_AIRPLAY_BENCH") is { Length: > 0 } s ? IPEndPoint.Parse(s) : null;
    internal static string Out(string f) => Path.Combine(Environment.GetEnvironmentVariable("WW_AIRPLAY_OUT") ?? Path.GetTempPath(), f);

    [Fact]
    public async Task Parses_response_with_body_and_headers()
    {
        var raw = "RTSP/1.0 200 OK\r\nCSeq: 3\r\nSession: 1;timeout=60\r\nTransport: RTP/AVP/UDP;unicast;mode=record;server_port=6001;control_port=6002;timing_port=6003\r\nContent-Length: 5\r\n\r\nhello";
        var r = await RtspClient.ReadResponseAsync(new MemoryStream(Encoding.ASCII.GetBytes(raw)), default);
        Assert.Equal(200, r.Status); Assert.Equal("hello", Encoding.ASCII.GetString(r.Body));
        var t = RtspClient.ParseTransport(r.H("transport")!);
        Assert.Equal("6001", t["server_port"]); Assert.Equal("6003", t["timing_port"]); Assert.True(t.ContainsKey("unicast"));
    }

    [Fact]
    public void Alac_escape_frame_round_trips_and_has_expected_size()
    {
        var pcm = new short[352 * 2];
        for (int i = 0; i < pcm.Length; i++) pcm[i] = (short)(i * 97 - 30000);
        var buf = new byte[AlacRaw.Size(352)];
        int n = AlacRaw.Encode(pcm, buf);
        Assert.Equal(1412, n); // 23 header + 11264 sample + 3 end bits = 11290 bits -> 1412 bytes
        Assert.Equal(0x20, buf[0]); // 001 0000 0...
        Assert.Equal(pcm, AlacRaw.Decode(buf, 352));
    }

    [Fact]
    public void Timing_reply_echoes_reference_time()
    {
        var req = new byte[32]; req[0] = 0x80; req[1] = 0xD2; Rtp.Be64(req, 24, 0x1122334455667788);
        var rep = Rtp.TimingReply(req, 5, 6);
        Assert.Equal(0xD3, rep[1]); Assert.Equal(0x1122334455667788UL, Rtp.Rd64(rep, 8)); Assert.Equal(5UL, Rtp.Rd64(rep, 16)); Assert.Equal(6UL, Rtp.Rd64(rep, 24));
    }

    [Fact]
    public void Sync_and_audio_headers()
    {
        var s = Rtp.Sync(100000, 88200, 7, true);
        Assert.Equal(0x90, s[0]); Assert.Equal(0xD4, s[1]); Assert.Equal(100000u - 88200u, Rtp.Rd32(s, 4)); Assert.Equal(100000u, Rtp.Rd32(s, 16));
        var a = Rtp.Audio(65535, 42, 9, new byte[] { 1, 2 }, true);
        Assert.Equal(0xE0, a[1]); Assert.Equal(65535, Rtp.Rd16(a, 2)); Assert.Equal(14, a.Length);
        Assert.Equal(0x60, Rtp.Audio(1, 1, 1, default, false)[1]);
    }

    [Fact]
    public void Ntp_epoch_offset()
    {
        var n = Ntp.FromUnixTicks(TimeSpan.TicksPerSecond / 2);
        Assert.Equal(2208988800UL, n >> 32); Assert.Equal(0x80000000UL, n & 0xFFFFFFFF);
    }

    [Fact]
    public void Rsa_wrap_is_256_bytes_and_aes_leaves_tail_clear()
    {
        Assert.Equal(256, RaopCrypto.WrapKey(new byte[16]).Length);
        using var aes = RaopCrypto.MakeAes(new byte[16]);
        var p = new byte[1411]; p[1410] = 0xAB;
        RaopCrypto.EncryptPayload(aes, new byte[16], p);
        Assert.Equal(0xAB, p[1410]); Assert.NotEqual(0, p[0] | p[1] | p[2] | p[3]);
    }

    [Fact]
    public async Task Live_bench_handshake_reaches_record_and_tears_down()
    {
        if (Bench is not { } ep) return;
        await using var s = new RaopSession();
        await s.ConnectAsync(ep);
        var rec = await s.StartAsync(1000, 123456);
        Assert.True(rec.Ok);
        Assert.True(s.ServerAudio.Port > 0 && s.ServerControl.Port > 0);
        var v = await s.SetVolumeAsync(-15); Assert.True(v.Ok);
        var t = await s.TeardownAsync(); Assert.True(t.Ok);
        File.WriteAllLines(Out("raop-s2-transcript.txt"), s.Rtsp.Transcript);
    }

    internal static int Secs(int d) => int.TryParse(Environment.GetEnvironmentVariable("WW_AIRPLAY_SECONDS"), out var v) ? v : d;

    /// <summary>Stage 3: a 1 kHz tone streamed as ALAC escape frames with sync + timing. The bench side is checked by
    /// /workspace/zb/pcmmon.py reading shairport-sync's pipe output (box tooling, not part of the repo).</summary>
    [Fact]
    public async Task Live_bench_streams_tone()
    {
        if (Bench is not { } ep) return;
        int enc = int.TryParse(Environment.GetEnvironmentVariable("WW_AIRPLAY_ET"), out var e) ? e : 0;
        await using var s = new RaopSession(new RaopOptions { Encryption = enc });
        await s.ConnectAsync(ep);
        await s.StartAsync(4000, 900000);
        await s.SetVolumeAsync(0);
        var st = new RaopStreamer(s, RaopStreamer.Tone(1000), 4000, 900000);
        var drop = Environment.GetEnvironmentVariable("WW_AIRPLAY_DROP");
        if (drop != null) foreach (var d in drop.Split(',')) st.DropOnce.Add((ushort)(4000 + int.Parse(d)));
        st.Start();
        int secs = Secs(15);
        await Task.Delay(TimeSpan.FromSeconds(secs));
        await st.StopAsync();
        await s.TeardownAsync();
        var stats = $"et={enc} secs={secs} packets={st.PacketsSent} syncs={st.SyncsSent} timingReq={s.TimingRequests} resendReq={st.ResendRequests} served={st.ResendsServed} missed={st.ResendsMissed} latency={s.AudioLatency}";
        File.WriteAllText(Out($"raop-stream-et{enc}.txt"), stats + "\n" + string.Join("\n", s.Rtsp.Transcript));
        Assert.InRange(st.PacketsSent, (long)(secs * 44100 / 352 * 0.95), (long)(secs * 44100 / 352 * 1.1) + 40);
        Assert.True(st.SyncsSent >= secs);
        if (drop != null) Assert.True(st.ResendsServed >= drop.Split(',').Length, stats);
    }

    [Fact]
    public void Volume_map_and_dmap_layout()
    {
        Assert.Equal(RaopControls.Mute, RaopControls.ToAirPlayDb(0));
        Assert.Equal(0, RaopControls.ToAirPlayDb(100, percent: true));
        Assert.Equal(-6.02, RaopControls.ToAirPlayDb(0.5), 2);
        Assert.Equal(-30, RaopControls.ToAirPlayDb(0.01));
        var d = RaopControls.Dmap("Song", "Band", null);
        Assert.Equal("mlit", Encoding.ASCII.GetString(d, 0, 4));
        Assert.Equal(d.Length - 8, (int)Rtp.Rd32(d, 4));
        Assert.Equal("minm", Encoding.ASCII.GetString(d, 8, 4)); Assert.Equal(4, (int)Rtp.Rd32(d, 12));
        Assert.Equal("asar", Encoding.ASCII.GetString(d, 20, 4));
        Assert.Equal("image/png", RaopControls.ImageType(new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G' }));
        Assert.Equal("progress: 1/2/3\r\n", Encoding.ASCII.GetString(RaopControls.Progress(1, 2, 3)));
    }

    /// <summary>Stage 5: volume, metadata, artwork, progress, FLUSH (pause) and resume against the bench.</summary>
    [Fact]
    public async Task Live_bench_controls()
    {
        if (Bench is not { } ep) return;
        await using var s = new RaopSession();
        await s.ConnectAsync(ep);
        await s.StartAsync(100, 5000);
        var st = new RaopStreamer(s, RaopStreamer.Tone(440), 100, 5000); st.Start();
        await Task.Delay(1500);
        Assert.True((await s.SetVolumeAsync(RaopControls.ToAirPlayDb(0.5))).Ok);
        Assert.True((await RaopControls.SendMetadataAsync(s, st.RtpTime, "WavWiz Test Tone", "WavWiz", "0.5.0 Bench")).Ok);
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
        Assert.True((await RaopControls.SendArtworkAsync(s, st.RtpTime, png)).Ok);
        Assert.True((await RaopControls.SendProgressAsync(s, st.StartRtp, st.RtpTime, st.StartRtp + 44100 * 60)).Ok);
        Assert.True((await s.SetVolumeAsync(RaopControls.Mute)).Ok);
        await st.StopAsync();
        var f = await s.FlushAsync(st.Seq, st.RtpTime); Assert.True(f.Ok);
        // resume after pause: new streamer continues seq/rtptime
        var st2 = new RaopStreamer(s, RaopStreamer.Tone(440), st.Seq, st.RtpTime); st2.Start();
        await s.SetVolumeAsync(0);
        await Task.Delay(2000); await st2.StopAsync();
        Assert.True((await s.TeardownAsync()).Ok);
        File.WriteAllLines(Out("raop-s5-transcript.txt"), s.Rtsp.Transcript);
    }

    [Fact]
    public void Resend_reply_wraps_original_packet_and_aes_round_trips()
    {
        var orig = Rtp.Audio(77, 1234, 5, new byte[] { 9, 8, 7 }, false);
        var r = Rtp.Resend(77, orig);
        Assert.Equal(0xD6, r[1]); Assert.Equal(77, Rtp.Rd16(r, 2)); Assert.Equal(orig, r[4..]);
        var key = new byte[16]; var iv = new byte[16]; key[0] = 1; iv[0] = 2;
        using var aes = RaopCrypto.MakeAes(key);
        var p = new byte[40]; for (int i = 0; i < p.Length; i++) p[i] = (byte)i; var copy = (byte[])p.Clone();
        RaopCrypto.EncryptPayload(aes, iv, p);
        var dec = aes.DecryptCbc(p.AsSpan(0, 32), iv, System.Security.Cryptography.PaddingMode.None);
        Assert.Equal(copy[..32], dec); Assert.Equal(copy[32..], p[32..]);
    }
}
