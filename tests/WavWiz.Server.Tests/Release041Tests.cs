using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.4.1 zone fixes: unknown zone falls back to the house group, every zone has a playback group, stale groups are pruned,
/// the smaller zone takes precedence (claim on play, release on stop / re-link), Split off explains a no-op.</summary>
public class Release041Tests
{
    private static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    private static async Task<(ServerFixture f, HttpClient admin, long dA, long dB, FakePc a, FakePc b)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker"); await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        return (f, admin, devs["pc-a"], devs["pc-b"], a, b);
    }

    [Fact]
    public async Task An_unknown_zone_id_reads_fall_back_to_the_house_group_but_stop_is_refused()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        foreach (var z in new[] { "zg:999", "g:999", "nonsense" })
        {
            var r = await admin.GetAsync($"/api/v1/stream?zoneId={z}"); Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            Assert.True(r.Headers.Contains("X-WavWiz-Zone-Fallback")); Assert.Equal("default", (await r.Json()).GetProperty("zoneId").GetString());
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/v1/stream/stop?zoneId={z}", null)).StatusCode);   // 0.4.2: stop / pause for an unknown zone must not touch the house group
        }
        Assert.False((await admin.GetAsync("/api/v1/stream")).Headers.Contains("X-WavWiz-Zone-Fallback"));
    }

    [Fact]
    public async Task Every_zone_has_a_playback_group_even_with_no_speakers_and_deleting_it_prunes_the_group_and_its_queue()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await MakeZone(admin, "Kitchen"); long spare = await MakeZone(admin, "Spare"); await MakeZone(admin, "Other");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{spare}/split", new { })).StatusCode);
        var id = ZoneLinks.OwnId(spare); Assert.True(S.Registry.Exists(id)); Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/v1/stream?zoneId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{spare}")).StatusCode);
        Assert.False(S.Registry.Exists(id));
        Assert.Equal("default", (await (await admin.GetAsync($"/api/v1/stream?zoneId={id}")).Json()).GetProperty("zoneId").GetString());
    }

    [Fact]
    public async Task A_speaker_belongs_to_exactly_one_zone_assigning_moves_it_and_migration_flattens_overlaps_to_the_smallest_zone()
    {
        var (f, admin, dA, dB, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b; var S = f.Server.S;
        long whole = await MakeZone(admin, "Whole Home", dA, dB), small = await MakeZone(admin, "Small", dA);
        var list = (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
        Assert.Equal(1, list["Whole Home"].GetProperty("deviceIds").GetArrayLength()); Assert.Equal(1, list["Small"].GetProperty("deviceIds").GetArrayLength());   // dA moved out of Whole Home
        // 0.4.1 data: overlapping zones. Migration keeps each speaker in the smallest zone, saves the old layout, and runs once.
        S.Db.Exec("INSERT OR IGNORE INTO zone_group_member(group_id,device_id) VALUES($g,$d)", ("$g", whole), ("$d", dA)); S.Db.DeleteSetting(WavWiz.Server.Zones.ZoneManager.ModelKey);
        Assert.Equal(1, S.Zones.MigrateSingleMembership());
        list = (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
        Assert.Equal(1, list["Whole Home"].GetProperty("deviceIds").GetArrayLength()); Assert.Equal(1, list["Small"].GetProperty("deviceIds").GetArrayLength());
        Assert.Contains("members", S.Db.Setting(WavWiz.Server.Zones.ZoneManager.PreMigrationKey) ?? ""); Assert.Equal(0, S.Zones.MigrateSingleMembership());
        Assert.False(list["Small"].GetProperty("claiming").GetBoolean());
    }

    [Fact]
    public async Task Split_off_says_why_when_it_would_do_nothing()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        long k = await MakeZone(admin, "Kitchen"); await MakeZone(admin, "Patio");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { })).StatusCode);
        var again = await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode); Assert.Contains("already plays its own music", (await again.Json()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_queue_can_be_copied_or_moved_to_another_zone_and_optionally_started_there()
    {
        var (f, admin, dA, dB, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b; var S = f.Server.S;
        long k = await MakeZone(admin, "Kitchen", dA), p = await MakeZone(admin, "Patio", dB); await MakeZone(admin, "House");
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        long tid = await E2ETests.AddClickTrack(f, admin);
        await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{k}", new { kind = "tracks", ids = new[] { tid } });
        var ck = S.Registry.Get(S.Links.PlaybackId(k))!; var cp = S.Registry.Get(S.Links.PlaybackId(p))!; Assert.Single(ck.Queue()); Assert.Empty(cp.Queue());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/queue/send?zoneId=g:{k}", new { to = "g:" + p, mode = "copy" })).StatusCode);
        Assert.Single(ck.Queue()); Assert.Single(cp.Queue()); Assert.NotEqual(PlayStateOf(cp), "playing");            // copy keeps the source, does not start
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/queue/send?zoneId=g:{k}", new { to = "g:" + p, mode = "move", play = true })).StatusCode);
        Assert.Empty(ck.Queue()); Assert.Equal("playing", PlayStateOf(cp));
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/v1/queue/send?zoneId=g:{k}", new { to = "g:" + p })).StatusCode);   // empty source says so
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/v1/queue/send?zoneId=g:{p}", new { to = "g:99999" })).StatusCode);
    }
    private static string PlayStateOf(WavWiz.Server.Playback.Conductor c) => c.State.ToString().ToLowerInvariant();

    [Fact]
    public void Quick_calibration_is_one_test_per_speaker_and_Thorough_keeps_three_with_the_drift_check()
    {
        var sp = new[] { (1L, "Den"), (2L, "Kitchen"), (3L, "Patio") };
        var quick = WavWiz.Server.Calibration.CalPlan.Build(1, "Den", sp, 1, driftCheck: false);
        Assert.Equal(new[] { "ref", "dev", "dev" }, quick.Select(s => s.Kind));
        var thorough = WavWiz.Server.Calibration.CalPlan.Build(1, "Den", sp);
        Assert.Equal(3 + 6 + 1, thorough.Count); Assert.Equal("ref-end", thorough.Last().Kind);
    }

    [Fact]
    public async Task The_playlist_toggle_saves_the_PICKED_zones_queue_whether_it_is_the_playing_zone_or_another_one()
    {
        var (f, admin, dA, dB, a, b) = await Setup(); await using var _f = f; await using var _a = a; await using var _b = b;
        long k = await MakeZone(admin, "Kitchen", dA), p = await MakeZone(admin, "Patio", dB); await MakeZone(admin, "House");
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        long t1 = await E2ETests.AddClickTrack(f, admin), t2 = await E2ETests.AddClickTrack(f, admin);
        await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{k}", new { kind = "tracks", ids = new[] { t1 } });          // Kitchen: 1 song
        await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{p}", new { kind = "tracks", ids = new[] { t1, t2 } });      // Patio: 2 songs
        async Task<int> Saved(string zone)
        {
            var r = await admin.PostAsJsonAsync($"/api/v1/playlists?zoneId={zone}", new { name = "From " + zone, fromQueue = true });
            Assert.Equal(HttpStatusCode.OK, r.StatusCode); long id = (await r.Json()).GetProperty("id").GetInt64();
            return (int)Convert.ToInt64(f.Server.S.Db.Scalar("SELECT COUNT(*) FROM playlist_item WHERE playlist_id=$i", ("$i", id)));
        }
        await admin.PostAsJsonAsync($"/api/v1/stream/play?zoneId=g:{k}", new { });                                              // Kitchen is the PLAYING zone
        Assert.Equal(1, await Saved($"g:{k}"));     // toggle on the playing zone
        Assert.Equal(2, await Saved($"g:{p}"));     // toggle on a different, picked zone
    }

    [Fact]
    public async Task The_Home_Screen_manifest_starts_at_this_devices_own_address_and_refuses_junk()
    {
        await using var f = await ServerFixture.StartAsync();
        var ok = await f.As("").GetAsync("/api/v1/phone/manifest?wr=abcdef123456");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode); Assert.Contains("\"start_url\":\"/?wr=abcdef123456\"", await ok.Content.ReadAsStringAsync());
        Assert.Contains("\"start_url\":\"/\"", await (await f.As("").GetAsync("/api/v1/phone/manifest?wr=%3Cscript%3E")).Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Deleting_a_zone_leaves_Settings_readable_and_no_empty_saved_queue_rows()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        long k = await MakeZone(admin, "Kitchen"); long p = await MakeZone(admin, "Patio");
        long tid = await E2ETests.AddClickTrack(f, admin); await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{k}", new { kind = "tracks", ids = new[] { tid } });
        await admin.DeleteAsync($"/api/v1/groups/{k}"); await admin.DeleteAsync($"/api/v1/groups/{p}");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/settings")).StatusCode);
        Assert.Equal(0L, Convert.ToInt64(f.Server.S.Db.Scalar("SELECT COUNT(*) FROM setting WHERE key LIKE 'playback.lastQueue.%' AND TRIM(value_json)=''")));
    }
}
