using WavWiz.Core.Playback;
using WavWiz.Sim.Harness;
using Xunit.Abstractions;

namespace WavWiz.Sim;

/// <summary>Spec 18.2 scenarios: outages, sleep/resume, DSP latency, radio stall. Asserts the 17 targets with simulated numbers.</summary>
public class ResilienceTests
{
    private readonly ITestOutputHelper _out;
    public ResilienceTests(ITestOutputHelper o) { _out = o; }
    private const long S = 1_000_000;

    private static PlayerConfig Cfg(string name, int seed, double skew, double card, bool wifi, long start = S, IAudioProcessor? proc = null, long procTrue = 0) => new()
    {
        Name = name, Clock = new VirtualClock { OffsetUs = seed * 1_234_567_891L, SkewPpm = skew }, CardSkewPpm = card,
        Down = new Link(seed) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2500 : 150, LossProb = wifi ? 0.01 : 0 },
        PingUp = new Link(seed + 100) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2000 : 100 }, PingDown = new Link(seed + 200) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2000 : 100 },
        BufferDepthMs = wifi ? 4000 : 3000, StartAtUs = start, Processor = proc, ProcessorTrueLatencyUs = procTrue,
    };

    private static void Outage(PlayerConfig c, long fromS, long toS)
    {
        c.Down!.Outages.Add((fromS * S, toS * S)); c.PingUp!.Outages.Add((fromS * S, toS * S)); c.PingDown!.Outages.Add((fromS * S, toS * S));
    }

    private (SimKernel k, SimServer srv) World() { var k = new SimKernel(); return (k, new SimServer(k)); }

    [Theory]
    [InlineData(2, 0, true)]       // M5: 2 s outage -> no audible gap
    [InlineData(30, 1, false)]     // 30 s -> fades out, rejoins quickly, back in sync; other zone unaffected
    [InlineData(300, 1, false)]    // 5 min
    public void Wifi_outage(int outageS, int _, bool noGapExpected)
    {
        var (k, srv) = World();
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var wcfg = Cfg("wifi", 2, -40, 25, true);
        Outage(wcfg, 100, 100 + outageS);
        var wifi = new SimPlayer(k, srv, wcfg);
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S));
        long end = (100 + outageS + 120) * S;
        k.RunUntil(end);
        int wiredUnder = wired.Engine.Underruns, wifiUnder = wifi.Engine.Underruns;
        long okFrom = (100 + outageS + 5) * S;   // "rejoins <= 5 s after the network returns"
        var st = SyncAnalysis.Compare(wifi, wired, okFrom, 48000.0 * (100 + outageS + 6), 48000.0 * (100 + outageS + 115));
        _out.WriteLine($"outage {outageS}s: wifi underruns={wifiUnder} wired underruns={wiredUnder} resyncs wifi={wifi.Engine.HardResyncs} after: max={st.MaxAbsMs:F3} ms points={st.Points}");
        Assert.Equal(0, wiredUnder); Assert.Equal(0, wired.Engine.HardResyncs);       // other zone unaffected
        if (noGapExpected) Assert.Equal(0, wifiUnder); else Assert.True(wifiUnder > 0);
        Assert.True(st.Points > 100);
        Assert.True(st.MaxAbsMs <= 5.0, $"max {st.MaxAbsMs:F3}");
        // while the outage lasted beyond the buffer the zone was silent (faded), not looping or stuttering
        if (!noGapExpected)
        {
            var silent = wifi.Log.Count(b => !b.Clean && b.AudibleTrueUs > (100 + 8) * S && b.AudibleTrueUs < (100 + outageS - 1) * S);
            Assert.True(silent > outageS * 50, $"silent blocks {silent}");
        }
    }

    [Fact]
    public void Sleep_and_resume_laptop_is_back_in_sync_within_10_seconds_and_the_house_stream_never_stops()
    {
        var (k, srv) = World();
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var laptop = new SimPlayer(k, srv, Cfg("laptop", 2, 55, -25, true));
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S));
        k.At(100 * S, () => laptop.Disconnect());                 // lid closed
        k.At(700 * S, () => laptop.Connect());                    // 10 minutes later
        k.RunUntil(900 * S);
        var st = SyncAnalysis.Compare(laptop, wired, 710 * S, 48000.0 * 711, 48000.0 * 895);
        var first = laptop.Log.First(b => b.Clean && b.AudibleTrueUs > 700 * S);
        _out.WriteLine($"resume: first clean audio {(first.AudibleTrueUs - 700 * S) / 1e6:F2} s after resume; max offset after {st.MaxAbsMs:F3} ms");
        Assert.True((first.AudibleTrueUs - 700 * S) < 10 * S);
        Assert.True(st.Points > 100); Assert.True(st.MaxAbsMs <= 5.0);
        Assert.Equal(0, wired.Engine.Underruns);
        Assert.True(first.StartPos > 48000.0 * 690, "rejoined at the CURRENT timeline position, did not resume where it stopped");
    }

    [Fact]
    public void Dsp_block_with_reported_latency_keeps_sync_and_an_unreported_latency_would_not()
    {
        var (k, srv) = World();
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var dsp = new SimPlayer(k, srv, Cfg("fir", 2, -20, 15, false, proc: new DelayProcessor(240, 5000), procTrue: 5000));       // 5 ms, reported
        var liar = new SimPlayer(k, srv, Cfg("liar", 3, 10, 0, false, proc: new DelayProcessor(240, 0), procTrue: 5000));          // 5 ms, NOT reported
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S));
        k.RunUntil(300 * S);
        var ok = SyncAnalysis.Compare(dsp, wired, 60 * S, 48000.0 * 65, 48000.0 * 295);
        var bad = SyncAnalysis.Compare(liar, wired, 60 * S, 48000.0 * 65, 48000.0 * 295);
        _out.WriteLine($"reported: max={ok.MaxAbsMs:F3} ms; unreported: mean={bad.MeanMs:F3} ms");
        Assert.True(ok.MaxAbsMs <= 2.0);
        Assert.InRange(bad.MeanMs, 4.5, 5.5);
    }

    [Fact]
    public void Editing_a_preset_so_that_the_chain_latency_changes_while_playing_converges_without_a_hard_resync()
    {
        var (k, srv) = World();
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var p = new SimPlayer(k, srv, Cfg("p", 2, -20, 15, false, proc: new DelayProcessor(0, 0)));
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S));
        k.RunUntil(100 * S);
        p.Engine.SetProcessor(new DelayProcessor(480, 10_000)); p.ProcessorTrueLatencyUs = 10_000;   // a latency-bearing block gets switched on: +10 ms
        k.RunUntil(400 * S);
        var st = SyncAnalysis.Compare(p, wired, 250 * S, 48000.0 * 255, 48000.0 * 395);
        _out.WriteLine($"after +10 ms DSP latency: max={st.MaxAbsMs:F3} resyncs={p.Engine.HardResyncs}");
        Assert.Equal(0, p.Engine.HardResyncs);
        Assert.True(st.MaxAbsMs <= 2.0);
    }

    [Fact]
    public void Radio_stall_keeps_the_timeline_moving_so_every_zone_is_back_in_sync_when_audio_resumes()
    {
        var (k, srv) = World();
        var a = new SimPlayer(k, srv, Cfg("a", 1, 30, 8, false));
        var b = new SimPlayer(k, srv, Cfg("b", 2, -20, 15, true));
        var src = new StallableSource(new RampSource(), () => k.TrueNowUs is > 100 * S and < 110 * S);   // stream stops delivering for 10 s
        k.At(500_000, () => srv.Stream.Play(src, 3 * S));
        k.RunUntil(300 * S);
        var st = SyncAnalysis.Compare(a, b, 130 * S, 48000.0 * 135, 48000.0 * 295);
        _out.WriteLine($"radio stall: max={st.MaxAbsMs:F3} resyncs a={a.Engine.HardResyncs} b={b.Engine.HardResyncs}");
        Assert.True(st.Points > 100); Assert.True(st.MaxAbsMs <= 2.0);
        Assert.Equal(0, a.Engine.HardResyncs + b.Engine.HardResyncs);
    }

    [Fact]
    public void Stop_at_fades_every_zone_out_at_the_same_instant()
    {
        var (k, srv) = World();
        var a = new SimPlayer(k, srv, Cfg("a", 1, 30, 8, false));
        var b = new SimPlayer(k, srv, Cfg("b", 2, -20, 15, true));
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S));
        k.At(60 * S, () => srv.Stream.Stop(600_000));
        k.RunUntil(80 * S);
        double lastA = a.Log.Where(x => x.Clean).Max(x => x.AudibleTrueUs), lastB = b.Log.Where(x => x.Clean).Max(x => x.AudibleTrueUs);
        _out.WriteLine($"last clean audio a={lastA / 1e6:F3}s b={lastB / 1e6:F3}s");
        Assert.InRange(Math.Abs(lastA - lastB) / 1000.0, 0, 30);   // within one block (10-20 ms) of each other
        Assert.True(lastA > 60.4 * S && lastA < 61.2 * S);          // pause = silence <= ~1 s after pressing (M4)
    }
}
