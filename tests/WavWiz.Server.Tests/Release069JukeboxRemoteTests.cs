using System.Net;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #28 (t1878): Remote library songs in the Jukebox guest search - merged with Local (Local first, the same song once), the source
/// named small, Radio never in it; a guest's Remote pick is looked up on its server, queues as a playable remote item, and its cover comes
/// through the guest art route (session code, no sign-in). Folder / playlist limits (Local music only) keep Remote out.</summary>
[Collection("serial")]
public class Release069JukeboxRemoteTests
{
    private sealed class FakeProt : ISecretProtector
    {
        public bool Available => true;
        public byte[] Protect(byte[] p) => p.Reverse().ToArray();
        public byte[] Unprotect(byte[] b) => b.Reverse().ToArray();
    }
    /// <summary>A Navidrome-shaped server: "Song 1" by "Band 1" (also in the local library), "Remote Only" and its explicit twin.</summary>
    private sealed class FakeNd : HttpMessageHandler
    {
        public bool Down; public List<string> Urls = new();
        static HttpResponseMessage J(string inner) => new(HttpStatusCode.OK) { Content = new StringContent("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\"" + inner + "}}", Encoding.UTF8, "application/json") };
        const string Dup = "{\"id\":\"d1\",\"title\":\"song 1\",\"artist\":\"BAND  1\",\"album\":\"Album 1\",\"duration\":60,\"coverArt\":\"al-d\"}";
        const string Only = "{\"id\":\"r1\",\"title\":\"Remote Only\",\"artist\":\"Band 1\",\"album\":\"Far Away\",\"duration\":200,\"coverArt\":\"al-r1\"}";
        const string Expl = "{\"id\":\"r2\",\"title\":\"Remote Only (Explicit)\",\"artist\":\"Band 9\",\"album\":\"Far Away\",\"duration\":200}";
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            if (Down) throw new HttpRequestException("down");
            var u = r.RequestUri!; Urls.Add(u.ToString()); var q = System.Web.HttpUtility.ParseQueryString(u.Query);
            return Task.FromResult(u.AbsolutePath switch
            {
                "/rest/ping" => J(""),
                "/rest/search3" => J(",\"searchResult3\":{\"song\":[" + Dup + "," + Only + "," + Expl + "]}"),
                "/rest/getSong" => q["id"] switch { "r1" => J(",\"song\":" + Only), "d1" => J(",\"song\":" + Dup), _ => J(",\"error\":{\"code\":70,\"message\":\"not found\"}").Also(x => x.Content = new StringContent("{\"subsonic-response\":{\"status\":\"failed\",\"error\":{\"code\":70,\"message\":\"Song not found\"}}}")) },
                "/rest/getCoverArt" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 1, 2 }) { Headers = { ContentType = new("image/jpeg") } } },
                _ => J(""),
            });
        }
    }
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void MergeSongs_keeps_Local_first_drops_duplicates_live_items_and_filtered_explicit()
    {
        var local = new[] { new Features.JukeboxService.Song(1, "Song 1", "Band 1", "Album 1", 60_000) };
        QueueItem R(string id, string t, string a, string? cover = "c") => SubsonicService.Item("srv1", id, t, a, "Al", 1000, cover);
        var remote = new (QueueItem, string)[] {
            (R("d1", " song  1 ", "BAND 1"), "Navidrome"),           // the same song as Local -> once, as Local
            (R("r1", "Remote Only", "Band 1"), "Navidrome"),
            (R("x1", "Remote Only", "band 1"), "Other NAS"),           // the same song on a second server -> once
            (R("r2", "Bad (Explicit)", "Band 9", null), "Navidrome"),
            (new QueueItem(0, "radio", "http://x/stream", "Station", "", "", 0, 5), "Navidrome"),
        };
        var m = Features.JukeboxService.MergeSongs(local, remote, explicitFilter: true);
        Assert.Equal(new[] { "Song 1", "Remote Only" }, m.Select(x => x.Title));
        Assert.Equal(1, m[0].Id); Assert.Null(m[0].Rid); Assert.Null(m[0].Src);
        Assert.Null(m[1].Id); Assert.Equal("srv1:r1", m[1].Rid); Assert.Equal("Navidrome", m[1].Src); Assert.Equal("/api/v1/jukebox/guest/rart/srv1/c", m[1].Art);
        Assert.Equal(3, Features.JukeboxService.MergeSongs(local, remote, explicitFilter: false).Count);
        Assert.Single(Features.JukeboxService.MergeSongs(local, remote, false, max: 1));
        // a local song serializes exactly as before (no rid / src / art keys)
        var j = JsonSerializer.SerializeToElement(m[0], Web);
        Assert.Equal(new[] { "id", "title", "artist", "album", "durationMs" }, j.EnumerateObject().Select(p => p.Name));
    }

    [Fact]
    public async Task Guest_search_merges_Remote_a_Remote_pick_is_looked_up_queued_playable_and_its_cover_is_served()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        var dir = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        for (int i = 1; i <= 2; i++) TestMedia.Tone(Path.Combine(dir, $"{i}.flac"), 30, 440, $"Song {i}", "Band " + i, "Album " + i, i);
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = dir });
        for (int i = 0; i < 200; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 2) break; await Task.Delay(100); }
        using var t = new TempDir(); var nd = new FakeNd(); var rs = new SubsonicService(S.Db, t.Path, new FakeProt(), nd);
        Assert.Null(await rs.Save("http://nas:4533", "trevor", "pa55", "Navidrome")); S.Remote = rs;
        var keepResolver = Playback.Conductor.RemoteResolver; Playback.Conductor.RemoteResolver = rs.StreamUrl;   // the server wires its own service at start
        try
        {
            var sid = JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("id").GetString()!;
            await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { perGuest = 5, explicitFilter = true });
            var code = (await (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).Json()).GetProperty("code").GetString()!;
            var anon = new HttpClient { BaseAddress = new Uri(f.Base) }; anon.DefaultRequestHeaders.Add("X-WavWiz-Guest", code);

            var songs = (await anon.GetJson("/api/v1/jukebox/guest/search?q=song")).GetProperty("songs").EnumerateArray().ToList();
            Assert.Equal(2, songs.Count(x => x.GetProperty("id").ValueKind == JsonValueKind.Number));        // both local songs
            Assert.DoesNotContain(songs, x => x.TryGetProperty("rid", out var r) && r.GetString() == sid + ":d1");   // the remote copy of Song 1 is not listed twice
            var ro = Assert.Single(songs, x => x.TryGetProperty("rid", out _));
            Assert.Equal("Remote Only", ro.GetProperty("title").GetString()); Assert.Equal("Navidrome", ro.GetProperty("src").GetString());
            Assert.Equal(JsonValueKind.Null, ro.GetProperty("id").ValueKind);
            Assert.DoesNotContain(songs, x => x.GetProperty("title").GetString()!.Contains("Explicit"));      // the explicit filter covers Remote too

            // the pick is looked up on its server: what the phone says about it is ignored
            var add = await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", rid = sid + ":r1", title = "Fake", trackId = (long?)null });
            Assert.True(add.StatusCode == HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
            var cd = S.Jukebox.Owns!; var it = Assert.Single(cd.Queue(), x => x.Kind == "remote");
            Assert.Equal("Remote Only", it.Title); Assert.Equal($"subsonic:{sid}:r1", it.Location);
            Assert.StartsWith("http://nas:4533/rest/stream?", Playback.Conductor.RemoteResolver!(it.Location));   // playable: the stream URL is minted at play time
            Assert.Contains(nd.Urls, u => u.Contains("/rest/getSong") && u.Contains("id=r1"));
            Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", rid = sid + ":nope" })).StatusCode);
            Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", rid = "ghost:r1" })).StatusCode);

            // its cover: the board names the guest route, which serves it with the session code only
            var b = await anon.GetJson("/api/v1/jukebox/guest/board?g=guest-aaaa-1");
            var rows = new[] { b.GetProperty("now") }.Concat(b.GetProperty("next").EnumerateArray()).Where(x => x.ValueKind == JsonValueKind.Object && x.GetProperty("title").GetString() == "Remote Only").ToList();
            var art = Assert.Single(rows).GetProperty("art").GetString(); Assert.Equal($"/api/v1/jukebox/guest/rart/{sid}/al-r1", art);
            var img = await anon.GetAsync(art + "?size=128&j=" + code); Assert.Equal(HttpStatusCode.OK, img.StatusCode); Assert.Equal("image/jpeg", img.Content.Headers.ContentType?.MediaType);
            var stranger = new HttpClient { BaseAddress = new Uri(f.Base) };
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(art + "?size=128&j=wrong")).StatusCode);

            // an offline server: Local results still come back
            nd.Down = true;
            var off = (await anon.GetJson("/api/v1/jukebox/guest/search?q=song")).GetProperty("songs").EnumerateArray().ToList();
            Assert.Equal(2, off.Count); Assert.All(off, x => Assert.False(x.TryGetProperty("rid", out _)));
            nd.Down = false;

            // folder picks name Local music only: Remote stays out of the search, the art route and the add path
            await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { folders = new[] { dir } });
            Assert.DoesNotContain((await anon.GetJson("/api/v1/jukebox/guest/search?q=song")).GetProperty("songs").EnumerateArray(), x => x.TryGetProperty("rid", out _));
            Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(art + "?size=128&j=" + code)).StatusCode);
            Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-bbbb-2", name = "B", rid = sid + ":r1" })).StatusCode);
        }
        finally { Playback.Conductor.RemoteResolver = keepResolver; }
    }
}

static class AlsoExt { public static T Also<T>(this T x, Action<T> a) { a(x); return x; } }
