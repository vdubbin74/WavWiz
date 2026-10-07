using WavWiz.Core.Calibration;
namespace WavWiz.Core.Tests;

public class CalibrationLookupTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);
    private static CalibrationRecord Rec(string dev, string? pc, double ms, int ageDays = 1, string method = "mic", string? codec = null)
        => new(dev, pc, ms, method, Now.AddDays(-ageDays), 0.9, true, codec);

    [Fact]
    public void Bluetooth_speakers_are_keyed_by_address_on_every_pc_but_wired_by_pc_and_endpoint()
    {
        var a = CalibrationLookup.DeviceKey(OutputKind.Bluetooth, "AA:BB:CC:00:11:22", "pc1", "{x}");
        var b = CalibrationLookup.DeviceKey(OutputKind.Bluetooth, "aa-bb-cc-00-11-22", "pc2", "{y}");
        Assert.Equal(a, b);
        Assert.NotEqual(CalibrationLookup.DeviceKey(OutputKind.Spdif, null, "pc1", "{x}"), CalibrationLookup.DeviceKey(OutputKind.Spdif, null, "pc2", "{x}"));
        Assert.StartsWith("ep:", CalibrationLookup.DeviceKey(OutputKind.Bluetooth, null, "pc1", "{x}"));   // no address readable: falls back to the endpoint (spec risk)
    }

    [Fact]
    public void This_pc_value_wins_over_another_pcs_value()
    {
        var r = CalibrationLookup.Resolve("bt:1", OutputKind.Bluetooth, "pc2", new[] { Rec("bt:1", "pc1", 180), Rec("bt:1", "pc2", 195) }, Now);
        Assert.Equal(195, r.LatencyMs); Assert.Equal(LatencySource.Measured, r.Source); Assert.False(r.Estimated); Assert.False(r.RecheckDue);
    }

    [Fact]
    public void Speaker_measured_only_on_another_pc_is_applied_as_estimated_with_a_recheck()
    {
        var r = CalibrationLookup.Resolve("bt:1", OutputKind.Bluetooth, "pc2", new[] { Rec("bt:1", "pc1", 180) }, Now);
        Assert.Equal(180, r.LatencyMs); Assert.True(r.Estimated); Assert.True(r.RecheckDue); Assert.Equal("pc1", r.FromPlayerId);
        Assert.Contains("estimated", r.Label);
    }

    [Fact]
    public void Unknown_bluetooth_plays_right_away_with_a_flagged_200_ms_guess_and_unknown_wired_starts_at_0_flagged()
    {
        var bt = CalibrationLookup.Resolve("bt:9", OutputKind.Bluetooth, "pc1", Array.Empty<CalibrationRecord>(), Now);
        Assert.Equal(200, bt.LatencyMs); Assert.True(bt.NotCalibrated); Assert.True(bt.RecheckDue); Assert.Equal(LatencySource.DefaultGuess, bt.Source);
        var w = CalibrationLookup.Resolve("ep:pc1:x", OutputKind.Hdmi, "pc1", Array.Empty<CalibrationRecord>(), Now);
        Assert.Equal(0, w.LatencyMs); Assert.True(w.NotCalibrated);
        var custom = CalibrationLookup.Resolve("bt:9", OutputKind.Bluetooth, "pc1", Array.Empty<CalibrationRecord>(), Now, new CalibrationOptions { BtDefaultLatencyMs = 150 });
        Assert.Equal(150, custom.LatencyMs);
    }

    [Theory]
    [InlineData(1, false, null, null, false)]
    [InlineData(45, false, null, null, true)]      // older than N days
    [InlineData(1, true, null, null, true)]        // reconnect
    [InlineData(1, false, "aptX", null, true)]     // codec changed (saved with SBC)
    [InlineData(1, false, "sbc", 50.0, true)]      // Windows now reports a different latency
    public void Recheck_rules(int age, bool reconnected, string? codec, double? win, bool due)
    {
        var rec = Rec("bt:1", "pc1", 180, age, codec: "SBC") with { WinReportedLatencyMs = 20 };
        var r = CalibrationLookup.Resolve("bt:1", OutputKind.Bluetooth, "pc1", new[] { rec }, Now, null, new DeviceState(reconnected, codec == "sbc" ? "SBC" : codec, win));
        Assert.Equal(due, r.RecheckDue);
        if (due) Assert.NotNull(r.Reason);
    }

    [Fact]
    public void Manual_value_is_labeled_manual_and_old_non_current_records_are_ignored()
    {
        var recs = new[] { Rec("bt:1", "pc1", 999, 2) with { IsCurrent = false }, Rec("bt:1", "pc1", 150, 1, "manual") };
        var r = CalibrationLookup.Resolve("bt:1", OutputKind.Bluetooth, "pc1", recs, Now);
        Assert.Equal(150, r.LatencyMs); Assert.Equal(LatencySource.Manual, r.Source);
    }
}
