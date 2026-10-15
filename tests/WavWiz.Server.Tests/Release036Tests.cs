using System.Net;
using System.Text.Json;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.3.6: K11 band feed, K10 trackNo, K20 backups + undo, K6/K7 speaker profiles and scene profile per device, migration v7.</summary>
public class Release036Tests
{
    static float[] Sine(double hz, int frames = 8192, double amp = 0.5) { var b = new float[frames * 2]; for (int i = 0; i < frames; i++) b[2 * i] = b[2 * i + 1] = (float)(amp * Math.Sin(2 * Math.PI * hz * i / 48000)); return b; }
    static byte[] Feed(double hz, double amp = 0.5) { var v = new VizHub(); v.OnFrame(1_000_000, Sine(hz, 8192, amp)); return v.At(1_000_000 + (long)(8192 * 1e6 / 48000.0))!; }

    [Theory]
    [InlineData(31.25, 0)]
    [InlineData(62.5, 1)]
    [InlineData(1000, 5)]
    [InlineData(8000, 8)]
    [InlineData(16000, 9)]
    public void K11_a_sine_at_a_band_center_lights_that_band_most(double hz, int band)
    {
        var d = Feed(hz); Assert.Equal(VizHub.Window + VizHub.Extra, d.Length); Assert.Equal(1024 + 14, d.Length);
        var bands = d.Skip(VizHub.Window + VizHub.Levels).Take(VizHub.Bands).ToArray();
        Assert.Equal(band, Array.IndexOf(bands, bands.Max())); Assert.True(bands[band] > 100);
        for (int i = 0; i < 10; i++) if (Math.Abs(i - band) >= 2) Assert.True(bands[i] < bands[band] - 40, $"band {i} should be far below band {band}");
    }

    [Fact]
    public void K11_31_and_62_Hz_are_separate_bands_and_silence_is_zero()
    {
        var a = Feed(31.25).Skip(1028).Take(10).ToArray(); var b = Feed(62.5).Skip(1028).Take(10).ToArray();
        Assert.True(a[0] > a[1] + 30); Assert.True(b[1] > b[0] + 30);
        var v = new VizHub(); v.OnFrame(1_000_000, new float[32768]); Assert.All(v.At(1_000_000 + 341_333)!.Skip(1028).Take(10), x => Assert.Equal(0, x));
    }

