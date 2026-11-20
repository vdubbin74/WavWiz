using System.Net;
using System.Text.Json;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8 zone fix (t1800u): a speaker in no zone is silent (no hidden house fallback), an upgrade from before 0.6.8 gets a real "Everywhere"
/// zone (0.7.1 t2078u: a fresh setup gets none - the user makes the first zone), deleting a zone takes its music with it, and no speaker is the reference until the user picks one.</summary>
public class ZoneFix068Tests
{
    static async Task<Dictionary<string, long>> Devices(HttpClient admin) => (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
    static async Task<Dictionary<string, JsonElement>> Groups(HttpClient admin) => (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
    static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs) => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    static bool Hears(ServerFixture f, string pid) => f.Server.S.Registry.Live().Any(c => c.Subscribers().Any(s => s.Id == pid));
    static async Task Until(Func<bool> ok, string what) { for (int i = 0; i < 100 && !ok(); i++) await Task.Delay(50); Assert.True(ok(), what); }
    static QueueItem Radio(string title) => new(0, "radio", "http://127.0.0.1:1/x", title, "Test", "", 0, null);

    // 0.7.1 t2078u: replaces the 0.6.8 "Fresh setup puts the first speaker into Everywhere" test - the user asked for no automatic zone:
    // a fresh setup has no zone, every speaker starts in Unassigned (silent) and the user creates the first zone.
    [Fact]
    public async Task Fresh_setup_makes_no_zone_every_speaker_waits_in_Unassigned_until_the_user_makes_one()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S; var reg = S.Registry;
        Assert.Equal("done", S.Db.Setting(ZoneManager.EverywhereKey));   // empty database: nothing to migrate, nothing to wait for
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await a.WaitConnected(); await Until(() => S.Zones.Zones().Count == 1, "first speaker");
        await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen"); await b.WaitConnected(); await Until(() => S.Zones.Zones().Count == 2, "second speaker");
        var dev = await Devices(admin);
        Assert.Empty(await Groups(admin));                                  // no "Everywhere" (or any) zone made for the user
        foreach (var p in new[] { "pc-a", "pc-b" }) { Assert.Equal(ConductorRegistry.SilentGroupId, reg.GroupOf(p)); Assert.True(reg.IsSilent(p)); Assert.False(Hears(f, p)); }
        // the user makes the first zone with the first speaker: it plays the house music, the other still waits in Unassigned
        long living = await MakeZone(admin, "Living room", dev["pc-a"]);
        Assert.Equal(Conductor.DefaultGroupId, reg.GroupOf("pc-a")); Assert.True(Hears(f, "pc-a"));
        Assert.True(reg.IsSilent("pc-b")); Assert.False(Hears(f, "pc-b"));
        long tid = await E2ETests.AddClickTrack(f, admin, 20); long mark = reg.Clock.NowUs;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } })).StatusCode);
        for (int i = 0; i < 100 && a.Clicks(mark).Count < 4; i++) await Task.Delay(100);
        Assert.True(a.Clicks(mark).Count >= 4, "the first zone plays"); Assert.Empty(b.Clicks(mark)); Assert.False(reg.Playing("pc-b"));
        // move the zone to the second speaker: it plays; the first goes silent at once
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{living}", new { deviceIds = new[] { dev["pc-b"] } })).StatusCode);
        Assert.True(Hears(f, "pc-b")); Assert.False(Hears(f, "pc-a")); Assert.True(reg.IsSilent("pc-a"));
        mark = reg.Clock.NowUs + 1_000_000; for (int i = 0; i < 100 && b.Clicks(mark).Count < 3; i++) await Task.Delay(100);
        Assert.True(b.Clicks(mark).Count >= 3, "the added speaker plays"); Assert.Empty(a.Clicks(mark));
        // no auto-REF
        var zs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!);
        Assert.False(zs["pc-a"].GetProperty("reference").GetBoolean()); Assert.False(zs["pc-b"].GetProperty("reference").GetBoolean());
        Assert.Equal(JsonValueKind.Null, (await Groups(admin))["Living room"].GetProperty("referenceId").ValueKind);
        Assert.Equal(0, S.Zones.ReferenceZoneId);
        // a restart (the migration runs again) still makes no zone
        Assert.Equal("skipped", S.Zones.MigrateEverywhere()); Assert.Equal(new[] { "Living room" }, (await Groups(admin)).Keys.ToArray());
    }

    [Fact]
    public async Task A_setup_still_waiting_for_its_first_speaker_and_an_existing_Everywhere_zone_are_left_alone()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        // a 0.6.8-0.7.0 database that never saw a speaker ("pending"): 0.7.1 marks it done and makes no zone, even when a speaker arrives
        S.Db.SetSetting(ZoneManager.EverywhereKey, "pending");
        Assert.Equal("skipped", S.Zones.MigrateEverywhere()); Assert.Equal("done", S.Db.Setting(ZoneManager.EverywhereKey));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await a.WaitConnected(); await Until(() => S.Zones.Zones().Count == 1, "speaker");
        Assert.Empty(await Groups(admin));
        // an install that already has the automatic "Everywhere" zone keeps it exactly as it is (no deletion, no rename, still plays)
        var dev = await Devices(admin); long every = await MakeZone(admin, "Everywhere", dev["pc-a"]);
        Assert.Equal("skipped", S.Zones.MigrateEverywhere()); S.Links.Apply();
        var g = await Groups(admin); Assert.Equal(new[] { "Everywhere" }, g.Keys.ToArray()); Assert.Equal(every, g["Everywhere"].GetProperty("id").GetInt64());
        Assert.True(Hears(f, "pc-a"));
    }

    [Fact]
    public async Task Upgrade_of_a_house_without_named_zones_creates_Everywhere_with_every_speaker_so_the_music_carries_on()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S; f.SkipEverywhere();
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); await Until(() => S.Zones.Zones().Count == 2, "speakers");
        S.Conductor.Add(new[] { Radio("Carry on") }, false);   // what the house group was playing before the upgrade
        // first start of 0.6.8: no named zone yet -> "Everywhere" with both speakers, in the house group (same queue)
        S.Db.DeleteSetting(ZoneManager.EverywhereKey);
        Assert.Equal("created", S.Zones.MigrateEverywhere()); S.Links.Apply();
        var g = await Groups(admin); var dev = await Devices(admin);
        Assert.Equal(new[] { "Everywhere" }, g.Keys.ToArray());
        Assert.Equal(new[] { dev["pc-a"], dev["pc-b"] }.OrderBy(x => x), g["Everywhere"].GetProperty("deviceIds").EnumerateArray().Select(x => x.GetInt64()).OrderBy(x => x));
        Assert.Equal(Conductor.DefaultGroupId, g["Everywhere"].GetProperty("playbackId").GetString());
        Assert.True(Hears(f, "pc-a")); Assert.True(Hears(f, "pc-b")); Assert.Equal("Carry on", Assert.Single(S.Conductor.Queue()).Title);
        // runs once
        Assert.Equal("skipped", S.Zones.MigrateEverywhere()); Assert.Single(await Groups(admin));
    }

    [Fact]
    public async Task Upgrade_of_a_house_with_named_zones_keeps_them_silences_the_rest_and_forgets_auto_picked_references()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S; f.SkipEverywhere();
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen"); await using var c = await FakePc.StartAsync(f, "pc-c", "Den");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected(); await Until(() => S.Zones.Zones().Count == 3, "speakers");
        var dev = await Devices(admin);
        long kitchen = await MakeZone(admin, "Kitchen", dev["pc-a"]), den = await MakeZone(admin, "Den", dev["pc-c"]);
        // 0.6.8-#15 had auto-picked each lone speaker as its zone's reference; Den's is also the house reference the user chose
        S.Zones.ReferenceZoneId = dev["pc-c"]; S.Db.SetSetting(ZoneRefs.MapKey, ZoneRefs.MapJson(new Dictionary<long, long> { [kitchen] = dev["pc-a"], [den] = dev["pc-c"] }));
        S.Db.DeleteSetting(ZoneManager.EverywhereKey);
        Assert.Equal("kept", S.Zones.MigrateEverywhere()); S.Links.Apply();
        var g = await Groups(admin);
        Assert.Equal(new[] { "Den", "Kitchen" }, g.Keys.OrderBy(x => x).ToArray());   // no Everywhere: named zones stay as they are
        Assert.True(Hears(f, "pc-a")); Assert.True(Hears(f, "pc-c")); Assert.False(Hears(f, "pc-b")); Assert.True(S.Registry.IsSilent("pc-b"));
        Assert.Equal(JsonValueKind.Null, g["Kitchen"].GetProperty("referenceId").ValueKind);   // auto pick forgotten
        Assert.Equal(dev["pc-c"], g["Den"].GetProperty("referenceId").GetInt64());               // the user's house reference kept
    }

    [Fact]
    public async Task Deleting_a_zone_stops_its_music_leaves_no_ghost_and_its_id_cannot_be_played_or_queued()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S; var reg = S.Registry; f.SkipEverywhere();
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await using var b = await FakePc.StartAsync(f, "pc-b", "Patio");
        await a.WaitConnected(); await b.WaitConnected(); await Until(() => S.Zones.Zones().Count == 2, "speakers");
        var dev = await Devices(admin);
        long every = await MakeZone(admin, "Everywhere", dev["pc-a"]), patio = await MakeZone(admin, "Patio", dev["pc-b"]);
        await admin.PostAsJsonAsync($"/api/v1/groups/{patio}/split", new { });   // Patio has its own music
        string pg = S.Links.PlaybackId(patio); Assert.Equal($"zg:{patio}", pg);
        reg.Get(pg)!.Add(new[] { Radio("Patio song") }, false); S.Conductor.Add(new[] { Radio("House song") }, false);
        Assert.True(Hears(f, "pc-b"));
        // delete Patio: its group is gone with its queue, its speaker is silent, the remaining zone is untouched
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{patio}")).StatusCode);
        Assert.False(reg.Exists(pg)); Assert.True(reg.IsSilent("pc-b")); Assert.False(Hears(f, "pc-b"));
        Assert.Equal(new[] { "Everywhere" }, (await Groups(admin)).Keys.ToArray());
        Assert.Equal("House song", Assert.Single(S.Conductor.Queue()).Title);
        // a stale client still pointing at Patio cannot put songs anywhere under its name (no fallback into the house group)
        foreach (var zid in new[] { $"g:{patio}", pg })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "radio", id = 1, zoneId = zid })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/v1/stream/play?zoneId={Uri.EscapeDataString(zid)}", new { kind = "radio", id = 1 })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/stream/resume", new { zoneId = zid })).StatusCode);
        }
        Assert.Equal("House song", Assert.Single(S.Conductor.Queue()).Title);
        var r = await admin.GetAsync($"/api/v1/stream?zoneId=g:{patio}"); Assert.True(r.Headers.Contains("X-WavWiz-Zone-Fallback"));   // reads tell the client to re-pick
        // delete the last zone that plays in the house group: the house music stops and its queue goes with it
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{every}")).StatusCode);
        Assert.Empty(S.Conductor.Queue()); Assert.Equal(PlayState.Stopped, S.Conductor.State);
        Assert.True(reg.IsSilent("pc-a")); Assert.False(Hears(f, "pc-a")); Assert.Empty(await Groups(admin));
    }
}
