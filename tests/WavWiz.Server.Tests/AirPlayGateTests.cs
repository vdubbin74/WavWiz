using WavWiz.Server.Receivers;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>AirPlay / Spotify names show only with a live speaker.</summary>
public class AirPlayGateTests
{
    private static ZoneDto D(long id, bool online, List<long>? groups, bool unavailable = false, bool muted = false, double vol = 0.5) =>
        new(id, "d" + id, "p" + id, online, true, vol, muted, null, null, "synced", "", null, null, null, null, null, null, null, null, new(), GroupIds: groups, OutputUnavailable: unavailable);

    [Fact]
    public void Zone_needs_toggle_and_a_live_speaker()
    {
        var devs = new[] { D(1, true, new() { 10 }), D(2, false, new() { 11 }), D(3, true, new() { 12 }, unavailable: true), D(4, true, new() { 13 }, muted: true, vol: 0) };
        var a = ZoneReceivers.ActiveZoneIds(devs);
        Assert.True(ZoneReceivers.ZoneGate(true, 10, a));
        Assert.False(ZoneReceivers.ZoneGate(true, 11, a));   // offline
        Assert.False(ZoneReceivers.ZoneGate(true, 12, a));   // output unavailable
        Assert.True(ZoneReceivers.ZoneGate(true, 13, a));    // muted / volume 0 still counts
        Assert.False(ZoneReceivers.ZoneGate(false, 10, a));  // Phone casting off
        Assert.False(ZoneReceivers.ZoneGate(true, 99, a));   // empty zone
    }

    [Fact]
    public void Linked_zones_gate_per_zone()
    {
        var a = ZoneReceivers.ActiveZoneIds(new[] { D(1, true, new() { 10 }), D(2, false, new() { 11 }) });
        Assert.Contains(10L, a); Assert.DoesNotContain(11L, a);
    }

    [Fact]
    public void House_needs_any_live_speaker()
    {
        Assert.False(ZoneReceivers.AnyActiveSpeaker(Array.Empty<ZoneDto>()));
        Assert.False(ZoneReceivers.AnyActiveSpeaker(new[] { D(1, false, new() { 10 }), D(2, true, null, unavailable: true) }));
        Assert.True(ZoneReceivers.AnyActiveSpeaker(new[] { D(1, false, new() { 10 }), D(2, true, new()) }));   // an Unassigned live speaker plays in the house group
    }

    [Fact]
    public void No_gate_wired_keeps_old_behaviour() => Assert.True(ZoneReceivers.ZoneGate(true, 5, null));
}
