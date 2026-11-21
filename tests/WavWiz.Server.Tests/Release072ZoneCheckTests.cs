using System.Net;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.7.2 D: acoustic zone-to-zone timing check ("Check with phone" on Timing vs house). Both zones' speakers play the chirps scheduled
/// like music; one phone recording tells how much later the zone sounds than the other one, and the "vs house" value that lines them up.</summary>
public class Release072ZoneCheckTests
{
    private static async Task WaitUntil(Func<bool> cond, int ms = 15000, string what = "condition") { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!cond() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(cond(), "timed out waiting for " + what); }

    [Theory]
    [InlineData(0, 37, -37)]
    [InlineData(0, -12.34, 12.3)]
    [InlineData(10, 4, 6)]
    [InlineData(-150, 80, -200)]     // clamped to the offset's range
    [InlineData(190, -30, 200)]
    public void Suggestion_moves_the_zone_by_what_was_measured(double cur, double later, double want) => Assert.Equal(want, ZoneCheck.Suggest(cur, later));

    [Fact]
    public void Out_of_range_median_speaker_and_default_zone()
    {
        Assert.True(ZoneCheck.OutOfRange(0, 250)); Assert.False(ZoneCheck.OutOfRange(0, 199)); Assert.True(ZoneCheck.OutOfRange(100, -120));
        Assert.Equal(5, ZoneCheck.Median(new[] { 9.0, 5, 1 })); Assert.Equal(4, ZoneCheck.Median(new[] { 3.0, 5 })); Assert.Throws<ArgumentException>(() => ZoneCheck.Median(Array.Empty<double>()));
        Assert.Equal(7L, ZoneCheck.PickSpeaker(7, new long[] { 3, 7 }, _ => true));
        Assert.Equal(3L, ZoneCheck.PickSpeaker(7, new long[] { 3, 7 }, d => d != 7));          // reference offline: the first member that can play
        Assert.Null(ZoneCheck.PickSpeaker(null, new long[] { 3 }, _ => false));
        Assert.Equal(2L, ZoneCheck.DefaultAgainst(1, 2, new long[] { 3, 2 }));                  // the zone holding the house reference first
        Assert.Equal(3L, ZoneCheck.DefaultAgainst(2, 2, new long[] { 3, 2 }));                  // checking that zone itself: the next one
        Assert.Null(ZoneCheck.DefaultAgainst(1, null, new long[] { 1 }));
    }

