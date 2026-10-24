using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
using WavWiz.Server.Receivers;
namespace WavWiz.Server.Tests;

/// <summary>0.4.0 Stage 4: one AirPlay / Spotify Connect name per zone, each feeding its own zone's playback group; calibration pauses only the groups it measures.
/// The receiver programs themselves (shairplay, librespot) and real phones are not part of these tests: they are fed through the same OnLine / OnEvent entry points the child processes use.</summary>
public class Release040Stage4Tests
{
    private static QueueItem Item(string t) => new(0, "radio", "http://127.0.0.1:1/x", t, "Artist", "", 0, null);
    private static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();

    private static async Task<(ServerFixture f, HttpClient admin, long kitchen, long patio, long dk, long dp, FakePc a, FakePc b)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker"); await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long k = await MakeZone(admin, "Kitchen", devs["pc-a"]), p = await MakeZone(admin, "Patio", devs["pc-b"]);
        await MakeZone(admin, "House");
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        return (f, admin, k, p, devs["pc-a"], devs["pc-b"], a, b);
    }

    [Fact]
    public void Two_receivers_of_one_kind_can_feed_one_group_without_touching_each_other()
    {
        var c = new Conductor(new Db(":memory:"), new EventHub(), "ffmpeg"); var f1 = new LiveFeed(); var f2 = new LiveFeed();
        c.RegisterFeed("airplay", f1, "airplay:1"); c.RegisterFeed("airplay", f2, "airplay:2");
        c.BeginLive("airplay", "AirPlay", key: "airplay:1");
        Assert.Equal("airplay:1", c.Queue().Single().Location);
        c.UpdateLive("airplay", q => q with { Title = "One" }, "airplay:2");       // not playing: no effect
        Assert.Equal("AirPlay", c.Queue().Single().Title);
        c.UpdateLive("airplay", q => q with { Title = "One" }, "airplay:1"); Assert.Equal("One", c.Queue().Single().Title);
        c.EndLive("airplay", "airplay:2"); Assert.Single(c.Queue());       // another receiver leaving does not end this one
        c.EndLive("airplay", "airplay:1"); Assert.Empty(c.Queue());
        // 0.3.9 callers (no key) still work
        c.RegisterFeed("spotify", new LiveFeed()); c.BeginLive("spotify", "S"); Assert.Equal("spotify", c.Queue().Single().Location); c.EndLive("spotify"); Assert.Empty(c.Queue());
    }

    [Fact]
    public async Task A_zone_gets_one_name_with_its_own_port_and_it_follows_a_rename_and_a_delete()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var S = f.Server.S;
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { airplay = true, spotify = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{p}", new { airplay = true })).StatusCode);
        var rows = (await admin.GetJson("/api/v1/receivers/zones")).GetProperty("zones").EnumerateArray().ToDictionary(z => z.GetProperty("zoneId").GetInt64());
        Assert.Equal("WavWiz – Kitchen", rows[k].GetProperty("name").GetString()); Assert.True(rows[k].GetProperty("airplay").GetProperty("enabled").GetBoolean()); Assert.True(rows[k].GetProperty("spotify").GetProperty("enabled").GetBoolean());
        Assert.False(rows[p].GetProperty("spotify").GetProperty("enabled").GetBoolean());
        var ak = S.ZoneRecv!.AirPlayOf(k)!; var ap = S.ZoneRecv.AirPlayOf(p)!;
        Assert.NotEqual(ak.Port, ap.Port); Assert.NotEqual(S.AirPlay!.Port, ak.Port); Assert.NotEqual(ak.HwAddr, ap.HwAddr); Assert.NotEqual(S.Spotify!.Port, S.ZoneRecv.SpotifyOf(k)!.Port);
        var ports = ak.Port; Assert.Equal(ports, S.ZoneRecv.PortFor("airplay", k));      // a port is kept for good
        // rename: the same receiver, the new name
        await admin.PatchAsJsonAsync($"/api/v1/groups/{k}", new { name = "Galley", deviceIds = new[] { dk } });
        Assert.Equal("WavWiz – Galley", S.ZoneRecv.AirPlayOf(k)!.DisplayName); Assert.Equal("WavWiz – Galley", S.ZoneRecv.SpotifyOf(k)!.DisplayName);
        Assert.Same(ak, S.ZoneRecv.AirPlayOf(k));
        // an explicit off stops it; deleting a zone removes its receivers
        await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { spotify = false }); Assert.Null(S.ZoneRecv.SpotifyOf(k)); Assert.NotNull(S.ZoneRecv.AirPlayOf(k));
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{p}")).StatusCode); Assert.Null(S.ZoneRecv.AirPlayOf(p));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync("/api/v1/receivers/zones/9999", new { airplay = true })).StatusCode);
        // a viewer cannot switch a name on
        var view = f.As(f.Token(Role.View)); Assert.Equal(HttpStatusCode.Forbidden, (await view.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { airplay = true })).StatusCode);
    }

    [Fact]
    public async Task What_a_phone_sends_to_a_zone_plays_in_that_zone_only_and_follows_a_link_and_a_split()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var S = f.Server.S; var reg = S.Registry; var kitchen = reg.Get($"zg:{k}")!; var patio = reg.Get($"zg:{p}")!; var house = reg.Default;
        await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { airplay = true, spotify = true });
        var ap = S.ZoneRecv!.AirPlayOf(k)!; var sp = S.ZoneRecv.SpotifyOf(k)!;
        patio.PlayItems(new List<QueueItem> { Item("Patio music") });
        ap.OnLine("INIT 0 2 44100");
        Assert.Equal("airplay", kitchen.Queue().Single().Kind); Assert.Equal("airplay:" + k, kitchen.Queue().Single().Location);
        Assert.DoesNotContain(house.Queue(), q => q.Kind == "airplay"); Assert.Equal("Patio music", patio.Queue().Single().Title);
        ap.OnLine("META " + Convert.ToBase64String(new byte[] { (byte)'m', (byte)'l', (byte)'i', (byte)'t', 0, 0, 0, 12, (byte)'m', (byte)'i', (byte)'n', (byte)'m', 0, 0, 0, 4, (byte)'S', (byte)'o', (byte)'n', (byte)'g' }));
        Assert.Equal("Song", kitchen.Queue().Single().Title);
        ap.OnLine("STOP"); Assert.DoesNotContain(kitchen.Queue(), q => q.Kind == "airplay");
        Assert.Equal(PlayState.Playing, patio.State);
        // Spotify on the same zone uses the same group
        sp.OnEvent(new Dictionary<string, string> { ["PLAYER_EVENT"] = "playing" });
        Assert.Equal("spotify:" + k, kitchen.Queue().Single().Location); sp.OnEvent(new Dictionary<string, string> { ["PLAYER_EVENT"] = "stopped" }); Assert.Empty(kitchen.Queue().Where(q => q.Kind == "spotify"));
        // link Kitchen into Patio: the receiver now feeds the shared group (Kitchen's old group is no longer its home)
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{k}/link", new { with = p })).StatusCode);
        var shared = S.Links.CondFor("g:" + k); Assert.Same(patio, shared);
        ap.OnLine("INIT 0 2 44100"); Assert.Contains(patio.Queue(), q => q.Kind == "airplay"); ap.OnLine("STOP");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { })).StatusCode);
        ap.OnLine("INIT 0 2 44100"); Assert.Contains(S.Links.CondFor("g:" + k).Queue(), q => q.Kind == "airplay"); Assert.DoesNotContain(patio.Queue(), q => q.Kind == "airplay"); ap.OnLine("STOP");
    }

    [Fact]
    public async Task Idle_zone_receivers_cost_nothing_and_a_zone_without_a_name_has_no_process()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var S = f.Server.S;
        Assert.Null(S.ZoneRecv!.AirPlayOf(k)); Assert.Null(S.ZoneRecv.SpotifyOf(p));
        Assert.True(S.Registry.Get($"zg:{k}")!.IsIdle); Assert.False(S.Registry.Get($"zg:{k}")!.PumpArmed);
        await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { airplay = true });
        Assert.False(S.Registry.Get($"zg:{k}")!.PumpArmed);       // an enabled but silent receiver does not wake the pump
        Assert.False(S.ZoneRecv.AirPlayOf(k)!.InSession);
    }

    [Fact]
    public async Task Calibrating_a_speaker_pauses_only_its_own_zone_and_offers_to_resume_only_that_one()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var S = f.Server.S; var kitchen = S.Registry.Get($"zg:{k}")!; var patio = S.Registry.Get($"zg:{p}")!; var house = S.Registry.Default;
        kitchen.PlayItems(new List<QueueItem> { Item("K") }); patio.PlayItems(new List<QueueItem> { Item("P") }); house.PlayItems(new List<QueueItem> { Item("H") });
        var (sess, err) = S.Cal.Start("ear", dk, null, null); Assert.Null(err); Assert.NotNull(sess);
        Assert.Equal(PlayState.Paused, kitchen.State);
        Assert.Equal(PlayState.Playing, patio.State); Assert.Equal(PlayState.Playing, house.State);
        // measuring the patio speaker too pauses the patio zone, still not the house
        S.Cal.Report(sess!, phase: "running"); sess!.Pending["x"] = (dp, 0, 0, "dev", 1); S.Cal.Quiet(sess);
        Assert.Equal(PlayState.Paused, patio.State); Assert.Equal(PlayState.Playing, house.State);
        Assert.True(S.Cal.End(sess));
        Assert.Equal(new[] { "zg:" + k, "zg:" + p }.OrderBy(x => x), sess.ResumeGroupIds.OrderBy(x => x));
        Assert.Equal(PlayState.Playing, house.State);
    }
}
