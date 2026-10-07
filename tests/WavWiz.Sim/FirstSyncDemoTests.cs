using WavWiz.Core.Clock;
using WavWiz.Core.Stream;
using WavWiz.Sim.Harness;
using Xunit.Abstractions;

namespace WavWiz.Sim;

/// <summary>Milestone 1 demo: the real StreamEngine + ClockModel + PlaybackEngine + wire codec, in virtual time (spec 18.2).</summary>
public class FirstSyncDemoTests
{
    private readonly ITestOutputHelper _out;
    public FirstSyncDemoTests(ITestOutputHelper o) { _out = o; }

    private static Link Tcp(int seed, long baseUs = 400, double jitter = 150, double loss = 0) => new(seed) { BaseUs = baseUs, JitterMeanUs = jitter, LossProb = loss };
    private static Link Udp(int seed, long baseUs = 400, double jitter = 150, double loss = 0) => new(seed) { BaseUs = baseUs, JitterMeanUs = jitter, LossProb = loss };

    [Fact]
    public void Three_players_with_different_clock_skews_and_a_Wifi_laptop_stay_within_5_ms_for_one_hour()
    {
        var k = new SimKernel();
        var server = new SimServer(k);
        var p1 = new SimPlayer(k, server, new PlayerConfig // desktop PC, Toslink reference, Ethernet
        {
            Name = "desktop-pc", Clock = new VirtualClock { OffsetUs = 123_456_789, SkewPpm = 37 }, CardSkewPpm = 12,
            Down = Tcp(1), PingUp = Udp(2), PingDown = Udp(3), StartAtUs = 1_000_000,
        });
        var p2 = new SimPlayer(k, server, new PlayerConfig // server PC, other direction of skew, slower driver pipeline
        {
            Name = "media-pc", Clock = new VirtualClock { OffsetUs = -987_654_321, SkewPpm = -80, WanderUs = 300 }, CardSkewPpm = -45,
            ReportedLatencyUs = 35_000, Down = Tcp(4), PingUp = Udp(5), PingDown = Udp(6), StartAtUs = 1_200_000,
        });
        var p3 = new SimPlayer(k, server, new PlayerConfig // laptop: Wi-Fi, 44.1 kHz mix format, jittery
        {
            Name = "laptop", Clock = new VirtualClock { OffsetUs = 5_000_000_000, SkewPpm = 55, WanderUs = 800 }, CardSkewPpm = 90,
            OutputRate = 44100, PeriodFrames = 441, BufferDepthMs = 4000,
            Down = Tcp(7, 2500, 3000, 0.02), PingUp = Udp(8, 2500, 2500, 0.05), PingDown = Udp(9, 2500, 2500, 0.05), StartAtUs = 1_500_000,
        });

        k.At(500_000, () => server.Stream.Play(new RampSource(), leadUs: 3_000_000)); // players join (and clock-sync) before the epoch starts
        k.RunUntil(3_600_000_000L); // one hour of virtual time

        long settle = 120_000_000; // ignore the first 2 minutes of audible time
        double from = 3 * 48000.0 * 40; // stream sample ~2 min in
        double to = 3_590 * 48000.0;
        var pairs = new[] { SyncAnalysis.Compare(p1, p2, settle, from, to), SyncAnalysis.Compare(p1, p3, settle, from, to), SyncAnalysis.Compare(p2, p3, settle, from, to) };
        foreach (var s in pairs) _out.WriteLine($"{s.A} vs {s.B}: points={s.Points} mean={s.MeanMs:F3} ms  max|.|={s.MaxAbsMs:F3} ms  p95={s.P95AbsMs:F3} ms");
        foreach (var p in new[] { p1, p2, p3 }) _out.WriteLine($"{p.Id}: skew est={p.Clock.SkewPpm:F1} ppm underruns={p.Engine.Underruns} hardResyncs={p.Engine.HardResyncs} ratio={p.Engine.RatioPpm:F0} ppm err={p.Engine.ErrorMs:F3} ms");

        foreach (var s in pairs) { Assert.True(s.Points > 3000, $"{s.A}/{s.B} only {s.Points} comparable points"); Assert.True(s.MaxAbsMs <= 5.0, $"{s.A} vs {s.B} max {s.MaxAbsMs:F3} ms"); }
        Assert.True(pairs[0].MaxAbsMs <= 2.0, "two Ethernet players should be within 2 ms");
        Assert.All(new[] { p1, p2, p3 }, p => { Assert.Equal(0, p.Engine.HardResyncs); });
    }
}
