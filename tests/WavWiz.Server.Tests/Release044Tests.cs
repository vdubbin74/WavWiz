using System.Net;
using WavWiz.Server.Api;
namespace WavWiz.Server.Tests;

/// <summary>0.4.4 fix list: F11 copy-queue leaves the source untouched; F12 mid-song join; more items land in later commits.</summary>
public class Release044Tests
{
    private static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();

    [Fact]
    public async Task F11_copy_queue_to_zone_leaves_source_queue_and_playback_unchanged()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker");
        await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long k = await MakeZone(admin, "Kitchen", devs["pc-a"]), p = await MakeZone(admin, "Patio", devs["pc-b"]);
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        long t1 = await E2ETests.AddClickTrack(f, admin), t2 = await E2ETests.AddClickTrack(f, admin);
        await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{k}", new { kind = "tracks", ids = new[] { t1, t2 } });
        await admin.PostAsJsonAsync($"/api/v1/stream/jump?zoneId=g:{k}", new { index = 0 });
        await admin.PostAsJsonAsync($"/api/v1/stream/resume?zoneId=g:{k}", new { });
        var S = f.Server.S;
        var ck = S.Registry.Get(S.Links.PlaybackId(k))!; var cp = S.Registry.Get(S.Links.PlaybackId(p))!;
        Assert.Equal(2, ck.Queue().Count); Assert.Equal("playing", ck.State.ToString().ToLowerInvariant());
        var beforeIds = ck.Queue().Select(x => x.RefId).ToArray();
        var beforeIdx = ck.Now().Index;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/queue/send?zoneId=g:{k}", new { to = "g:" + p, mode = "copy", play = true })).StatusCode);
        Assert.Equal(2, ck.Queue().Count);
        Assert.Equal(beforeIds, ck.Queue().Select(x => x.RefId).ToArray());
        Assert.Equal(beforeIdx, ck.Now().Index);
        Assert.Equal("playing", ck.State.ToString().ToLowerInvariant());   // source still playing
        Assert.Equal(2, cp.Queue().Count);                                  // target got the copy
        Assert.Equal("playing", cp.State.ToString().ToLowerInvariant());
    }

    /// <summary>0.4.4 F12: moving a speaker into an actively playing zone must deliver audio within ~2 s without a track change.</summary>
    [Fact]
    public async Task F12_move_into_playing_zone_gets_audio_without_track_change()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker");
        await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long k = await MakeZone(admin, "Kitchen", devs["pc-a"]), p = await MakeZone(admin, "Patio", devs["pc-b"]);
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });
        long t1 = await E2ETests.AddClickTrack(f, admin, 30);
        await admin.PostAsJsonAsync($"/api/v1/queue/add?zoneId=g:{k}", new { kind = "tracks", ids = new[] { t1 } });
        await admin.PostAsJsonAsync($"/api/v1/stream/jump?zoneId=g:{k}", new { index = 0 });
        await admin.PostAsJsonAsync($"/api/v1/stream/resume?zoneId=g:{k}", new { });
        var S = f.Server.S;
        var ck = S.Registry.Get(S.Links.PlaybackId(k))!;
        for (int i = 0; i < 100 && a.Clicks().Count < 2; i++) await Task.Delay(50);
        Assert.True(a.Clicks().Count >= 2, "kitchen must be playing before the move");
        var beforeTitle = ck.Now().Item?.Title; var beforeIndex = ck.Now().Index;
        long moveUs = S.Registry.Clock.NowUs;
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{k}", new { deviceIds = new[] { devs["pc-a"], devs["pc-b"] } })).StatusCode);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 2000 && b.Clicks(moveUs).Count == 0) await Task.Delay(40);
        Assert.Equal(beforeTitle, ck.Now().Item?.Title);
        Assert.Equal(beforeIndex, ck.Now().Index);
        var gid = S.Registry.GroupOf("pc-b");
        var subs = string.Join(",", ck.Subscribers().Select(x => x.Id));
        Assert.True(b.Clicks(moveUs).Count > 0, $"F12: moved speaker silent after {sw.ElapsedMilliseconds} ms; group={gid} kitchenPlaying={ck.State} subs={subs}");
    }

    [Fact]
    public void F6_legacy_builtins_a_speaker_still_uses_become_my_presets_without_a_duplicate_name()
    {
        using var t = new TempDir(); var db = new Db(t.File("w.db")); db.Migrate();
        var d0 = new WavWiz.Server.Dsp.DspService(db);
        var j = d0.Presets().First(p => p.Name == "Bass Boost").Json.GetRawText();
        foreach (var n in new[] { "Bass boost", "Bright room (softer treble)", "Vocal / speech" }) db.Insert("INSERT INTO dsp_preset(name,source,json,created_at,updated_at) VALUES($n,'builtin',$j,'t','t')", ("$n", n), ("$j", j));
        var bb = Convert.ToInt64(db.Scalar("SELECT id FROM dsp_preset WHERE name='Bass boost'")); var br = Convert.ToInt64(db.Scalar("SELECT id FROM dsp_preset WHERE name='Bright room (softer treble)'"));
        db.Exec("INSERT INTO output_device_dsp(output_device_id,dsp_preset_id,enabled,bypass,updated_at) VALUES('d1',$p,1,0,'t')", ("$p", bb));
        db.Exec("INSERT INTO output_device_dsp(output_device_id,dsp_preset_id,enabled,bypass,updated_at) VALUES('d2',$p,1,0,'t')", ("$p", br));
        var all = new WavWiz.Server.Dsp.DspService(db).Presets();
        Assert.Equal(new[] { "Flat", "Bass Boost", "Treble Boost", "Vocal", "Late Night", "Movie Night", "Bluetooth Speaker", "Rock / Metal" }.OrderBy(x => x), all.Where(p => p.Source == "builtin").Select(p => p.Name).OrderBy(x => x));
        var b1 = all.Single(p => p.Id == bb); Assert.Equal("user", b1.Source); Assert.Equal("Bass boost (saved)", b1.Name);     // no "Bass boost" next to "Bass Boost"
        var b2 = all.Single(p => p.Id == br); Assert.Equal("user", b2.Source); Assert.Equal("Bright room (softer treble)", b2.Name);
        Assert.DoesNotContain(all, p => p.Name == "Vocal / speech");                                                                // unused: removed
        Assert.Equal(all.Count, all.Select(p => p.Name.ToLowerInvariant()).Distinct().Count());
        Assert.Equal(bb, Convert.ToInt64(db.Scalar("SELECT dsp_preset_id FROM output_device_dsp WHERE output_device_id='d1'")));   // the speaker keeps its sound
    }
}
