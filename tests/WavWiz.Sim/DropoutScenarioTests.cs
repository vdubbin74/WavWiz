using WavWiz.Sim.Harness;
using Xunit.Abstractions;

namespace WavWiz.Sim;

/// <summary>0.0.2 Wi-Fi dropout scenarios: a Wi-Fi player that keeps losing and regaining the network. Simulated numbers - the real Wi-Fi is the field test.</summary>
public class DropoutScenarioTests
{
    private readonly ITestOutputHelper _out; public DropoutScenarioTests(ITestOutputHelper o) { _out = o; }
    private const long S = 1_000_000;

    private static PlayerConfig Cfg(string name, int seed, double skew, double card, bool wifi, long start = S) => new()
    {
        Name = name, Clock = new VirtualClock { OffsetUs = seed * 1_234_567_891L, SkewPpm = skew }, CardSkewPpm = card,
        Down = new Link(seed) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2500 : 150, LossProb = wifi ? 0.01 : 0 },
        PingUp = new Link(seed + 100) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2000 : 100 }, PingDown = new Link(seed + 200) { BaseUs = wifi ? 2500 : 400, JitterMeanUs = wifi ? 2000 : 100 },
        BufferDepthMs = wifi ? 4000 : 3000, StartAtUs = start,
    };
    private static void Outage(PlayerConfig c, long fromS, long toS) { c.Down!.Outages.Add((fromS * S, toS * S)); c.PingUp!.Outages.Add((fromS * S, toS * S)); c.PingDown!.Outages.Add((fromS * S, toS * S)); }

    [Fact]
    public void Wifi_that_flaps_six_times_a_minute_is_back_in_sync_after_the_last_flap_and_the_wired_room_never_notices()
    {
        var k = new SimKernel(); var srv = new SimServer(k);
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var wcfg = Cfg("wifi", 2, -40, 25, true); for (int i = 0; i < 6; i++) Outage(wcfg, 100 + i * 20, 100 + i * 20 + 6);      // 6 s gaps, 14 s apart
        var wifi = new SimPlayer(k, srv, wcfg);
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S)); k.RunUntil(300 * S);
        var st = SyncAnalysis.Compare(wifi, wired, 230 * S, 48000.0 * 232, 48000.0 * 295);
        _out.WriteLine($"flapping: wifi underruns={wifi.Engine.Underruns} events={wifi.Engine.UnderrunEvents} resyncs={wifi.Engine.HardResyncs}; after last flap max error {st.MaxAbsMs:F3} ms over {st.Points} points");
        Assert.Equal(0, wired.Engine.Underruns); Assert.Equal(0, wired.Engine.HardResyncs);
        Assert.True(wifi.Engine.UnderrunEvents >= 1, "the dropouts must be counted as events, not hidden"); Assert.True(wifi.Engine.UnderrunEvents <= 6 * 2, $"events {wifi.Engine.UnderrunEvents}: one per outage, not one per audio block");
        Assert.True(st.Points > 50); Assert.True(st.MaxAbsMs <= 5.0, $"max {st.MaxAbsMs:F3}");
    }

    [Fact]
    public void Short_blips_shorter_than_the_buffer_are_inaudible_zero_underruns_and_stay_in_sync()
    {
        var k = new SimKernel(); var srv = new SimServer(k);
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var wcfg = Cfg("wifi", 2, -40, 25, true); for (int i = 0; i < 8; i++) Outage(wcfg, 100 + i * 10, 100 + i * 10 + 2);
        var wifi = new SimPlayer(k, srv, wcfg);
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S)); k.RunUntil(240 * S);
        var st = SyncAnalysis.Compare(wifi, wired, 190 * S, 48000.0 * 192, 48000.0 * 235);
        _out.WriteLine($"blips: underruns={wifi.Engine.Underruns} events={wifi.Engine.UnderrunEvents} resyncs={wifi.Engine.HardResyncs} max={st.MaxAbsMs:F3}");
        Assert.Equal(0, wifi.Engine.Underruns); Assert.Equal(0, wifi.Engine.UnderrunEvents); Assert.True(st.MaxAbsMs <= 3.0, $"max {st.MaxAbsMs:F3}");
    }

    [Fact]
    public void A_long_outage_then_a_flap_straight_after_still_rebuffers_and_rejoins_in_sync()
    {
        var k = new SimKernel(); var srv = new SimServer(k);
        var wired = new SimPlayer(k, srv, Cfg("wired", 1, 30, 8, false));
        var wcfg = Cfg("wifi", 2, -40, 25, true); Outage(wcfg, 100, 160); Outage(wcfg, 168, 172);     // a minute off, a short return, off again
        var wifi = new SimPlayer(k, srv, wcfg);
        k.At(500_000, () => srv.Stream.Play(new RampSource(), 3 * S)); k.RunUntil(320 * S);
        var st = SyncAnalysis.Compare(wifi, wired, 185 * S, 48000.0 * 188, 48000.0 * 315);
        _out.WriteLine($"outage+flap: underruns={wifi.Engine.Underruns} events={wifi.Engine.UnderrunEvents} resyncs={wifi.Engine.HardResyncs} max={st.MaxAbsMs:F3}");
        Assert.True(wifi.Engine.UnderrunEvents >= 1); Assert.True(st.Points > 100); Assert.True(st.MaxAbsMs <= 5.0, $"max {st.MaxAbsMs:F3}"); Assert.Equal(0, wired.Engine.Underruns);
    }
}
