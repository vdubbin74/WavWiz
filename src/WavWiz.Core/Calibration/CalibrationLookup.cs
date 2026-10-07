namespace WavWiz.Core.Calibration;

public enum OutputKind { Hdmi, Spdif, Bluetooth, Analog, Usb, Other }
public enum LatencySource { Measured, Manual, EstimatedFromOtherPc, DefaultGuess }

/// <summary>A saved calibration (spec 14 `calibration`). PlayerId = the PC it was measured on (null = PC-independent).</summary>
public sealed record CalibrationRecord(string OutputDeviceId, string? PlayerId, double LatencyMs, string Method /* mic|ear|loopback|manual */,
    DateTimeOffset MeasuredAt, double Confidence, bool IsCurrent = true, string? Codec = null, double? WinReportedLatencyMs = null);

/// <summary>What the player applies, and how honestly it is labeled. "Unknown is never zero": a missing value is a flagged default, never a silent 0.</summary>
public sealed record ResolvedLatency(double LatencyMs, LatencySource Source, bool NotCalibrated, bool Estimated, bool RecheckDue, string? Reason, string? FromPlayerId)
{
    public string Label => Source switch
    {
        LatencySource.Measured => $"+{LatencyMs:0} ms - measured",
        LatencySource.Manual => $"+{LatencyMs:0} ms - manual",
        LatencySource.EstimatedFromOtherPc => $"+{LatencyMs:0} ms - estimated (from another PC)",
        _ => NotCalibrated ? $"~{LatencyMs:0} ms - not calibrated" : $"{LatencyMs:0} ms",
    };
}

public sealed class CalibrationOptions
{
    public double BtDefaultLatencyMs { get; init; } = 200;     // D9: setting bt.defaultLatencyMs
    public double WiredDefaultLatencyMs { get; init; } = 0;
    public int RecheckAfterDays { get; init; } = 30;
    public double WinLatencyChangeMs { get; init; } = 15;
}

public readonly record struct DeviceState(bool JustReconnected = false, string? CurrentCodec = null, double? WinReportedLatencyMs = null);

public static class CalibrationLookup
{
    /// <summary>Stable identity: Bluetooth speakers are keyed by Bluetooth address (the same on every PC); wired endpoints by PC + Windows endpoint id.</summary>
    public static string DeviceKey(OutputKind kind, string? btAddress, string playerId, string winEndpointId)
        => kind == OutputKind.Bluetooth && !string.IsNullOrWhiteSpace(btAddress)
            ? "bt:" + btAddress.Replace(":", "").Replace("-", "").ToLowerInvariant()
            : $"ep:{playerId}:{winEndpointId.ToLowerInvariant()}";

    /// <summary>Spec 14 lookup order: current (device, this PC) -> current (device, any PC) flagged "estimated" -> BT default / wired 0, both "not calibrated".</summary>
    public static ResolvedLatency Resolve(string deviceKey, OutputKind kind, string playerId, IEnumerable<CalibrationRecord> all, DateTimeOffset now,
        CalibrationOptions? opt = null, DeviceState state = default)
    {
        opt ??= new CalibrationOptions();
        var mine = all.Where(c => c.IsCurrent && c.OutputDeviceId == deviceKey).ToList();
        var here = mine.Where(c => c.PlayerId == playerId).OrderByDescending(c => c.MeasuredAt).FirstOrDefault();
        var any = mine.Where(c => c.PlayerId == null).OrderByDescending(c => c.MeasuredAt).FirstOrDefault();
        if (here is not null || any is not null)
        {
            var c = here ?? any!;
            var (recheck, why) = Recheck(c, now, opt, state, estimated: false);
            return new ResolvedLatency(c.LatencyMs, c.Method == "manual" ? LatencySource.Manual : LatencySource.Measured, false, false, recheck, why, null);
        }
        var other = mine.Where(c => c.PlayerId != null && c.PlayerId != playerId).OrderByDescending(c => c.MeasuredAt).FirstOrDefault();
        if (other is not null)
            return new ResolvedLatency(other.LatencyMs, LatencySource.EstimatedFromOtherPc, false, true, true, $"measured on another PC ({other.PlayerId}); re-check here", other.PlayerId);
        double d = kind == OutputKind.Bluetooth ? opt.BtDefaultLatencyMs : opt.WiredDefaultLatencyMs;
        return new ResolvedLatency(d, LatencySource.DefaultGuess, true, false, true,
            kind == OutputKind.Bluetooth ? "not calibrated - guessed delay, calibrate this speaker" : "not calibrated", null);
    }

    private static (bool, string?) Recheck(CalibrationRecord c, DateTimeOffset now, CalibrationOptions o, DeviceState s, bool estimated)
    {
        if (s.JustReconnected) return (true, "speaker reconnected");
        if (s.CurrentCodec != null && c.Codec != null && !string.Equals(s.CurrentCodec, c.Codec, StringComparison.OrdinalIgnoreCase)) return (true, "codec changed");
        if (s.WinReportedLatencyMs is double w && c.WinReportedLatencyMs is double w0 && Math.Abs(w - w0) > o.WinLatencyChangeMs) return (true, "Windows reports a different latency than at calibration time");
        if ((now - c.MeasuredAt).TotalDays > o.RecheckAfterDays) return (true, $"older than {o.RecheckAfterDays} days");
        return (false, null);
    }
}
