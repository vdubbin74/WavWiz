using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Tests;

public class Release042Tests
{
    [Fact]
    public void Retired_presets_are_removed_when_unused_and_kept_as_the_users_own_when_a_speaker_uses_them()
    {
        using var t = new TempDir(); var db = new Db(t.File("w.db")); db.Migrate();
        var d0 = new WavWiz.Server.Dsp.DspService(db);
        // pretend this is a 0.4.1 database: the old built-ins exist and a speaker uses Hip-Hop
        var flat = System.Text.Json.JsonSerializer.Serialize(new { });
        foreach (var n in new[] { "Hip-Hop", "Classical", "Tower" }) db.Insert("INSERT INTO dsp_preset(name,source,json,created_at,updated_at) VALUES($n,'builtin',$j,'t','t')", ("$n", n), ("$j", d0.Presets().First(p => p.Name == "Flat").Json.GetRawText()));
        var hip = Convert.ToInt64(db.Scalar("SELECT id FROM dsp_preset WHERE name='Hip-Hop'"));
        db.Exec("INSERT INTO output_device_dsp(output_device_id,dsp_preset_id,enabled,bypass,updated_at) VALUES('dev1',$p,1,0,'t')", ("$p", hip));
        var d = new WavWiz.Server.Dsp.DspService(db);
        var all = d.Presets();
        Assert.DoesNotContain(all, p => p.Name == "Classical"); Assert.DoesNotContain(all, p => p.Name == "Tower");     // unused: gone from the picker
        var kept = all.Single(p => p.Name == "Hip-Hop"); Assert.Equal("user", kept.Source);                            // used: becomes the user's own saved preset, no data loss
        Assert.Equal(hip, kept.Id); Assert.Equal(hip, Convert.ToInt64(db.Scalar("SELECT dsp_preset_id FROM output_device_dsp WHERE output_device_id='dev1'")));
        Assert.Equal(new[] { "Flat", "Bass Boost", "Treble Boost", "Vocal", "Late Night", "Movie Night", "Bluetooth Speaker", "Rock / Metal" }.OrderBy(x => x), all.Where(p => p.Source == "builtin").Select(p => p.Name).OrderBy(x => x));
    }

    [Fact]
    public async Task A_scene_saves_the_zone_layout_and_links_and_applying_it_regroups()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var a = await FakePc.StartAsync(f, "pc-a", "A"); var b = await FakePc.StartAsync(f, "pc-b", "B"); await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().Select(z => z.GetProperty("id").GetInt64()).ToArray();
        async Task<long> Mk(string n, params long[] d) => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = n, deviceIds = d })).Json()).GetProperty("id").GetInt64();
        long z1 = await Mk("Up", devs[0]), z2 = await Mk("Down", devs[1]);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{z1}/link", new { with = z2 })).StatusCode);
        var sc = (await (await admin.PostAsJsonAsync("/api/v1/scenes/capture", new { name = "Party" })).Json()).GetProperty("id").GetInt64();
        // change the layout: swap speakers and split
        await admin.PatchAsJsonAsync($"/api/v1/groups/{z1}", new { name = "Up", deviceIds = new[] { devs[1] } });
        await admin.PatchAsJsonAsync($"/api/v1/groups/{z2}", new { name = "Down", deviceIds = new[] { devs[0] } });
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{z2}/split", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/v1/scenes/{sc}/apply", null)).StatusCode);
        var gs = (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(g => g.GetProperty("id").GetInt64());
        Assert.Equal(new[] { devs[0] }, gs[z1].GetProperty("deviceIds").EnumerateArray().Select(e => e.GetInt64()));
        Assert.Equal(new[] { devs[1] }, gs[z2].GetProperty("deviceIds").EnumerateArray().Select(e => e.GetInt64()));
        Assert.Equal(gs[z1].GetProperty("playbackId").GetString(), gs[z2].GetProperty("playbackId").GetString());   // linked again
        // an older scene (no layout) leaves the layout alone
        var old = f.Server.S.Scenes.Create("Old", null, new (long, double, bool, long?)[] { (devs[0], 50, true, null) }).Id;
        f.Server.S.Db.Exec("UPDATE scene SET layout=NULL WHERE id=$i", ("$i", old));
        await admin.PatchAsJsonAsync($"/api/v1/groups/{z1}", new { name = "Up", deviceIds = new[] { devs[1] } });
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/v1/scenes/{old}/apply", null)).StatusCode);
        var g1 = (await admin.GetJson("/api/v1/groups")).EnumerateArray().First(g => g.GetProperty("id").GetInt64() == z1);
        Assert.Equal(new[] { devs[1] }, g1.GetProperty("deviceIds").EnumerateArray().Select(e => e.GetInt64()));
    }
}