    [Fact]
    public void K20_snapshots_are_listed_pruned_and_names_are_validated()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        var svc = new WavWiz.Server.Features.BackupService(db, new EventHub(), Path.Combine(t.Path, "backups"));
        var at = new DateTime(2026, 10, 14, 9, 0, 0);
        for (int i = 0; i < 13; i++) svc.SaveSnapshot("0.3.6", false, at.AddMinutes(i));
        for (int i = 0; i < 5; i++) svc.SaveSnapshot("0.3.6", true, at.AddHours(1).AddMinutes(i));
        var l = svc.ListSnapshots(); Assert.Equal(10, l.Count(x => x.Kind == "manual")); Assert.Equal(3, l.Count(x => x.Kind == "before-restore"));
        Assert.True(string.CompareOrdinal(l[0].Name, l[^1].Name) > 0, "newest first");
        Assert.NotNull(svc.ReadSnapshot(l[0].Name)); Assert.Null(svc.ReadSnapshot("../u.db")); Assert.Null(svc.ReadSnapshot("WavWiz-19990101-000000.wavwizbackup"));
        Assert.False(WavWiz.Server.Features.BackupService.ValidSnapshotName("..\\x.wavwizbackup")); Assert.True(WavWiz.Server.Features.BackupService.ValidSnapshotName("WavWiz-20261014-090000-before-restore.wavwizbackup"));
    }

    [Fact]
    public void Migration_v7_adds_device_profile_and_scene_member_profile()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); Assert.Equal(Db.Migrations.Length, db.Version()); Assert.True(db.Version() >= 7);
        Assert.Equal(0, Convert.ToInt32(db.Scalar("SELECT COUNT(*) FROM device_profile")));
        Assert.True(Convert.ToInt32(db.Scalar("SELECT COUNT(*) FROM pragma_table_info('scene_member') WHERE name='profile_id'")) == 1);
    }

    static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, long ida, long idb)> TwoPcs()
    {
        var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones");
        for (int i = 0; i < 100 && zs.GetArrayLength() < 2; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        return (f, admin, a, b, Id("pc-a"), Id("pc-b"));
    }
    static async Task<JsonElement> Zone(HttpClient c, long id) => (await c.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("id").GetInt64() == id);

    [Fact]
    public async Task K6_profile_saves_applies_flags_modified_and_only_admins_write()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 35 })).EnsureSuccessStatusCode();
        var r = await admin.PostAsJsonAsync("/api/v1/profiles", new { name = "Quiet kitchen", zoneId = ida }); r.EnsureSuccessStatusCode(); var pid = (await r.Json()).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/profiles", new { name = "quiet KITCHEN", zoneId = idb })).StatusCode);   // names are unique
        var loaded = await admin.GetJson($"/api/v1/profiles/for/{ida}"); Assert.Equal(pid, loaded.GetProperty("profileId").GetInt64()); Assert.False(loaded.GetProperty("modified").GetBoolean());
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 70 })).EnsureSuccessStatusCode();
        Assert.True((await admin.GetJson($"/api/v1/profiles/for/{ida}")).GetProperty("modified").GetBoolean());
        (await admin.PostAsJsonAsync($"/api/v1/profiles/{pid}/apply", new { zoneId = idb })).EnsureSuccessStatusCode();
        Assert.Equal(35, (await Zone(admin, idb)).GetProperty("volume").GetDouble(), 0);
        Assert.Equal(70, (await Zone(admin, ida)).GetProperty("volume").GetDouble(), 0);             // applying to B never touches A
        var ctl = f.As(f.Token(Role.Control, "phone"));
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PostAsJsonAsync("/api/v1/profiles", new { name = "x", zoneId = ida })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.DeleteAsync($"/api/v1/profiles/{pid}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ctl.GetAsync("/api/v1/profiles")).StatusCode);
        (await admin.DeleteAsync($"/api/v1/profiles/{pid}")).EnsureSuccessStatusCode(); Assert.Equal(0, (await admin.GetJson("/api/v1/profiles")).GetArrayLength());
    }

    [Fact]
    public async Task K7_scene_applies_a_profile_per_device_cap_still_wins_and_a_backup_round_trips_profiles()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 25 })).EnsureSuccessStatusCode();
        var pid = (await (await admin.PostAsJsonAsync("/api/v1/profiles", new { name = "Low", zoneId = ida })).Json()).GetProperty("id").GetInt64();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 60 })).EnsureSuccessStatusCode();
        var sr = await admin.PostAsJsonAsync("/api/v1/scenes", new { name = "Evening", members = new object[] { new { deviceId = ida, volume = 50, on = true, profileId = pid }, new { deviceId = idb, volume = 40, on = true } } });
        sr.EnsureSuccessStatusCode(); var sid = (await sr.Json()).GetProperty("id").GetInt64();
        var list = await admin.GetJson("/api/v1/scenes"); var sc = list.EnumerateArray().First(x => x.GetProperty("id").GetInt64() == sid);
        var m = sc.GetProperty("members").EnumerateArray().ToList(); Assert.Equal(pid, m.First(x => x.GetProperty("deviceId").GetInt64() == ida).GetProperty("profileId").GetInt64());
        Assert.Equal(JsonValueKind.Null, m.First(x => x.GetProperty("deviceId").GetInt64() == idb).GetProperty("profileId").ValueKind);
        (await admin.PutAsJsonAsync($"/api/v1/zones/{ida}/volcap", new { cap = 45, locked = true })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/api/v1/scenes/{sid}/apply", new { })).EnsureSuccessStatusCode();
        Assert.True((await Zone(admin, ida)).GetProperty("volume").GetDouble() <= 45.01, "the max-volume lock beats the scene volume");
        Assert.Equal(40, (await Zone(admin, idb)).GetProperty("volume").GetDouble(), 0);
        // export -> wipe -> import brings profiles and the scene's profile back
        var bk = await admin.PostAsync("/api/v1/backup/export", null); var raw = bk.IsSuccessStatusCode ? await bk.Content.ReadAsByteArrayAsync() : f.Server.S.Backup.Export("0.3.6");
        (await admin.DeleteAsync($"/api/v1/profiles/{pid}")).EnsureSuccessStatusCode();
        var imp = await admin.PostAsync("/api/v1/backup/import", new ByteArrayContent(raw)); Assert.True(imp.IsSuccessStatusCode, await imp.Content.ReadAsStringAsync());
        Assert.Equal(1, (await admin.GetJson("/api/v1/profiles")).GetArrayLength());
        Assert.False(string.IsNullOrEmpty((await imp.Json()).GetProperty("undo").GetString()));
        Assert.Contains(f.Server.S.Backup.ListSnapshots(), s => s.Kind == "before-restore");
    }

    [Fact]
    public async Task K20_back_up_now_lists_previews_and_restores_a_saved_backup_admin_only()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var n = await admin.PostAsJsonAsync("/api/v1/backup/now", new { }); n.EnsureSuccessStatusCode(); var name = (await n.Json()).GetProperty("name").GetString()!;
        Assert.Contains(name, (await admin.GetJson("/api/v1/backup/list")).EnumerateArray().Select(x => x.GetProperty("name").GetString()));
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/backup/preview-saved", new { name })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/backup/preview-saved", new { name = "WavWiz-19990101-000000.wavwizbackup" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/backup/restore-saved", new { name })).StatusCode);
        var ctl = f.As(f.Token(Role.Control, "phone"));
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PostAsJsonAsync("/api/v1/backup/now", new { })).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await ctl.GetAsync("/api/v1/backup/list")).StatusCode);
    }
}
