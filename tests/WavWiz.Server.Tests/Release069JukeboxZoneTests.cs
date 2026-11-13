using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #19 (t1846-t1849): the Jukebox zone's OFF / ON is a saved setting. It used to be "is any of the zone's speakers on", and the
/// Jukebox zone only holds speakers while it runs, so with no speakers the switch did nothing. Off by default; ON = its speakers play while
/// the Jukebox runs, OFF = the speakers it borrowed are switched off (and always switched back on afterwards). Saved with songs per guest and
/// vote to skip, and kept across a restart.</summary>
public class Release069JukeboxZoneTests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, Dictionary<string, long> devs)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "PCBOXV2"); await a.WaitConnected(); for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 1; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        return (f, admin, a, devs);
    }
    static bool Enabled(ServerFixture f, long id) => f.Server.S.Zones.Zones().First(z => z.Id == id).Enabled;

    [Fact]
    public async Task Off_by_default_saved_with_the_panel_settings_and_kept_across_a_restart_even_with_no_speakers()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var z = await admin.GetJson("/api/v1/jukebox/zone");
        Assert.False(z.GetProperty("zoneOn").GetBoolean()); Assert.Equal(0, z.GetProperty("deviceIds").GetArrayLength());   // the user's case: no speakers
        Assert.Equal(3, z.GetProperty("perGuest").GetInt32()); Assert.True(z.GetProperty("voteSkip").GetBoolean());
        // an install whose saved config predates the switch reads as off
        f.Server.S.Db.SetSetting("jukebox.config", JsonSerializer.Serialize("{\"style\":\"retro\",\"perGuest\":4}"));
        Assert.False(f.Server.S.Jukebox.Cfg().ZoneOn); Assert.Equal(4, f.Server.S.Jukebox.Cfg().PerGuest);
        // Save (the panel sends only what changed)
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { zoneOn = true, perGuest = 5, voteSkip = false })).StatusCode);
        z = await admin.GetJson("/api/v1/jukebox/zone");
        Assert.True(z.GetProperty("zoneOn").GetBoolean()); Assert.Equal(5, z.GetProperty("perGuest").GetInt32()); Assert.False(z.GetProperty("voteSkip").GetBoolean());
        Assert.Equal("retro", f.Server.S.Jukebox.Cfg().Style);   // other settings untouched
        // a restart: a fresh service over the same database reads the same
        var again = new WavWiz.Server.Features.JukeboxService(f.Server.S.Db, null!, null!).Cfg(); Assert.True(again.ZoneOn); Assert.Equal(5, again.PerGuest); Assert.False(again.VoteSkip);
        // only an admin saves it
        var ctl = f.As(f.Token(Role.Control));
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PutAsJsonAsync("/api/v1/jukebox/config", new { zoneOn = false })).StatusCode);
        Assert.True(f.Server.S.Jukebox.Cfg().ZoneOn);
    }

    [Fact]
    public async Task Off_silences_the_borrowed_speakers_on_switches_them_on_and_they_are_always_given_back_on()
    {
        var (f, admin, a, devs) = await Setup(); await using var _f = f; await using var _a = a; var id = devs["pc-a"];
        Assert.True(Enabled(f, id));
        // OFF (default): start borrows the speaker and keeps it silent
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { deviceIds = new[] { id } });
        Assert.Equal("jukebox", f.Server.S.Registry.GroupOf("pc-a")); Assert.False(Enabled(f, id));
        Assert.Contains(id, WavWiz.Server.Features.JukeboxPower.OffIds(f.Server.S.Db));
        // Save ON while running: it plays
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { zoneOn = true }); Assert.True(Enabled(f, id));
        Assert.Empty(WavWiz.Server.Features.JukeboxPower.OffIds(f.Server.S.Db));
        // OFF again, then Exit Jukebox: the speaker goes home switched ON (never left off by the Jukebox)
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { zoneOn = false }); Assert.False(Enabled(f, id));
        await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { }); Assert.True(Enabled(f, id)); Assert.NotEqual("jukebox", f.Server.S.Registry.GroupOf("pc-a"));
        // a restart mid-session (speaker left switched off by the Jukebox): startup gives it back on
        f.Server.S.Zones.Patch(id, null, null, null, false); f.Server.S.Db.SetSetting(WavWiz.Server.Features.JukeboxPower.OffKey, JsonSerializer.Serialize(new[] { id }));
        WavWiz.Server.Features.JukeboxPower.Apply(f.Server.S); Assert.True(Enabled(f, id));
        // a speaker the user switched off themselves is never switched on by the Jukebox
        f.Server.S.Zones.Patch(id, null, null, null, false); WavWiz.Server.Features.JukeboxPower.Apply(f.Server.S); Assert.False(Enabled(f, id));
        f.Server.S.Zones.Patch(id, null, null, null, true);
        // ON: a started Jukebox's speaker stays on
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { zoneOn = true });
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { deviceIds = new[] { id } }); Assert.True(Enabled(f, id));
        await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { }); Assert.True(Enabled(f, id));
    }
}
