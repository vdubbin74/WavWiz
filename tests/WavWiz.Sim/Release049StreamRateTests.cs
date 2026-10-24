using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;
using WavWiz.Sim.Harness;
using Xunit.Abstractions;

namespace WavWiz.Sim;

/// <summary>0.4.9 F77: Streaming quality. The house stream at 48 kHz (Studio) and 96 kHz (Studio Max), and a zone that mixes a 96 kHz player with
/// one that falls back to the server's 48 kHz copy: they must stay in sync because every rate maps onto the same server-time timeline.</summary>
public class Release049StreamRateTests
{
    private readonly ITestOutputHelper _out;
    public Release049StreamRateTests(ITestOutputHelper o) { _out = o; }
    private static Link L(int seed, long baseUs = 400, double jitter = 150) => new(seed) { BaseUs = baseUs, JitterMeanUs = jitter };

    private (SimPlayer A, SimPlayer B, SimServer S) Run(int houseRate, int aMax, int aOut, int bMax, int bOut, long minutes = 10)
    {
        var k = new SimKernel(); var server = new SimServer(k);
        var a = new SimPlayer(k, server, new PlayerConfig { Name = "a", MaxRate = aMax, OutputRate = aOut, PeriodFrames = aOut / 100, Clock = new VirtualClock { OffsetUs = 123_456, SkewPpm = 37 }, CardSkewPpm = 12, Down = L(1), PingUp = L(2), PingDown = L(3), StartAtUs = 1_000_000 });
        var b = new SimPlayer(k, server, new PlayerConfig { Name = "b", MaxRate = bMax, OutputRate = bOut, PeriodFrames = bOut / 100, Clock = new VirtualClock { OffsetUs = -987_654, SkewPpm = -80, WanderUs = 300 }, CardSkewPpm = -45, ReportedLatencyUs = 35_000, Down = L(4), PingUp = L(5), PingDown = L(6), StartAtUs = 1_200_000 });
        k.At(500_000, () => server.Stream.Play(new RampSource { Rate = houseRate }, leadUs: 3_000_000));
        k.RunUntil(minutes * 60_000_000L);
        return (a, b, server);
    }

    private SyncAnalysis.PairStats Check(SimPlayer a, SimPlayer b, long minutes)
    {
        var s = SyncAnalysis.CompareSec(a, a.Engine.StreamRate, b, b.Engine.StreamRate, 120_000_000, 125, minutes * 60 - 10);
        _out.WriteLine($"{a.Id}@{a.Engine.StreamRate} vs {b.Id}@{b.Engine.StreamRate}: points={s.Points} mean={s.MeanMs:F3} max={s.MaxAbsMs:F3} p95={s.P95AbsMs:F3} ms; hard={a.Engine.HardResyncs}/{b.Engine.HardResyncs} under={a.Engine.Underruns}/{b.Engine.Underruns}");
        Assert.True(s.Points > 300, $"only {s.Points} points");
        Assert.True(s.MaxAbsMs <= 2.0, $"max {s.MaxAbsMs:F3} ms");
        Assert.Equal(0, a.Engine.HardResyncs); Assert.Equal(0, b.Engine.HardResyncs);
        Assert.Equal(0, a.Engine.Underruns); Assert.Equal(0, b.Engine.Underruns);
        return s;
    }

    [Fact]
    public void Studio_48k_two_players_stay_in_sync()
    {
        var (a, b, s) = Run(48000, 96000, 48000, 48000, 44100);
        Assert.Equal(48000, s.Stream.Rate); Assert.Equal(48000, a.Engine.StreamRate); Assert.Equal(48000, b.Engine.StreamRate);
        Check(a, b, 10);
    }

    [Fact]
    public void Studio_Max_96k_two_players_stay_in_sync()
    {
        var (a, b, s) = Run(96000, 96000, 96000, 96000, 96000);
        Assert.Equal(96000, s.Stream.Rate); Assert.Equal(1920, s.Stream.FrameSamples);
        Assert.Equal(96000, a.Engine.StreamRate); Assert.Equal(96000, b.Engine.StreamRate);
        Check(a, b, 10);
    }

    [Fact]
    public void Studio_Max_with_a_48k_fallback_player_stays_in_sync_across_the_zone()
    {
        var (a, b, s) = Run(96000, 96000, 96000, 48000, 48000);
        Assert.Equal(96000, a.Engine.StreamRate); Assert.Equal(48000, b.Engine.StreamRate);   // b offered 48 kHz in HELLO: it gets the 48 kHz copy
        var st = Check(a, b, 10);
        Assert.True(Math.Abs(st.MeanMs) < 0.5, $"fallback copy is offset by {st.MeanMs:F3} ms");   // zero-delay decimator
    }

    [Fact]
    public void Fallback_player_on_a_44k1_device_still_syncs()
    {
        var (a, b, _) = Run(96000, 96000, 96000, 48000, 44100);
        Assert.Equal(48000, b.Engine.StreamRate);
        Check(a, b, 10);
    }
}

