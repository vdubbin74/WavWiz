using System.Net;
using System.Net.Sockets;
using System.Text;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>A tiny ICY (Shoutcast) server on loopback: sends an MP3 loop with metadata blocks; can drop connections on demand.</summary>
public sealed class FakeIcyServer : IDisposable
{
    private readonly TcpListener _l = new(IPAddress.Loopback, 0);
    private readonly byte[] _mp3; private readonly CancellationTokenSource _cts = new();
    public int Port => ((IPEndPoint)_l.LocalEndpoint).Port;
    public int Connections; public volatile string Title = "First Artist - First Song"; public volatile int DropAfterBytes = int.MaxValue;
    public bool Playlist; public string? SeenIcyRequest;
    public FakeIcyServer(byte[] mp3) { _mp3 = mp3; _l.Start(); _ = Task.Run(Accept); }
    private async Task Accept()
    {
        try { while (!_cts.IsCancellationRequested) { var c = await _l.AcceptTcpClientAsync(_cts.Token); _ = Task.Run(() => Serve(c)); } } catch { }
    }
    private async Task Serve(TcpClient c)
    {
        try
        {
            using var _ = c; var s = c.GetStream(); var rd = new byte[4096]; int n = await s.ReadAsync(rd); var req = Encoding.ASCII.GetString(rd, 0, n);
            SeenIcyRequest = req;
            int conn = Interlocked.Increment(ref Connections);
            if (req.StartsWith("GET /list.pls"))
            {
                var body = $"[playlist]\nFile1=http://127.0.0.1:{Port}/stream\nNumberOfEntries=1\n";
                await s.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.0 200 OK\r\nContent-Type: audio/x-scpls\r\nContent-Length: {body.Length}\r\n\r\n{body}")); return;
            }
            const int metaint = 8192;
            await s.WriteAsync(Encoding.ASCII.GetBytes($"ICY 200 OK\r\nicy-name: Fake FM\r\nicy-metaint: {metaint}\r\nContent-Type: audio/mpeg\r\n\r\n"));
            long sent = 0; int pos = 0; bool first = true;
            while (!_cts.IsCancellationRequested)
            {
                if (sent > DropAfterBytes && conn == 1) return;                        // simulate a dropped connection
                var chunk = new byte[metaint];
                for (int i = 0; i < metaint; i++) { chunk[i] = _mp3[pos]; pos = (pos + 1) % _mp3.Length; }
                await s.WriteAsync(chunk); sent += metaint;
                byte[] meta;
                if (first || Title != lastTitle) { var m = Encoding.UTF8.GetBytes($"StreamTitle='{Title}';"); meta = new byte[1 + ((m.Length + 15) / 16) * 16]; meta[0] = (byte)((m.Length + 15) / 16); Array.Copy(m, 0, meta, 1, m.Length); lastTitle = Title; first = false; }
                else meta = new byte[] { 0 };
                await s.WriteAsync(meta);
                await Task.Delay(8, _cts.Token);                                       // ~ 8 kB per 8 ms ≈ far faster than real time (128 kbps = 16 kB/s)
            }
        }
        catch { }
    }
    private string lastTitle = "";
    public void Dispose() { _cts.Cancel(); _l.Stop(); }
}

public class RadioTests
{
    private static byte[] Mp3(TempDir t)
    {
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=500:sample_rate=44100:duration=20", "-ac", "2", "-b:a", "64k", t.File("r.mp3"));
        return File.ReadAllBytes(t.File("r.mp3"));
    }

    private static int ReadSeconds(RadioDecoder d, double seconds, int timeoutS = 20)
    {
        var buf = new float[960 * 2]; int total = 0; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (total < seconds * 48000 && sw.Elapsed.TotalSeconds < timeoutS) { int n = d.Read(buf, 960); total += n; if (n == 0) Thread.Sleep(5); }
        return total;
    }

    [Fact]
    public void Radio_plays_reads_icy_titles_and_sends_an_ICY_request()
    {
        using var t = new TempDir(); using var srv = new FakeIcyServer(Mp3(t));
        var titles = new List<string>();
        using var d = new RadioDecoder(TestMedia.Ffmpeg, $"http://127.0.0.1:{srv.Port}/stream") { PrebufferFrames = 48000 / 2 };
        d.Metadata += titles.Add;
        Assert.True(ReadSeconds(d, 2) >= 2 * 48000);
        Assert.Contains("First Artist - First Song", titles); Assert.Equal("Fake FM", d.StationName);
        Assert.Contains("Icy-MetaData: 1", srv.SeenIcyRequest!, StringComparison.OrdinalIgnoreCase);
        srv.Title = "Second Artist - Second Song";
        var sw = System.Diagnostics.Stopwatch.StartNew(); var b = new float[1920];
        while (!titles.Contains("Second Artist - Second Song") && sw.Elapsed.TotalSeconds < 10) { d.Read(b, 960); Thread.Sleep(5); }
        Assert.Contains("Second Artist - Second Song", titles); Assert.Equal("Second Artist - Second Song", d.NowPlaying);
    }

    [Fact]
    public void Radio_reconnects_after_the_stream_drops_and_keeps_playing()
    {
        using var t = new TempDir(); using var srv = new FakeIcyServer(Mp3(t)) { DropAfterBytes = 60_000 };
        using var d = new RadioDecoder(TestMedia.Ffmpeg, $"http://127.0.0.1:{srv.Port}/stream") { PrebufferFrames = 48000 / 4, BackoffMs = _ => 100 };
        Assert.True(ReadSeconds(d, 12, 40) >= 12 * 48000, "audio kept flowing across the drop");
        Assert.True(d.Reconnects >= 1); Assert.True(srv.Connections >= 2);
    }

    [Fact]
    public void Radio_follows_a_pls_playlist_and_fails_politely_when_the_station_is_down()
    {
        using var t = new TempDir(); using var srv = new FakeIcyServer(Mp3(t));
        using var d = new RadioDecoder(TestMedia.Ffmpeg, $"http://127.0.0.1:{srv.Port}/list.pls") { PrebufferFrames = 48000 / 4 };
        Assert.True(ReadSeconds(d, 1) >= 48000);
        var dead = new TcpListener(IPAddress.Loopback, 0); dead.Start(); int port = ((IPEndPoint)dead.LocalEndpoint).Port; dead.Stop();
        using var d2 = new RadioDecoder(TestMedia.Ffmpeg, $"http://127.0.0.1:{port}/x") { BackoffMs = _ => 100 };
        var buf = new float[1920]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (d2.Error == null && d2.Reconnects < 2 && sw.Elapsed.TotalSeconds < 10) { Assert.Equal(0, d2.Read(buf, 960)); Thread.Sleep(20); }   // silence (0 frames), never an exception
        Assert.True(d2.Reconnects >= 1 || d2.Error != null);
    }
}
