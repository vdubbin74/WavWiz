using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.2.2 T4: artist photos - transient errors are retried (not 14-day misses), no silent queue drops, live "arrived" push,
/// TheAudioDB as the second source, album-cover fallback data, status + retry, images requested as images.</summary>
public class Release022ArtTests
{
    private sealed class Net : HttpMessageHandler
    {
        public readonly ConcurrentQueue<(string Url, string Accept)> Seen = new();
        public byte[] Image = Array.Empty<byte>();
        public Func<string, HttpStatusCode?>? Fail;               // force a status for a URL (null = normal answer)
        public bool Throw;                                         // network down
        public bool WikidataHasPhoto = true, AudioDbHasPhoto = true;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            var u = req.RequestUri!.AbsoluteUri; Seen.Enqueue((u, req.Headers.Accept.ToString()));
            if (Throw) throw new HttpRequestException("network is down");
            if (Fail?.Invoke(u) is HttpStatusCode code) return Task.FromResult(new HttpResponseMessage(code));
            HttpResponseMessage J(string s) => new(HttpStatusCode.OK) { Content = new StringContent(s, Encoding.UTF8, "application/json") };
            HttpResponseMessage Img() => new(HttpStatusCode.OK) { Content = new ByteArrayContent(Image) };
            if (u.StartsWith(OnlineArt.MbBase + "/artist/?")) { var name = Uri.UnescapeDataString(u).Split("artist:\"")[1].Split('"')[0]; return Task.FromResult(J($$"""{"artists":[{"id":"ar-{{name.Length}}","name":"{{name}}","score":100}]}""")); }
            if (u.StartsWith(OnlineArt.MbBase + "/artist/ar-")) return Task.FromResult(WikidataHasPhoto ? J("""{"relations":[{"type":"wikidata","url":{"resource":"https://www.wikidata.org/wiki/Q42"}}]}""") : J("""{"relations":[]}"""));
            if (u.StartsWith("https://www.wikidata.org/wiki/Special:EntityData/Q42.json")) return Task.FromResult(J("""{"entities":{"Q42":{"claims":{"P18":[{"mainsnak":{"datavalue":{"value":"Photo.jpg"}}}]}}}}"""));
            if (u.StartsWith("https://commons.wikimedia.org/")) return Task.FromResult(Img());
            if (u.StartsWith(OnlineArt.AudioDbBase + "/search.php")) { var name = Uri.UnescapeDataString(u.Split("s=")[1]); return Task.FromResult(AudioDbHasPhoto ? J($$"""{"artists":[{"strArtist":"{{name}}","strArtistThumb":"https://r2.theaudiodb.com/images/media/artist/thumb/x.jpg"}]}""") : J("""{"artists":null}""")); }
            if (u.StartsWith("https://r2.theaudiodb.com/")) return Task.FromResult(Img());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
    private static byte[] Pic(string path) { TestMedia.Run("-f", "lavfi", "-i", "testsrc=s=300x300:d=1", "-frames:v", "1", path); return File.ReadAllBytes(path); }
    private static async Task<bool> Until(Func<bool> f, int ms = 15000) { for (int i = 0; i < ms / 50; i++) { if (f()) return true; await Task.Delay(50); } return f(); }
    private static string Dir(TempDir t) => Path.Combine(t.Path, "artcache", "online");

