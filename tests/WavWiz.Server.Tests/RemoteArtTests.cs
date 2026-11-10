using System.Net;
using System.Net.Sockets;
using System.Text;
using WavWiz.Server.Features;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8: /art/remote/{hash} only fetches favicons the finder itself returned; private/loopback/CGNAT and redirect hops are refused.</summary>
public class RemoteArtTests
{
    static byte[] Pic() => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "art", "plain.png"));

    [Theory]
    [InlineData("http://127.0.0.1/favicon.png")]
    [InlineData("http://127.0.0.1:8080/x")]
    [InlineData("http://localhost/x")]
    [InlineData("http://10.0.0.1/x")]
    [InlineData("http://10.255.255.255/x")]
    [InlineData("http://172.16.0.1/x")]
    [InlineData("http://172.31.255.1/x")]
    [InlineData("http://192.168.1.1/x")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://100.64.0.1/x")]
    [InlineData("http://100.127.1.1/x")]
    [InlineData("http://[::1]/x")]
    [InlineData("http://[fc00::1]/x")]
    [InlineData("http://[fe80::1]/x")]
    [InlineData("http://0.0.0.0/x")]
    [InlineData("file:///etc/passwd")]
    [InlineData("ftp://1.1.1.1/x")]
    public void Private_loopback_link_local_and_cgnat_urls_are_rejected(string url)
        => Assert.False(RemoteUrlGuard.IsSafeRemoteUrl(url));

    [Theory]
    [InlineData("http://1.1.1.1/favicon.png")]
    [InlineData("https://8.8.8.8/logo")]
    [InlineData("http://[2001:4860:4860::8888]/x")]
    public void Public_literal_addresses_are_allowed(string url)
        => Assert.True(RemoteUrlGuard.IsSafeRemoteUrl(url));

    [Fact]
    public void Remember_rejects_private_ips_and_unknown_hashes_are_missing()
    {
        using var t = new TempDir();
        var db = new Db(t.File("t.db")); db.Migrate();
        var f = new RadioFinderService(db);
        Assert.Null(f.RememberFavicon("http://127.0.0.1/fav.png"));
        Assert.Null(f.RememberFavicon("http://192.168.0.5/fav.png"));
        Assert.Null(f.RememberFavicon("http://169.254.169.254/fav.png"));
        Assert.Null(f.RememberFavicon("http://10.1.2.3/fav.png"));
        Assert.Null(f.RememberFavicon("http://100.64.1.2/fav.png"));
        Assert.Equal(0, f.FaviconCount);
        Assert.False(f.TryFavicon("deadbeef", out _));
        var hash = f.RememberFavicon("https://1.1.1.1/fav.png");
        Assert.False(string.IsNullOrEmpty(hash));
        Assert.Equal(64, hash!.Length);
        Assert.True(f.TryFavicon(hash, out var url));
        Assert.Equal("https://1.1.1.1/fav.png", url);
        Assert.False(f.TryFavicon(RadioFinderService.FaviconHash("https://8.8.8.8/nope.png"), out _));
    }

    [Fact]
    public async Task GetRemoteAsync_refuses_private_ips_without_fetching()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ww-remote-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var db = new Db(Path.Combine(dir, "t.db")); db.Migrate();
            var art = new ArtService(new LibraryService(db), dir, TestMedia.Ffmpeg);
            Assert.Null(await art.GetRemoteAsync("http://127.0.0.1/fav.png", 96, CancellationToken.None));
            Assert.Null(await art.GetRemoteAsync("http://169.254.169.254/latest/meta-data/", 96, CancellationToken.None));
            Assert.Null(await art.GetRemoteAsync("http://10.0.0.1/x", 96, CancellationToken.None));
            Assert.Null(await art.GetRemoteAsync("http://192.168.1.9/x", 96, CancellationToken.None));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public async Task Unknown_hash_and_old_query_url_return_404()
    {
        await using var f = await ServerFixture.StartAsync();
        var view = f.As(f.Token(Role.View));
        Assert.Equal(HttpStatusCode.NotFound, (await view.GetAsync("/api/v1/art/remote/deadbeef")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await view.GetAsync("/api/v1/art/remote/" + new string('a', 64))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await view.GetAsync("/api/v1/art/remote?url=" + Uri.EscapeDataString("https://1.1.1.1/fav.png"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.GetAsync("/api/v1/art/remote/" + new string('a', 64))).StatusCode);
    }

    [Fact]
    public async Task Finder_returned_favicon_hash_is_fetched()
    {
        await using var f = await ServerFixture.StartAsync();
        using var img = new TinyImg(Pic());
        Func<Uri, bool> allow = u => u.Host == "127.0.0.1" && u.Port == img.Port;
        f.Server.S.RadioFinder.AllowRemoteHost = allow;
        f.Server.S.Art.AllowRemoteHost = allow;
        var url = $"http://127.0.0.1:{img.Port}/favicon.png";
        var hash = f.Server.S.RadioFinder.RememberFavicon(url);
        Assert.False(string.IsNullOrEmpty(hash));
        var view = f.As(f.Token(Role.View));
        var ok = await view.GetAsync($"/api/v1/art/remote/{hash}?size=96");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("image/jpeg", ok.Content.Headers.ContentType?.MediaType);
        var bytes = await ok.Content.ReadAsByteArrayAsync();
        Assert.True(ArtService.LooksLikeJpeg(bytes));
        var hits = img.Hits;
        Assert.True(hits >= 1);
        Assert.Equal(HttpStatusCode.NotFound, (await view.GetAsync("/api/v1/art/remote/" + RadioFinderService.FaviconHash($"http://127.0.0.1:{img.Port}/other.png"))).StatusCode);
        Assert.Equal(hits, img.Hits);   // unknown hash must not trigger a fetch
    }

    [Fact]
    public async Task Redirect_to_private_or_cloud_metadata_is_not_followed()
    {
        await using var f = await ServerFixture.StartAsync();
        using var img = new TinyImg(Pic()) { Mode = "redir-private" };
        Func<Uri, bool> allow = u => u.Host == "127.0.0.1" && u.Port == img.Port;
        f.Server.S.RadioFinder.AllowRemoteHost = allow;
        f.Server.S.Art.AllowRemoteHost = allow;
        var hash = f.Server.S.RadioFinder.RememberFavicon($"http://127.0.0.1:{img.Port}/go");
        Assert.False(string.IsNullOrEmpty(hash));
        var view = f.As(f.Token(Role.View));
        var r = await view.GetAsync($"/api/v1/art/remote/{hash}?size=96");
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    /// <summary>Loopback HTTP server that can serve a picture or a 302.</summary>
    sealed class TinyImg : IDisposable
    {
        readonly TcpListener _l = new(IPAddress.Loopback, 0);
        readonly CancellationTokenSource _cts = new();
        readonly byte[] _body;
        public int Port => ((IPEndPoint)_l.LocalEndpoint).Port;
        public volatile string Mode = "ok";
        public int Hits;
        public TinyImg(byte[] body)
        {
            _body = body;
            _l.Start();
            _ = Task.Run(Accept);
        }
        async Task Accept()
        {
            try { while (!_cts.IsCancellationRequested) { var c = await _l.AcceptTcpClientAsync(_cts.Token); _ = Task.Run(() => Serve(c)); } }
            catch { }
        }
        async Task Serve(TcpClient c)
        {
            try
            {
                using var _ = c;
                var s = c.GetStream();
                var buf = new byte[4096];
                await s.ReadAsync(buf);
                Interlocked.Increment(ref Hits);
                if (Mode == "redir-private")
                {
                    var head = Encoding.ASCII.GetBytes("HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    await s.WriteAsync(head);
                    return;
                }
                var hdr = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {_body.Length}\r\nConnection: close\r\n\r\n");
                await s.WriteAsync(hdr);
                await s.WriteAsync(_body);
            }
            catch { }
        }
        public void Dispose() { _cts.Cancel(); try { _l.Stop(); } catch { } }
    }
}
