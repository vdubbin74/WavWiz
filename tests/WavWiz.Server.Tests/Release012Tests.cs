using WavWiz.Server;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Receivers;
namespace WavWiz.Server.Tests;

/// <summary>0.1.2: AirPlay/Spotify level offsets, TargetMs 1800, wavwiz.db rename, admin reset on server PC.</summary>
public class Release012Tests
{
    [Fact]
    public async Task AirPlay_LiveFeed_targets_about_1800_ms()
    {
        Assert.Equal(1800, new LiveFeed { TargetMs = 1800 }.TargetMs);
        await using var f = await ServerFixture.StartAsync();
        Assert.Equal(1800, f.Server.S.AirPlay!.Feed.TargetMs);
    }

    [Fact]
    public void VolumeToGain_then_level_offset_multiplies()
    {
        var phone = AirPlayReceiver.VolumeToGain(-6);
        var level = (float)Math.Pow(10, 6 / 20.0);
        Assert.InRange(phone * level, 0.9f, 1.1f);
        Assert.Equal(0f, AirPlayReceiver.VolumeToGain(-144));
    }

    [Fact]
    public void Unison_db_renames_to_wavwiz_db_on_first_open()
    {
        using var t = new TempDir();
        var seedPath = Path.Combine(t.Path, "seed.db");
        var db = new Db(seedPath); db.Migrate();
        var old = Path.Combine(t.Path, "unison.db");
        File.Move(seedPath, old);
        foreach (var s in new[] { "-wal", "-shm" })
        {
            var p = seedPath + s; if (File.Exists(p)) File.Move(p, old + s);
        }
        var cfg = new ServerConfig { DataDir = t.Path };
        var path = cfg.DbPath;
        Assert.EndsWith(Path.DirectorySeparatorChar + "wavwiz.db", path);
        Assert.True(File.Exists(path));
        Assert.False(File.Exists(old));
    }

    [Fact]
    public void ClearPassword_forces_setup_without_wiping_other_settings()
    {
        using var t = new TempDir();
        var db = new Db(t.File("w.db")); db.Migrate();
        var a = new AuthService(db);
        Assert.Null(a.SetPassword("long-enough"));
        db.SetSetting("spotify.enabled", "true");
        Assert.False(a.SetupRequired);
        a.ClearPassword();
        Assert.True(a.SetupRequired);
        Assert.Equal("true", db.Setting("spotify.enabled"));
        Assert.Null(a.SetPassword("another-long-password"));
        Assert.True(a.CheckPassword("another-long-password"));
    }

    [Fact]
    public async Task Admin_can_set_airplay_and_spotify_levelDb_0_to_6()
    {
        await using var f = await ServerFixture.StartAsync();
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = 3 })).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.levelDb"] = 6 })).EnsureSuccessStatusCode();
        var st = await admin.GetFromJsonAsync<JsonElement>("/api/v1/receivers");
        Assert.Equal(3, st.GetProperty("airplay").GetProperty("levelDb").GetDouble());
        Assert.Equal(6, st.GetProperty("spotify").GetProperty("levelDb").GetDouble());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = 7 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = -1 })).StatusCode);
    }

    [Fact]
    public async Task Reset_password_from_this_machine_sets_new_password()
    {
        await using var f = await ServerFixture.StartAsync();
        await f.SetupAdmin();
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/reset-password", new { password = "brand-new-password" });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("setupRequired").GetBoolean());
        Assert.True(f.Server.S.Auth.CheckPassword("brand-new-password"));
    }
}