    [Fact]
    public async Task T4a_a_transient_error_is_not_a_miss_it_backs_off_and_a_confirmed_not_found_is_a_7_day_miss()
    {
        using var t = new TempDir(); var net = new Net { Image = Pic(t.File("p.png")), Throw = true };
        using var oa = new OnlineArt(t.Path, () => true, net);
        Assert.Null(oa.Artist("Glow Society"));
        var key = OnlineArt.Key("artist", "Glow Society");
        Assert.True(await Until(() => File.Exists(Path.Combine(Dir(t), key + ".retry"))));
        Assert.False(File.Exists(Path.Combine(Dir(t), key + ".none")));                                 // NOT remembered as "no photo"
        Assert.Equal(1, oa.Transient);
        var n = net.Seen.Count; net.Throw = false;
        Assert.Null(oa.Artist("Glow Society")); await Task.Delay(300); Assert.Equal(n, net.Seen.Count);  // waits out the back-off (no hammering)
        // back-off grows 1 h, 2 h, 4 h ... at most a day; misses are 7 days now
        Assert.Equal(TimeSpan.FromHours(1), OnlineArt.Backoff(1)); Assert.Equal(TimeSpan.FromHours(4), OnlineArt.Backoff(3)); Assert.Equal(TimeSpan.FromDays(1), OnlineArt.Backoff(12));
        Assert.Equal(TimeSpan.FromDays(7), OnlineArt.MissRetry);
        // once the back-off has run out the lookup runs again and finds the photo
        File.WriteAllText(Path.Combine(Dir(t), key + ".retry"), "1|" + DateTime.UtcNow.AddMinutes(-1).ToString("O"));
        Assert.Null(oa.Artist("Glow Society"));
        Assert.True(await Until(() => oa.Artist("Glow Society") != null));
        Assert.False(File.Exists(Path.Combine(Dir(t), key + ".retry")));
        // rate limit (429) and server errors (503) are transient too; a 404 from every source is a real miss
        var net2 = new Net { Image = net.Image, Fail = u => u.Contains("musicbrainz") ? HttpStatusCode.TooManyRequests : u.Contains("theaudiodb") ? HttpStatusCode.ServiceUnavailable : null };
        using var t2 = new TempDir(); using var oa2 = new OnlineArt(t2.Path, () => true, net2); oa2.Artist("Cinder Club");
        Assert.True(await Until(() => File.Exists(Path.Combine(Dir(t2), OnlineArt.Key("artist", "Cinder Club") + ".retry"))));
        var net3 = new Net { Image = net.Image, WikidataHasPhoto = false, AudioDbHasPhoto = false };
        using var t3 = new TempDir(); using var oa3 = new OnlineArt(t3.Path, () => true, net3); oa3.Artist("Nobody Known");
        Assert.True(await Until(() => File.Exists(Path.Combine(Dir(t3), OnlineArt.Key("artist", "Nobody Known") + ".none"))));
    }

