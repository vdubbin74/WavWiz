using WavWiz.Sim.Harness;
using Xunit.Abstractions;

namespace WavWiz.Sim;

public class BluetoothAndResyncTests
{
    private readonly ITestOutputHelper _out;
    public BluetoothAndResyncTests(ITestOutputHelper o) { _out = o; }

    private static PlayerConfig Wired(string name, int seed, double skew, double cardSkew, long start) => new()
    {
        Name = name, Clock = new VirtualClock { OffsetUs = seed * 1_000_000_007L, SkewPpm = skew }, CardSkewPpm = cardSkew,
        Down = new Link(seed) { BaseUs = 400 }, PingUp = new Link(seed + 100), PingDown = new Link(seed + 200), StartAtUs = start,
    };

    private static PlayerConfig Bt(string name, int seed, long hiddenUs, double? savedMs) => new()
    {
        Name = name, Clock = new VirtualClock { OffsetUs = -seed * 999_999_937L, SkewPpm = 21 }, CardSkewPpm = -30,
        HiddenLatencyUs = hiddenUs, SavedLatencyMs = savedMs, ReportedLatencyUs = 20_000,
        Down = new Link(seed) { BaseUs = 2000, JitterMeanUs = 1500, LossProb = 0.01 }, PingUp = new Link(seed + 100) { BaseUs = 2000, JitterMeanUs = 1500 },
        PingDown = new Link(seed + 200) { BaseUs = 2000, JitterMeanUs = 1500 }, StartAtUs = 1_000_000,
    };

    private (SimKernel k, SimServer s) World() { var k = new SimKernel(); return (k, new SimServer(k)); }

    private SyncAnalysis.PairStats Run(double? savedMs, long hiddenUs, out SimPlayer bt, out SimPlayer wired)
    {
        var (k, server) = World();
        wired = new SimPlayer(k, server, Wired("toslink-ref", 1, 40, 10, 1_000_000));
        bt = new SimPlayer(k, server, Bt("bt-speaker", 2, hiddenUs, savedMs));
        k.At(500_000, () => server.Stream.Play(new RampSource(), 3_000_000));
        k.RunUntil(600_000_000L);
        return SyncAnalysis.Compare(bt, wired, 60_000_000, 48000.0 * 90, 48000.0 * 590);
    }

    [Fact]
    public void Calibrated_Bluetooth_speaker_with_187ms_hidden_delay_lines_up_with_the_wired_reference()
    {
        var s = Run(187, 187_000, out _, out _);
        _out.WriteLine($"calibrated 187/187: mean={s.MeanMs:F3} max={s.MaxAbsMs:F3}");
        Assert.True(s.MaxAbsMs <= 5.0, $"max {s.MaxAbsMs:F3} ms");
    }

    [Fact]
    public void Uncalibrated_unknown_delay_is_audibly_off_which_is_why_it_is_flagged_not_calibrated_never_silently_zero()
    {
        // negative control: proves the harness can see an offset, and documents why unknown Bluetooth gets a flagged default, not 0.
        var off = Run(null, 187_000, out _, out _);
        Assert.InRange(off.MeanMs, 180, 195);                       // the full hidden delay is heard as an echo
        var guess = Run(200, 187_000, out _, out _);                // D9: a guessed 200 ms default is much closer
        _out.WriteLine($"no offset: mean={off.MeanMs:F1} ms; default guess 200 vs real 187: mean={guess.MeanMs:F1} ms");
        Assert.InRange(guess.MeanMs, -16, -10);                     // we over-feed by 13 ms: speaker plays 13 ms EARLY
    }

    [Fact]
    public void Output_switch_with_a_different_saved_offset_hard_resyncs_once_and_converges()
    {
        var (k, server) = World();
        var wired = new SimPlayer(k, server, Wired("toslink-ref", 1, 40, 10, 1_000_000));
        var cfg = Bt("bt", 2, 150_000, 150);
        var bt = new SimPlayer(k, server, cfg);
        k.At(500_000, () => server.Stream.Play(new RampSource(), 3_000_000));
        k.RunUntil(200_000_000L);
        bt.Engine.SetDeviceLatencyMs(240);                       // user re-calibrates / edits the ms box while playing: +90 ms
        k.At(210_000_000L, () => { });
        k.RunUntil(260_000_000L);
        Assert.Equal(1, bt.Engine.HardResyncs);                  // large change -> fade, jump, fade (not a long smear)
        // speaker still has 150 ms hidden delay but now we feed 240 ms early -> 90 ms EARLY; set it back and check it re-converges
        bt.Engine.SetDeviceLatencyMs(150);
        k.RunUntil(400_000_000L);
        var s = SyncAnalysis.Compare(bt, wired, 340_000_000, 48000.0 * 345, 48000.0 * 395);
        _out.WriteLine($"after switching back: mean={s.MeanMs:F3} max={s.MaxAbsMs:F3} resyncs={bt.Engine.HardResyncs}");
        Assert.True(s.MaxAbsMs <= 5.0, $"max {s.MaxAbsMs:F3}");
    }

    [Fact]
    public void A_zone_enabled_mid_song_joins_at_the_current_position_and_is_in_sync_after_the_lead_time()
    {
        var (k, server) = World();
        var a = new SimPlayer(k, server, Wired("a", 1, 10, 5, 1_000_000));
        var late = new SimPlayer(k, server, Wired("late", 3, -60, -20, 100_000_000));   // joins 100 s into the song
        k.At(500_000, () => server.Stream.Play(new RampSource(), 3_000_000));
        k.RunUntil(300_000_000L);
        var s = SyncAnalysis.Compare(late, a, 130_000_000, 48000.0 * 135, 48000.0 * 295);
        _out.WriteLine($"late join: points={s.Points} max={s.MaxAbsMs:F3}");
        Assert.True(s.Points > 100);
        Assert.True(s.MaxAbsMs <= 2.0);
    }

    [Fact]
    public void Output_samples_really_are_the_stream_samples_at_the_reported_position()
    {
        var (k, server) = World();
        var a = new SimPlayer(k, server, Wired("a", 1, 70, -35, 1_000_000));
        k.At(500_000, () => server.Stream.Play(new RampSource(), 3_000_000));
        k.RunUntil(120_000_000L);
        int checkedBlocks = 0;
        foreach (var b in a.Log.Where(b => b.Clean && b.AudibleTrueUs > 30_000_000))
        {
            double pos = b.StartPos % RampSource.Mod;
            if (pos > RampSource.Mod - 10) continue; // wrap
            Assert.Equal(pos / RampSource.Mod, b.FirstValue, 1e-5);      // 24-bit wire quantisation + Hermite on a ramp
            checkedBlocks++;
        }
        Assert.True(checkedBlocks > 1000);
    }
}
