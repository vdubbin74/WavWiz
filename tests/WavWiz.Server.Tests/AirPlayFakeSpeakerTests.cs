using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using WavWiz.Server.AirPlay;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
using Xunit;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#14: a tiny fake AirPlay 1 (RAOP) speaker on loopback - the setup test connects without joining a group, a refusal is classed
/// as "denied", and outgoing metadata (text, artwork clear, progress) goes out; a rejected kind is switched off without touching the session.</summary>
public class AirPlayFakeSpeakerTests
{
    sealed class FakeRaop : IDisposable
    {
        readonly TcpListener _l = new(IPAddress.Loopback, 0); readonly CancellationTokenSource _cts = new();
        public readonly ConcurrentQueue<(string Method, string? Type)> Got = new();
        public Func<string, string?, int> Status = (_, _) => 200;
        public int Port => ((IPEndPoint)_l.LocalEndpoint).Port;
        public FakeRaop() { _l.Start(); _ = Task.Run(Accept); }
        async Task Accept()
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient c; try { c = await _l.AcceptTcpClientAsync(_cts.Token); } catch { return; }
                _ = Task.Run(() => Serve(c));
            }
        }
        async Task Serve(TcpClient c)
        {
            using var _ = c; var s = c.GetStream(); var buf = new List<byte>(); var one = new byte[1];
            try
            {
                while (!_cts.IsCancellationRequested)
                {
                    buf.Clear();
                    while (!(buf.Count >= 4 && buf[^4] == 13 && buf[^3] == 10 && buf[^2] == 13 && buf[^1] == 10)) { if (await s.ReadAsync(one, _cts.Token) == 0) return; buf.Add(one[0]); }
                    var head = Encoding.ASCII.GetString(buf.ToArray()); var lines = head.Split("\r\n");
                    var method = lines[0].Split(' ')[0]; string? cseq = null, type = null; int len = 0;
                    foreach (var l in lines.Skip(1)) { var i = l.IndexOf(':'); if (i < 0) continue; var k = l[..i].Trim(); var v = l[(i + 1)..].Trim();
                        if (k.Equals("CSeq", StringComparison.OrdinalIgnoreCase)) cseq = v; if (k.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) type = v; if (k.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) len = int.Parse(v); }
                    var body = new byte[len]; int got = 0; while (got < len) { int n = await s.ReadAsync(body.AsMemory(got), _cts.Token); if (n == 0) return; got += n; }
                    Got.Enqueue((method, type));
                    int st = Status(method, type);
                    var sb = new StringBuilder($"RTSP/1.0 {st} {(st == 200 ? "OK" : st == 403 ? "Forbidden" : "Bad Request")}\r\nCSeq: {cseq}\r\nServer: AirTunes/105.1\r\n");
                    if (method == "SETUP") sb.Append("Transport: RTP/AVP/UDP;unicast;mode=record;server_port=6000;control_port=6001;timing_port=6002\r\nSession: 1\r\n");
                    if (method == "RECORD") sb.Append("Audio-Latency: 11025\r\n");
                    sb.Append("\r\n"); await s.WriteAsync(Encoding.ASCII.GetBytes(sb.ToString()), _cts.Token);
                }
            }
            catch { }
        }
        public void Dispose() { _cts.Cancel(); _l.Stop(); }
    }

    static NowPlaying Playing(long pos) => new("playing", 0, pos, 180_000, new QueueItem(7, "track", "/m/a.flac", "Song A", "Band", "Album", 180_000, null), null, null, false, "off", 1);

    [Fact]
    public async Task Setup_test_connects_without_joining_a_group_and_a_refusal_is_denied()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        using var fake = new FakeRaop();
        await using var outs = new AirPlayOutputs(S.Registry, () => null);
        var o = await outs.ConnectAsync("fake1", "127.0.0.1:" + fake.Port, 0, 50, default, subscribe: false);
        Assert.False(o.Subscribed);
        Assert.DoesNotContain(S.Registry.Subscribers(), x => x.Id == o.Sink.Id);
        Assert.True(await outs.TestToneAsync("fake1"));
        Assert.True(await outs.DisconnectAsync("fake1"));

        using var no = new FakeRaop { Status = (m, _) => m == "ANNOUNCE" ? 403 : 200 };
        var e = await Assert.ThrowsAnyAsync<Exception>(() => outs.ConnectAsync("fake2", "127.0.0.1:" + no.Port, 0, 50));
        Assert.Equal(AirPlaySetup.Denied, AirPlaySetup.Classify(e.Message, "TV").Code);
    }

    [Fact]
    public async Task Metadata_goes_out_on_start_and_a_rejected_kind_is_switched_off_without_dropping_the_speaker()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        using var fake = new FakeRaop { Status = (m, t) => m == "SET_PARAMETER" && t == "application/x-dmap-tagged" ? 400 : 200 };
        long pos = 1000;
        await using var outs = new AirPlayOutputs(S.Registry, () => null) { NowFor = _ => Playing(pos) };
        var o = await outs.ConnectAsync("fake3", "127.0.0.1:" + fake.Port, 0, 50);
        Assert.True(o.Subscribed);
        for (int i = 0; i < 40 && !fake.Got.Any(g => g.Type == "text/parameters" && g.Method == "SET_PARAMETER" && o.MetaSent >= 3); i++) await Task.Delay(100);
        var sets = fake.Got.Where(g => g.Method == "SET_PARAMETER").Select(g => g.Type).ToList();
        Assert.Contains("application/x-dmap-tagged", sets);
        Assert.Contains("image/none", sets);                  // no cover -> the old one is cleared
        Assert.Contains("text/parameters", sets);
        Assert.False(o.MetaText);                              // rejected once -> not sent again
        Assert.True(o.MetaArt); Assert.True(o.MetaProgress);
        Assert.True(outs.IsConnected("fake3"));                // the speaker stays connected
        int textBefore = fake.Got.Count(g => g.Type == "application/x-dmap-tagged");
        pos = 90_000; await Task.Delay(1600);                  // a seek -> progress again, never text
        Assert.Equal(textBefore, fake.Got.Count(g => g.Type == "application/x-dmap-tagged"));
        Assert.True(fake.Got.Count(g => g.Type == "text/parameters") >= 2);
    }

    [Fact]
    public async Task Metadata_for_radio_sends_artwork_not_image_none()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        using var fake = new FakeRaop();
        var logo = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
        var item = new QueueItem(1, "radio", "http://stream.example/x", "Springtime Chill", "Internet radio", "", 0, 12, null, null, "https://example.com/logo.png");
        var now = new NowPlaying("playing", 0, 0, 0, item, "Springtime Chill / Florito", null, false, "off", 1);
        await using var outs = new AirPlayOutputs(S.Registry, () => null)
        {
            NowFor = _ => now,
            ArtFor = (it, ct) => AirPlayArt.BytesAsync(it, (_, _) => Task.FromResult<byte[]?>(null), (_, _) => Task.FromResult<byte[]?>(logo), null, logo, ct),
        };
        var o = await outs.ConnectAsync("radio-tv", "127.0.0.1:" + fake.Port, 0, 50);
        Assert.True(o.Subscribed);
        for (int i = 0; i < 40 && !fake.Got.Any(g => g.Type == "image/png" && g.Method == "SET_PARAMETER"); i++) await Task.Delay(100);
        var sets = fake.Got.Where(g => g.Method == "SET_PARAMETER").Select(g => g.Type).ToList();
        Assert.Contains("application/x-dmap-tagged", sets);
        Assert.Contains("image/png", sets);
        Assert.DoesNotContain("image/none", sets);
    }
}