    [Fact]
    public async Task T4a_misses_saved_by_0_2_1_are_forgotten_once_on_upgrade()
    {
        using var t = new TempDir(); Directory.CreateDirectory(Dir(t));
        var old = Path.Combine(Dir(t), OnlineArt.Key("artist", "Blue Lantern") + ".none"); File.WriteAllText(old, DateTime.UtcNow.ToString("O"));
        using (new OnlineArt(t.Path, () => false, new Net())) { }
        Assert.False(File.Exists(old));
        File.WriteAllText(old, DateTime.UtcNow.ToString("O"));                 // a 0.2.2 miss is kept on the next start
        using (new OnlineArt(t.Path, () => false, new Net())) { }
        Assert.True(File.Exists(old));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task T4b_a_big_library_is_never_dropped_and_every_arrival_is_pushed()
    {
        using var t = new TempDir(); var net = new Net { Image = Pic(t.File("p.png")), WikidataHasPhoto = false };
        // MusicBrainz says "no such artist" so only TheAudioDB is asked (fast) - 0.2.1 dropped everything past 500 queued lookups
        net.Fail = u => u.StartsWith(OnlineArt.MbBase) ? HttpStatusCode.NotFound : null;
        using var oa = new OnlineArt(t.Path, () => true, net);
        var arrived = new ConcurrentBag<string>(); oa.Arrived += (k, a, b) => arrived.Add(k + ":" + a);
        for (int i = 0; i < 520; i++) oa.Artist("Artist " + i);
        var s0 = oa.Status(); Assert.Equal(520, s0.Artists.Pending + s0.Artists.Found);
        // (TheAudioDB is spaced 2 s apart; checking the first ones arrive and nothing was dropped from the queue is enough)
        Assert.True(await Until(() => arrived.Count >= 2, 8000));
        Assert.Contains("artist:Artist 0", arrived);
        var st = oa.Status(); Assert.Equal(520, st.Artists.Found + st.Artists.Pending);
    }

    [Fact]
    public async Task T4c_TheAudioDB_is_the_fallback_when_Wikidata_has_no_photo_and_T4e_images_are_requested_as_images()
    {
        using var t = new TempDir(); var net = new Net { Image = Pic(t.File("p.png")), WikidataHasPhoto = false };
        using var oa = new OnlineArt(t.Path, () => true, net);
        oa.Artist("Coastal Ghosts");
        Assert.True(await Until(() => oa.Artist("Coastal Ghosts") != null));
        Assert.Contains(net.Seen, s => s.Url.StartsWith(OnlineArt.AudioDbBase + "/search.php?s=Coastal%20Ghosts"));
        Assert.All(net.Seen.Where(s => s.Url.Contains("/images/") || s.Url.StartsWith("https://commons.")), s => Assert.Equal("image/*", s.Accept));
        Assert.All(net.Seen.Where(s => s.Url.Contains("musicbrainz") || s.Url.Contains("search.php")), s => Assert.Equal("application/json", s.Accept));
        // only an exact name match counts
        using var d = JsonDocument.Parse("""{"artists":[{"strArtist":"Coastal Ghost","strArtistThumb":"https://x/a.jpg"},{"strArtist":"coastal  ghosts","strArtistThumb":"https://x/b.jpg"}]}""");
        Assert.Equal("https://x/b.jpg", OnlineArt.AudioDbThumb(d.RootElement, "Coastal Ghosts"));
        using var none = JsonDocument.Parse("""{"artists":null}"""); Assert.Null(OnlineArt.AudioDbThumb(none.RootElement, "X"));
        // Wikidata photo wins when there is one (TheAudioDB not asked)
        var net2 = new Net { Image = net.Image }; using var t2 = new TempDir(); using var oa2 = new OnlineArt(t2.Path, () => true, net2);
        oa2.Artist("Amber Kites"); Assert.True(await Until(() => oa2.Artist("Amber Kites") != null));
        Assert.DoesNotContain(net2.Seen, s => s.Url.Contains("theaudiodb"));
    }

    [Fact]
    public async Task T4d_T4e_artist_rows_carry_album_covers_and_the_status_and_retry_endpoints_work()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        for (int i = 1; i <= 5; i++) TestMedia.Tone(Path.Combine(music, $"0{i}.mp3"), 1, 300 + i * 40, $"Song {i}", "Blue Lantern", "Album " + i, 1, "Indie Rock", 2020);
        f.Server.S.Library.AddRoot(music); f.Server.S.Library.Scan();
        var a = (await admin.GetJson("/api/v1/library/artists")).EnumerateArray().Single();
        Assert.Equal(4, a.GetProperty("artTrackIds").GetArrayLength());           // up to 4 albums for the round mosaic
        var st = await admin.GetJson("/api/v1/library/online-art");
        Assert.False(st.GetProperty("enabled").GetBoolean());                     // tests run with online art off
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/v1/library/online-art/retry", null)).StatusCode);
        var net = new Net { Image = Pic(Path.Combine(f.Dir.Path, "c.png")), Fail = u => u.Contains("musicbrainz") ? HttpStatusCode.NotFound : null, AudioDbHasPhoto = false };
        var data2 = Path.Combine(f.Dir.Path, "data2");
        f.Server.S.Art.Online = new OnlineArt(data2, () => true, net);
        var miss = Path.Combine(data2, "artcache", "online", OnlineArt.Key("artist", "Blue Lantern") + ".none"); File.WriteAllText(miss, DateTime.UtcNow.ToString("O"));
        net.AudioDbHasPhoto = true;
        var r = await admin.PostAsync("/api/v1/library/online-art/retry", null); r.EnsureSuccessStatusCode();
        Assert.Equal(1, (await r.Json()).GetProperty("queued").GetInt32());
        Assert.True(await Until(() => f.Server.S.Art.Online.CacheKey("artist", "Blue Lantern") != null));
        st = await admin.GetJson("/api/v1/library/online-art");
        Assert.Equal(1, st.GetProperty("artists").GetProperty("found").GetInt32());
        var view = f.As(f.Token(Role.View, "tv"));
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsync("/api/v1/library/online-art/retry", null)).StatusCode);
        f.Server.S.Art.Online.Dispose();
    }
}
