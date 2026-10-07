using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using WavWiz.Core.Discovery;
using WavWiz.Server.Media;
using WavWiz.Server.Net;
using WavWiz.Server.Playback;
using WavWiz.Server.Receivers;
namespace WavWiz.Server.Tests;

/// <summary>0.1.1: AirPlay receiver plumbing, Spotify Connect add-on, live sources in the house stream.</summary>
public class Release011Tests
{
    private static byte[] Tag(string t, byte[] v) { var b = new byte[8 + v.Length]; Encoding.ASCII.GetBytes(t).CopyTo(b, 0); System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(4), (uint)v.Length); v.CopyTo(b, 8); return b; }

    [Fact]
    public void Dmap_metadata_gives_title_artist_album_inside_an_mlit_container()
    {
        var inner = Tag("minm", Encoding.UTF8.GetBytes("Señorita")).Concat(Tag("asar", Encoding.UTF8.GetBytes("Artist"))).Concat(Tag("asal", Encoding.UTF8.GetBytes("Album"))).Concat(Tag("caps", new byte[] { 1 })).ToArray();
        var m = Dmap.Parse(Tag("mlit", inner));
        Assert.Equal("Señorita", m["minm"]); Assert.Equal("Artist", m["asar"]); Assert.Equal("Album", m["asal"]); Assert.False(m.ContainsKey("caps"));
        Assert.Empty(Dmap.Parse(new byte[] { 1, 2, 3 }));                 // garbage never throws
    }

    [Fact]
    public void LiveFeed_resamples_44k1_to_48k_buffers_to_target_applies_phone_volume_and_flushes()
    {
        var f = new LiveFeed { TargetMs = 500 }; var dec = f.OpenDecoder(); var dst = new float[48000 * 2];
        var pcm = new byte[44100 * 4]; for (int i = 0; i < 44100; i++) { short v = (short)(Math.Sin(2 * Math.PI * 440 * i / 44100.0) * 16000); pcm[i * 4] = (byte)v; pcm[i * 4 + 1] = (byte)(v >> 8); pcm[i * 4 + 2] = (byte)v; pcm[i * 4 + 3] = (byte)(v >> 8); }
        f.WriteS16(pcm.AsSpan(0, 4410 * 4), 44100);                      // 100 ms: below the target, nothing plays yet
        Assert.Equal(0, dec.Read(dst, 4800)); Assert.True(f.Active);
        f.WriteS16(pcm.AsSpan(4410 * 4), 44100);                          // the rest of the second
        Assert.InRange(f.BufferedMs, 990, 1010);                          // 1 s of 44.1 kHz = 48000 frames out
        f.Gain = AirPlayReceiver.VolumeToGain(-144); Assert.Equal(0f, f.Gain);
        f.Gain = AirPlayReceiver.VolumeToGain(0); int n = dec.Read(dst, 4800); Assert.Equal(4800, n);
        Assert.InRange(dst.Take(n * 2).Max(), 0.45f, 0.5f);               // amplitude survives the resampler
        f.Flush(); Assert.Equal(0, f.BufferedMs); Assert.Equal(0, dec.Read(dst, 100));
        Assert.Equal(0f, AirPlayReceiver.VolumeToGain(-150)); Assert.InRange(AirPlayReceiver.VolumeToGain(-20), 0.09f, 0.11f);
    }

    [Fact]
    public void A_phone_takes_over_the_house_and_the_previous_queue_comes_back_when_it_leaves()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        using var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        var feed = new LiveFeed(); c.RegisterFeed("airplay", feed);
        c.Add(new[] { new QueueItem(0, "track", "/nope/a.flac", "Song A", "X", "Y", 1000, 1), new QueueItem(0, "track", "/nope/b.flac", "Song B", "X", "Y", 1000, 2) }, false);
        c.BeginLive("airplay", "AirPlay", "", "AirPlay");
        var np = c.Now(); Assert.Equal("airplay", np.Item!.Kind); Assert.Single(c.Queue());
        Assert.Equal("paused", np.State);                                  // nothing arriving yet = paused on the phone
        c.UpdateLive("airplay", q => q with { Title = "Live title", Artist = "Live artist", ArtUrl = "/api/v1/live/art/airplay?v=1" });
        Assert.Equal("Live title", c.Now().Item!.Title); Assert.Equal("airplay", c.Now().Item!.Kind);
        c.Next(); Assert.Equal("airplay", c.Now().Item!.Kind);             // skip buttons do not end the phone's session
        Assert.False(c.Seek(1000));
        c.EndLive("airplay");
        Assert.Equal(new[] { "Song A", "Song B" }, c.Queue().Select(q => q.Title)); Assert.Equal("stopped", c.Now().State);
    }

    [Fact]
    public void The_mDNS_responder_answers_AirPlay_raop_questions_and_still_answers_WavWiz()
    {
        var beacon = new ServerBeacon("id1", "MEDIA-PC", "192.168.1.20", 47800, 47443, 47801, "0.1.1"); var ip = IPAddress.Parse("192.168.1.20");
        Func<string, IPAddress, IEnumerable<List<DnsWire.Record>>> extra = (host, a) => new[] { new List<DnsWire.Record> { DnsWire.Ptr("_raop._tcp.local", "AABBCCDDEEFF@WavWiz – Whole House._raop._tcp.local"), DnsWire.Srv("AABBCCDDEEFF@WavWiz – Whole House._raop._tcp.local", host, 47804), DnsWire.Txt("AABBCCDDEEFF@WavWiz – Whole House._raop._tcp.local", new[] { "et=0,1" }), DnsWire.A(host, a) } };
        var ans = DiscoveryHost.Answer(DnsWire.Query("_raop._tcp.local", DnsWire.TypePtr), beacon, ip, extra);
        Assert.NotNull(ans); Assert.True(DnsWire.TryParse(ans, out var m));
        var srv = m!.Records.Single(r => r.Type == DnsWire.TypeSrv); Assert.Equal(47804, DnsWire.SrvOf(srv.Data).Port); Assert.Contains("Whole House", srv.Name);
        Assert.NotNull(DiscoveryHost.Answer(DnsWire.Query("_unison._tcp.local", DnsWire.TypePtr), beacon, ip, extra));
        Assert.Null(DiscoveryHost.Answer(DnsWire.Query("_googlecast._tcp.local", DnsWire.TypePtr), beacon, ip, extra));
        Assert.NotNull(DiscoveryHost.Answer(DnsWire.Query("AABBCCDDEEFF@WavWiz – Whole House._raop._tcp.local", DnsWire.TypeSrv), beacon, ip, extra));
    }

    [Fact]
    public void Spotify_hook_events_need_the_run_token()
    {
        var e = SpotifyReceiver.ParseEvent("WAVWIZ abc\nPLAYER_EVENT=track_changed\nNAME=Song\nARTISTS=A\tB\nCOVERS=https://i.scdn.co/image/x\thttps://i.scdn.co/image/y\n", "abc");
        Assert.NotNull(e); Assert.Equal("track_changed", e!["PLAYER_EVENT"]); Assert.Equal("A\tB", e["ARTISTS"]);
        Assert.Null(SpotifyReceiver.ParseEvent("WAVWIZ wrong\nPLAYER_EVENT=stopped\n", "abc"));
    }

    [Fact]
    public async Task Spotify_Connect_is_an_admin_setting_off_by_default_and_receivers_report_status()
    {
        await using var f = await ServerFixture.StartAsync(); var ck = await f.SetupAdmin(); var admin = f.As(f.Token(WavWiz.Server.Role.Admin));
        var st = await admin.GetFromJsonAsync<JsonElement>("/api/v1/receivers");
        Assert.False(st.GetProperty("spotify").GetProperty("enabled").GetBoolean()); Assert.Equal("WavWiz – Whole House", st.GetProperty("airplay").GetProperty("name").GetString());
        Assert.Equal(47804, st.GetProperty("airplay").GetProperty("port").GetInt32());
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.enabled"] = true })).EnsureSuccessStatusCode();
        st = await admin.GetFromJsonAsync<JsonElement>("/api/v1/receivers"); Assert.True(st.GetProperty("spotify").GetProperty("enabled").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.enabled"] = "yes" })).StatusCode);
        var viewer = f.As(f.Token(WavWiz.Server.Role.View));
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.enabled"] = false })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.GetAsync("/api/v1/live/art/airplay")).StatusCode);
        var diag = await admin.GetStringAsync("/api/v1/diagnostics"); Assert.Contains("Spotify Connect", diag); Assert.Contains("AirPlay speaker", diag);
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.enabled"] = false })).EnsureSuccessStatusCode();
    }
}
