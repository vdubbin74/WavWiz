using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.2.1 server items. F13: online album covers (MusicBrainz -> Cover Art Archive) and artist photos (MusicBrainz -> Wikidata ->
/// Commons), cached on the server, polite (one worker, MusicBrainz spacing, a real User-Agent), off in tests and switchable off.</summary>
public class Release021Tests
{
    /// <summary>Answers like the real services; records every request.</summary>
    private sealed class FakeNet : HttpMessageHandler
    {
        public readonly ConcurrentQueue<(string url, string ua)> Seen = new();
        public byte[] Image = Array.Empty<byte>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            var u = req.RequestUri!.AbsoluteUri; Seen.Enqueue((u, req.Headers.UserAgent.ToString()));
            HttpResponseMessage Json(string s) => new(HttpStatusCode.OK) { Content = new StringContent(s, Encoding.UTF8, "application/json") };
            if (u.StartsWith(OnlineArt.MbBase + "/release-group/")) return Task.FromResult(Json("""{"release-groups":[{"id":"low-score","score":40},{"id":"rg-1","score":100}]}"""));
            if (u.StartsWith(OnlineArt.MbBase + "/artist/?")) return Task.FromResult(Json("""{"artists":[{"id":"other","name":"Blue Lanterns","score":99},{"id":"ar-1","name":"Blue Lantern","score":100}]}"""));
            if (u.StartsWith(OnlineArt.MbBase + "/artist/ar-1")) return Task.FromResult(Json("""{"relations":[{"type":"official homepage","url":{"resource":"https://example.org"}},{"type":"wikidata","url":{"resource":"https://www.wikidata.org/wiki/Q42"}}]}"""));
            if (u == "https://www.wikidata.org/wiki/Special:EntityData/Q42.json") return Task.FromResult(Json("""{"entities":{"Q42":{"claims":{"P18":[{"mainsnak":{"datavalue":{"value":"Blue Lantern live.jpg"}}}]}}}}"""));
            if (u == "https://coverartarchive.org/release-group/rg-1/front-500" || u.StartsWith("https://commons.wikimedia.org/wiki/Special:FilePath/Blue%20Lantern%20live.jpg"))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Image) });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
    /// <summary>A real-looking picture (a flat color PNG is tiny and would count as "no picture").</summary>
    private static byte[] Pic(string path) { TestMedia.Run("-f", "lavfi", "-i", "testsrc=s=300x300:d=1", "-frames:v", "1", path); return File.ReadAllBytes(path); }
    private static async Task<byte[]?> Until(Func<byte[]?> f, int ms = 8000) { for (int i = 0; i < ms / 50; i++) { var b = f(); if (b != null) return b; await Task.Delay(50); } return f(); }

    [Fact]
    public void Online_art_keys_ignore_case_and_spacing_and_read_the_wikidata_image_claim()
    {
        Assert.Equal("the glass harbor", OnlineArt.Norm("  The   Glass Harbor "));
        Assert.Equal(OnlineArt.Key("album", "Blue Lantern", "Glass Harbor"), OnlineArt.Key("album", "blue  lantern", "GLASS HARBOR"));
        Assert.NotEqual(OnlineArt.Key("album", "Blue Lantern", "Glass Harbor"), OnlineArt.Key("artist", "Blue Lantern", "Glass Harbor"));
        using var d = JsonDocument.Parse("""{"entities":{"Q1":{"claims":{"P18":[{"mainsnak":{"snaktype":"value","datavalue":{"value":"Photo.jpg","type":"string"}}}]}}}}""");
        Assert.Equal("Photo.jpg", OnlineArt.WikidataImage(d.RootElement, "Q1"));
        Assert.Null(OnlineArt.WikidataImage(d.RootElement, "Q2"));
    }

    [Fact]
    public async Task Album_covers_and_artist_photos_are_looked_up_once_in_the_background_cached_and_skipped_for_unknown_names_or_when_off()
    {
        using var t = new TempDir(); var net = new FakeNet { Image = Pic(t.File("pic.png")) }; bool on = true;
        using var oa = new OnlineArt(t.Path, () => on, net);
        Assert.Null(oa.Album("Blue Lantern", "Glass Harbor"));                       // first ask: queued, nothing yet
        var cover = await Until(() => oa.Album("Blue Lantern", "Glass Harbor"));
        Assert.Equal(net.Image, cover);
        var photo = await Until(() => oa.Artist("Blue Lantern"));
        Assert.Equal(net.Image, photo);
        Assert.All(net.Seen, s => Assert.StartsWith("WavWiz/", s.ua));
        Assert.Contains(net.Seen, s => s.url == "https://coverartarchive.org/release-group/rg-1/front-500");
        Assert.DoesNotContain(net.Seen, s => s.url.Contains("low-score"));               // weak MusicBrainz matches are ignored
        Assert.DoesNotContain(net.Seen, s => s.url.Contains("/artist/other"));          // only the exact artist name
        var n = net.Seen.Count;
        Assert.Equal(net.Image, oa.Album("blue lantern", "glass harbor"));              // cached on disk: no new requests
        Assert.Null(oa.Album("Unknown Artist", "Something")); Assert.Null(oa.Artist("Various Artists"));
        on = false; Assert.Null(oa.Album("Somebody", "Else")); await Task.Delay(300);
        Assert.Equal(n, net.Seen.Count);
        // a fresh instance (server restart) reads the same cache
        using var oa2 = new OnlineArt(t.Path, () => false, net); Assert.Equal(net.Image, oa2.Artist("BLUE LANTERN"));
    }

    [Fact]
    public async Task A_song_without_a_picture_gets_the_online_album_cover_and_the_art_endpoints_answer_204_while_none_is_known()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        TestMedia.Tone(Path.Combine(music, "01.mp3"), 1, 440, "Harbor Song", "Blue Lantern", "Glass Harbor", 1, "Indie Rock", 2020);
        f.Server.S.Library.AddRoot(music); f.Server.S.Library.Scan();
        var id = f.Server.S.Library.Search("harbor song").Single().Id;
        // tests run with online art off: no picture -> 204, artist photo -> 204
        Assert.Equal(HttpStatusCode.NoContent, (await admin.GetAsync($"/api/v1/art/track/{id}?size=192")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.GetAsync("/api/v1/art/artist?name=Blue%20Lantern")).StatusCode);
        Assert.False(f.Server.S.Art.Online!.Enabled);
        // switched on (with a fake network): the cover arrives in the background and is served resized as JPEG
        var net = new FakeNet { Image = Pic(Path.Combine(f.Dir.Path, "c.png")) };
        f.Server.S.Art.Online = new OnlineArt(Path.Combine(f.Dir.Path, "data2"), () => true, net);
        byte[]? got = null;
        for (int i = 0; i < 160 && got == null; i++) { var r = await admin.GetAsync($"/api/v1/art/track/{id}?size=192"); if (r.StatusCode == HttpStatusCode.OK) { Assert.Equal("image/jpeg", r.Content.Headers.ContentType!.MediaType); got = await r.Content.ReadAsByteArrayAsync(); } else await Task.Delay(50); }
        Assert.NotNull(got); Assert.Equal(0xFF, got![0]); Assert.Equal(0xD8, got[1]);
        HttpResponseMessage a = null!;
        for (int i = 0; i < 200; i++) { a = await admin.GetAsync("/api/v1/art/artist?name=Blue%20Lantern&size=96"); if (a.StatusCode == HttpStatusCode.OK) break; await Task.Delay(50); }
        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        // the admin switch: library.onlineArt is a plain boolean setting
        Assert.True((await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["library.onlineArt"] = false })).IsSuccessStatusCode);
        Assert.Equal("false", f.Server.S.Db.Setting("library.onlineArt"));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["library.onlineArt"] = "no" })).StatusCode);
        f.Server.S.Art.Online.Dispose();
    }

    [Fact]
    public async Task Mute_all_mutes_every_device_and_unmute_all_restores_only_what_it_muted()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); await using var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await using var c = await FakePc.StartAsync(f, "pc-c", "Office");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        JsonElement zs = await admin.GetJson("/api/v1/zones");
        for (int i = 0; i < 100 && zs.GetArrayLength() < 3; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        async Task<Dictionary<string, bool>> Muted() => (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("muted").GetBoolean());
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{Id("pc-c")}", new { muted = true })).EnsureSuccessStatusCode();      // muted on its own first
        var r = await admin.PostAsJsonAsync("/api/v1/zones/mute-all", new { muted = true }); r.EnsureSuccessStatusCode();
        Assert.Equal(2, (await r.Json()).GetProperty("changed").GetInt32());
        Assert.All((await Muted()).Values, Assert.True);
        r = await admin.PostAsJsonAsync("/api/v1/zones/mute-all", new { muted = false }); r.EnsureSuccessStatusCode();
        var m = await Muted(); Assert.False(m["pc-a"]); Assert.False(m["pc-b"]); Assert.True(m["pc-c"]);              // per-device mute stays separate
        var view = f.As(f.Token(Role.View, "tv"));
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync("/api/v1/zones/mute-all", new { muted = true })).StatusCode);
    }
}
