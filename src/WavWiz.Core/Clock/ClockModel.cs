namespace WavWiz.Core.Clock;

/// <summary>
/// NTP-style clock model on a player (spec 6.2, 7.2). Keeps the last ~60 s of (offset, rtt) samples, uses only the
/// lowest-RTT quarter (least queuing delay) and fits serverTime = localTime + a + b*(localTime - ref) by least squares.
/// Holds its last skew through outages (spec 7.6). All times are microseconds.
/// "Unknown is never zero": until the first sample, IsValid is false and conversions throw instead of returning a guess.
/// </summary>
public sealed class ClockModel
{
    private readonly record struct Sample(long LocalMidUs, double OffsetUs, long RttUs);

    private readonly List<Sample> _samples = new();
    private readonly long _windowUs;
    private readonly double _keepFraction;
    private readonly double _maxSkew;

    private sealed record Fit(double A, double B, double Ref);   // published as one immutable snapshot: the audio thread reads it while the network thread refits
    private volatile Fit? _fit;
    private double _b;           // skew (dimensionless): d(offset)/d(local)
    private double _lastSkew;    // survives outages
    private long _minRttUs = long.MaxValue;
    private long _lastRttUs;

    public ClockModel(long windowUs = 60_000_000, double keepFraction = 0.25, double maxSkewPpm = 1000)
    {
        _windowUs = windowUs; _keepFraction = keepFraction; _maxSkew = maxSkewPpm * 1e-6;
    }

    public bool IsValid => _fit != null;
    public int SampleCount => _samples.Count;
    public double SkewPpm => _b * 1e6;
    public long LastRttUs => _lastRttUs;
    public long BestRttUs => _minRttUs == long.MaxValue ? 0 : _minRttUs;
    /// <summary>True once enough span/samples exist for a regression (otherwise a constant offset + last known skew is used).</summary>
    public bool HasSkewFit { get; private set; }

    public void Reset(bool keepSkew = true)
    {
        _samples.Clear(); _fit = null; HasSkewFit = false; _minRttUs = long.MaxValue;
        if (!keepSkew) _lastSkew = 0;
    }

    /// <summary>offset = ((t1 - t0) + (t2 - t3)) / 2 ; rtt = (t3 - t0) - (t2 - t1). t0,t3 player-local; t1,t2 server.</summary>
    public static (double OffsetUs, long RttUs) Compute(long t0, long t1, long t2, long t3)
        => (((t1 - t0) + (t2 - t3)) / 2.0, (t3 - t0) - (t2 - t1));

    public void AddPong(long t0, long t1, long t2, long t3)
    {
        var (off, rtt) = Compute(t0, t1, t2, t3);
        if (rtt < 0) return; // impossible; clock went backwards or corrupt packet
        AddSample((t0 + t3) / 2, off, rtt);
    }

    public void AddSample(long localMidUs, double offsetUs, long rttUs)
    {
        _samples.Add(new Sample(localMidUs, offsetUs, rttUs));
        _lastRttUs = rttUs;
        long cutoff = localMidUs - _windowUs;
        int drop = 0;
        while (drop < _samples.Count && _samples[drop].LocalMidUs < cutoff) drop++;
        if (drop > 0) _samples.RemoveRange(0, drop);
        _minRttUs = long.MaxValue;
        foreach (var s in _samples) if (s.RttUs < _minRttUs) _minRttUs = s.RttUs;
        Refit();
    }

    private void Refit()
    {
        int n = _samples.Count;
        if (n == 0) return;
        // lowest-RTT quarter (at least 3 samples when available)
        var sorted = new List<Sample>(_samples);
        sorted.Sort((x, y) => x.RttUs.CompareTo(y.RttUs));
        int keep = Math.Max(Math.Min(3, n), (int)Math.Ceiling(n * _keepFraction));
        var good = sorted.GetRange(0, keep);

        double meanT = 0, meanO = 0;
        foreach (var s in good) { meanT += s.LocalMidUs; meanO += s.OffsetUs; }
        meanT /= good.Count; meanO /= good.Count;

        double minT = double.MaxValue, maxT = double.MinValue;
        foreach (var s in good) { minT = Math.Min(minT, s.LocalMidUs); maxT = Math.Max(maxT, s.LocalMidUs); }
        double span = maxT - minT;

        double slope = _lastSkew;
        bool fit = false;
        if (good.Count >= 8 && span >= 10_000_000)
        {
            double sxx = 0, sxy = 0;
            foreach (var s in good) { double dx = s.LocalMidUs - meanT; sxx += dx * dx; sxy += dx * (s.OffsetUs - meanO); }
            if (sxx > 0)
            {
                slope = Math.Clamp(sxy / sxx, -_maxSkew, _maxSkew);
                fit = true;
                _lastSkew = slope;
            }
        }
        _b = slope; HasSkewFit = fit;
        _fit = new Fit(meanO, slope, meanT);
    }

    /// <summary>serverTime = localTime + a + b*(localTime - ref)</summary>
    public long ToServerUs(long localUs)
    {
        var f = Require();
        return localUs + (long)Math.Round(f.A + f.B * (localUs - f.Ref));
    }

    /// <summary>Inverse of <see cref="ToServerUs"/>.</summary>
    public long ToLocalUs(long serverUs)
    {
        var f = Require();
        // server = local + a + b*(local - ref)  =>  local = (server - a + b*ref) / (1 + b)
        return (long)Math.Round((serverUs - f.A + f.B * f.Ref) / (1 + f.B));
    }

    /// <summary>Same as ToServerUs but fractional, for the audio-thread control loop.</summary>
    public double ToServerUsExact(double localUs)
    {
        var f = Require();
        return localUs + f.A + f.B * (localUs - f.Ref);
    }

    private Fit Require() => _fit ?? throw new InvalidOperationException("Clock model has no samples yet (unknown is never zero).");
}
