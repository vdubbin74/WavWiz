using System.Net;
using WavWiz.Server.Api;
namespace WavWiz.Server.Tests;

/// <summary>0.7.3 t2248u: Docker / iPhone "Pair or Administrator just reloads the sign-in page". The session cookie was SameSite=Strict and iPhone
/// Safari withholds a Strict cookie from a page opened by a cross-site navigation (the Camera's QR code, Messages, a Home Screen icon) - on its own
/// fetches and on location.reload() - so every sign-in came back signed out. The cookie is Lax now; cross-site writes are still refused by the
/// Origin check. Also the F274 W5 gap: the calibration QR opens the http secure set-up page with the calibration hand-off.</summary>
public class Release073DockerSignInTests
{
    [Fact]
    public async Task Pair_and_login_set_a_lax_httponly_cookie_that_signs_the_next_page_in()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var code = (await (await f.As(f.Token(Role.Admin)).PostAsJsonAsync("/api/v1/pairing/code", new { })).Json()).GetProperty("code").GetString()!;
        using var phone = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        phone.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1");
        var r = await phone.PostAsJsonAsync("/api/v1/auth/pair", new { code, name = "iPhone" }); Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var sc = r.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("wavwiz_session="));
        Assert.Contains("samesite=lax", sc, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("samesite=strict", sc, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", sc, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain(sc.Split(';').Skip(1), a => a.Trim().Equals("secure", StringComparison.OrdinalIgnoreCase));   // plain http: no Secure flag
        var q = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/state"); q.Headers.Add("Cookie", sc.Split(';')[0]);
        var st = await (await phone.SendAsync(q)).Json(); Assert.True(st.GetProperty("authenticated").GetBoolean()); Assert.Equal("control", st.GetProperty("role").GetString());
        // a cross-site write with that cookie is still refused (Lax is not the guard; the Origin check is)
        var w = new HttpRequestMessage(HttpMethod.Post, "/api/v1/stream/pause"); w.Headers.Add("Cookie", sc.Split(';')[0]); w.Headers.Add("Origin", "http://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.SendAsync(w)).StatusCode);
    }

    [Fact]
    public async Task Calibration_qr_opens_the_secure_setup_page_and_the_short_link_follows_with_https_on()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        var tok = (await (await admin.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).Json()).GetProperty("token").GetString()!;
        var host = PhoneApi.PhoneHost(new Microsoft.AspNetCore.Http.DefaultHttpContext { Request = { Host = new Microsoft.AspNetCore.Http.HostString(new Uri(f.Base).Authority) } }, f.Server.S);
        var qr = await admin.GetStringAsync($"/api/v1/calibration/phone-link/{tok}/qr.svg");
        Assert.Equal(SystemApi.QrSvg($"http://{host}:{f.Cfg.HttpPort}/tls/setup?next=cal&cal={tok}"), qr);
        Assert.NotEqual(SystemApi.QrSvg($"http://{host}:{f.Cfg.HttpPort}/c/{tok}"), qr);
        f.Server.S.Ca.Enable(IPAddress.Parse("192.168.1.50"));
        using var phone = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        var go = await phone.GetAsync($"/c/{tok}"); Assert.Equal(HttpStatusCode.Redirect, go.StatusCode);
        Assert.EndsWith($"/tls/setup?next=cal&cal={tok}", go.Headers.Location!.ToString()); Assert.DoesNotContain("/tls/check", go.Headers.Location!.ToString());
    }
}
