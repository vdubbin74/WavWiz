using System.Net;
using WavWiz.Server.Api;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.2.2 T9: "Use your phone as the microphone" links on the Calibrate speakers page.</summary>
public class Release022CalPhoneTests
{
    [Fact]
    public void T9_link_tokens_are_short_unambiguous_and_expire()
    {
        var now = DateTimeOffset.UtcNow; var l = CalPhoneApi.Create(true, now);
        Assert.Equal(6, l.Token.Length); Assert.True(CalPhoneApi.WellFormed(l.Token));
        Assert.DoesNotContain(l.Token, ch => ch is '0' or 'O' or '1' or 'I' or 'L');
        Assert.Same(l, CalPhoneApi.Valid(l.Token.ToLowerInvariant(), now));
        Assert.Null(CalPhoneApi.Valid(l.Token, now + CalPhoneApi.Life + TimeSpan.FromSeconds(1)));
        Assert.Null(CalPhoneApi.Valid("../../x", now)); Assert.Null(CalPhoneApi.Valid(null, now));
        Assert.Equal("https://10.0.0.5:8443/calmic.html?cal=ABCDEF", CalPhoneApi.SecureUrl("10.0.0.5", 8443, "ABCDEF", "123456"));      // 0.2.5: mic-only page, no pairing code
    }

    [Fact]
    public void T9_short_link_is_not_forced_onto_https_before_the_certificate_check()
    {
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/c/ABCDEF", false, true, true, false, "Mozilla/5.0 (iPhone)"));
        Assert.True(RedirectPolicy.ShouldRedirect("GET", "/", false, true, true, false, "Mozilla/5.0 (iPhone)"));
    }

    [Fact]
    public async Task T9_phone_link_flow_status_pairing_and_admin_scope()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin)); var ctl = f.As(f.Token(Role.Control)); var view = f.As(f.Token(Role.View));
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).StatusCode);
        var link = await (await admin.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).Json();
        var tok = link.GetProperty("token").GetString()!;
        Assert.False(link.GetProperty("signsIn").GetBoolean()); Assert.True(link.GetProperty("allSpeakers").GetBoolean());      // 0.2.5: no sign-in needed any more
        Assert.EndsWith("/c/" + tok, link.GetProperty("shortUrl").GetString());
        var st = await admin.GetJson($"/api/v1/calibration/phone-link/{tok}");
        Assert.Equal("waiting", st.GetProperty("state").GetString()); Assert.False(st.GetProperty("connected").GetBoolean());
        var qr = await admin.GetAsync($"/api/v1/calibration/phone-link/{tok}/qr.svg"); qr.EnsureSuccessStatusCode();
        Assert.Contains("<svg", await qr.Content.ReadAsStringAsync());

        // the short link: no sign-in needed. 0.2.5: no pairing code either - the mic-only page is authorized by the link code itself (see Release025CalibrationTests)
        using var anon = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        var r = await anon.GetAsync($"/c/{tok}"); Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        var loc = r.Headers.Location!.ToString(); Assert.Contains("cal=" + tok, loc); Assert.DoesNotContain("pair=", loc);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync("/c/ZZZZZZ")).StatusCode);

        // the phone says hello: the PC sees "connected", and a "calphone" event is pushed
        var hi = await (await view.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/hello", new { state = "measuring", device = "iPhone" })).Json();
        Assert.True(hi.GetProperty("byAdmin").GetBoolean());
        st = await admin.GetJson($"/api/v1/calibration/phone-link/{tok}");
        Assert.True(st.GetProperty("connected").GetBoolean()); Assert.Equal("measuring", st.GetProperty("state").GetString()); Assert.Equal("iPhone", st.GetProperty("device").GetString());
        await view.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/hello", new { state = "left" });
        Assert.False((await admin.GetJson($"/api/v1/calibration/phone-link/{tok}")).GetProperty("connected").GetBoolean());

        // a regular user's link does not sign phones in
        var mine = await (await ctl.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).Json();
        Assert.False(mine.GetProperty("signsIn").GetBoolean());
        var r2 = await anon.GetAsync($"/c/{mine.GetProperty("token").GetString()}"); Assert.DoesNotContain("pair=", r2.Headers.Location!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/v1/calibration/phone-link/ABCDEF")).StatusCode);
    }
}