public class Release049StreamRateUnitTests
{
    [Fact]
    public void Epoch_is_12_bytes_at_48k_and_carries_the_rate_at_96k()
    {
        var m48 = Wire.EncodeEpoch(1, 7, 123, 48000); Assert.Equal(Wire.HeaderSize + 12, m48.Length);
        Assert.True(Wire.TryDecodeEpoch(m48.AsSpan(Wire.HeaderSize), out var e, out var st)); Assert.Equal(7u, e);        // an old player still reads it
        var m96 = Wire.EncodeEpoch(1, 7, 123, 96000); Assert.Equal(Wire.HeaderSize + 16, m96.Length);
        Assert.True(Wire.TryDecodeEpoch(m96.AsSpan(Wire.HeaderSize), out e, out st, out var r)); Assert.Equal((7u, 123L, 96000), (e, st, r));
        Assert.True(Wire.TryDecodeEpoch(m48.AsSpan(Wire.HeaderSize), out _, out _, out r)); Assert.Equal(48000, r);
        var bad = Wire.EncodeEpoch(1, 7, 123, 96000); bad[Wire.HeaderSize + 12] = 0x44; Assert.False(Wire.TryDecodeEpoch(bad.AsSpan(Wire.HeaderSize), out _, out _, out _));
        Assert.Equal(48000, Wire.NormalizeRate(44100)); Assert.Equal(96000, Wire.NormalizeRate(192000)); Assert.Equal(1920, Wire.FrameSamplesAt(96000));
    }

    private static double Tone(HalfbandDecimator d, double hz, out double phaseErr)
    {
        const int N = 1920; var outAll = new List<float>(); long n = 0;
        for (int f = 0; f < 20; f++)
        {
            var fr = new float[N * 2]; for (int i = 0; i < N; i++, n++) fr[2 * i] = fr[2 * i + 1] = (float)Math.Sin(2 * Math.PI * hz * n / 96000.0);
            if (d.Push(fr) is { } o) outAll.AddRange(o);
        }
        outAll.AddRange(d.Flush()!);
        double peak = 0; phaseErr = 0;
        for (int j = 4800; j < 14400; j++) { peak = Math.Max(peak, Math.Abs(outAll[2 * j])); phaseErr = Math.Max(phaseErr, Math.Abs(outAll[2 * j] - Math.Sin(2 * Math.PI * hz * j / 48000.0))); }
        return peak;
    }

    [Fact]
    public void Decimator_keeps_the_audio_band_with_zero_delay_and_removes_ultrasonics()
    {
        var p1k = Tone(new HalfbandDecimator(1920), 1000, out var err1k);
        Assert.InRange(p1k, 0.995, 1.005); Assert.True(err1k < 0.005, $"1 kHz differs from the ideal 48 kHz sine by {err1k}");   // same phase = zero delay
        var p30k = Tone(new HalfbandDecimator(1920), 30000, out _);
        Assert.True(20 * Math.Log10(p30k + 1e-12) < -60, $"30 kHz only down {20 * Math.Log10(p30k):F1} dB (would alias to 18 kHz)");
    }

    private sealed class Sub : IStreamSubscriber { public string Id { get; init; } = ""; public int BufferDepthMs => 1000; public int MaxRate { get; init; } = 48000; public List<byte[]> Got = new(); public void Send(byte[] m) => Got.Add(m); }
    private sealed class FakeClock : IMonotonicClock { public long NowUs { get; set; } }

    [Fact]
    public void Engine_sends_96k_frames_to_capable_players_and_48k_copies_to_the_rest_with_the_same_timing()
    {
        var clk = new FakeClock { NowUs = 1_000_000 }; var eng = new StreamEngine(clk);
        var hi = new Sub { Id = "hi", MaxRate = 96000 }; var lo = new Sub { Id = "lo" };
        eng.Subscribe(hi); eng.Subscribe(lo);
        eng.Play(new RampSource { Rate = 96000, TotalFrames = 96000 }, 100_000);
        for (int i = 0; i < 200; i++) { clk.NowUs += 10_000; eng.Pump(); }
        AudioFrame Dec(byte[] m) { Wire.TryReadHeader(m, out var h, out _); Assert.True(Wire.TryDecodeAudio(m.AsSpan(Wire.HeaderSize, (int)h.PayloadLen), out var f, out _)); return f!; }
        bool IsAudio(byte[] m) { Wire.TryReadHeader(m, out var h, out _); return h.Type == MsgType.Audio; }
        var fh = hi.Got.Where(IsAudio).Select(Dec).ToList(); var fl = lo.Got.Where(IsAudio).Select(Dec).ToList();
        Assert.Equal(50, fh.Count); Assert.Equal(50, fl.Count);                      // 1 s of audio, every frame (the last 48 kHz one flushed at the end)
        Assert.All(fh, f => Assert.Equal(1920, f.SampleCount)); Assert.All(fl, f => Assert.Equal(960, f.SampleCount));
        Assert.Equal(fh.Select(f => f.PlayAtUs), fl.Select(f => f.PlayAtUs));      // same timeline
        Wire.TryReadHeader(hi.Got[0], out var h0, out _); Assert.Equal(MsgType.Epoch, h0.Type); Assert.Equal(16u, h0.PayloadLen);
        Wire.TryReadHeader(lo.Got[0], out var h1, out _); Assert.Equal(12u, h1.PayloadLen);   // an old player's EPOCH is unchanged
    }
}
