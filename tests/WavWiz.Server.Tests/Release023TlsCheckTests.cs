using System.Net;
using System.Text.RegularExpressions;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>
/// 0.2.3 fix: on an iPhone the phone set-up page (/tls/check) loaded its CSS but showed a broken logo, hidden steps and a dead "Check my phone" button.
/// With "Send web browsers on other devices to the secure (HTTPS) address" on, every GET from another device except /tls*, /api, /ws and /c/ was redirected
/// to https. /tls.css slipped through (it starts with "/tls"), but /assets/logo-64.png and /js/tls-setup.js were 302'd to https://host:47801/..., which the
/// page's CSP ('self' = the http origin) refuses - so the script never ran, on trusted and untrusted phones alike.
/// </summary>
public class TlsCheckPageTests
{
    private static string RealWebRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent)
        {
            var w = Path.Combine(d.FullName, "src", "WavWiz.Server", "wwwroot");
            if (File.Exists(Path.Combine(w, "js", "tls-setup.js"))) return w;
        }
        throw new DirectoryNotFoundException("wwwroot not found above " + AppContext.BaseDirectory);
    }

    [Theory]
    [InlineData("/js/tls-setup.js")]
    [InlineData("/assets/logo-64.png")]
    [InlineData("/favicon.ico")]
    [InlineData("/tls.css")]
    [InlineData("/JS/TLS-SETUP.JS")]
    public void The_set_up_pages_own_files_are_never_redirected(string path)
        => Assert.False(RedirectPolicy.ShouldRedirect("GET", path, false, true, true, false, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Safari/604.1"));

    [Theory]
    [InlineData("/js/main.js")]
    [InlineData("/js/devices.js")]
    [InlineData("/assets/logo-128.png")]
    [InlineData("/app.css")]
    [InlineData("/js/tls-setup.js.map")]
    public void The_rest_of_the_app_is_still_redirected(string path)
        => Assert.True(RedirectPolicy.ShouldRedirect("GET", path, false, true, true, false, "Mozilla/5.0 (iPhone)"));

    [Theory]
    [InlineData("/tls/check")]
    [InlineData("/tls/setup")]
    public async Task Every_file_the_phone_set_up_page_loads_comes_over_plain_http_with_the_redirect_on(string page)
    {
        await using var f = await ServerFixture.StartAsync(c => { c.TestTreatAllClientsAsRemote = true; c.WebRoot = RealWebRoot(); });
        await f.SetupAdmin();
        f.Server.S.Ca.Enable(IPAddress.Parse("192.168.1.50"));
        f.Server.S.Db.SetSetting("tls.redirect", "true");
        using var phone = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        phone.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");

        // sanity: the redirect is on for the app itself
        Assert.Equal(HttpStatusCode.Redirect, (await phone.GetAsync("/js/main.js")).StatusCode);

        var r = await phone.GetAsync(page); Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var html = await r.Content.ReadAsStringAsync();
        var refs = Regex.Matches(html, @"(?:src|href)='(/[^']*)'").Select(m => WebUtility.HtmlDecode(m.Groups[1].Value)).Distinct().ToList();
        Assert.Contains("/js/tls-setup.js", refs); Assert.Contains("/assets/logo-64.png", refs); Assert.Contains("/tls.css", refs);
        var expect = new Dictionary<string, string> { ["/js/tls-setup.js"] = "javascript", ["/assets/logo-64.png"] = "image/png", ["/tls.css"] = "text/css", ["/favicon.ico"] = "image/" };
        foreach (var u in refs)
        {
            var a = await phone.GetAsync(u);
            Assert.True(a.StatusCode == HttpStatusCode.OK, $"{page} loads {u}: got {(int)a.StatusCode} {a.Headers.Location}");
            if (expect.TryGetValue(u, out var ct)) Assert.Contains(ct, a.Content.Headers.ContentType!.ToString());
        }
    }

    // ---- 0.2.3 fix: the ?cal= hand-off is in the page HTML itself, so it works even if tls-setup.js cannot run ----
    private static async Task<(ServerFixture f, HttpClient phone)> Phone(bool redirect, bool ca = true)
    {
        var f = await ServerFixture.StartAsync(c => { c.TestTreatAllClientsAsRemote = true; c.WebRoot = RealWebRoot(); });
        await f.SetupAdmin();
        if (ca) f.Server.S.Ca.Enable(IPAddress.Parse("192.168.1.50"));
        f.Server.S.Db.SetSetting("tls.redirect", redirect ? "true" : "false");
        var phone = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        phone.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
        return (f, phone);
    }

    [Theory]
    [InlineData("/tls/check", true)]
    [InlineData("/tls/check", false)]
    [InlineData("/tls/setup", true)]
    [InlineData("/tls/setup", false)]
    public async Task A_valid_cal_code_puts_a_secure_calibration_link_in_the_page(string page, bool redirect)
    {
        var (f, phone) = await Phone(redirect);
        await using var _ = f; using var __ = phone;
        var r = await phone.GetAsync(page + "?cal=ABC234&pair=123456");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("no-store", r.Headers.CacheControl!.ToString());
        var html = await r.Content.ReadAsStringAsync();
        var want = $"https://127.0.0.1:{f.Cfg.HttpsPort}/calmic.html?cal=ABC234";       // 0.2.5: the mic-only page; no pairing code is passed on
        Assert.Contains($"<a class=btn id=calgoLink href='{want}'>Continue to secure calibration</a>", html);
        Assert.Equal(CalPhoneApi_SecureUrl(f, "ABC234", "123456"), WebUtility.HtmlDecode(want));
        Assert.Contains("Certificate Trust Settings. Then come back and tap the button again.", html);
        // the install steps are on the same page, after the button
        Assert.True(html.IndexOf("id=calgoLink", StringComparison.Ordinal) < html.IndexOf("Download profile", StringComparison.Ordinal));
        // without a pairing code the link carries only cal=
        var h2 = await (await phone.GetAsync(page + "?cal=abc234")).Content.ReadAsStringAsync();
        Assert.Contains($"href='https://127.0.0.1:{f.Cfg.HttpsPort}/calmic.html?cal=abc234'>", h2);
    }

    private static string CalPhoneApi_SecureUrl(ServerFixture f, string cal, string? pair) => Api.CalPhoneApi.SecureUrl("127.0.0.1", f.Cfg.HttpsPort, cal, pair);

    [Theory]
    [InlineData("ABC23")]                       // too short
    [InlineData("ABC2345")]                     // too long
    [InlineData("AB%27C23")]                    // AB'C23
    [InlineData("%3Cscript%3Ealert(1)%3C/script%3E")]
    [InlineData("ABC%2023")]                    // space
    [InlineData("")]
    public async Task A_bad_cal_code_gets_no_link_and_never_reaches_the_page(string cal)
    {
        var (f, phone) = await Phone(true);
        await using var _ = f; using var __ = phone;
        var html = await (await phone.GetAsync("/tls/check?cal=" + cal + "&pair=123456")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("calgoLink", html); Assert.DoesNotContain("?cal=", html);
        Assert.DoesNotContain("<script>alert", html); Assert.DoesNotContain("AB'C23", html);
        Assert.Contains("Download profile", html);
    }

    [Theory]
    [InlineData("12345")]
    [InlineData("12345a")]
    [InlineData("123456%27%3E%3Cb%3E")]
    public async Task A_bad_pair_code_is_dropped_but_the_cal_link_stays(string pair)
    {
        var (f, phone) = await Phone(false);
        await using var _ = f; using var __ = phone;
        var html = await (await phone.GetAsync("/tls/check?cal=ABC234&pair=" + pair)).Content.ReadAsStringAsync();
        Assert.Contains($"href='https://127.0.0.1:{f.Cfg.HttpsPort}/calmic.html?cal=ABC234'>", html);
        Assert.DoesNotContain("pair=", html); Assert.DoesNotContain("'><b>", html);
    }

    [Fact]
    public async Task No_calibration_link_while_HTTPS_is_not_set_up_or_without_cal()
    {
        var (f, phone) = await Phone(false, ca: false);
        await using (f) using (phone)
            Assert.DoesNotContain("calgoLink", await (await phone.GetAsync("/tls/check?cal=ABC234")).Content.ReadAsStringAsync());
        var (g, p2) = await Phone(true);
        await using (g) using (p2)
            Assert.DoesNotContain("calgoLink", await (await p2.GetAsync("/tls/check")).Content.ReadAsStringAsync());
    }
}
