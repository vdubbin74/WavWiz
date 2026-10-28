using System.Net;
using System.Net.Sockets;
using System.Text;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 stage 6: AirPlaySink (house stream -> RAOP) against an in-process fake RAOP receiver that applies the
/// RAOP sync rule (sync field 1 plays at the sync NTP time) to predict when each sample would be heard.</summary>
public class AirPlaySinkTests
{
    /// <summary>Minimal RAOP receiver: answers RTSP 200, records audio and sync packets with arrival times.</summary>
    sealed class FakeRaop : IDisposable
    {
        public readonly TcpListener Tcp = new(IPAddress.Loopback, 0);
        public readonly UdpClient Audio = new(new IPEndPoint(IPAddress.Loopback, 0)), Control = new(new IPEndPoint(IPAddress.Loopback, 0));
        public readonly List<byte[]> AudioPk = new(), Syncs = new(); public readonly List<string> Methods = new();
        readonly CancellationTokenSource _cts = new();
        public IPEndPoint Ep => (IPEndPoint)Tcp.LocalEndpoint;
        public FakeRaop()
        {
            Tcp.Start();
            _ = Task.Run(async () =>
            {
                using var c = await Tcp.AcceptTcpClientAsync(_cts.Token); var s = c.GetStream(); var r = new StreamReader(s, Encoding.ASCII);
                while (!_cts.IsCancellationRequested)
                {
                    var first = await r.ReadLineAsync(); if (first == null) return;
                    string? cseq = null; int len = 0; string? l;
                    while (!string.IsNullOrEmpty(l = await r.ReadLineAsync()))
                    { if (l.StartsWith("CSeq:")) cseq = l[5..].Trim(); if (l.StartsWith("Content-Length:")) len = int.Parse(l[15..]); }
                    if (len > 0) { var b = new char[len]; int g = 0; while (g < len) g += await r.ReadAsync(b, g, len - g); }
                    var m = first.Split(' ')[0]; lock (Methods) Methods.Add(m);
                    var extra = m == "SETUP" ? $"Transport: RTP/AVP/UDP;unicast;mode=record;server_port={((IPEndPoint)Audio.Client.LocalEndPoint!).Port};control_port={((IPEndPoint)Control.Client.LocalEndPoint!).Port};timing_port=9\r\nSession: 7\r\n" : "";
                    var resp = Encoding.ASCII.GetBytes($"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n{extra}\r\n");
                    await s.WriteAsync(resp);
                }
            });
            _ = Task.Run(async () => { while (true) { var x = await Audio.ReceiveAsync(_cts.Token); lock (AudioPk) AudioPk.Add(x.Buffer); } });
            _ = Task.Run(async () => { while (true) { var x = await Control.ReceiveAsync(_cts.Token); if ((x.Buffer[1] & 0x7F) == 0x54) lock (Syncs) Syncs.Add(x.Buffer); } });
        }
        /// <summary>Predicted NTP play time (unix us) of rtp, from the latest sync packet.</summary>
        public long PlayUnixUs(uint rtp)
        {
            byte[] sy; lock (Syncs) sy = Syncs[^1];
            uint playing = Rtp.Rd32(sy, 4); ulong ntp = Rtp.Rd64(sy, 8);
            long ntpUnixUs = (long)((ntp >> 32) - 2208988800UL) * 1_000_000 + (long)((ntp & 0xFFFFFFFF) * 1_000_000 >> 32);
            return ntpUnixUs + (long)((int)(rtp - playing) / 0.0441);
        }
        public void Dispose() { _cts.Cancel(); Tcp.Stop(); Audio.Dispose(); Control.Dispose(); }
    }

    static long UnixUs() => (DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks) / 10;

