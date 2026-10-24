using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.0 Stage 3: alarms and the sleep timer can target a zone (its own playback group); the Jukebox zone is served by the Schedule / Sleep / Jukebox services off the house group.</summary>
public class Release040Stage3Tests
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
        await MakeZone(admin, "House");      // a third zone keeps the house group, so both test zones can split off
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        return (f, admin, k, p, devs["pc-a"], devs["pc-b"], a, b);
    }

    [Fact]
    public async Task An_alarm_for_a_zone_rings_in_that_zone_only_and_stop_and_snooze_touch_only_that_zone()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var reg = f.Server.S.Registry; var S = f.Server.S;
        var kitchen = reg.Get($"zg:{k}")!; var patio = reg.Get($"zg:{p}")!; var house = reg.Default;
        patio.Add(new[] { Item("Patio song") }, false);
        S.Schedules.Resolve = _ => new List<QueueItem> { Item("Wake-up") };
        var id = (await (await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "Kitchen wake", time = "07:00", days = "0123456", action = "play", payload = new { source = "radio", id = 1, zoneKey = "g:" + k, fadeMin = 0, endVol = 40 } })).Json()).GetProperty("id").GetInt64();
        var list = await admin.GetJson("/api/v1/schedules"); var row = list.EnumerateArray().First(); Assert.Equal("g:" + k, row.GetProperty("zoneKey").GetString()); Assert.Equal("Kitchen", row.GetProperty("zoneName").GetString());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/schedules/{id}/run", new { })).StatusCode);
        Assert.Contains(kitchen.Queue(), q => q.Title == "Wake-up"); Assert.DoesNotContain(house.Queue(), q => q.Title == "Wake-up"); Assert.DoesNotContain(patio.Queue(), q => q.Title == "Wake-up"); Assert.Contains(patio.Queue(), q => q.Title == "Patio song");
        var st = await admin.GetJson("/api/v1/alarm"); Assert.Equal("Kitchen", st.GetProperty("alarm").GetProperty("zoneName").GetString());
        // the alarm's speakers (and only those) are on at the start volume
        Assert.Equal(new[] { dk }, S.Schedules.Active!.Zones.ToArray());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/v1/alarm/stop", null)).StatusCode);
        Assert.Equal(PlayState.Stopped, kitchen.State); Assert.Single(patio.Queue());
    }

    [Fact]
    public async Task A_stop_schedule_for_a_zone_stops_only_it_and_all_off_stops_every_group()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var reg = f.Server.S.Registry; var kitchen = reg.Get($"zg:{k}")!; var patio = reg.Get($"zg:{p}")!;
        kitchen.PlayItems(new List<QueueItem> { Item("K") }); patio.PlayItems(new List<QueueItem> { Item("P") });
        var stopK = (await (await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "Stop kitchen", time = "07:00", days = "0123456", action = "stop", payload = new { zoneKey = "g:" + k } })).Json()).GetProperty("id").GetInt64();
        await admin.PostAsJsonAsync($"/api/v1/schedules/{stopK}/run", new { });
        Assert.Equal(PlayState.Stopped, kitchen.State); Assert.NotEqual(PlayState.Stopped, patio.State);
        kitchen.PlayItems(new List<QueueItem> { Item("K") });
        var off = (await (await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "Night", time = "23:00", days = "0123456", action = "all_off", payload = new { } })).Json()).GetProperty("id").GetInt64();
        await admin.PostAsJsonAsync($"/api/v1/schedules/{off}/run", new { });
        Assert.Equal(PlayState.Stopped, kitchen.State); Assert.Equal(PlayState.Stopped, patio.State);
    }

    [Fact]
    public async Task The_sleep_timer_for_a_zone_uses_its_queue_for_end_of_song_and_stops_only_it()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var reg = f.Server.S.Registry; var kitchen = reg.Get($"zg:{k}")!; var patio = reg.Get($"zg:{p}")!; var sl = f.Server.S.Sleep;
        var now = DateTime.Now; sl.Clock = () => now;
        kitchen.PlayItems(new List<QueueItem> { Item("K") }); patio.PlayItems(new List<QueueItem> { Item("P") });
        // end of song is refused for radio, from the zone's own queue (the house group is idle)
        var r = await admin.PostAsJsonAsync("/api/v1/sleep", new { mode = "song", zoneKey = "g:" + k }); Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode); Assert.Contains("radio", await r.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/sleep", new { minutes = 5, zoneKey = "g:" + k })).StatusCode);
        Assert.Equal("g:" + k, (await admin.GetJson("/api/v1/sleep")).GetProperty("zoneKey").GetString());
        now = now.AddMinutes(6); sl.Tick();
        Assert.Equal(PlayState.Stopped, kitchen.State); Assert.NotEqual(PlayState.Stopped, patio.State);
        Assert.Equal("off", (await admin.GetJson("/api/v1/sleep")).GetProperty("mode").GetString());
        // no zone = the old behavior (house group)
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/sleep", new { minutes = 5 })).StatusCode); Assert.Equal(JsonValueKind.Null, (await admin.GetJson("/api/v1/sleep")).GetProperty("zoneKey").ValueKind);
    }

    [Fact]
    public async Task The_jukebox_zone_is_served_off_the_house_group_by_the_jukebox_service_and_alarm_targets()
    {
        var (f, admin, k, p, dk, dp, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        var S = f.Server.S; var reg = S.Registry;
        Assert.Same(reg.Default, S.Links.CondFor("jukebox"));                        // no speakers picked: 0.3.9 behavior
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { });   // 0.4.9 F76 fix: speakers are only borrowed while the Jukebox runs
        await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { dp } });
        var jc = S.Links.JukeboxConductor(); Assert.NotNull(jc); Assert.Same(jc, S.Links.CondFor("jukebox")); Assert.Equal(new[] { dp }, S.Links.DevicesOf("jukebox")!.ToArray());
        Assert.Equal("jukebox", reg.GroupOf("pc-b")); Assert.Equal("Jukebox", S.Links.KeyName("jukebox"));
        S.Schedules.Resolve = _ => new List<QueueItem> { Item("Party") };
        var id = (await (await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "Party", time = "20:00", days = "0123456", action = "play", payload = new { source = "radio", id = 1, zoneKey = "jukebox", fadeMin = 0 } })).Json()).GetProperty("id").GetInt64();
        await admin.PostAsJsonAsync($"/api/v1/schedules/{id}/run", new { });
        Assert.Contains(jc!.Queue(), q => q.Title == "Party"); Assert.Empty(reg.Default.Queue());
        await admin.PostAsync("/api/v1/alarm/stop", null);
        // the Jukebox service plays its guests' songs in its own group, not the house group
        Assert.Same(jc, S.Links.JukeboxConductor());
        // a deleted zone falls back to the house group for the alarm, and says so
        Assert.Same(reg.Default, S.Links.CondFor("g:99999")); Assert.Null(S.Links.DevicesOf("bogus"));
    }
}
