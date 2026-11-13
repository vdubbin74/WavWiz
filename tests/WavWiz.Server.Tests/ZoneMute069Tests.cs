using System.Net.Http.Json;
using System.Text.Json;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 t1894: the zone mute works like the master mute, scoped to the zone. Mute mutes every member (ONE "zones" event, so a client never
/// paints a half-muted zone); Unmute un-mutes what the zone mute muted, so a speaker the user muted on its own stays muted; each speaker's own
/// toggle keeps working. Mixed zone: Mute mutes the rest. Nothing on record (all muted one by one): Unmute un-mutes every member.</summary>
public class ZoneMute069Tests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, long ida, long idb)> TwoPcs()
    {
        var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var a = await FakePc.StartAsync(f, "pc-a", "Den"); var b = await FakePc.StartAsync(f, "pc-b", "Kitchen"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones");
        for (int i = 0; i < 100 && zs.GetArrayLength() < 2; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        return (f, admin, a, b, Id("pc-a"), Id("pc-b"));
    }
    private static async Task<(bool a, bool b)> Muted(HttpClient c, long ida, long idb)
    {
        var zs = (await c.GetJson("/api/v1/zones")).EnumerateArray().ToList();
        bool M(long id) => zs.First(z => z.GetProperty("id").GetInt64() == id).GetProperty("muted").GetBoolean();
        return (M(ida), M(idb));
    }

    [Fact]
    public async Task Zone_mute_unmute_speaker_toggles_zone_mute_again_and_master_mute()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var gid = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Living Room", deviceIds = new[] { ida, idb } })).Json()).GetProperty("id").GetInt64();
        async Task Zone(bool m) => (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/mute", new { muted = m })).EnsureSuccessStatusCode();
        async Task Spk(long id, bool m) => (await admin.PatchAsJsonAsync($"/api/v1/zones/{id}", new { muted = m })).EnsureSuccessStatusCode();

        await Zone(true); Assert.Equal((true, true), await Muted(admin, ida, idb));
        await Zone(false); Assert.Equal((false, false), await Muted(admin, ida, idb));
        await Spk(ida, true); Assert.Equal((true, false), await Muted(admin, ida, idb));     // own toggles keep working
        await Spk(idb, true); Assert.Equal((true, true), await Muted(admin, ida, idb));
        await Spk(ida, false); Assert.Equal((false, true), await Muted(admin, ida, idb));    // mixed
        await Zone(true); Assert.Equal((true, true), await Muted(admin, ida, idb));          // mixed + Mute = mute the rest
        await Zone(false); Assert.Equal((false, true), await Muted(admin, ida, idb));        // b was muted on its own: it stays muted
        await Spk(ida, true); Assert.Equal((true, true), await Muted(admin, ida, idb));      // now all muted one by one...
        await Zone(false); Assert.Equal((false, false), await Muted(admin, ida, idb));       // ...nothing on record: Unmute un-mutes every member

        // master mute regression: unchanged (mute all, unmute restores what it muted)
        await Spk(idb, true);
        (await admin.PostAsJsonAsync("/api/v1/zones/mute-all", new { muted = true })).EnsureSuccessStatusCode(); Assert.Equal((true, true), await Muted(admin, ida, idb));
        (await admin.PostAsJsonAsync("/api/v1/zones/mute-all", new { muted = false })).EnsureSuccessStatusCode(); Assert.Equal((false, true), await Muted(admin, ida, idb));
        Assert.True((await (await admin.PostAsJsonAsync($"/api/v1/groups/999999/mute", new { muted = true })).Content.ReadAsStringAsync()).Contains("zone not found"));
    }

    [Fact]
    public async Task T1897_zone_on_off_switches_every_member_in_one_call()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var gid = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Both", deviceIds = new[] { ida, idb } })).Json()).GetProperty("id").GetInt64();
        async Task<(bool, bool)> On() { var zs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToList(); bool E(long id) => zs.First(z => z.GetProperty("id").GetInt64() == id).GetProperty("enabled").GetBoolean(); return (E(ida), E(idb)); }
        (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/enabled", new { enabled = false })).EnsureSuccessStatusCode(); Assert.Equal((false, false), await On());
        (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/enabled", new { enabled = true })).EnsureSuccessStatusCode(); Assert.Equal((true, true), await On());
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/groups/{gid}/enabled", new { })).StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/groups/999999/enabled", new { enabled = false })).StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PostAsJsonAsync($"/api/v1/groups/{gid}/enabled", new { enabled = false })).StatusCode);
        Assert.Equal((true, true), await On());
    }

    [Fact]
    public async Task A_zone_mute_publishes_ONE_zones_event_not_one_per_speaker()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var gid = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Both", deviceIds = new[] { ida, idb } })).Json()).GetProperty("id").GetInt64();
        await Task.Delay(300);
        foreach (var (path, m) in new[] { ($"/api/v1/groups/{gid}/mute", true), ($"/api/v1/groups/{gid}/mute", false), ("/api/v1/zones/mute-all", true), ("/api/v1/zones/mute-all", false), ($"/api/v1/groups/{gid}/enabled", false), ($"/api/v1/groups/{gid}/enabled", true) })
        {
            await Task.Delay(400); var (sub, reader) = f.Server.S.Events.Subscribe();
            try
            {
                (await admin.PostAsJsonAsync(path, path.EndsWith("/enabled") ? new { enabled = m } as object : new { muted = m })).EnsureSuccessStatusCode();
                var n = 0;   // read right after the response: what the press itself published (Publish writes before the request returns; speakers' own later acks are not the press)
                while (reader.TryRead(out var msg)) if (JsonDocument.Parse(msg).RootElement.GetProperty("type").GetString() == "zones") n++;
                Assert.True(n == 1, $"{path} muted={m}: {n} zones events");
            }
            finally { f.Server.S.Events.Unsubscribe(sub); }
        }
    }
}