    [Fact]
    public async Task Phone_check_measures_the_zone_gap_suggests_the_offset_and_a_recheck_is_aligned()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var ctl = f.As(f.Token(Role.Control, "c")); var view = f.As(f.Token(Role.View, "v"));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living Speaker", hiddenMs: 15);
        await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen Speaker", hiddenMs: 52);
        await a.WaitConnected(); await b.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count(z => z.Connected) == 2, what: "speakers");
        var zs = f.Server.S.Zones.Zones(); long dA = zs.First(z => z.PlayerId == "pc-a").Id, dB = zs.First(z => z.PlayerId == "pc-b").Id;
        long living = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Living", deviceIds = new[] { dA } })).Json()).GetProperty("id").GetInt64();
        long kitchen = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Kitchen", deviceIds = new[] { dB } })).Json()).GetProperty("id").GetInt64();
        f.Server.S.Zones.ReferenceZoneId = dA;

        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync($"/api/v1/groups/{kitchen}/timing-check", new { })).StatusCode);   // Control+ only
        Assert.Equal(HttpStatusCode.NotFound, (await ctl.PostAsJsonAsync("/api/v1/groups/99999/timing-check", new { })).StatusCode);

        async Task<(double later, double suggested)> Check()
        {
            var r = await ctl.PostAsJsonAsync($"/api/v1/groups/{kitchen}/timing-check", new { }); var j = await r.Json(); Assert.True(r.IsSuccessStatusCode, j.ToString());
            Assert.Equal(living, j.GetProperty("against").GetProperty("id").GetInt64()); Assert.Equal(dB, j.GetProperty("zone").GetProperty("speakerId").GetInt64());
            string sid = j.GetProperty("sessionId").GetString()!; long at = j.GetProperty("atUs").GetInt64(); int recMs = j.GetProperty("recordMs").GetInt32();
            Assert.InRange(recMs, 8000, 15000);
            Assert.NotNull(f.Server.S.Cal.Get(sid));
            await Task.Delay(recMs);
            long start = at - 500_000; var rec = new float[48000L * recMs / 1000]; const double micMs = 23;   // the phone's own input delay cancels out
            a.MixInto(rec, start, micMs); b.MixInto(rec, start, micMs); var rnd = new Random(5); for (int i = 0; i < rec.Length; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f;
            var bytes = new byte[rec.Length * 4]; Buffer.BlockCopy(rec, 0, bytes, 0, bytes.Length);
            var cr = await ctl.PostAsync($"/api/v1/groups/{kitchen}/timing-check/{sid}/capture?rate=48000", new ByteArrayContent(bytes)); var cj = await cr.Json();
            Assert.True(cj.GetProperty("ok").GetBoolean(), cj.ToString());
            // a second capture without a new test sound is refused (each run plays the pair again)
            var again = await (await ctl.PostAsync($"/api/v1/groups/{kitchen}/timing-check/{sid}/capture?rate=48000", new ByteArrayContent(bytes))).Json();
            Assert.False(again.GetProperty("ok").GetBoolean()); Assert.Contains("pending", again.GetProperty("error").GetString());
            var e = await (await ctl.PostAsync($"/api/v1/groups/{kitchen}/timing-check/{sid}/end", null)).Json(); Assert.True(e.GetProperty("ok").GetBoolean());
            Assert.Equal(HttpStatusCode.NotFound, (await ctl.PostAsync($"/api/v1/groups/{kitchen}/timing-check/{sid}/play", null)).StatusCode);
            return (cj.GetProperty("laterMs").GetDouble(), cj.GetProperty("suggestedMs").GetDouble());
        }

        double Delay(string pid) => f.Server.S.Zones.PlaybackDelayMs(f.Server.S.Audio.Get(pid)!) ?? 0;
        double dB0 = Delay("pc-b"), expect = (52 - dB0) - (15 - Delay("pc-a"));
        var (later, sug) = await Check();
        Assert.InRange(later, expect - 2.5, expect + 2.5);
        Assert.Equal(ZoneCheck.Suggest(0, later), sug);
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PutAsJsonAsync($"/api/v1/groups/{kitchen}/house-offset", new { ms = sug })).StatusCode);   // Apply stays Admin
        Assert.True((await admin.PutAsJsonAsync($"/api/v1/groups/{kitchen}/house-offset", new { ms = sug })).IsSuccessStatusCode);
        Assert.Equal(dB0 - sug, Delay("pc-b"), 3);                            // only the zone offset moved: nothing was saved as a speaker delay
        var (later2, sug2) = await Check();
        Assert.InRange(later2, -2.5, 2.5);                                  // the offset is included in how the pattern was scheduled
        Assert.InRange(sug2, sug - 2.5, sug + 2.5);
    }

    [Fact]
    public async Task Checks_need_two_zones_with_their_own_online_speakers()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living Speaker"); await a.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Any(z => z.Connected), what: "speaker");
        long dA = f.Server.S.Zones.Zones().First().Id;
        long living = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Living", deviceIds = new[] { dA } })).Json()).GetProperty("id").GetInt64();
        var r = await admin.PostAsJsonAsync($"/api/v1/groups/{living}/timing-check", new { }); Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Contains("no other zone", (await r.Json()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
        long empty = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Porch", deviceIds = Array.Empty<long>() })).Json()).GetProperty("id").GetInt64();
        var r2 = await admin.PostAsJsonAsync($"/api/v1/groups/{empty}/timing-check", new { }); Assert.Equal(HttpStatusCode.Conflict, r2.StatusCode);
        Assert.Contains("Porch", (await r2.Json()).GetProperty("error").GetString());
        var r3 = await admin.PostAsJsonAsync($"/api/v1/groups/{living}/timing-check", new { againstId = living }); Assert.Equal(HttpStatusCode.BadRequest, r3.StatusCode);
        var r4 = await admin.PostAsync($"/api/v1/groups/{living}/timing-check/nope/capture", new ByteArrayContent(new byte[8])); Assert.Equal(HttpStatusCode.NotFound, r4.StatusCode);
    }
}
