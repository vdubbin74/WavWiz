using WavWiz.Core.Clock;
namespace WavWiz.Core.Tests;

public class ClockModelTests
{
    [Fact]
    public void Offset_and_rtt_formulas_match_the_ntp_definition()
    {
        // server is 1000 us ahead; 200 us each way
        var (off, rtt) = ClockModel.Compute(t0: 10_000, t1: 10_000 + 1000 + 200, t2: 10_000 + 1000 + 200, t3: 10_400);
        Assert.Equal(1000, off, 1e-9); Assert.Equal(400, rtt);
    }

    [Theory]
    [InlineData(200)] [InlineData(-200)] [InlineData(0)]
    public void Skew_and_offset_are_recovered_from_jittery_asymmetric_lossy_pings_within_100us(double skewPpm)
    {
        var rng = new Random(5);
        var m = new ClockModel();
        long trueOffset0 = 3_000_000_000; // server - local at local=0
        long maxErr = 0;
        for (long t = 0; t < 120_000_000; t += 250_000)
        {
            if (rng.NextDouble() < 0.05) continue; // loss
            long up = 300 + (long)(-Math.Log(1 - rng.NextDouble()) * 800);   // asymmetric jitter
            long dn = 300 + (long)(-Math.Log(1 - rng.NextDouble()) * 100);
            long t0 = t;
            long serverAt(long local) => local + trueOffset0 + (long)(local * skewPpm * 1e-6);
            long t1 = serverAt(t0 + up), t2 = t1, t3 = t0 + up + dn;
            m.AddPong(t0, t1, t2, t3);
            if (t > 40_000_000) maxErr = Math.Max(maxErr, Math.Abs(m.ToServerUs(t3) - serverAt(t3)));
        }
        Assert.True(m.IsValid && m.HasSkewFit);
        Assert.InRange(m.SkewPpm, skewPpm - 5, skewPpm + 5);
        Assert.True(maxErr < 100 + 200, $"max error {maxErr} us");   // jitter floor: min-rtt filtering keeps this small
    }

    [Fact]
    public void Unknown_is_never_zero_conversion_before_any_sample_throws()
    {
        Assert.Throws<InvalidOperationException>(() => new ClockModel().ToServerUs(5));
    }

    [Fact]
    public void Conversions_round_trip()
    {
        var m = new ClockModel();
        for (int i = 0; i < 40; i++) { long t = i * 500_000L; m.AddSample(t, 5_000_000 + i * 20, 400); }
        long local = 123_456_789;
        Assert.InRange(m.ToLocalUs(m.ToServerUs(local)) - local, -1, 1);
    }

    [Fact]
    public void Last_skew_survives_an_outage_and_reset()
    {
        var m = new ClockModel();
        for (int i = 0; i < 60; i++) { long t = i * 500_000L; m.AddSample(t, 1_000_000 + t * 80e-6, 500); }
        double before = m.SkewPpm; Assert.InRange(before, 70, 90);
        m.Reset(keepSkew: true);
        m.AddSample(900_000_000, 1_072_000, 500);
        Assert.InRange(m.SkewPpm, 70, 90);   // constant offset + remembered skew until a new fit is possible
    }
}
