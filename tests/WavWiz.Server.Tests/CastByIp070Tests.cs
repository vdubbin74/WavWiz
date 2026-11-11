using System.Net;
using WavWiz.Core.Cast;
using WavWiz.Core.Tests;
using WavWiz.Server.Api;
using WavWiz.Server.Cast;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 item 5b: "Add by IP address" on the Cast card, for a device discovery can't see (another subnet, mDNS blocked).
/// The entry only records the address; Play test sound / Add then dial it like any Cast device (checked end to end against the fake receiver).</summary>
public class CastByIp070Tests
{
    [Theory]
    [InlineData("192.168.1.40", null, "ip-192.168.1.40", "192.168.1.40:8009")]
    [InlineData(" 192.168.1.40:8010 ", null, "ip-192.168.1.40-8010", "192.168.1.40:8010")]
    [InlineData("10.0.0.7", 9000, "ip-10.0.0.7-9000", "10.0.0.7:9000")]
    [InlineData("fe80::1", null, "ip-fe80--1", "[fe80::1]:8009")]
    [InlineData("[fd00::5]:8009", null, "ip-fd00--5", "[fd00::5]:8009")]
    public void Addresses_parse_to_a_stable_key_and_endpoint(string a, int? port, string key, string ep)
    {
        Assert.Null(CastApi.ParseManual(a, port, null, out var m));
        Assert.Equal(key, m!.Key); Assert.Equal(ep, m.Endpoint); Assert.StartsWith("Cast device (", m.Name);
    }

    [Theory]
    [InlineData("", "Enter the device's IP address")]
    [InlineData("kitchen-speaker.local", "is not an IP address")]
    [InlineData("192.168.1", "is not an IP address")]
    [InlineData("3232235777", "is not an IP address")]
    [InlineData("192.168.1.40:", "is not an IP address")]
    [InlineData("0.0.0.0", "can't be a Cast device")]
    [InlineData("255.255.255.255", "can't be a Cast device")]
    [InlineData("239.255.255.250", "can't be a Cast device")]
    public void Bad_input_gets_words_not_a_crash(string a, string want)
    {
        Assert.Contains(want, CastApi.ParseManual(a, null, null, out var m)); Assert.Null(m);
    }

    [Fact]
    public void Port_range_and_name_and_a_device_discovery_already_knows()
    {
        Assert.Contains("between 1 and 65535", CastApi.ParseManual("192.168.1.40", 70000, null, out _));
        Assert.Null(CastApi.ParseManual("192.168.1.40", null, "  Garage speaker  ", out var m)); Assert.Equal("Garage speaker", m!.Name);
        Assert.Null(CastApi.ParseManual("192.168.1.40", null, new string('x', 80), out m)); Assert.Equal(40, m!.Name.Length);
        // discovery already lists that address: reuse its id and name, so it is never added twice
        Assert.Null(CastApi.ParseManual("192.168.1.41", null, null, out m, ip => ip.ToString() == "192.168.1.41" ? ("abc123", "Kitchen display") : null));
        Assert.Equal("abc123", m!.Key); Assert.Equal("Kitchen display", m.Name);
    }

    [Fact]
    public async Task Typed_address_appears_in_the_list_then_test_and_add_dial_it_and_it_is_remembered_with_the_address()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var fake = new FakeCastReceiver { FetchStream = true };
        CastApi.Outs(f.Server.S).Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        // admin only; bad input is a 400 with words for the card
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).PostAsJsonAsync("/api/v1/cast/setup/byip", new { address = "127.0.0.1" })).StatusCode);
        var bad = await admin.PostAsJsonAsync("/api/v1/cast/setup/byip", new { address = "speaker.local" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode); Assert.Equal("input", (await bad.Json()).GetProperty("code").GetString());

        var r = await admin.PostAsJsonAsync("/api/v1/cast/setup/byip", new { address = fake.Ep.ToString(), name = "Garage" });
        var b = await r.Json(); Assert.True(r.IsSuccessStatusCode, b.ToString());
        var key = b.GetProperty("id").GetString()!; Assert.Equal($"ip-127.0.0.1-{fake.Ep.Port}", key);
        var row = (await admin.GetJson("/api/v1/cast/setup/devices")).GetProperty("devices").EnumerateArray().Single(x => x.GetProperty("id").GetString() == key);
        Assert.True(row.GetProperty("manual").GetBoolean()); Assert.Equal("Garage", row.GetProperty("name").GetString()); Assert.False(row.GetProperty("added").GetBoolean());

        // the card sends only the key (no endpoint), as for a discovered device
        var add = await admin.PostAsJsonAsync("/api/v1/cast/setup/add", new { key, newZone = "Garage" });
        var ab = await add.Json(); Assert.True(add.IsSuccessStatusCode, ab.ToString());
        Assert.Equal("cast:" + key, ab.GetProperty("id").GetString());
        Assert.Equal("CC1AD845", fake.AppId);
        var saved = CastSpeakers.Load(f.Server.S).Single(x => x.Key == key);
        Assert.Equal(fake.Ep.ToString(), saved.Endpoint); Assert.Equal("Garage", saved.Name);   // reconnects after a restart without mDNS
        var z = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(x => x.GetProperty("playerId").GetString() == "cast:" + key);
        Assert.Equal("Garage", z.GetProperty("name").GetString());
        row = (await admin.GetJson("/api/v1/cast/setup/devices")).GetProperty("devices").EnumerateArray().Single(x => x.GetProperty("id").GetString() == key);
        Assert.True(row.GetProperty("added").GetBoolean());
    }

    [Fact]
    public async Task An_address_nothing_answers_on_fails_at_test_with_the_reach_words()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        CastApi.Outs(f.Server.S).Dial = (ep, ct) => CastClient.ConnectAsync(ep, ct, tls: false);
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0); l.Start(); var port = ((IPEndPoint)l.LocalEndpoint).Port; l.Stop();   // a closed port
        var key = (await (await admin.PostAsJsonAsync("/api/v1/cast/setup/byip", new { address = "127.0.0.1", port })).Json()).GetProperty("id").GetString();
        var t = await admin.PostAsJsonAsync("/api/v1/cast/setup/test", new { key });
        Assert.Equal(HttpStatusCode.Conflict, t.StatusCode);
        var tb = await t.Json(); Assert.Equal("discovery", tb.GetProperty("code").GetString()); Assert.Contains("Cast device (127.0.0.1)", tb.GetProperty("text").GetString());
        Assert.Empty(CastSpeakers.Load(f.Server.S));
    }
}
