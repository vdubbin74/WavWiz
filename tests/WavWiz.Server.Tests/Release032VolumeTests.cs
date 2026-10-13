using System.Net;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.3.2 F4 zone volume (offset-keeping, mute) and F18 per-room max-volume lock, enforced on the server for every source.</summary>
public class Release032VolumeTests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, long ida, long idb)> TwoPcs()
    {
        var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones");
        for (int i = 0; i < 100 && zs.GetArrayLength() < 2; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        return (f, admin, a, b, Id("pc-a"), Id("pc-b"));
    }
    private static async Task<double> Vol(HttpClient c, long id) => (await c.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("id").GetInt64() == id).GetProperty("volume").GetDouble();

    [Fact]
    public void ZoneVolume_shift_keeps_offsets_through_a_clamp_and_level_is_the_average()
    {
        double[] v = { 90, 60 };
        var up = ZoneVolume.Shift(v, 95); Assert.Equal(new double[] { 100, 80 }, ZoneVolume.Real(up));   // virtual 110/80: 110 clamps to 100, the offset stays virtual
        var back = ZoneVolume.Shift(up, 75); Assert.Equal(new double[] { 90, 60 }, ZoneVolume.Real(back)); // back down: the 30-point offset is intact
        Assert.Equal(75, ZoneVolume.Level(new List<double> { 90, 60 }));
    }

    [Fact]
    public void VolumeCap_only_ever_lowers_and_only_when_locked()
    {
        var c = new VolumeCap(40, true);
        Assert.Equal(40, VolumeCap.Apply(100, c)); Assert.Equal(40, VolumeCap.Apply(80, c)); Assert.Equal(30, VolumeCap.Apply(30, c)); Assert.Equal(0, VolumeCap.Apply(0, c));
        Assert.Equal(80, VolumeCap.Apply(80, c with { Locked = false })); Assert.Equal(80, VolumeCap.Apply(80, VolumeCap.None));
    }

    [Fact]
    public async Task Locked_cap_holds_against_master_device_zone_scene_and_api_lowering_works_unlock_restores()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 30 })).EnsureSuccessStatusCode();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{idb}", new { volume = 30 })).EnsureSuccessStatusCode();
        // only an admin may change the cap
        var ctl = f.As(f.Token(Role.Control, "phone"));
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PutAsJsonAsync($"/api/v1/zones/{ida}/volcap", new { cap = 90, locked = false })).StatusCode);
        (await admin.PutAsJsonAsync($"/api/v1/zones/{ida}/volcap", new { cap = 40, locked = true })).EnsureSuccessStatusCode();
        var z = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(x => x.GetProperty("id").GetInt64() == ida);
        Assert.Equal(40, z.GetProperty("volCap").GetDouble()); Assert.True(z.GetProperty("volLocked").GetBoolean());
        // master to 100: the capped room stays at 40, the other keeps moving
        (await admin.PostAsJsonAsync("/api/v1/zones/master", new { set = 100 })).EnsureSuccessStatusCode();
        Assert.Equal(40, await Vol(admin, ida)); Assert.True(await Vol(admin, idb) > 40);
        // device slider / API / mini player (all PATCH /zones/{id}) asking 80 gives 40, also for a Control token
        (await ctl.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 80 })).EnsureSuccessStatusCode(); Assert.Equal(40, await Vol(admin, ida));
        // a scene / schedule / alarm "volumes" step goes through the same server write
        Assert.Null(f.Server.S.Zones.Patch(ida, null, 80, null, null)); Assert.Equal(40, await Vol(admin, ida));
        // zone slider
        var g = await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Both", deviceIds = new[] { ida, idb } })).Json();
        (await admin.PostAsJsonAsync($"/api/v1/groups/{g.GetProperty("id").GetInt64()}/volume", new { set = 95 })).EnsureSuccessStatusCode();
        Assert.Equal(40, await Vol(admin, ida));
        // lowering is always allowed
        (await ctl.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 25 })).EnsureSuccessStatusCode(); Assert.Equal(25, await Vol(admin, ida));
        // the cap is saved (survives a restart: it lives in the database)
        Assert.Contains("\"Locked\":true", f.Server.S.Db.Setting("volcap." + ida));
        // unlock: normal behavior again
        (await admin.PutAsJsonAsync($"/api/v1/zones/{ida}/volcap", new { locked = false })).EnsureSuccessStatusCode();
        (await ctl.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 80 })).EnsureSuccessStatusCode(); Assert.Equal(80, await Vol(admin, ida));
        // locking while above the cap brings the room down to it
        (await admin.PutAsJsonAsync($"/api/v1/zones/{ida}/volcap", new { cap = 50, locked = true })).EnsureSuccessStatusCode(); Assert.Equal(50, await Vol(admin, ida));
    }

    [Fact]
    public async Task Zone_volume_moves_members_together_and_zone_mute_mutes_all_members()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 90 })).EnsureSuccessStatusCode();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{idb}", new { volume = 60 })).EnsureSuccessStatusCode();
        var g = await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Both", deviceIds = new[] { ida, idb } })).Json(); var gid = g.GetProperty("id").GetInt64();
        Assert.Equal(75, g.GetProperty("volume").GetDouble());
        (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/volume", new { set = 95 })).EnsureSuccessStatusCode();
        Assert.Equal(100, await Vol(admin, ida)); Assert.Equal(80, await Vol(admin, idb));
        (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/volume", new { set = 75 })).EnsureSuccessStatusCode();
        Assert.Equal(90, await Vol(admin, ida)); Assert.Equal(60, await Vol(admin, idb));      // offset survived the clamp
        (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/mute", new { muted = true })).EnsureSuccessStatusCode();
        var zs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().Where(z => z.GetProperty("id").GetInt64() is var i && (i == ida || i == idb));
        Assert.All(zs, z => Assert.True(z.GetProperty("muted").GetBoolean()));
        Assert.True((await admin.GetJson("/api/v1/groups")).EnumerateArray().First(x => x.GetProperty("id").GetInt64() == gid).GetProperty("muted").GetBoolean());
    }
}
