using System.Net.Http.Json;
using WavWiz.Server.Playback;
using WavWiz.Server.Receivers;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 fix: AirPlay zone casts and "WavWiz – Everywhere" coexist. Simulated sessions (INIT + PCM into the feeds), three one-speaker zones.</summary>
public class Release049CastCoexistTests
{
    [Fact]
    public async Task Zone_casts_and_Everywhere_coexist()
    {
        var f = await ServerFixture.StartAsync(); await using var _f = f; var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S; var reg = S.Registry;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Den"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen"); await using var c = await FakePc.StartAsync(f, "pc-c", "Office");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected(); for (int i = 0; i < 100 && S.Zones.Zones().Count < 3; i++) await Task.Delay(50);
        var devs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        async Task<long> Zone(string n, string p) => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = n, deviceIds = new[] { devs[p] } })).Json()).GetProperty("id").GetInt64();
        long den = await Zone("Den", "pc-a"), kit = await Zone("Kitchen", "pc-b"), off = await Zone("Office", "pc-c");
        // Office has its own saved group (the layout Everywhere must give back)
        S.Db.SetSetting(ZoneLinks.MapKey, System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string> { [off.ToString()] = ZoneLinks.OwnId(off) })); S.Links.Apply();
        AirPlayReceiver Zr(long id, int port) => new(S, null, new ZoneReceiverTarget(id, "airplay:" + id, "WavWiz – " + id, port, "02:00:00:00:00:0" + port % 10, () => S.Links.CondFor("g:" + id), () => true));
        var zd = Zr(den, 47991); var zk = Zr(kit, 47992); zd.Bind(); zk.Bind(); S.Links.Applied += () => { zd.Bind(); zk.Bind(); };
        var hr = new AirPlayReceiver(S, null); S.AirPlay = hr;
        string G(string p) => reg.GroupOf(p)!; Conductor C(string p) => reg.Get(G(p))!;
        void Plays(string p, string loc) { var q = C(p).Queue(); Assert.Equal(loc, q.Single().Location ?? q.Single().Kind); Assert.Equal(PlayState.Playing, C(p).State); }
        void Cast(AirPlayReceiver r) { r.OnLine("INIT 0 2 44100"); r.Feed.WriteS16(new byte[4410], 44100); }

        // (a) two casts to two zone names at once: each plays in its own zone
        Cast(zd); Cast(zk);
        Plays("pc-a", "airplay:" + den); Plays("pc-b", "airplay:" + kit); Assert.NotEqual(G("pc-a"), G("pc-b")); Assert.True(zd.InSession && zk.InSession);
        zk.OnLine("STOP"); Assert.True(zd.InSession); Plays("pc-a", "airplay:" + den);

        // (b) Everywhere while Den casts: Kitchen + Office join Everywhere, Den keeps its cast
        Cast(hr);
        Assert.Equal(Conductor.DefaultGroupId, G("pc-b")); Assert.Equal(Conductor.DefaultGroupId, G("pc-c")); Assert.NotEqual(Conductor.DefaultGroupId, G("pc-a"));
        Plays("pc-b", "airplay"); Plays("pc-a", "airplay:" + den); Assert.True(zd.InSession);
        // ...and Den rejoins Everywhere when its cast ends
        zd.OnLine("STOP"); Assert.Equal(Conductor.DefaultGroupId, G("pc-a")); Plays("pc-a", "airplay");

        // (c) a zone cast starting during Everywhere leaves the group, plays its own cast, then rejoins
        Cast(zk); Assert.NotEqual(Conductor.DefaultGroupId, G("pc-b")); Plays("pc-b", "airplay:" + kit); Plays("pc-a", "airplay"); Assert.True(hr.InSession);
        zk.OnLine("STOP"); Assert.Equal(Conductor.DefaultGroupId, G("pc-b")); Plays("pc-b", "airplay");

        // (d) Everywhere ends while Kitchen casts: the saved layout comes back, Kitchen untouched until its cast ends
        Cast(zk); var kg = G("pc-b"); hr.OnLine("STOP");
        Assert.Equal(ZoneLinks.OwnId(off), G("pc-c")); Assert.Equal(kg, G("pc-b")); Plays("pc-b", "airplay:" + kit); Assert.True(zk.InSession);
        zk.OnLine("STOP"); Assert.Equal(Conductor.DefaultGroupId, G("pc-b")); Assert.Equal(Conductor.DefaultGroupId, G("pc-a"));
        Assert.True((await admin.GetAsync("/api/v1/settings")).IsSuccessStatusCode);
        zd.Dispose(); zk.Dispose(); hr.Dispose();
    }
}
