using System.Net.Http.Json;
using WavWiz.Server.Playback;
using WavWiz.Server.Receivers;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 fix: AirPlay to "WavWiz – Everywhere" played to nobody once Whole-Home had its own group (the house group had no speakers left).
/// Simulated RAOP session (the receiver's INIT line + PCM into its feed) with both the house and the zone's own receiver set up.</summary>
public class Release049AirPlayEverywhereTests
{
    [Fact]
    public async Task Everywhere_takes_over_every_zone_and_gives_it_back_and_the_zone_receiver_plays_in_its_zone()
    {
        var f = await ServerFixture.StartAsync(); await using var _f = f; var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "PCBOXV2"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); for (int i = 0; i < 100 && S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        var id = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Whole-Home", deviceIds = new[] { devs["pc-a"], devs["pc-b"] } })).Json()).GetProperty("id").GetInt64();
        // Whole-Home has its own playback group (as on the user's server: playing local music in it) - the house group keeps no speakers
        S.Db.SetSetting(WavWiz.Server.Zones.ZoneLinks.MapKey, System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string> { [id.ToString()] = WavWiz.Server.Zones.ZoneLinks.OwnId(id) })); S.Links.Apply();
        var reg = S.Registry; var home = reg.GroupOf("pc-a")!; Assert.NotEqual(Conductor.DefaultGroupId, home); Assert.Equal(home, reg.GroupOf("pc-b"));

        // the zone's own receiver ("WavWiz – Whole-Home") and the house receiver, both set up at once
        var zr = new AirPlayReceiver(S, null, new ZoneReceiverTarget(id, "airplay:" + id, "WavWiz – Whole-Home", 47990, "02:00:00:00:00:09", () => S.Links.CondFor("g:" + id), () => true));
        var logs = new List<string>(); var hr = new AirPlayReceiver(S, l => { lock (logs) logs.Add(l); }) { NoAudioAfterMs = 300 }; S.AirPlay = hr;

        hr.OnLine("INIT 0 2 44100"); hr.Feed.WriteS16(new byte[17640], 44100);
        Assert.Equal(Conductor.DefaultGroupId, reg.GroupOf("pc-a")); Assert.Equal(Conductor.DefaultGroupId, reg.GroupOf("pc-b"));   // every zone hears it
        var dc = reg.Default; Assert.Equal("airplay", dc.Queue().Single().Kind); Assert.Equal(PlayState.Playing, dc.State);
        await Task.Delay(600); lock (logs) Assert.DoesNotContain(logs, l => l.Contains("no audio packets"));
        // 0.4.9 F78: the Casting bar's data, and its Stop
        var c = await admin.GetJson("/api/v1/cast"); Assert.True(c.GetProperty("active").GetBoolean()); Assert.Equal("airplay", c.GetProperty("kind").GetString());
        Assert.Contains(id, c.GetProperty("zones").EnumerateArray().Select(x => x.GetInt64()));
        Assert.False((await (await admin.PostAsJsonAsync("/api/v1/cast/stop", new { })).Json()).GetProperty("active").GetBoolean());
        Assert.False(hr.InSession); Assert.False((await admin.GetJson("/api/v1/cast")).GetProperty("active").GetBoolean());
        Assert.Equal(home, reg.GroupOf("pc-a")); Assert.Equal(home, reg.GroupOf("pc-b"));                                     // layout back
        Assert.True((await admin.GetAsync("/api/v1/settings")).IsSuccessStatusCode);                                            // settings still load after Everywhere ends

        // the zone's own name plays in that zone only
        zr.OnLine("INIT 0 2 44100"); var zc = reg.Get(home)!;
        Assert.Equal("airplay:" + id, zc.Queue().Single().Location); Assert.Equal(PlayState.Playing, zc.State); Assert.Equal(home, reg.GroupOf("pc-a"));
        zr.OnLine("STOP");

        // connected, but the firewall eats the UDP audio: say so in the log
        hr.OnLine("INIT 0 2 44100"); await Task.Delay(900);
        lock (logs) Assert.Contains(logs, l => l.Contains("connected but no audio packets") && l.Contains("check firewall"));
        hr.OnLine("STOP"); zr.Dispose(); hr.Dispose();
    }
}
