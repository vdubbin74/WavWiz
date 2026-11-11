using System.Net;
using System.Net.Sockets;
using System.Text;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 item 2: HLS stations name the song in #EXTINF (RFC 8216 4.3.2.1); the per-zone now (Devices tiles, zone menu) carries the
/// radio song like /stream does. ICY StreamTitle was already covered (RadioTests, 0.6.8-#8).</summary>
public class Radio070NowPlayingTests
{
    const string Media = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:120\n#EXTINF:6.0,Nirvana - Lithium\nseg120.aac\n#EXTINF:6.0,Blondie - Heart of Glass\nseg121.aac\n";
    const string Master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS=\"mp4a.40.5\"\nlow/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nhigh/playlist.m3u8\n";

    [Fact]
    public void Hls_playlist_parsing()
    {
        Assert.Equal("Blondie - Heart of Glass", HlsMeta.LastTitle(Media));
        Assert.Equal(6, HlsMeta.TargetDuration(Media));
        Assert.Null(HlsMeta.Variant(Media, "http://x/live.m3u8"));
        Assert.Equal("http://radio.example/hls/low/playlist.m3u8", HlsMeta.Variant(Master, "http://radio.example/hls/master.m3u8"));
        Assert.Null(HlsMeta.LastTitle("#EXTM3U\n#EXTINF:6.0,\nseg.aac\n"));                         // no title = nothing to show
        Assert.Null(HlsMeta.LastTitle("#EXTM3U\n#EXTINF:6.0,Old Song\na.aac\n#EXTINF:6.0,\nb.aac\n"));   // newest segment has none (ad break)
        // iHeart-style key="value" titles go through the same RadioLive parser as ICY
        var t = HlsMeta.LastTitle("#EXTINF:10.0,title=\"Smells Like Teen Spirit\",artist=\"Nirvana\"\nx.aac\n")!;
        var live = RadioLive.Parse(t)!; Assert.Equal("Nirvana", live.Artist); Assert.Equal("Smells Like Teen Spirit", live.Title);
    }

    [Fact]
    public async Task Hls_station_reports_the_song_while_it_plays()
    {
        using var dir = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=8", "-c:a", "aac", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", Path.Combine(dir.Path, "live.m3u8"));
        var pl = File.ReadAllText(Path.Combine(dir.Path, "live.m3u8"));
        var lines = pl.Split('\n').ToList(); int last = lines.FindLastIndex(l => l.StartsWith("#EXTINF:"));
        lines[last] = lines[last].TrimEnd(',') + ",Blondie - Heart of Glass";
        File.WriteAllText(Path.Combine(dir.Path, "live.m3u8"), string.Join('\n', lines));
        using var srv = new StaticHttp(dir.Path);
        var got = new List<string>();
        using var d = new RadioDecoder(TestMedia.Ffmpeg, $"http://127.0.0.1:{srv.Port}/live.m3u8") { PrebufferFrames = 48000 / 4, BackoffMs = _ => 200 };
        d.Metadata += t => { lock (got) got.Add(t); };
        var sw = System.Diagnostics.Stopwatch.StartNew(); var buf = new float[4800 * 2]; int frames = 0;
        while (sw.ElapsedMilliseconds < 15000 && (d.NowPlaying == null || frames < 48000 / 2)) { frames += d.Read(buf, 4800); await Task.Delay(20); }
        Assert.Equal("Blondie - Heart of Glass", d.NowPlaying);
        lock (got) Assert.Contains("Blondie - Heart of Glass", got);
        Assert.True(frames > 0, "the HLS audio still decodes (ffmpeg) while the playlist is polled");
        Assert.Contains(srv.Paths, p => p.EndsWith(".aac") || p.EndsWith(".ts"));
    }

    [Fact]
    public async Task Zone_now_carries_the_radio_song_for_devices_tiles_and_the_zone_menu()
    {
        await using var f = await ServerFixture.StartAsync(); var a = f.As(f.Token(Role.Admin));
        using var t = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=500:sample_rate=44100:duration=20", "-ac", "2", "-b:a", "64k", t.File("r.mp3"));
        using var srv = new FakeIcyServer(File.ReadAllBytes(t.File("r.mp3"))) { Title = "Blondie - Heart of Glass" };
        await using var pc = await FakePc.StartAsync(f, "pc-r", "R"); await pc.WaitConnected();
        long zid = (await a.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-r").GetProperty("id").GetInt64();
        (await a.PostAsJsonAsync("/api/v1/groups", new { name = "Kitchen", deviceIds = new[] { zid } })).EnsureSuccessStatusCode();
        var st = await (await a.PostAsJsonAsync("/api/v1/radio", new { name = "Fake FM", url = $"http://127.0.0.1:{srv.Port}/stream" })).Json();
        long rid = st.TryGetProperty("id", out var idp) ? idp.GetInt64() : (await a.GetJson("/api/v1/radio")).EnumerateArray().First().GetProperty("id").GetInt64();
        (await a.PostAsJsonAsync("/api/v1/stream/play", new { kind = "radio", id = rid })).EnsureSuccessStatusCode();
        System.Text.Json.JsonElement now = default; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 15000)
        {
            var g = await a.GetJson("/api/v1/groups");
            now = g.EnumerateArray().Select(x => x.GetProperty("now")).FirstOrDefault(n => n.ValueKind == System.Text.Json.JsonValueKind.Object && n.TryGetProperty("liveSong", out var ls) && ls.ValueKind == System.Text.Json.JsonValueKind.String);
            if (now.ValueKind == System.Text.Json.JsonValueKind.Object) break; await Task.Delay(200);
        }
        Assert.Equal(System.Text.Json.JsonValueKind.Object, now.ValueKind);
        Assert.Equal("radio", now.GetProperty("kind").GetString());
        Assert.Equal("Fake FM", now.GetProperty("title").GetString());
        Assert.Equal("Heart of Glass", now.GetProperty("liveSong").GetString());
        Assert.Equal("Blondie", now.GetProperty("liveArtist").GetString());
        Assert.Equal("Blondie - Heart of Glass", now.GetProperty("liveTitle").GetString());
    }

    /// <summary>Tiny static file server (GET only) that records the paths asked for.</summary>
    sealed class StaticHttp : IDisposable
    {
        private readonly TcpListener _l = new(IPAddress.Loopback, 0); private readonly string _root; private readonly CancellationTokenSource _cts = new();
        public readonly List<string> Paths = new();
        public int Port => ((IPEndPoint)_l.LocalEndpoint).Port;
        public StaticHttp(string root) { _root = root; _l.Start(); _ = Loop(); }
        private async Task Loop()
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient c; try { c = await _l.AcceptTcpClientAsync(_cts.Token); } catch { return; }
                _ = Task.Run(async () =>
                {
                    using var _c = c; var s = c.GetStream(); var r = new StreamReader(s, Encoding.ASCII, false, 1024, leaveOpen: true);
                    var req = await r.ReadLineAsync() ?? ""; while (!string.IsNullOrEmpty(await r.ReadLineAsync())) { }
                    var path = req.Split(' ').ElementAtOrDefault(1)?.Split('?')[0].TrimStart('/') ?? ""; lock (Paths) Paths.Add(path);
                    var file = Path.Combine(_root, path);
                    if (path.Contains("..") || !File.Exists(file)) { await s.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")); return; }
                    var body = await File.ReadAllBytesAsync(file); var type = path.EndsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "audio/aac";
                    await s.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n")); await s.WriteAsync(body);
                });
            }
        }
        public void Dispose() { _cts.Cancel(); _l.Stop(); }
    }
}
