using System.Buffers.Binary;
using System.Net;
using System.Text;
using WavWiz.Core.Cast;
using WavWiz.Core.Clock;
using WavWiz.Core.Discovery;
using WavWiz.Core.Protocol;
using Xunit;
namespace WavWiz.Core.Tests;

/// <summary>0.7.0 F169: Google Cast sender - CASTV2 framing, mDNS discovery model, JSON messages, the live WAV sink, and the client against a fake receiver.</summary>
public class CastTests
{
    [Fact]
    public void CastMessage_encodes_proto2_fields_1_to_6_and_round_trips()
    {
        var m = new CastMessage("sender-0", "receiver-0", CastProto.NsHeartbeat, """{"type":"PING"}""");
        var b = CastProto.Encode(m);
        // field 1 varint 0, field 2 "sender-0"
        Assert.Equal(new byte[] { 0x08, 0x00, 0x12, 0x08 }, b[..4]);
        Assert.Equal("sender-0", Encoding.UTF8.GetString(b, 4, 8));
        Assert.Equal(0x1A, b[12]);                                       // field 3, length-delimited
        Assert.Contains((byte)0x28, b);                                  // field 5 (payload_type) varint
        Assert.True(CastProto.TryDecode(b, out var back));
        Assert.Equal(m, back with { PayloadBinary = null });
        var f = CastProto.Frame(m);
        Assert.Equal((uint)b.Length, BinaryPrimitives.ReadUInt32BigEndian(f));
        Assert.False(CastProto.TryDecode(new byte[] { 0x12, 0x50, 0x41 }, out _));   // truncated
        Assert.Throws<InvalidOperationException>(() => CastProto.Frame(m with { PayloadUtf8 = new string('x', 70_000) }));
    }

    [Fact]
    public async Task ReadAsync_reads_back_to_back_frames_and_rejects_oversize()
    {
        var a = CastProto.Frame(new CastMessage("a", "b", "ns", "{}")); var c = CastProto.Frame(new CastMessage("c", "d", "ns", """{"x":1}"""));
        var ms = new MemoryStream(a.Concat(c).ToArray());
        Assert.Equal("a", (await CastProto.ReadAsync(ms, default))!.SourceId);
        Assert.Equal("""{"x":1}""", (await CastProto.ReadAsync(ms, default))!.PayloadUtf8);
        Assert.Null(await CastProto.ReadAsync(ms, default));
        var big = new byte[8]; BinaryPrimitives.WriteUInt32BigEndian(big, 1_000_000);
        await Assert.ThrowsAsync<InvalidDataException>(() => CastProto.ReadAsync(new MemoryStream(big), default));
    }

    [Fact]
    public void Load_is_a_live_stream_for_the_default_media_receiver_with_music_metadata()
    {
        var j = System.Text.Json.Nodes.JsonNode.Parse(CastJson.Load(7, "http://192.168.1.5:47800/api/v1/cast/stream/ab.wav", "audio/wav", "WavWiz", "Kitchen", null, null))!;
        Assert.Equal("LOAD", (string?)j["type"]); Assert.Equal(7, (int)j["requestId"]!);
        Assert.Equal("LIVE", (string?)j["media"]!["streamType"]); Assert.Equal(3, (int)j["media"]!["metadata"]!["metadataType"]!);
        Assert.Equal("audio/wav", (string?)j["media"]!["contentType"]); Assert.True((bool)j["autoplay"]!);
        Assert.Null(j["media"]!["metadata"]!["albumName"]);
        Assert.Contains("\"level\":0.5", CastJson.SetVolume(1, 0.5)); Assert.Contains("\"level\":1", CastJson.SetVolume(1, 3));
        Assert.Equal("CC1AD845", CastProto.DefaultMediaReceiver);
        var rs = CastJson.ParseReceiverStatus("""{"type":"RECEIVER_STATUS","status":{"applications":[{"appId":"CC1AD845","sessionId":"s","transportId":"t","displayName":"Default Media Receiver"}],"volume":{"level":0.25,"muted":true}}}""")!;
        Assert.Equal(("CC1AD845", "t", 0.25, true), (rs.AppId, rs.TransportId, rs.Level!.Value, rs.Muted!.Value));
        var ms = CastJson.ParseMediaStatus("""{"type":"MEDIA_STATUS","status":[{"mediaSessionId":4,"playerState":"IDLE","idleReason":"ERROR"}]}""")!;
        Assert.Equal((4L, "IDLE", "ERROR"), (ms.MediaSessionId, ms.PlayerState, ms.IdleReason));
    }

    static DnsWire.Message Answer(string inst, string host, int port, IPAddress ip, params string[] txt)
    {
        var raw = DnsWire.Response(new[] { DnsWire.Ptr(CastBrowseState.Service, inst), DnsWire.Srv(inst, host, port), DnsWire.Txt(inst, txt), DnsWire.A(host, ip) });
        Assert.True(DnsWire.TryParse(raw, out var m)); return m!;
    }

