using System.Net;
using System.Text.Json;
using WavWiz.Server.Receivers;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2078u: "WavWiz – Everywhere" (house AirPlay / Spotify Connect) shows on phones only while a speaker IN A ZONE is online - an Unassigned
/// speaker is silent, so a phone sending to Everywhere with only Unassigned speakers played nowhere. And a zone named "Everywhere" no longer gets the
/// same "WavWiz – Everywhere" name for its own receiver.</summary>
public class Release071HouseGateTests
{
    private static ZoneDto D(long id, bool online, List<long>? groups) =>
        new(id, "d" + id, "p" + id, online, true, 0.5, false, null, null, "synced", "", null, null, null, null, null, null, null, null, new(), GroupIds: groups);

    [Fact]
    public void Only_a_live_speaker_in_a_zone_opens_the_house_gate()
    {
        Assert.False(ZoneReceivers.AnyActiveSpeaker(new[] { D(1, true, null), D(2, true, new()) }));          // live but Unassigned
        Assert.False(ZoneReceivers.AnyActiveSpeaker(new[] { D(1, false, new() { 7 }) }));                     // in a zone but offline
        Assert.True(ZoneReceivers.AnyActiveSpeaker(new[] { D(1, true, null), D(2, true, new() { 7 }) }));
    }

    [Fact]
    public void A_zone_called_Everywhere_gets_its_own_name()
    {
        Assert.Equal("WavWiz – Everywhere zone", ZoneReceivers.NameOf("Everywhere"));
        Assert.Equal("WavWiz – everywhere zone", ZoneReceivers.NameOf(" everywhere "));
        Assert.NotEqual(AirPlayReceiver.Name, ZoneReceivers.NameOf("Everywhere"));
        Assert.Equal("WavWiz – Kitchen", ZoneReceivers.NameOf("Kitchen"));
        Assert.Equal("WavWiz – Everywhere Else", ZoneReceivers.NameOf("Everywhere Else"));
    }

    [Fact]
    public async Task The_house_gate_follows_zones_and_speakers_live()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin));
        await using var pc = await FakePc.StartAsync(f, "pc-h", "Den Speaker"); await pc.WaitConnected();
        static async Task<bool> Ready(HttpClient c) => (await c.GetJson("/api/v1/receivers")).GetProperty("houseReady").GetBoolean();
        Assert.False(await Ready(admin));                                    // the only live speaker is Unassigned
        Assert.False(f.Server.S.Spotify!.HouseGate!());                       // Spotify Connect "Everywhere" waits too
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-h").GetProperty("id").GetInt64();
        var g = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Den", deviceIds = new[] { dev } })).Json()).GetProperty("id").GetInt64();
        Assert.True(await Ready(admin));                                     // in a zone and online
        Assert.True(f.Server.S.Spotify!.HouseGate!());
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{g}")).StatusCode);
        Assert.False(await Ready(admin));                                    // zone deleted: Unassigned again, hidden again
    }
}
