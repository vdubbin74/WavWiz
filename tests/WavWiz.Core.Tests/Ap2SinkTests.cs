using System.Net;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 stage 10: the house stream into an AirPlay 2 speaker (Ap2Sink), both modes, plus the quirk table.
/// Live part needs WW_AIRPLAY2_BENCH + WW_AIRPLAY2_LOCAL; the receiver's pipe is judged by pcmmon (1 kHz, pause, 440 Hz).</summary>
public class Ap2SinkTests
{
    [Fact]
    public void Quirks_match_model_prefix_and_default()
    {
        Assert.Equal("Sonos (Era 100 etc.)", AirPlayQuirks.For("Sonos Era 100").Label);
        Assert.Same(AirPlayQuirks.Default, AirPlayQuirks.For(null));
        Assert.Same(AirPlayQuirks.Default, AirPlayQuirks.For("Unknown9,1"));
        Assert.All(AirPlayQuirks.FirewallRules, r => Assert.Contains("profile=private", r));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Live_house_stream_play_pause_seek(bool buffered)
    {
        var bench = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH"); var local = Environment.GetEnvironmentVariable("WW_AIRPLAY2_LOCAL");
        var ff = File.Exists("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : null;
        if (bench == null || local == null || (buffered && ff == null)) return;
        using var ptp = new PtpMaster(IPAddress.Parse(local)); ptp.Start();
        await using var s = new Ap2Session(new Ap2Options { Endpoint = IPEndPoint.Parse(bench), Buffered = buffered, VolumeDb = -15 }, ptp);
        await s.ConnectAsync();
        var clock = new StopwatchClock();
        await using var sink = new Ap2Sink("airplay:bench", s, ptp, clock, buffered, ff) { Log = m => Console.WriteLine("sink: " + m) };
        await sink.StartAsync();
        var log = new List<string>(); void Mark(string m) { lock (log) log.Add($"{DateTime.Now:HH:mm:ss.fff} {m}"); }
        // epoch 1: 1 kHz for 8 s; STOP_AT (pause) for 3 s; epoch 2: 440 Hz for 8 s (seek)
        long t0 = clock.NowUs + 3_000_000;
        Mark($"{(buffered ? "buffered" : "realtime")} epoch1 1kHz plays from +3s");
        var feed = Feed(sink, clock, 1, t0, 600, 1000);
        while (clock.NowUs < t0 + 4_000_000) await Task.Delay(20);
        sink.Send(Wire.EncodeStopAt(3, 1, t0 + 7_000_000)); Mark("stop_at (pause) at 7 s of 12 s; 3 s silence expected");
        await feed;
        long t1 = clock.NowUs + 1_500_000;
        sink.Send(Wire.EncodeEpoch(2, 2, t1)); Mark("epoch2 440 Hz plays from +1.5s");
        await Feed(sink, clock, 2, t1, 400, 440);
        await Task.Delay(3000);
        Mark($"packets={sink.Packets} flushes={sink.Flushes} segments={sink.Segments} announces={sink.Announces} feedbacks={s.Feedbacks}");
        try { await s.TeardownAsync(); } catch { }
        var outDir = Environment.GetEnvironmentVariable("WW_AIRPLAY_OUT");
        if (outDir != null) File.WriteAllLines(Path.Combine(outDir, $"s10-sink-{(buffered ? "buffered" : "realtime")}.txt"), log);
        Assert.True(sink.Packets > 100); Assert.True(sink.Flushes >= 1);
    }

    /// <summary>Sends 20 ms house frames of a tone, about 2.5 s ahead of their play time (like the conductor).</summary>
    static async Task Feed(Ap2Sink k, IMonotonicClock c, uint epoch, long start, int frames, double hz, long until = 0)
    {
        if (frames == 0) { while (c.NowUs < until) await Task.Delay(20); return; }
        if (epoch == 1) k.Send(Wire.EncodeEpoch(1, 1, start));
        var f = new float[960 * 2]; long n0 = 0;
        for (int n = 0; n < frames; n++)
        {
            long at = start + n * 20_000L;
            while (at - c.NowUs > 2_500_000) await Task.Delay(5);
            for (int i = 0; i < 960; i++, n0++) { float v = (float)(0.3 * Math.Sin(2 * Math.PI * hz * n0 / 48000.0)); f[2 * i] = v; f[2 * i + 1] = v; }
            k.Send(Wire.EncodeAudio((uint)n, at, epoch, f));
        }
        while (c.NowUs < start + frames * 20_000L) await Task.Delay(20);
    }
}
