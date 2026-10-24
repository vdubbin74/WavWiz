using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.0 Stage 2 (server side): zones (zone_group rows) <-> playback groups, link / split off / link all, the Jukebox zone.</summary>
public class Release040Stage2Tests
{
    private static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    private static JsonElement Zone(JsonElement groups, long id) => groups.EnumerateArray().First(g => g.GetProperty("id").GetInt64() == id);

    [Fact]
    public async Task Existing_installs_start_fully_linked_and_zones_link_split_and_link_all()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); await using var b = await FakePc.StartAsync(f, "pc-b", "Counter"); await using var c = await FakePc.StartAsync(f, "pc-c", "Patio Speaker");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 3; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long k = await MakeZone(admin, "Kitchen", devs["pc-a"], devs["pc-b"]), p = await MakeZone(admin, "Patio", devs["pc-c"]);
        var reg = f.Server.S.Registry;
        // migration: no zone.links setting = every zone in the house group (today's behavior)
        Assert.Null(f.Server.S.Db.Setting(Zones.ZoneLinks.MapKey));
        var g0 = await admin.GetJson("/api/v1/groups"); Assert.Equal("default", Zone(g0, k).GetProperty("playbackId").GetString()); Assert.Equal(new[] { "Patio" }, Zone(g0, k).GetProperty("linked").EnumerateArray().Select(x => x.GetString()).ToArray());
        Assert.All(new[] { "pc-a", "pc-b", "pc-c" }, id => Assert.Equal("default", reg.GroupOf(id)));
        // split Patio off: it gets its own playback group; the Kitchen keeps the house group
        var g1 = await (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { })).Json();
        Assert.Equal($"zg:{p}", Zone(g1, p).GetProperty("playbackId").GetString()); Assert.Equal("default", Zone(g1, k).GetProperty("playbackId").GetString()); Assert.Empty(Zone(g1, p).GetProperty("linked").EnumerateArray());
        Assert.Equal($"zg:{p}", reg.GroupOf("pc-c")); Assert.Equal("default", reg.GroupOf("pc-a")); Assert.Equal("Patio", reg.NameOf($"zg:{p}"));
        // the zone card shows its own group's song
        var itm = new QueueItem(0, "radio", "http://127.0.0.1:1/x", "Evening Drift", "Atlas Drift", "", 0, null); reg.Get($"zg:{p}")!.Add(new[] { itm }, false);
        var g2 = await admin.GetJson("/api/v1/groups"); Assert.Equal("Evening Drift", Zone(g2, p).GetProperty("now").GetProperty("title").GetString()); Assert.Equal(JsonValueKind.Null, Zone(g2, k).GetProperty("now").GetProperty("title").ValueKind);
        // link Patio with Kitchen again: it plays the Kitchen's group, its own queue is kept
        var g3 = await (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = k })).Json();
        Assert.Equal("default", Zone(g3, p).GetProperty("playbackId").GetString()); Assert.Equal("default", reg.GroupOf("pc-c")); Assert.Single(reg.Get($"zg:{p}")!.Queue());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = p })).StatusCode); Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = 9999 })).StatusCode);
        // the lead of a linked pair can leave too: the others keep the group, the leaver gets a fresh one
        long lead = await MakeZone(admin, "Lead"); await admin.PostAsJsonAsync($"/api/v1/groups/{lead}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = lead });
        Assert.Equal($"zg:{lead}", reg.GroupOf("pc-c")); var gl = await (await admin.PostAsJsonAsync($"/api/v1/groups/{lead}/split", new { })).Json();
        Assert.NotEqual(Zone(gl, lead).GetProperty("playbackId").GetString(), Zone(gl, p).GetProperty("playbackId").GetString());
        // link all into the zone being controlled
        await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { }); var ga = await (await admin.PostAsJsonAsync("/api/v1/groups/link-all", new { into = k })).Json();
        Assert.All(ga.EnumerateArray(), z => Assert.Equal("default", z.GetProperty("playbackId").GetString())); Assert.Equal("default", reg.GroupOf("pc-c"));
        // persisted + view role cannot change it
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PostAsJsonAsync("/api/v1/groups/link-all", new { })).StatusCode);
        // removing a zone drops its link
        await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { }); await admin.DeleteAsync($"/api/v1/groups/{p}"); Assert.DoesNotContain($"\"{p}\"", f.Server.S.Db.Setting(Zones.ZoneLinks.MapKey) ?? "");
        Assert.Equal("default", reg.GroupOf("pc-c"));
    }

    [Fact]
    public async Task Jukebox_zone_picks_its_own_devices_and_the_jukebox_plays_there_only_once_it_has_some()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Deck"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        var j0 = await admin.GetJson("/api/v1/jukebox/zone"); Assert.False(j0.GetProperty("own").GetBoolean()); Assert.Equal(0, j0.GetProperty("deviceIds").GetArrayLength());
        Assert.Same(f.Server.S.Conductor, f.Server.S.Links.JukeboxConductor() ?? f.Server.S.Conductor);              // no speakers picked: 0.3.9 behavior
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { });   // 0.4.9 F76 fix: speakers are only borrowed while the Jukebox runs
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { devs["pc-a"] } })).StatusCode);
        var reg = f.Server.S.Registry; Assert.Equal("jukebox", reg.GroupOf("pc-a")); Assert.Equal("default", reg.GroupOf("pc-b"));
        var jc = f.Server.S.Links.JukeboxConductor(); Assert.NotNull(jc); Assert.NotSame(f.Server.S.Conductor, jc); Assert.Equal("jukebox", jc!.GroupId);
        Assert.True((await admin.GetJson("/api/v1/jukebox/zone")).GetProperty("own").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { 99999L } })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new long[0] })).StatusCode);
        await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new long[0] }); Assert.Equal("default", reg.GroupOf("pc-a")); Assert.Null(f.Server.S.Links.JukeboxConductor());
    }

    [Fact]
    public async Task Jukebox_zone_volume_and_mute_move_only_its_own_devices()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Deck"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { });   // 0.4.9 F76 fix: speakers are only borrowed while the Jukebox runs
        await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { devs["pc-a"] } });
        double Vol(string pc) => (f.Server.S.Zones.Zones().First(z => z.PlayerId == pc)).Volume; bool Muted(string pc) => f.Server.S.Zones.Zones().First(z => z.PlayerId == pc).Muted;
        double kitchen = Vol("pc-b");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/zone/volume", new { set = 33 })).StatusCode); Assert.Equal(33, Vol("pc-a"), 0); Assert.Equal(kitchen, Vol("pc-b"));
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/zone/mute", new { muted = true })).StatusCode); Assert.True(Muted("pc-a")); Assert.False(Muted("pc-b"));
        await admin.PostAsJsonAsync("/api/v1/jukebox/zone/mute", new { muted = false }); Assert.False(Muted("pc-a"));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/jukebox/zone/volume", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PostAsJsonAsync("/api/v1/jukebox/zone/volume", new { set = 10 })).StatusCode);
    }
}
