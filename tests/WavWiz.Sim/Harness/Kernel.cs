using WavWiz.Core.Clock;
namespace WavWiz.Sim.Harness;

/// <summary>Deterministic discrete-event kernel. All times are TRUE time in microseconds; nobody but the harness can see it.</summary>
public sealed class SimKernel : IMonotonicClock
{
    private readonly PriorityQueue<Action, (long, long)> _q = new();
    private long _seq;
    public long TrueNowUs { get; private set; }
    long IMonotonicClock.NowUs => TrueNowUs + ServerEpochOffsetUs; // the server's monotonic clock: true time + a constant nobody else knows
    public const long ServerEpochOffsetUs = 7_000_000_000;         // makes sure no code accidentally treats local time == server time

    public void At(long trueUs, Action a) => _q.Enqueue(a, (trueUs, _seq++));
    public void After(long deltaUs, Action a) => At(TrueNowUs + deltaUs, a);

    public void RunUntil(long trueUs)
    {
        while (_q.TryPeek(out _, out var pri) && pri.Item1 <= trueUs)
        {
            _q.TryDequeue(out var a, out pri); if (a is null) break;
            TrueNowUs = pri.Item1;
            a();
        }
        TrueNowUs = trueUs;
    }
}

/// <summary>A PC's clock vs true time: constant offset + ppm skew + slow sinusoidal wander (temperature etc.).</summary>
public sealed class VirtualClock
{
    public long OffsetUs { get; init; }
    public double SkewPpm { get; init; }
    public double WanderUs { get; init; }
    public double WanderPeriodS { get; init; } = 900;
    public long LocalAt(long trueUs)
        => OffsetUs + trueUs + (long)Math.Round(trueUs * SkewPpm * 1e-6)
           + (WanderUs == 0 ? 0 : (long)Math.Round(WanderUs * Math.Sin(2 * Math.PI * trueUs / (WanderPeriodS * 1e6))));
}

/// <summary>One direction of a network path. TCP-like (FIFO, loss = retransmit delay) or UDP-like (loss = gone).</summary>
public sealed class Link
{
    private readonly Random _rng;
    private long _lastArrival;
    public Link(int seed) { _rng = new Random(seed); }
    public long BaseUs { get; init; } = 300;
    public double JitterMeanUs { get; init; } = 100;
    public double LossProb { get; init; }
    public long RetransmitUs { get; init; } = 200_000;
    public List<(long FromUs, long ToUs)> Outages { get; } = new();

    private long Delay()
    {
        double u = _rng.NextDouble();
        long d = BaseUs + (long)(-Math.Log(1 - u) * JitterMeanUs);
        return d;
    }

    private long? OutageEnd(long t) { foreach (var (f, e) in Outages) if (t >= f && t < e) return e; return null; }

    /// <summary>Arrival time of a TCP message sent at sendUs (never lost, never reordered).</summary>
    public long TcpArrival(long sendUs)
    {
        long t = sendUs + Delay();
        if (_rng.NextDouble() < LossProb) t += RetransmitUs;
        var end = OutageEnd(sendUs) ?? OutageEnd(t);
        if (end != null) t = end.Value + Delay();
        if (t <= _lastArrival) t = _lastArrival + 1;
        _lastArrival = t;
        return t;
    }

    /// <summary>Arrival time of a UDP datagram, or null if it was lost.</summary>
    public long? UdpArrival(long sendUs)
    {
        if (OutageEnd(sendUs) != null) return null;
        if (_rng.NextDouble() < LossProb) return null;
        long t = sendUs + Delay();
        return OutageEnd(t) != null ? null : t;
    }
}
