using System.Net;
namespace WavWiz.Server.Tests;

/// <summary>F260-A M1: the server ends a phone link's calibration session when the page says 'left', including a session whose create lands after the page left. Never auto-resumes.</summary>
[Collection("serial")]
public class F260CalExitServerTests
{
    [Fact]
    public async Task Left_ends_the_links_session_and_a_late_create_is_ended_at_once()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); await using var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones"); for (int i = 0; i < 100 && zs.GetArrayLength() < 2; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long idb = zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-b").GetProperty("id").GetInt64();
        var tok = (await (await admin.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).Json()).GetProperty("token").GetString()!;
        using var phone = new HttpClient { BaseAddress = new Uri(f.Base) }; phone.DefaultRequestHeaders.Add("X-WavWiz-Cal", tok);
        async Task Hello(string st) => (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/hello", new { state = st, device = "iPhone" })).EnsureSuccessStatusCode();
        Task<HttpResponseMessage> Create() => phone.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = idb, micSource = "phone", micProcessing = "raw", linkToken = tok });

        await Hello("measuring");
        var c1 = await Create(); Assert.True(c1.IsSuccessStatusCode, await c1.Content.ReadAsStringAsync());
        var sid = (await c1.Json()).GetProperty("id").GetString();
        Assert.Equal(1, f.Server.S.Cal.OpenSessions);
        await Hello("left");                                   // the phone's own /end never arrived
        Assert.Equal(0, f.Server.S.Cal.OpenSessions);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/v1/calibration/sessions/{sid}")).StatusCode);

        var late = await Create();                             // create that lands after the page left
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
        Assert.Equal(0, f.Server.S.Cal.OpenSessions);

        await Hello("opened"); await Hello("measuring");       // a fresh page can calibrate again
        var c2 = await Create(); Assert.True(c2.IsSuccessStatusCode); Assert.Equal(1, f.Server.S.Cal.OpenSessions);
    }
}
