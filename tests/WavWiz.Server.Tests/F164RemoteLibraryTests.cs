using System.Net;
using System.Text;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>F164: Subsonic / OpenSubsonic client (Navidrome-shaped answers): token auth, legacy fallback, encrypted storage, browse, play items, offline status.</summary>
public class F164RemoteLibraryTests
{
    private sealed class FakeProt : ISecretProtector
    {
        public bool Available => true;
        public byte[] Protect(byte[] p) => p.Select(b => (byte)(b ^ 0x5A)).Reverse().ToArray();
        public byte[] Unprotect(byte[] b) => b.Reverse().Select(x => (byte)(x ^ 0x5A)).ToArray();
    }
    private sealed class FakeNavidrome : HttpMessageHandler
    {
        public string Pw = "pa55"; public bool TokenOk = true; public bool Down; public List<string> Urls = new();
        private static HttpResponseMessage J(string inner) => new(HttpStatusCode.OK) { Content = new StringContent("{\"subsonic-response\":{\"status\":\"ok\",\"version\":\"1.16.1\"" + inner + "}}", Encoding.UTF8, "application/json") };
        private static HttpResponseMessage E(int c) => new(HttpStatusCode.OK) { Content = new StringContent("{\"subsonic-response\":{\"status\":\"failed\",\"error\":{\"code\":" + c + ",\"message\":\"x\"}}}") };
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            if (Down) throw new HttpRequestException("down");
            var u = r.RequestUri!; Urls.Add(u.ToString()); var q = System.Web.HttpUtility.ParseQueryString(u.Query);
            bool auth = q["t"] != null ? TokenOk && q["t"] == SubsonicService.Md5Hex(Pw + q["s"]) : q["p"] == "enc:" + Convert.ToHexString(Encoding.UTF8.GetBytes(Pw)).ToLowerInvariant();
            if (q["t"] != null && !TokenOk) return Task.FromResult(E(41));
            if (!auth) return Task.FromResult(E(40));
            return Task.FromResult(u.AbsolutePath switch
            {
                "/rest/ping" => J(""),
                "/rest/getArtists" => J(",\"artists\":{\"index\":[{\"name\":\"A\",\"artist\":[{\"id\":\"ar1\",\"name\":\"Air\",\"albumCount\":1,\"coverArt\":\"ar-ar1\"}]}]}"),
                "/rest/getAlbumList2" => J(",\"albumList2\":{\"album\":[{\"id\":\"al1\",\"name\":\"Moon Safari\",\"artist\":\"Air\",\"year\":1998,\"songCount\":2,\"coverArt\":\"al-al1\"}]}"),
                "/rest/getAlbum" => J(",\"album\":{\"id\":\"al1\",\"name\":\"Moon Safari\",\"artist\":\"Air\",\"song\":[{\"id\":\"s1\",\"title\":\"La femme d'argent\",\"artist\":\"Air\",\"album\":\"Moon Safari\",\"track\":1,\"duration\":430,\"coverArt\":\"al-al1\"},{\"id\":\"s2\",\"title\":\"Sexy Boy\",\"artist\":\"Air\",\"album\":\"Moon Safari\",\"track\":2,\"duration\":298}]}"),
                "/rest/getCoverArt" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 1, 2 }) { Headers = { ContentType = new("image/jpeg") } } },
                _ => E(70),
            });
        }
    }

    [Fact]
    public async Task Navidrome_server_is_tested_saved_encrypted_browsed_and_played()
    {
        using var t = new TempDir(); var db = new Db(t.File("x.db")); db.Migrate(); var nd = new FakeNavidrome();
        var rs = new SubsonicService(db, t.Path, new FakeProt(), nd);
        Assert.NotNull(await rs.Save("nas:4533", "trevor", "wrong", null));
        Assert.Empty(rs.List());
        Assert.Null(await rs.Save("http://nas:4533/rest/", "trevor", "pa55", "Navidrome"));
        Assert.DoesNotContain("pa55", db.Setting(SubsonicService.Key));
        var sid = System.Text.Json.JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("id").GetString(); Assert.NotNull(sid);
        Assert.Contains("Air", System.Text.Json.JsonSerializer.Serialize(await rs.Artists(sid!)));
        var items = await rs.AlbumItems(sid!, "al1");
        Assert.Equal(2, items.Count); Assert.Equal("remote", items[0].Kind); Assert.Equal(430_000, items[0].DurationMs);
        Assert.DoesNotContain("pa55", items[0].Location); Assert.StartsWith("subsonic:" + sid + ":s1", items[0].Location);
        var url = rs.StreamUrl(items[0].Location)!; Assert.StartsWith("http://nas:4533/rest/stream?", url); Assert.Contains("&t=", url); Assert.Contains("id=s1", url);
        Assert.NotNull(await rs.Cover(sid!, "al-al1", 200, default)); int calls = nd.Urls.Count;
        Assert.NotNull(await rs.Cover(sid!, "al-al1", 200, default)); Assert.Equal(calls, nd.Urls.Count);   // cached on disk
        nd.Down = true; await Assert.ThrowsAsync<SubsonicService.SubsonicError>(() => rs.Artists(sid!));
        Assert.NotNull(System.Text.Json.JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("lastError").GetString());   // dim status; the saved server stays
        Assert.True(rs.Remove(sid!)); Assert.Null(rs.StreamUrl(items[0].Location));
    }

    [Fact]
    public async Task Legacy_server_falls_back_to_hex_password()
    {
        using var t = new TempDir(); var db = new Db(t.File("x.db")); db.Migrate(); var nd = new FakeNavidrome { TokenOk = false };
        var rs = new SubsonicService(db, t.Path, new FakeProt(), nd);
        Assert.Null(await rs.Save("http://old:8080", "u", "pa55", null));
        var sid = System.Text.Json.JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("id").GetString();
        Assert.Contains("p=enc:", rs.StreamUrl("subsonic:" + sid + ":x")!);
    }

    /// <summary>F175: dragging a remote album / song onto the queue = POST /queue/add with "at"; entries land at the drop line as Kind=remote, mixed with local.</summary>
    [Fact]
    public async Task F175_remote_queue_add_inserts_at_drop_position_mixed_with_local()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        using var t = new TempDir(); var rs = new SubsonicService(S.Db, t.Path, new FakeProt(), new FakeNavidrome());
        Assert.Null(await rs.Save("http://nas:4533", "trevor", "pa55", "Navidrome")); S.Remote = rs;
        var sid = System.Text.Json.JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("id").GetString()!;
        long t1 = await E2ETests.AddClickTrack(f, admin), t2 = await E2ETests.AddClickTrack(f, admin);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "tracks", ids = new[] { t1, t2 } })).StatusCode);
        // song row drag (same shape as Add to queue) dropped between the two local songs
        Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "remote", server = sid, songs = new[] { new { id = "s9", title = "Kelly", artist = "Air", album = "Moon Safari", durationMs = 1000 } }, at = 1 })).StatusCode);
        // album tile drag dropped at the top
        Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "remote", server = sid, album = "al1", at = 0 })).StatusCode);
        var q = S.Conductor.Queue().ToList();
        Assert.Equal(5, q.Count);
        Assert.Equal(new[] { "remote", "remote", "track", "remote", "track" }, q.Select(x => x.Kind).ToArray());
        Assert.StartsWith("subsonic:" + sid + ":s1", q[0].Location); Assert.StartsWith("subsonic:" + sid + ":s2", q[1].Location);
        Assert.StartsWith("subsonic:" + sid + ":s9", q[3].Location);
    }

    /// <summary>F176: queue DTO carries a source pill: local "Local", remote = server display name (removed server -> "Remote"); no Location / secrets.</summary>
    [Fact]
    public async Task F176_queue_dto_has_source_and_label()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        using var t = new TempDir(); var rs = new SubsonicService(S.Db, t.Path, new FakeProt(), new FakeNavidrome());
        Assert.Null(await rs.Save("http://nas:4533", "trevor", "pa55", "Navidrome")); S.Remote = rs;
        var sid = System.Text.Json.JsonSerializer.SerializeToElement(rs.List()[0]).GetProperty("id").GetString()!;
        long t1 = await E2ETests.AddClickTrack(f, admin);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "tracks", ids = new[] { t1 } })).StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "remote", server = sid, songs = new[] { new { id = "s9", title = "Kelly", artist = "Air", album = "Moon Safari", durationMs = 1000 } } })).StatusCode);
        var raw = await admin.GetStringAsync("/api/v1/queue");
        Assert.DoesNotContain("pa55", raw); Assert.DoesNotContain("subsonic:", raw);
        var items = System.Text.Json.JsonDocument.Parse(raw).RootElement.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal("local", items[0].GetProperty("source").GetString()); Assert.Equal("Local", items[0].GetProperty("sourceLabel").GetString());
        Assert.Equal("remote", items[1].GetProperty("source").GetString()); Assert.Equal("Navidrome", items[1].GetProperty("sourceLabel").GetString());
        Assert.Equal(sid, items[1].GetProperty("serverId").GetString());
        Assert.True(rs.Remove(sid));
        var gone = System.Text.Json.JsonDocument.Parse(await admin.GetStringAsync("/api/v1/queue")).RootElement.GetProperty("items")[1];
        Assert.Equal("remote", gone.GetProperty("source").GetString()); Assert.Equal("Remote", gone.GetProperty("sourceLabel").GetString());
    }

    /// <summary>F238: remote album detail uses local albhead/albcover chrome — never cover(..., 'lg') (full-bleed giant art).</summary>
    [Fact]
    public void F238_remote_album_page_uses_albcover_not_cover_lg()
    {
        var js = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "wwwroot", "js", "library.js"));
        var i = js.IndexOf("async function remoteAlbumPage", StringComparison.Ordinal);
        Assert.True(i >= 0, "remoteAlbumPage missing");
        var body = js.Substring(i, Math.Min(2200, js.Length - i));
        Assert.Contains("'albcover'", body);
        Assert.Contains("albhead", body);
        Assert.Contains("albmeta", body);
        Assert.Contains("albacts", body);
        Assert.Contains("albcols", body);
        Assert.Contains("dominantColor", body);
        Assert.DoesNotContain("cover(r.album.artUrl, 'lg'", body);
        Assert.Contains("rplay(sid, songs)", body); // Play kept
        Assert.Contains("rsongList(sid, songs, true)", body); // F175 song rows kept
    }
}