    /// <summary>Feeds an epoch with a click at frame 50 (1.0 s after epoch start) and returns the predicted error (us) per receiver.</summary>
    static async Task<long[]> RunClick(int[] delays)
    {
        var clock = new StopwatchClock();
        var fakes = delays.Select(_ => new FakeRaop()).ToArray();
        var sinks = new List<AirPlaySink>(); var sessions = new List<RaopSession>();
        try
        {
            for (int i = 0; i < fakes.Length; i++)
            {
                var s = new RaopSession(); sessions.Add(s);
                await s.ConnectAsync(fakes[i].Ep); await s.StartAsync(10, 1000);
                var k = new AirPlaySink("airplay:test" + i, s, clock, 10, 1000) { DelayMs = delays[i], SendAheadMs = 1500 };
                sinks.Add(k); k.Start();
            }
            long start = clock.NowUs + 600_000; long offset = UnixUs() - clock.NowUs; // monotonic -> unix
            foreach (var k in sinks) k.Send(Wire.EncodeEpoch(1, 1, start));
            var frame = new float[960 * 2];
            for (int n = 0; n < 150; n++)
            {
                Array.Clear(frame);
                if (n == 50) { frame[0] = 0.9f; frame[1] = 0.9f; }
                var msg = Wire.EncodeAudio((uint)n, start + n * 20_000L, 1, frame);
                foreach (var k in sinks) k.Send(msg);
            }
            await Task.Delay(2400);
            var err = new long[fakes.Length];
            for (int i = 0; i < fakes.Length; i++)
            {
                uint clickRtp = 0; bool found = false;
                lock (fakes[i].AudioPk)
                    foreach (var pk in fakes[i].AudioPk)
                    {
                        var pcm = AlacRaw.Decode(pk.AsSpan(12), 352);
                        int best = -1; for (int j = 0; j < 352; j++) if (Math.Abs((int)pcm[j * 2]) > 12000) { best = j; break; }
                        if (best >= 0) { clickRtp = Rtp.Rd32(pk, 4) + (uint)best; found = true; break; }
                    }
                Assert.True(found, "click not received");
                long expected = start + 50 * 20_000L + offset - delays[i] * 1000L; // sink sends early by the speaker's delay
                err[i] = fakes[i].PlayUnixUs(clickRtp) - expected;
            }
            return err;
        }
        finally
        {
            foreach (var k in sinks) await k.DisposeAsync();
            foreach (var s in sessions) await s.DisposeAsync();
            foreach (var f in fakes) f.Dispose();
        }
    }

    [Fact]
    public async Task Click_lands_on_schedule_and_two_speakers_agree()
    {
        var err = await RunClick(new[] { 0, 0 });
        foreach (var e in err) Assert.InRange(e, -2000, 2000);       // within 2 ms of the house schedule (resampler ~0.25 ms)
        Assert.InRange(Math.Abs(err[0] - err[1]), 0, 1000);
    }

    [Fact]
    public async Task Speaker_delay_is_compensated()
    {
        var err = await RunClick(new[] { 120 });
        Assert.InRange(err[0], -2000, 2000);
    }

    [Fact]
    public void Resampler_keeps_tone_and_is_seamless()
    {
        var rs = new Resampler48To44(); var all = new List<short>();
        var inb = new float[960 * 2]; long n = 0; var outb = new short[882 * 2];
        for (int f = 0; f < 20; f++)
        {
            for (int i = 0; i < 960; i++, n++) { float v = (float)(0.5 * Math.Sin(2 * Math.PI * 1000 * n / 48000.0)); inb[2 * i] = v; inb[2 * i + 1] = v; }
            rs.Process(inb, outb); for (int i = 0; i < 882; i++) all.Add(outb[2 * i]);
        }
        var tail = all.Skip(882).ToArray();
        double maxStep = 2 * Math.PI * 1000 / 44100 * 0.5 * 32767 * 1.05;
        for (int i = 1; i < tail.Length; i++) Assert.True(Math.Abs(tail[i] - tail[i - 1]) <= maxStep, $"step at {i}");
        double rms = Math.Sqrt(tail.Average(x => (double)x * x)); Assert.InRange(rms, 0.5 * 32767 / Math.Sqrt(2) * 0.97, 0.5 * 32767 / Math.Sqrt(2) * 1.03);
        int zc = 0; for (int i = 1; i < tail.Length; i++) if ((tail[i - 1] < 0) != (tail[i] < 0)) zc++;
        Assert.InRange(zc / 2.0 / (tail.Length / 44100.0), 995, 1005);
    }
}
