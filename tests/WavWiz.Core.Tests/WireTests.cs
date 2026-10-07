using WavWiz.Core.Protocol;
namespace WavWiz.Core.Tests;

public class WireTests
{
    [Fact]
    public void Header_magic_is_UNSN_and_is_16_bytes()
    {
        var b = new byte[16]; Wire.WriteHeader(b, MsgType.Audio, 7, 100);
        Assert.Equal((byte)'U', b[0]); Assert.Equal((byte)'N', b[1]); Assert.Equal((byte)'S', b[2]); Assert.Equal((byte)'N', b[3]);
        Assert.True(Wire.TryReadHeader(b, out var h, out _));
        Assert.Equal(MsgType.Audio, h.Type); Assert.Equal(7u, h.Seq); Assert.Equal(100u, h.PayloadLen);
    }

    [Fact]
    public void Garbage_oversize_and_unknown_versions_are_refused()
    {
        Assert.False(Wire.TryReadHeader(new byte[16], out _, out var e1)); Assert.Contains("magic", e1);
        var b = new byte[16]; Wire.WriteHeader(b, MsgType.Audio, 0, Wire.MaxPayload + 1);
        Assert.False(Wire.TryReadHeader(b, out _, out var e2)); Assert.Contains("too large", e2);
        Wire.WriteHeader(b, MsgType.Audio, 0, 1); b[4] = 9;
        Assert.False(Wire.TryReadHeader(b, out _, out var e3)); Assert.Contains("version", e3);
        Assert.False(Wire.TryReadHeader(b.AsSpan(0, 8), out _, out _));
    }

    [Fact]
    public void Audio_frame_round_trips_through_24_bit_pcm_within_two_lsb()
    {
        var s = new float[Wire.FrameSamples * 2];
        for (int i = 0; i < s.Length; i++) s[i] = MathF.Sin(i * 0.01f) * 0.9f;
        var msg = Wire.EncodeAudio(5, 123_456_789_012, 3, s);
        Assert.Equal(Wire.HeaderSize + 14 + s.Length * 3, msg.Length);
        Assert.True(Wire.TryReadHeader(msg, out var h, out _));
        Assert.True(Wire.TryDecodeAudio(msg.AsSpan(Wire.HeaderSize), out var f, out _));
        Assert.Equal(123_456_789_012, f!.PlayAtUs); Assert.Equal(3u, f.Epoch); Assert.Equal(960, f.SampleCount);
        for (int i = 0; i < s.Length; i++) Assert.InRange(f.Samples[i] - s[i], -3e-7f, 3e-7f);
    }

    [Fact]
    public void Audio_decoder_rejects_inconsistent_lengths_and_clips_instead_of_wrapping()
    {
        var msg = Wire.EncodeAudio(0, 0, 1, new float[] { 2f, -3f, 0.5f, 0f });   // 2 frames, overdriven
        Assert.True(Wire.TryDecodeAudio(msg.AsSpan(Wire.HeaderSize), out var f, out _));
        Assert.Equal(1f, f!.Samples[0], 1e-6); Assert.Equal(-1f, f.Samples[1], 1e-6);
        Assert.False(Wire.TryDecodeAudio(msg.AsSpan(Wire.HeaderSize, msg.Length - Wire.HeaderSize - 1), out _, out var err)); Assert.NotNull(err);
    }

    [Fact]
    public void Epoch_stop_and_json_messages_round_trip()
    {
        var e = Wire.EncodeEpoch(1, 9, -42);
        Assert.True(Wire.TryDecodeEpoch(e.AsSpan(Wire.HeaderSize), out var ep, out var st)); Assert.Equal(9u, ep); Assert.Equal(-42, st);
        var z = Wire.EncodeJson(MsgType.ZoneUpdate, 2, new ZoneUpdate(0.5, false, true, "ep1", 182.5, "measured", 3));
        Assert.True(Wire.TryReadHeader(z, out var h, out _));
        var back = Wire.DecodeJson<ZoneUpdate>(z.AsSpan(Wire.HeaderSize, (int)h.PayloadLen));
        Assert.Equal(182.5, back!.LatencyMs); Assert.Equal("measured", back.LatencySource);
    }

    [Fact]
    public void Version_comes_from_one_place_and_is_beta_0_0_x()
    {
        Assert.Matches(@"^0\.[01]\.\d+$", WavWizInfo.Version);          // BETA 0.0.x, then 0.1.x (0.1.1)
        Assert.Equal("BETA", WavWizInfo.Channel);
        Assert.Equal($"WavWiz {WavWizInfo.Version} BETA", WavWizInfo.DisplayName);
    }
}

public class ClockPacketTests
{
    private static readonly byte[] Key = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();

    [Fact]
    public void Ping_and_pong_round_trip_and_reject_tampering_and_wrong_keys()
    {
        var ping = ClockPacket.EncodePing(7, 42, 123456789, Key);
        Assert.True(ClockPacket.TryReadSessionId(ping, out var sid)); Assert.Equal(7u, sid);
        Assert.True(ClockPacket.TryDecodePing(ping, Key, out var seq, out var t0)); Assert.Equal(42u, seq); Assert.Equal(123456789, t0);
        var bad = (byte[])ping.Clone(); bad[15] ^= 1;
        Assert.False(ClockPacket.TryDecodePing(bad, Key, out _, out _));
        Assert.False(ClockPacket.TryDecodePing(ping, new byte[32], out _, out _));
        var pong = ClockPacket.EncodePong(7, 42, 1, 2, 3, Key);
        Assert.True(ClockPacket.TryDecodePong(pong, Key, out _, out var a, out var b, out var c)); Assert.Equal((1L, 2L, 3L), (a, b, c));
        Assert.False(ClockPacket.TryDecodePong(ping, Key, out _, out _, out _, out _));
        Assert.False(ClockPacket.TryDecodePing(new byte[5], Key, out _, out _));
    }
}
