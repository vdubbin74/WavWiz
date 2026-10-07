using System.Net;
using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.0.8 bug 1: the tray "Open player" window on the server PC showed a blank gray page.</summary>
public class Release008Tests
{
    [Theory]
    [InlineData("192.168.1.20", 47800, true, "http://192.168.1.20:47800/\r\n", "http://192.168.1.20:47800/")]
    [InlineData("127.0.0.1", 47800, true, "http://192.168.1.20:47800/", "http://192.168.1.20:47800/")]     // loopback never used when setup knows the real address
    [InlineData("localhost", 47800, true, "\uFEFFhttp://192.168.1.20:47800/", "http://192.168.1.20:47800/")]
    [InlineData("192.168.1.20", 47800, false, "http://10.0.0.5:47800/", "http://192.168.1.20:47800/")]   // a client PC uses its own server address
    [InlineData("media-pc", 47800, true, null, "http://media-pc:47800/")]
    [InlineData("", 0, true, "http://192.168.1.20:47800/", "http://192.168.1.20:47800/")]
    [InlineData("fe80::1", 47800, false, null, "http://[fe80::1]:47800/")]
    public void The_player_window_opens_the_same_address_as_the_desktop_shortcut(string host, int port, bool here, string? firstRun, string want)
        => Assert.Equal(want, UiUrl.Resolve(host, port, here, firstRun));

    [Theory]
    [InlineData("http://192.168.1.20:47800/", "http://192.168.1.20:47800/", true)]
    [InlineData("http://192.168.1.20:47800/", "http://192.168.1.20:47800/?x=1#y", true)]
    [InlineData("http://MEDIA-PC:47800/", "http://media-pc:47800/viz.html", true)]
    [InlineData("http://192.168.1.20:47800/", "https://192.168.1.20:47443/tls/", true)]
    [InlineData("http://192.168.1.20:47800/", "about:blank", true)]
    [InlineData("http://192.168.1.20:47800/", "data:text/html,hi", true)]
    [InlineData("http://192.168.1.20:47800/", "https://musicbrainz.org/", false)]
    [InlineData("http://192.168.1.20:47800/", "http://192.168.1.20:9999/", false)]
    public void Navigations_on_the_same_server_stay_in_the_window(string baseUrl, string target, bool inside)
        => Assert.Equal(inside, UiUrl.IsInternal(baseUrl, target, 47443));

    [Fact]
    public async Task The_root_page_answers_the_player_window_with_the_sign_in_page_and_no_redirect()
    {
        await using var f = await ServerFixture.StartAsync();
        var req = new HttpRequestMessage(HttpMethod.Get, "/");
        req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Edg/140.0 WavWizPlayer/0.0.8");
        var r = await f.Http.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var csp = string.Join(";", r.Headers.TryGetValues("Content-Security-Policy", out var v) ? v : r.Content.Headers.TryGetValues("Content-Security-Policy", out var v2) ? v2 : Array.Empty<string>());
        Assert.Contains("script-src 'self'", csp); Assert.Contains("connect-src 'self' ws: wss:", csp);
        var state = await f.Http.GetStringAsync("/api/v1/auth/state");
        Assert.Contains("\"authenticated\":false", state);                 // not signed in -> the page draws the Player / Administrator chooser
    }

    [Fact]
    public void The_shipped_index_page_has_the_blank_page_guard()
    {
        var root = FindWebRoot();
        var html = File.ReadAllText(Path.Combine(root, "index.html"));
        Assert.Contains("/js/bootguard.js", html);
        Assert.True(html.IndexOf("bootguard.js", StringComparison.Ordinal) < html.IndexOf("main.js", StringComparison.Ordinal));
        Assert.Contains("Sign in again", File.ReadAllText(Path.Combine(root, "js", "bootguard.js")));
    }

    internal static string FindWebRoot()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d != null && !Directory.Exists(Path.Combine(d.FullName, "src", "WavWiz.Server", "wwwroot"))) d = d.Parent;
        return Path.Combine(d!.FullName, "src", "WavWiz.Server", "wwwroot");
    }
}

/// <summary>0.0.8 item 10: radio / network streams feed the visualizer exactly like library tracks, with true stereo levels for the VU meters.</summary>
public class Release008VizTests
{
    [Fact]
    public void VizHub_adds_stereo_rms_and_peak_levels_after_the_waveform()
    {
        var hub = new WavWiz.Server.Playback.VizHub(); var st = new float[960 * 2];
        for (int i = 0; i < 960; i++) { float v = (float)Math.Sin(i * 0.2); st[2 * i] = 0.5f * v; st[2 * i + 1] = 0.05f * v; }
        for (int k = 0; k < 3; k++) hub.OnFrame(1_000_000 + k * 20_000, st);
        var w = hub.At(1_000_000 + 3 * 20_000)!; Assert.Equal(1024 + WavWiz.Server.Playback.VizHub.Extra, w.Length);
        Assert.True(w[1024] > w[1025] + 50, $"left rms byte {w[1024]} should be well above right {w[1025]}");
        Assert.True(w[1026] >= w[1024] && w[1027] >= w[1025], "peak >= rms");
        Assert.InRange(WavWiz.Server.Playback.VizHub.Db(1.0), 254, 255); Assert.Equal(0, WavWiz.Server.Playback.VizHub.Db(0));
    }

    [Fact]
    public async Task An_internet_radio_stream_feeds_the_visualizer_socket()
    {
        await using var f = await ServerFixture.StartAsync(); var a = f.As(f.Token(Role.Admin));
        using var t = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=500:sample_rate=44100:duration=20", "-ac", "2", "-b:a", "64k", t.File("r.mp3"));
        using var srv = new FakeIcyServer(File.ReadAllBytes(t.File("r.mp3")));
        await using var pc = await FakePc.StartAsync(f, "pc-r", "R"); await pc.WaitConnected();
        var st = await (await a.PostAsJsonAsync("/api/v1/radio", new { name = "Fake FM", url = $"http://127.0.0.1:{srv.Port}/stream" })).Json();
        long rid = st.TryGetProperty("id", out var idp) ? idp.GetInt64() : (await a.GetJson("/api/v1/radio")).EnumerateArray().First().GetProperty("id").GetInt64();
        using var ws = new System.Net.WebSockets.ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View));
        await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/viz"), CancellationToken.None);
        (await a.PostAsJsonAsync("/api/v1/stream/play", new { kind = "radio", id = rid })).EnsureSuccessStatusCode();
        int frames = 0, maxVal = 0, maxRms = 0; var buf = new byte[4096]; using var cts = new CancellationTokenSource(20000);
        try
        {
            while (frames < 15)
            {
                var r = await ws.ReceiveAsync(buf, cts.Token);
                if (r.Count == 1 + 1024 + WavWiz.Server.Playback.VizHub.Extra && buf[0] == 1) { frames++; maxVal = Math.Max(maxVal, buf.Skip(1).Take(1024).Max(b => Math.Abs(b - 128))); maxRms = Math.Max(maxRms, buf[1025]); }
            }
        }
        catch (OperationCanceledException) { }
        Assert.True(frames >= 10, $"only {frames} viz frames from the radio stream");
        Assert.True(maxVal > 10, "the radio waveform should not be flat"); Assert.True(maxRms > 100, $"stereo level bytes should show the tone (got {maxRms})");
        await a.PostAsync("/api/v1/stream/stop", null);
    }
}
