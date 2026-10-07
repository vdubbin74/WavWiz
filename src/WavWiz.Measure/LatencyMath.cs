namespace WavWiz.Measure;

public enum MeasureVerdict { Ok, Noisy, NotFound }

public sealed record DeviceMeasurement(double RawLatencyMs, double SpreadMs, MeasureVerdict Verdict, string? Note);
public sealed record SessionResult(double OffsetMs, double Confidence, string? Warning);

/// <summary>Spec 8.2: L = A - T - 2.9 ms * distance; offset = L_dev - L_ref; median of 3, spread &gt; 5 ms means "noisy room, try again".</summary>
public static class LatencyMath
{
    public const double SoundMsPerMeter = 2.9;
    public const double MaxSpreadMs = 5.0;
    public const double ReferenceDriftWarnMs = 5.0;

    /// <summary>Raw latency from a detected arrival time. <paramref name="arrivalServerUs"/> is the pattern start as heard at the mic,
    /// already mapped to server time (phone clock sync or player clock model); <paramref name="playAtUs"/> is T.</summary>
    public static double RawLatencyMs(double arrivalServerUs, long playAtUs, double distanceM = 0)
        => (arrivalServerUs - playAtUs) / 1000.0 - SoundMsPerMeter * distanceM;

    public static DeviceMeasurement Median(IReadOnlyList<double> rawMs)
    {
        if (rawMs.Count == 0) return new(double.NaN, double.NaN, MeasureVerdict.NotFound, "no usable measurements");
        var s = rawMs.OrderBy(x => x).ToArray();
        double med = s.Length % 2 == 1 ? s[s.Length / 2] : (s[s.Length / 2 - 1] + s[s.Length / 2]) / 2;
        double spread = s[^1] - s[0];
        if (rawMs.Count < 3) return new(med, spread, MeasureVerdict.Noisy, "fewer than 3 usable measurements");
        return spread > MaxSpreadMs ? new(med, spread, MeasureVerdict.Noisy, $"spread {spread:F1} ms - noisy room, try again") : new(med, spread, MeasureVerdict.Ok, null);
    }

    /// <summary>Saved offset = L_dev - L_ref (the mic's own unknown input delay cancels).</summary>
    public static double Offset(double devMs, double refMs) => devMs - refMs;

    /// <summary>The reference is re-measured at the end of a phone session; if it moved more than 5 ms the session gets low confidence (spec 8.6).</summary>
    public static SessionResult Session(double offsetMs, double refStartMs, double refEndMs, double spreadMs)
    {
        double drift = Math.Abs(refEndMs - refStartMs);
        if (drift > ReferenceDriftWarnMs) return new(offsetMs, 0.3, $"the phone's timing moved {drift:F1} ms during the session - repeat it");
        double conf = Math.Clamp(1 - spreadMs / 10.0 - drift / 20.0, 0.2, 1.0);
        return new(offsetMs, conf, null);
    }

    /// <summary>Same-recording mode: the reference plays at T, the device at T + gap, in ONE recording.
    /// offset = (second hit - first hit) - gap; no clock sync or capture latency involved.</summary>
    public static double SameRecordingOffsetMs(double firstSec, double secondSec, double gapSec) => ((secondSec - firstSec) - gapSec) * 1000.0;
}
