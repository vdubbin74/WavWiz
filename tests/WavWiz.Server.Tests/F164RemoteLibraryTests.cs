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
}
