using System.Net;
using System.Text.Json;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 t1901: the Cast speakers card is a reorder card like AirPlay, so the shared card order accepts its key ("cast").</summary>
public class ZoneOrder070CastTests
{
    static StringContent Body(object o) => new(JsonSerializer.Serialize(o), System.Text.Encoding.UTF8, "application/json");
    static async Task<List<string>> Order(HttpClient c) => (await (await c.GetAsync("/api/v1/zones/order")).Json()).GetProperty("order").EnumerateArray().Select(e => e.GetString()!).ToList();

    [Fact]
    public async Task Card_order_keeps_the_cast_card_where_it_was_put()
    {
        await using var f = await ServerFixture.StartAsync();
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        var want = new[] { "cast", "g:3", "airplay", "unassigned", "jukebox" };
        var r = await admin.PutAsync("/api/v1/zones/order", Body(new { order = want }));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(want, await Order(f.As(f.Token(Role.View))));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsync("/api/v1/zones/order", Body(new { order = new[] { "chromecast" } }))).StatusCode);
    }
}
