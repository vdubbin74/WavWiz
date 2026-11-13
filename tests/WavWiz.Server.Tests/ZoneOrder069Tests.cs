using System.Net;
using System.Text.Json;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #12: the Devices card order (zones, Jukebox, Unassigned, AirPlay) is stored on the server, exactly as the user left it.</summary>
public class ZoneOrder069Tests
{
    static StringContent Body(object o) => new(JsonSerializer.Serialize(o), System.Text.Encoding.UTF8, "application/json");
    static async Task<List<string>> Order(HttpClient c) => (await (await c.GetAsync("/api/v1/zones/order")).Json()).GetProperty("order").EnumerateArray().Select(e => e.GetString()!).ToList();

    [Fact]
    public async Task Card_order_round_trips_keeps_jukebox_unassigned_airplay_where_put_and_survives_a_restart()
    {
        await using var f = await ServerFixture.StartAsync();
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        Assert.Empty(await Order(admin));                                                   // nothing saved yet: the client uses its default order
        var want = new[] { "airplay", "g:7", "unassigned", "jukebox", "g:3" };
        var r = await admin.PutAsync("/api/v1/zones/order", Body(new { order = want.Append("g:7") }));   // a duplicate is dropped, never reordered
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(want, await Order(admin));
        Assert.Equal(want, await Order(f.As(f.Token(Role.View))));                          // same for every client

        // restart on the same data folder: the order is still exactly what was put
        await f.Server.DisposeAsync(); f.Http.Dispose();
        f.Server = await WavWizServer.StartAsync(f.Cfg); f.Base = f.Server.HttpUrl; f.Http = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        Assert.Equal(want, await Order(f.As(f.Token(Role.View))));
    }

    [Fact]
    public async Task Changing_the_order_is_admin_only_and_rejects_unknown_keys()
    {
        await using var f = await ServerFixture.StartAsync();
        await f.SetupAdmin();
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).PutAsync("/api/v1/zones/order", Body(new { order = new[] { "g:1" } }))).StatusCode);
        var admin = f.As(f.Token(Role.Admin));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsync("/api/v1/zones/order", Body(new { order = new[] { "g:1", "<script>" } }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsync("/api/v1/zones/order", Body(new { order = "g:1" }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsync("/api/v1/zones/order", Body(new { order = Enumerable.Range(0, 1001).Select(i => "g:" + i) }))).StatusCode);
        Assert.Empty(await Order(admin));
    }
}