    [Fact]
    public void Discovery_reads_name_model_capabilities_and_spots_groups_and_tvs()
    {
        var st = new CastBrowseState(); var now = DateTimeOffset.UtcNow;
        st.Ingest(Answer("Google-Home-Mini-1a2b._googlecast._tcp.local", "1a2b.local", 8009, IPAddress.Parse("192.168.1.40"), "id=1A2B3C4D5E6F70819293A4B5C6D7E8F9", "fn=Kitchen speaker", "md=Google Home Mini", "ca=199172", "rs="), now);
        st.Ingest(Answer("Google-Cast-Group-b25c._googlecast._tcp.local", "b25c.local", 32072, IPAddress.Parse("192.168.1.41"), "id=b25c0000-1111-2222-3333-405a381f4f48", "fn=Top Floor Group", "md=Google Cast Group", "ca=199204"), now);
        st.Ingest(Answer("Chromecast-9f._googlecast._tcp.local", "9f.local", 8009, IPAddress.Parse("192.168.1.42"), "id=9f9f9f9f9f9f9f9f", "fn=Living Room TV", "md=Chromecast", "ca=201221", "rs=YouTube"), now);
        var d = st.Devices(now);
        Assert.Equal(new[] { "Kitchen speaker", "Living Room TV", "Top Floor Group" }, d.Select(x => x.Name));
        var k = d[0]; Assert.Equal("1a2b3c4d5e6f70819293a4b5c6d7e8f9", k.Id); Assert.Equal("speaker", k.Kind); Assert.Equal(new[] { "192.168.1.40" }, k.Addresses); Assert.Equal(8009, k.Port);
        Assert.Equal("tv", d[1].Kind); Assert.Equal("YouTube", d[1].Status);
        Assert.True(d[2].IsGroup); Assert.Equal(32072, d[2].Port); Assert.Equal("b25c00001111222233333405a381f4f48".Length - 1, d[2].Id.Length);
        // goodbye (TTL 0) removes it
        var bye = DnsWire.Response(new[] { DnsWire.Ptr(CastBrowseState.Service, "Chromecast-9f._googlecast._tcp.local", 0) }); DnsWire.TryParse(bye, out var bm); st.Ingest(bm!, now);
        Assert.DoesNotContain(st.Devices(now), x => x.Name == "Living Room TV");
        // other services are ignored
        Assert.False(st.Ingest(Answer("Sonos._raop._tcp.local", "s.local", 7000, IPAddress.Parse("192.168.1.9"), "am=Sonos"), now));
        Assert.True(DnsWire.TryParse(CastBrowseState.Query(), out var q) && q!.Questions.Single().Name.TrimEnd('.') == CastBrowseState.Service);
    }

    [Fact]
    public void Wav_header_is_endless_pcm16_stereo_48k()
    {
        var h = CastSink.WavHeader();
        Assert.Equal("RIFF", Encoding.ASCII.GetString(h, 0, 4)); Assert.Equal("WAVE", Encoding.ASCII.GetString(h, 8, 4)); Assert.Equal("data", Encoding.ASCII.GetString(h, 36, 4));
        Assert.Equal(0xFFFFFFFFu, BinaryPrimitives.ReadUInt32LittleEndian(h.AsSpan(40)));
        Assert.Equal(48000u, BinaryPrimitives.ReadUInt32LittleEndian(h.AsSpan(24))); Assert.Equal(192000u, BinaryPrimitives.ReadUInt32LittleEndian(h.AsSpan(28)));
        Assert.Equal((ushort)2, BinaryPrimitives.ReadUInt16LittleEndian(h.AsSpan(22))); Assert.Equal((ushort)16, BinaryPrimitives.ReadUInt16LittleEndian(h.AsSpan(34)));
        var b = new byte[6]; CastSink.ToS16(new[] { 1.5f, -1f, 0.5f }, b);
        Assert.Equal(new short[] { 32767, -32767, 16384 }, new[] { 0, 2, 4 }.Select(i => BinaryPrimitives.ReadInt16LittleEndian(b.AsSpan(i))));
    }

    sealed class FakeClock : IMonotonicClock { public long NowUs { get; set; } }

    static byte[] Frame(uint epoch, long playAt, float v) { var s = new float[CastSink.FrameSamples * 2]; Array.Fill(s, v); return Wire.EncodeAudio(1, playAt, epoch, s); }

