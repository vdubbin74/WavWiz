using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2038u: ticking a box in "Speakers for Jukebox" said "device not found". The saved default speakers still held the id of a
/// device removed since; the browser re-sent it with every tick (the browser now sends only the boxes on screen, see v071jukebox.test.mjs).
/// The saved list itself is kept as saved (0.4.9 contract, Release049JukeboxDefaultsTests); Start with no pick now skips the removed ids.</summary>
public class Release071JukeboxStaleSpeakerTests
{
    [Fact]
    public async Task A_removed_default_speaker_is_refused_when_sent_and_skipped_by_start()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Basement PC"); await a.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 1; i++) await Task.Delay(50);
        var pa = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-a").GetProperty("id").GetInt64();
        const long gone = 987654;   // a device that was removed after it was saved as a default speaker
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { defaultSpeakers = new[] { pa, gone } })).StatusCode);
        // what the browser now sends after a tick (the boxes on screen) is accepted; an unknown id is still refused
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { pa } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/jukebox/zone", new { deviceIds = new[] { pa, gone } })).StatusCode);
        // Start with no pick uses the defaults that still exist (it used to fail with "device not found")
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { defaultSpeakers = new[] { pa, gone } })).StatusCode);
        var r = await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("jukebox", f.Server.S.Registry.GroupOf("pc-a"));
        await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { });
    }
}
