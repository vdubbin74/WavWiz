using System.Net;
using System.Text;
using WavWiz.Core.Cast;
using WavWiz.Core.Tests;
using WavWiz.Server.Api;
using WavWiz.Server.Cast;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 F169: Cast devices as Speakers, end to end against the fake CASTV2 receiver (plain TCP; a real device uses TLS on 8009).
/// The fake fetches the LOADed URL from the real server the way a Cast receiver would.</summary>
public class Cast070Tests
{
    [Fact]
    public async Task Add_makes_a_speaker_in_a_new_zone_and_the_device_pulls_live_wav_without_signing_in()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var fake = new FakeCastReceiver { FetchStream = true };
        CastApi.Outs(f.Server.S).Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        var r = await admin.PostAsJsonAsync("/api/v1/cast/setup/add", new { key = "fake1", endpoint = fake.Ep.ToString(), newZone = "Den" });
        var body = await r.Json(); Assert.True(r.IsSuccessStatusCode, body.ToString());
        Assert.Equal("cast:fake1", body.GetProperty("id").GetString());
        Assert.Equal("CC1AD845", fake.AppId);
        Assert.Matches(@"^http://127\.0\.0\.1:\d+/api/v1/cast/stream/[0-9a-f]{32}\.wav$", fake.LoadedUrl);
        var wav = await fake.FetchDone.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("audio/wav", fake.LoadedType); Assert.Equal("RIFF", Encoding.ASCII.GetString(wav, 0, 4)); Assert.True(wav.Length > 44 + 3840);
        // a regular, online speaker in zone "Den", tagged CAST; remembered for reconnect
        var zones = await admin.GetJson("/api/v1/zones");
        var z = zones.EnumerateArray().First(x => x.GetProperty("playerId").GetString() == "cast:fake1");
        Assert.True(z.GetProperty("connected").GetBoolean());
        Assert.Contains(CastSpeakers.Load(f.Server.S), x => x.Key == "fake1");
        var groups = await admin.GetJson("/api/v1/groups");
        Assert.Contains(groups.EnumerateArray(), g => g.GetProperty("name").GetString() == "Den");
        // a wrong token is a 404; the setup list is admin-only
        Assert.Equal(HttpStatusCode.NotFound, (await f.Http.GetAsync("/api/v1/cast/stream/00000000000000000000000000000000.wav")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).GetAsync("/api/v1/cast/setup/devices")).StatusCode);
        // Forget: app stopped, rows and saved entry gone
        Assert.True((await admin.PostAsJsonAsync("/api/v1/cast/forget", new { key = "fake1" })).IsSuccessStatusCode);
        Assert.False(CastApi.Outs(f.Server.S).IsConnected("fake1")); Assert.Equal(1, fake.Stops);
        Assert.DoesNotContain(CastSpeakers.Load(f.Server.S), x => x.Key == "fake1");
        Assert.DoesNotContain((await admin.GetJson("/api/v1/zones")).EnumerateArray(), x => x.GetProperty("playerId").GetString() == "cast:fake1");
    }

    [Fact]
    public async Task Stream_url_already_works_when_the_receiver_fetches_it_before_answering_LOAD()
    {
        // 0.7.0 Pi smoke: the token was registered only after LOAD + SET_VOLUME, so a quick receiver got a 404
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var fake = new FakeCastReceiver { FetchStream = true, FetchBeforeReply = true };
        CastApi.Outs(f.Server.S).Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        var r = await admin.PostAsJsonAsync("/api/v1/cast/setup/add", new { key = "fast1", endpoint = fake.Ep.ToString(), newZone = "Hall" });
        Assert.True(r.IsSuccessStatusCode, (await r.Json()).ToString());
        Assert.Equal(200, fake.FetchStatus);
        var wav = await fake.FetchDone.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("RIFF", Encoding.ASCII.GetString(wav, 0, 4));
    }

    [Fact]
    public async Task Failed_load_leaves_no_speaker_row_and_explains_why()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var fake = new FakeCastReceiver { FailLoad = true };
        CastApi.Outs(f.Server.S).Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        var r = await admin.PostAsJsonAsync("/api/v1/cast/setup/add", new { key = "bad", endpoint = fake.Ep.ToString(), newZone = "X" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        var b = await r.Json(); Assert.Equal("transport", b.GetProperty("code").GetString()); Assert.Contains(f.Cfg.HttpPort.ToString(), b.GetProperty("text").GetString());
        Assert.DoesNotContain((await admin.GetJson("/api/v1/zones")).EnumerateArray(), x => x.GetProperty("playerId").GetString() == "cast:bad");
        Assert.Empty(CastSpeakers.Load(f.Server.S));
    }

    [Fact]
    public async Task Receiver_error_reloads_the_stream_and_volume_follows_the_card()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        await using var fake = new FakeCastReceiver();
        var outs = CastApi.Outs(S); outs.Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        var o = await outs.ConnectAsync("k", fake.Ep.ToString(), 0, 30, default, subscribe: false);
        Assert.Equal(1, fake.Loads); Assert.Equal(0.3, fake.Level, 3);
        await fake.Broadcast("IDLE", "ERROR");
        for (int i = 0; i < 100 && fake.Loads < 2; i++) await Task.Delay(50);
        Assert.Equal(2, fake.Loads);
        Assert.True(await outs.SetVolumeAsync("k", 80)); Assert.Equal(0.8, fake.Level, 3);
        Assert.True(outs.SetDelay("k", 120)); Assert.Equal(120, o.Sink.DelayMs);
        Assert.True(await outs.TestToneAsync("k")); Assert.True(o.Sink.FramesIn > 50);   // the chime reached the sink
    }

    [Theory]
    [InlineData("cast launch refused (LAUNCH_ERROR)", "denied")]
    [InlineData("cast LOAD failed (LOAD_FAILED)", "transport")]
    [InlineData("Cast device not found; search again", "discovery")]
    [InlineData("no reply from the Cast device (receiver)", "discovery")]
    [InlineData("Connection refused 192.168.1.9:8009", "discovery")]
    [InlineData("something odd", "other")]
    public void Errors_sort_into_the_card_classes(string msg, string code) => Assert.Equal(code, CastApi.Classify(msg, "Kitchen").Code);

    [Fact]
    public void Stream_host_is_the_bind_address_or_the_route_to_the_device()
    {
        Assert.Equal("192.168.1.169", CastOutputs.StreamHost("192.168.1.169", IPAddress.Parse("192.168.1.40")).ToString());
        Assert.Equal("127.0.0.1", CastOutputs.StreamHost("0.0.0.0", IPAddress.Loopback).ToString());
        Assert.Equal("http://10.0.0.2:47800/api/v1/cast/stream/ab.wav", CastOutputs.StreamUrl(IPAddress.Parse("10.0.0.2"), 47800, "ab"));
        Assert.NotEqual(CastOutputs.NewToken(), CastOutputs.NewToken()); Assert.Equal(32, CastOutputs.NewToken().Length);
    }
}