    [Fact]
    public void Sink_writes_each_house_frame_latency_ahead_and_silence_when_nothing_plays()
    {
        var clock = new FakeClock { NowUs = 10_000_000 };
        var sink = new CastSink("cast:x", clock) { LatencyMs = 1000, PrerollMs = 0 };
        sink.Send(Wire.EncodeEpoch(1, 5, 10_000_000));
        // house frames for play times 11.0 s .. 11.1 s (value = index)
        for (int i = 0; i < 6; i++) sink.Send(Frame(5, 11_000_000 + i * 20_000, (i + 1) / 10f));
        var r = sink.Attach();
        Assert.True(r.TryRead(out var hdr) && hdr.Length == 44);
        Assert.Equal(1, sink.Tick(10_000_000));                       // slot at 10.0 s plays house time 11.0 s
        Assert.True(r.TryRead(out var s0)); Assert.Equal((short)Math.Round(0.1f * 32767), BinaryPrimitives.ReadInt16LittleEndian(s0));
        Assert.Equal(5, sink.Tick(10_100_000));                       // 10.02..10.1 -> frames 2..6
        var vals = new List<short>(); while (r.TryRead(out var x)) vals.Add(BinaryPrimitives.ReadInt16LittleEndian(x));
        Assert.Equal(new[] { 0.2f, 0.3f, 0.4f, 0.5f, 0.6f }.Select(v => (short)Math.Round(v * 32767)), vals);
        Assert.Equal(1, sink.Tick(10_120_000)); Assert.True(r.TryRead(out var sil)); Assert.All(sil, b => Assert.Equal(0, b));
        Assert.Equal(1, sink.SlotsSilent);
        // delay: +40 ms -> the slot carries the frame 40 ms later; frames already behind are dropped as late
        sink.DelayMs = 40; for (int i = 9; i < 13; i++) sink.Send(Frame(5, 11_000_000 + i * 20_000, 0.9f));   // 10.14 s + 1.04 s = 11.18 s = frame 9
        sink.Tick(10_140_000); Assert.True(r.TryRead(out var d)); Assert.Equal((short)Math.Round(0.9f * 32767), BinaryPrimitives.ReadInt16LittleEndian(d));
        // StopAt drops the rest, a new epoch drops what was pending
        sink.Send(Wire.EncodeStopAt(2, 5, 11_200_000)); sink.Tick(10_200_000); while (r.TryRead(out var y)) Assert.All(y, b => Assert.Equal(0, b));
        sink.Detach(r); Assert.Equal(0, sink.Readers);
    }

    [Fact]
    public async Task Client_connects_launches_loads_sets_volume_and_answers_pings()
    {
        await using var fake = new FakeCastReceiver();
        await using var c = await CastClient.ConnectAsync(fake.Ep, default, tls: false);
        var st = await c.LaunchAsync();
        Assert.Equal("CC1AD845", st.AppId); Assert.Equal("web-7", c.TransportId); Assert.Equal(1, fake.Launches);
        var m = await c.LoadAsync("http://127.0.0.1:1/x.wav", "audio/wav", "WavWiz", "Kitchen");
        Assert.Equal("BUFFERING", m.PlayerState); Assert.Equal("audio/wav", fake.LoadedType);
        await c.SetVolumeAsync(0.42); Assert.Equal(0.42, fake.Level, 3); Assert.Equal(0.42, c.Receiver!.Level!.Value, 3);
        // virtual connections to receiver-0 and the app transport were opened before use
        Assert.True(fake.Count(CastProto.NsConnection, "CONNECT") >= 2);
        var lm = fake.Got.First(x => x.Namespace == CastProto.NsMedia); Assert.Equal("web-7", lm.DestinationId);
        // the device pings us: we pong
        await fake.Send(new CastMessage("receiver-0", "sender-0", CastProto.NsHeartbeat, """{"type":"PING"}"""));
        await WaitFor(() => fake.Count(CastProto.NsHeartbeat, "PONG") == 1);
        // a spontaneous IDLE/ERROR reaches the listener
        CastJson.MediaStatus? seen = null; c.MediaStatusChanged += x => seen = x;
        await fake.Broadcast("IDLE", "ERROR"); await WaitFor(() => seen != null); Assert.Equal("ERROR", seen!.IdleReason);
        await c.StopAppAsync(); Assert.Equal(1, fake.Stops); Assert.Null(c.TransportId);
    }

    [Fact]
    public async Task Launch_refusal_and_drop_are_reported()
    {
        await using var fake = new FakeCastReceiver { RefuseLaunch = true };
        await using var c = await CastClient.ConnectAsync(fake.Ep, default, tls: false);
        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => c.LaunchAsync());
        Assert.Contains("LAUNCH_ERROR", e.Message);
        string? why = null; c.Closed += w => why = w;
        fake.Drop(); await WaitFor(() => why != null); Assert.True(c.IsClosed);
        await Assert.ThrowsAsync<IOException>(() => c.SendAsync("receiver-0", CastProto.NsReceiver, "{}"));
    }

    static async Task WaitFor(Func<bool> ok, int ms = 3000) { var t = Environment.TickCount64 + ms; while (!ok() && Environment.TickCount64 < t) await Task.Delay(10); Assert.True(ok()); }
}
