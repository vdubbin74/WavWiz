using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F76: Settings > Jukebox - default speakers and "Show Jukebox zone in Devices" are persisted server-side and reported with the Jukebox zone.</summary>
public class Release049JukeboxDefaultsTests
{
    [Fact]
    public async Task Defaults_start_unsaved_and_shown()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var cfg = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/config");
        Assert.Equal(JsonValueKind.Null, cfg.GetProperty("defaultSpeakers").ValueKind); Assert.True(cfg.GetProperty("showInDevices").GetBoolean());
        var z = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/zone");
        Assert.True(z.GetProperty("showInDevices").GetBoolean()); Assert.False(z.GetProperty("running").GetBoolean()); Assert.Equal(JsonValueKind.Null, z.GetProperty("defaultSpeakers").ValueKind);
    }

    [Fact]
    public async Task Defaults_and_switch_persist_deduped()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var r = await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { defaultSpeakers = new long[] { 3, 1, 3, -2 }, showInDevices = false });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var cfg = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/config");
        Assert.Equal(new long[] { 3, 1 }, cfg.GetProperty("defaultSpeakers").EnumerateArray().Select(x => x.GetInt64()).ToArray()); Assert.False(cfg.GetProperty("showInDevices").GetBoolean());
        var z = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/zone");
        Assert.False(z.GetProperty("showInDevices").GetBoolean()); Assert.Equal(2, z.GetProperty("defaultSpeakers").GetArrayLength());
        // other options keep their values; an empty list is "saved, none"
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { perGuest = 4 });
        cfg = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/config"); Assert.Equal(2, cfg.GetProperty("defaultSpeakers").GetArrayLength()); Assert.False(cfg.GetProperty("showInDevices").GetBoolean());
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { defaultSpeakers = Array.Empty<long>() });
        cfg = await admin.GetFromJsonAsync<JsonElement>("/api/v1/jukebox/config"); Assert.Equal(0, cfg.GetProperty("defaultSpeakers").GetArrayLength());
    }

    [Fact]
    public async Task Only_admins_change_them()
    {
        var f = await ServerFixture.StartAsync(); var ctl = f.As(f.Token(Role.Control));
        Assert.NotEqual(HttpStatusCode.OK, (await ctl.PutAsJsonAsync("/api/v1/jukebox/config", new { showInDevices = false })).StatusCode);
    }
}
