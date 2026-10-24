using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F76 fix: the Jukebox only borrows its speakers while it runs. Exit hands each one back to its own zone, a speaker never
/// sits in two playback groups, and a speaker left in the Jukebox zone (exit before the fix, or a restart mid-session) heals on Apply/startup.</summary>
public class Release049JukeboxReleaseTests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, Dictionary<string, long> devs, string home)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "PCBOXV2"); var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        var id = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Whole-Home", deviceIds = new[] { devs["pc-a"], devs["pc-b"] } })).Json()).GetProperty("id").GetInt64();
        await admin.PostAsJsonAsync($"/api/v1/groups/{id}/split", new { });
        var home = f.Server.S.Registry.GroupOf("pc-a")!; Assert.NotEqual("jukebox", home); Assert.Equal(home, f.Server.S.Registry.GroupOf("pc-b"));
        return (f, admin, a, b, devs, home);
    }

    [Fact]
    public async Task Exit_returns_the_borrowed_speaker_to_its_zone_and_switch_to_app_keeps_it()
    {
        var (f, admin, a, b, devs, home) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b; var reg = f.Server.S.Registry;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { deviceIds = new[] { devs["pc-a"] } })).StatusCode);
        Assert.Equal("jukebox", reg.GroupOf("pc-a")); Assert.Equal(home, reg.GroupOf("pc-b"));          // borrowed; one group only
        // "Switch to app" is just leaving the kiosk: the Jukebox keeps running and keeps the speaker
        var z = await admin.GetJson("/api/v1/jukebox/zone"); Assert.True(z.GetProperty("running").GetBoolean()); Assert.Equal(new[] { devs["pc-a"] }, z.GetProperty("deviceIds").EnumerateArray().Select(x => x.GetInt64()));
        Assert.Equal("jukebox", reg.GroupOf("pc-a"));
        // Exit Jukebox
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { })).StatusCode);
        Assert.Equal(home, reg.GroupOf("pc-a")); Assert.Equal(home, reg.GroupOf("pc-b"));
        z = await admin.GetJson("/api/v1/jukebox/zone"); Assert.Equal(0, z.GetProperty("deviceIds").GetArrayLength()); Assert.False(z.GetProperty("own").GetBoolean());
        Assert.Null(f.Server.S.Links.JukeboxConductor());
    }

    [Fact]
    public async Task Picking_speakers_while_idle_saves_defaults_and_borrows_nothing_until_start()
    {
        var (f, admin, a, b, devs, home) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b; var reg = f.Server.S.Registry;
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { devs["pc-a"] } })).StatusCode);
        Assert.Equal(home, reg.GroupOf("pc-a"));
        var cfg = await admin.GetJson("/api/v1/jukebox/config"); Assert.Equal(new[] { devs["pc-a"] }, cfg.GetProperty("defaultSpeakers").EnumerateArray().Select(x => x.GetInt64()));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { 99999L } })).StatusCode);
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { });                                     // no pick: the defaults
        Assert.Equal("jukebox", reg.GroupOf("pc-a"));
        await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { }); Assert.Equal(home, reg.GroupOf("pc-a"));
    }

    [Fact]
    public async Task A_speaker_left_in_the_Jukebox_zone_heals_when_the_Jukebox_is_not_running()
    {
        var (f, admin, a, b, devs, home) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b; var reg = f.Server.S.Registry;
        // what 0.4.9 left behind after Exit, and what a restart mid-session leaves: jukebox.devices still set, Jukebox not running
        f.Server.S.Db.SetSetting("jukebox.devices", JsonSerializer.Serialize(new[] { "pc-a" }));
        f.Server.S.Links.Apply();                                                                              // runs at startup and on every change
        Assert.Equal(home, reg.GroupOf("pc-a")); Assert.Empty(f.Server.S.Links.JukeboxPlayers());
        var z = await admin.GetJson("/api/v1/jukebox/zone"); Assert.Equal(0, z.GetProperty("deviceIds").GetArrayLength());
    }
}
