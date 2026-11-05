using System.Net;
using System.Security.Cryptography;
using System.Text;
using WavWiz.Server.Api;
using WavWiz.Server.Features;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>Play history (always on, 50% / 4 min rule, 500 kept) and opt-in Last.fm.</summary>
public class PlayHistoryTests
{
    sealed class Fake : HttpMessageHandler
    {
        public List<string> Bodies = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            var body = r.Content != null ? await r.Content.ReadAsStringAsync(ct) : r.RequestUri!.Query; lock (Bodies) Bodies.Add(body);
            var json = body.Contains("auth.getToken") ? "{\"token\":\"TOK\"}" : body.Contains("auth.getSession") ? "{\"session\":{\"name\":\"me\",\"key\":\"SK\"}}" : "{}";
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) };
        }
    }
    static QueueItem Song(long id, long dur = 200_000) => new(id, "track", "/m/" + id + ".mp3", "Song " + id, "Artist", "Album", dur, id);
    static NowPlaying Np(QueueItem? it, long pos, string st = "playing") => new(st, 0, pos, it?.DurationMs ?? 0, it, null, null, false, "off", 1);

    [Fact]
    public void Threshold_is_half_or_four_minutes_and_short_songs_never_count()
    {
        Assert.Equal(100_000, PlayHistoryService.ThresholdMs(200_000));
        Assert.Equal(240_000, PlayHistoryService.ThresholdMs(600_000));
        Assert.Equal(0, PlayHistoryService.ThresholdMs(30_000));
    }

    [Fact]
    public void Sign_is_md5_of_sorted_params_plus_secret_without_format()
    {
        var p = new Dictionary<string, string> { ["token"] = "t", ["method"] = "auth.getSession", ["api_key"] = "k", ["format"] = "json" };
        var want = Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes("api_keykmethodauth.getSessiontokentS"))).ToLowerInvariant();
        Assert.Equal(want, LastFm.Sign(p, "S"));
    }

    [Fact]
    public async Task Records_after_threshold_keeps_500_and_Last_fm_off_makes_no_calls()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        var fake = new Fake(); var h = new PlayHistoryService(S.Db, S.Registry, S.Events, fake);
        var a = Song(1);
        h.Observe("g1", Np(a, 10_000)); h.Observe("g1", Np(a, 99_000));
        Assert.Empty(h.Recent(null));
        h.Observe("g1", Np(a, 101_000)); h.Observe("g1", Np(a, 150_000));
        Assert.Single(h.Recent(null));
        h.Observe("g1", Np(a, 120_000, "paused"));
        Assert.Single(h.Recent("g1")); Assert.Empty(h.Recent("other"));
        for (int i = 2; i < 520; i++) { var s = Song(i); h.Observe("g2", Np(s, 1000)); h.Observe("g2", Np(s, 150_000)); }
        Assert.Equal(500, Convert.ToInt32(S.Db.Scalar("SELECT COUNT(*) FROM play_history")));
        await Task.Delay(200);
        Assert.Equal(0, h.LastFm.Calls); Assert.Empty(fake.Bodies);
    }

    [Fact]
    public async Task Last_fm_connect_then_scrobbles_and_never_returns_secrets()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        var fake = new Fake(); var h = new PlayHistoryService(S.Db, S.Registry, S.Events, fake);
        h.LastFm.SetKeys("KEY", "SECRET");
        var (url, err) = await h.LastFm.Begin(); Assert.Null(err); Assert.Contains("token=TOK", url); Assert.Contains("api_key=KEY", url);
        Assert.Null(await h.LastFm.Finish());
        Assert.True(h.LastFm.Active);            // finishing the Last.fm sign-in is the opt-in
        h.LastFm.SetEnabled(false); Assert.False(h.LastFm.Active); h.LastFm.SetEnabled(true);
        var st = System.Text.Json.JsonSerializer.Serialize(h.LastFm.Status()); Assert.DoesNotContain("SECRET", st); Assert.DoesNotContain("SK", st);
        var a = Song(7); h.Observe("g", Np(a, 1000)); h.Observe("g", Np(a, 150_000));
        for (int i = 0; i < 50 && !fake.Bodies.Any(b => b.Contains("track.scrobble")); i++) await Task.Delay(50);
        Assert.Contains(fake.Bodies, b => b.Contains("track.updateNowPlaying"));
        Assert.Contains(fake.Bodies, b => b.Contains("track.scrobble") && b.Contains("sk=SK"));
        var admin = f.As(f.Token(Role.Admin)); var view = f.As(f.Token(Role.View));
        Assert.Equal(HttpStatusCode.OK, (await view.GetAsync("/api/v1/history")).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await view.GetAsync("/api/v1/lastfm")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/lastfm")).StatusCode);
    }
}
