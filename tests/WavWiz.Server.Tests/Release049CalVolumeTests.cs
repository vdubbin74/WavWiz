using WavWiz.PlayerCore;
using WavWiz.Server.Calibration;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F71: a low max-volume cap no longer makes the calibration test sound inaudible. The cap (and the zone / master volume) is
/// bypassed for the test sound only; the stored cap is never changed; the speaker's volume and mute always come back (success, cancel,
/// exception, the session ending, and a server restart via the "calibrating" marker).</summary>
public class Release049CalVolumeTests
{
    private sealed class FakeDsp { public double Vol = 20; public bool Muted = true; public readonly List<double> Seen = new(); }
    private static (FakeDsp d, CalVolumeGuard g) Make() { var d = new FakeDsp(); return (d, new CalVolumeGuard(() => d.Vol, () => d.Muted, v => { d.Vol = v; d.Seen.Add(v); }, m => d.Muted = m)); }

    [Fact]
    public async Task Test_sound_plays_at_full_volume_then_the_volume_and_mute_come_back_after_success()
    {
        var (d, g) = Make();
        await g.Run(100, () => { Assert.Equal(100, d.Vol); Assert.False(d.Muted); Assert.True(g.Active); return Task.CompletedTask; });
        Assert.Equal(20, d.Vol); Assert.True(d.Muted); Assert.False(g.Active);
    }

    [Fact]
    public async Task Volume_is_restored_after_cancel_and_after_an_exception()
    {
        var (d, g) = Make();
        await Assert.ThrowsAsync<OperationCanceledException>(() => g.Run(100, () => throw new OperationCanceledException()));
        Assert.Equal(20, d.Vol); Assert.True(d.Muted);
        await Assert.ThrowsAsync<InvalidOperationException>(() => g.Run(100, () => throw new InvalidOperationException("mic failed")));
        Assert.Equal(20, d.Vol); Assert.True(d.Muted); Assert.False(g.Active);
    }

    [Fact]
    public void A_zone_update_during_the_test_sound_is_held_and_becomes_the_restored_value_and_repeat_patterns_keep_the_first_saved_volume()
    {
        var (d, g) = Make();
        g.Begin(100); g.Begin(100);                      // a second pattern must not save 100 as "the real volume"
        Assert.True(g.Hold(35, false)); Assert.Equal(100, d.Vol);
        g.End(); Assert.Equal(35, d.Vol); Assert.False(d.Muted);
        Assert.False(g.Hold(50, true));                  // not calibrating: applied normally by the caller
        g.End(); Assert.Equal(35, d.Vol);                // End twice is harmless
    }

    [Fact]
    public async Task Server_bypasses_a_locked_low_cap_for_the_test_sound_without_changing_the_stored_cap_and_clears_the_marker_on_end()
    {
        await using var f = await ServerFixture.StartAsync();
        var cal = f.Server.S.Cal; var db = f.Server.S.Db;
        db.SetSetting("volcap.7", System.Text.Json.JsonSerializer.Serialize(new VolumeCap(15, true)));
        var before = db.Setting("volcap.7");
        var s = new CalSession();
        Assert.Equal(100, s.TestVolume);                                     // full volume by default
        Assert.Equal(100, cal.EffectiveTestVolume(s, 7));                    // the 15 % lock does not limit the test sound
        Assert.Equal(before, db.Setting("volcap.7"));                        // stored cap untouched
        Assert.Equal(15, f.Server.S.Zones.VolCapOf(7).Cap);
        Assert.Contains(7L, cal.CalMarker());                                // a restart would still restore it
        s.TestVolume = 60; Assert.Equal(60, cal.EffectiveTestVolume(s, 7));  // the user's own test volume still counts
        cal.End(s, "canceled");
        Assert.DoesNotContain(7L, cal.CalMarker());
        Assert.Equal(100, CalibrationService.TestVolumeFor(double.NaN));
    }
}
