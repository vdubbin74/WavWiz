using System.Net;
using WavWiz.Server.Receivers;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2075u: Settings > Network "AirPlay boost" / "Spotify Connect boost" (airplay.levelDb / spotify.levelDb, 0..+6 dB on top of the phone's volume)
/// reached only "WavWiz – Everywhere". A zone's own AirPlay / Spotify name kept the old level until the phone volume changed or the next session.
/// Now every receiver applies a change at once. Receiver programs are fed through OnLine like the child processes do (no shairplay / librespot needed).</summary>
public class Release071BoostTests
{
    static float Db(double db) => (float)Math.Pow(10, db / 20.0);

    private static async Task<(ServerFixture f, HttpClient admin, long zone, FakePc pc)> ZoneWithOwnNames()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var pc = await FakePc.StartAsync(f, "pc-k", "Kitchen Speaker"); await pc.WaitConnected();
        for (int i = 0; i < 100 && f.Server.S.Zones.Zones().Count < 1; i++) await Task.Delay(50);
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-k").GetProperty("id").GetInt64();
        var k = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Kitchen", deviceIds = new[] { dev } })).Json()).GetProperty("id").GetInt64();
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { });
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{k}", new { airplay = true, spotify = true })).StatusCode);
        return (f, admin, k, pc);
    }

    [Fact]
    public async Task A_zones_own_AirPlay_name_takes_a_boost_change_at_once_during_a_session()
    {
        var (f, admin, k, pc) = await ZoneWithOwnNames(); await using var _f = f; await using var _p = pc;
        var ap = f.Server.S.ZoneRecv!.AirPlayOf(k)!;
        ap.OnLine("INIT 0 2 44100"); ap.OnLine("VOL -6");
        Assert.InRange(ap.Feed.Gain, Db(-6) - 0.001f, Db(-6) + 0.001f);
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = 6 })).EnsureSuccessStatusCode();
        Assert.InRange(ap.Feed.Gain, Db(0) - 0.002f, Db(0) + 0.002f);      // phone -6 dB x boost +6 dB, without touching the phone
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = 0 })).EnsureSuccessStatusCode();
        Assert.InRange(ap.Feed.Gain, Db(-6) - 0.001f, Db(-6) + 0.001f);
        ap.OnLine("STOP");
    }

    [Fact]
    public async Task A_zones_own_Spotify_name_takes_a_boost_change_at_once()
    {
        var (f, admin, k, pc) = await ZoneWithOwnNames(); await using var _f = f; await using var _p = pc;
        var sp = f.Server.S.ZoneRecv!.SpotifyOf(k)!;
        Assert.Equal(1f, sp.Feed.Gain);
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["spotify.levelDb"] = 4 })).EnsureSuccessStatusCode();
        Assert.InRange(sp.Feed.Gain, Db(4) - 0.002f, Db(4) + 0.002f);
        Assert.InRange(f.Server.S.Spotify!.Feed.Gain, Db(4) - 0.002f, Db(4) + 0.002f);   // and Everywhere
    }

    [Fact]
    public async Task Everywhere_takes_a_boost_change_at_once_during_a_session()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var ap = f.Server.S.AirPlay!;
        ap.OnLine("INIT 0 2 44100"); ap.OnLine("VOL -10");
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["airplay.levelDb"] = 3 })).EnsureSuccessStatusCode();
        Assert.InRange(ap.Feed.Gain, Db(-7) - 0.002f, Db(-7) + 0.002f);
        ap.OnLine("VOL -20");                                                   // the phone's volume still scales it, boost kept
        Assert.InRange(ap.Feed.Gain, Db(-17) - 0.002f, Db(-17) + 0.002f);
        ap.OnLine("STOP");
    }
}
