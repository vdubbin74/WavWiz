using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

/// <summary>F274 (0.7.3): the phones' secure connection is on by default (D1), one http-first QR (to=secure), the reworked phone page,
/// "Secure connection ✓" reported by the phone itself (LAN-only, rate-limited, grants nothing; D4) and no bare "HTTPS is off" anywhere.</summary>
public class F274PhoneSecureTests
{
    [Fact]
    public void Auto_enable_targets_a_home_address_only()
    {
        Assert.Null(TlsAuto.Target(new ServerConfig { BindAddress = "127.0.0.1" }, false));
        Assert.Equal(IPAddress.Parse("192.168.1.20"), TlsAuto.Target(new ServerConfig { BindAddress = "192.168.1.20" }, false));
        Assert.Equal(IPAddress.Parse("192.168.1.30"), TlsAuto.Target(new ServerConfig { BindAddress = "0.0.0.0", AdvertiseAddress = "192.168.1.30" }, true));   // Docker bridge + advertise
        Assert.Null(TlsAuto.Target(new ServerConfig { BindAddress = "0.0.0.0" }, true));                                                                      // Docker bridge, no advertise
        Assert.Equal(IPAddress.Any, TlsAuto.Target(new ServerConfig { BindAddress = "0.0.0.0" }, false));                                                     // same as the manual button
    }

    [Fact]
    public void Auto_enable_runs_once_on_a_lan_bind_and_never_on_loopback()
    {
        using var t = new TempDir(); var log = new List<string>();
        var ca = new LocalCa(t.Path, _ => new[] { IPAddress.Parse("192.168.1.20") });
        Assert.Null(TlsAuto.Run(new ServerConfig { BindAddress = "127.0.0.1" }, ca, log.Add, false)); Assert.False(ca.Enabled); Assert.Empty(log);
        Assert.Null(TlsAuto.Run(new ServerConfig { BindAddress = "192.168.1.20" }, ca, log.Add, false));
        Assert.True(ca.Enabled); Assert.Contains(log, l => l.StartsWith("HTTPS set up automatically for phones"));
        var root = ca.RootSha256; log.Clear();
        Assert.Null(TlsAuto.Run(new ServerConfig { BindAddress = "192.168.1.20" }, ca, log.Add, false));   // upgrade with it on: untouched
        Assert.Equal(root, ca.RootSha256); Assert.Empty(log);
    }

    [Fact]
    public async Task Status_says_state_off_or_error_and_never_warns_needs_https()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var st = await admin.GetJson("/api/v1/status");
        Assert.Equal("off", st.GetProperty("tls").GetProperty("state").GetString());          // loopback test server: manual, and no warning
        Assert.DoesNotContain(st.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.Contains("HTTPS"));
        f.Server.S.TlsAutoError = "access denied";
        st = await admin.GetJson("/api/v1/status");
        Assert.Equal("error", st.GetProperty("tls").GetProperty("state").GetString()); Assert.Equal("access denied", st.GetProperty("tls").GetProperty("error").GetString());
        Assert.Contains(st.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.StartsWith("Secure connection for phones couldn't be set up: access denied. Music works normally."));
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true })).StatusCode);
        st = await admin.GetJson("/api/v1/status");
        Assert.Equal("on", st.GetProperty("tls").GetProperty("state").GetString()); Assert.Null(f.Server.S.TlsAutoError);
        Assert.DoesNotContain(st.GetProperty("warnings").EnumerateArray(), w => w.GetString()!.Contains("HTTPS") || w.GetString()!.Contains("secure connection", StringComparison.OrdinalIgnoreCase));
        var diag = await admin.GetJson("/api/v1/diagnostics"); var checks = diag.GetProperty("checks").EnumerateArray().ToList();
        Assert.Contains(checks, c => c.GetProperty("title").GetString() == "Secure connection for phones" && c.GetProperty("detail").GetString()!.StartsWith("On, renews by itself (valid "));
        Assert.Contains(checks, c => c.GetProperty("title").GetString() == "Phones with a secure connection");
        // W3: the remote line no longer says "off"
        Assert.Equal("Not used. Phones at home use WavWiz's own secure connection.", st.GetProperty("tls").GetProperty("remote").GetProperty("text").GetString());
    }

    [Fact]
    public async Task Secure_qr_opens_the_http_setup_page_with_next_and_keeps_the_cal_hand_off()
    {
        Assert.Equal("/tls/setup?next=app", PhoneApi.SecurePath(null, null));
        Assert.Equal("/tls/setup?next=app", PhoneApi.SecurePath("app", "ABC123"));
        Assert.Equal("/tls/setup?next=cal&cal=ABC123", PhoneApi.SecurePath("cal", "ABC123"));
        Assert.Equal("/tls/setup?next=app", PhoneApi.SecurePath("cal", "AB<12"));      // invalid codes are dropped
        await using var f = await ServerFixture.StartAsync();
        var sec = await f.Http.GetStringAsync("/tls/qr.svg?to=secure");
        Assert.Contains("<svg", sec); Assert.NotEqual(await f.Http.GetStringAsync("/tls/qr.svg?to=setup"), sec);
        Assert.NotEqual(sec, await f.Http.GetStringAsync("/tls/qr.svg?to=secure&next=cal&cal=ABC123"));
        Assert.Equal(sec, await f.Http.GetStringAsync("/tls/qr.svg?to=secure&next=cal&cal=junk!"));
        Assert.Equal(sec, SystemApi.QrSvg($"http://{PhoneApi.PhoneHost(new Microsoft.AspNetCore.Http.DefaultHttpContext { Request = { Host = new Microsoft.AspNetCore.Http.HostString(new Uri(f.Base).Authority) } }, f.Server.S)}:{f.Cfg.HttpPort}/tls/setup?next=app"));
    }

    [Fact]
    public async Task Setup_page_puts_the_status_first_then_this_phones_steps_and_says_the_truth_about_address_changes()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin));
        var off = await f.Http.GetStringAsync("/tls/setup");
        Assert.Contains("Secure connection isn't ready yet", off); Assert.Contains("WavWiz works on this phone already", off); Assert.Contains("id=enableTls", off);
        Assert.DoesNotContain("HTTPS is not switched on yet", off);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true })).StatusCode);
        var on = await f.Http.GetStringAsync("/tls/setup?next=app");
        int st = on.IndexOf("id=status"), ios = on.IndexOf("id=steps-ios"), and = on.IndexOf("id=steps-android"), a2 = on.IndexOf("id=a2hs-ios");
        Assert.True(st > 0 && st < ios && ios < and && and < a2, "status card first, then the steps, Add to Home Screen last");
        Assert.Contains("Make this phone secure", on); Assert.Contains("Using Android?", on); Assert.Contains("Using an iPhone?", on);
        Assert.Contains("class=callout", on); Assert.Contains("the step most people miss", on); Assert.Contains("Certificate Trust Settings", on);
        Assert.Contains("If your PC gets a new address, WavWiz may ask you to set up phones again. Reserving the PC's address in your router avoids this.", on);
        Assert.DoesNotContain("You do not need to repeat these steps", on);
        Assert.Contains("/tls/qr.svg?to=secure", on);
    }

    [Fact]
    public void Trust_reports_are_https_and_lan_only_rate_limited_and_capped()
    {
        Assert.True(PhoneTrust.AcceptsSource(true, IPAddress.Parse("192.168.1.80")));
        Assert.True(PhoneTrust.AcceptsSource(true, IPAddress.Parse("::ffff:10.0.0.9")));
        Assert.True(PhoneTrust.AcceptsSource(true, IPAddress.Parse("100.101.1.2")));          // Tailscale
        Assert.False(PhoneTrust.AcceptsSource(false, IPAddress.Parse("192.168.1.80")));       // plain http proves nothing
        Assert.False(PhoneTrust.AcceptsSource(true, IPAddress.Loopback));
        Assert.False(PhoneTrust.AcceptsSource(true, IPAddress.Parse("8.8.8.8")));
        Assert.False(PhoneTrust.AcceptsSource(true, null));
        var now = new DateTimeOffset(2026, 11, 26, 18, 0, 0, TimeSpan.Zero);
        try
        {
            PhoneTrust.Now = () => now; PhoneTrust.ResetRate();
            for (int i = 0; i < 10; i++) Assert.True(PhoneTrust.Allow("192.168.1.80"));
            Assert.False(PhoneTrust.Allow("192.168.1.80"), "the 11th call in a minute");
            Assert.True(PhoneTrust.Allow("192.168.1.81"), "per address");
            now = now.AddSeconds(61); Assert.True(PhoneTrust.Allow("192.168.1.80"));
        }
        finally { PhoneTrust.Now = () => DateTimeOffset.UtcNow; PhoneTrust.ResetRate(); }
        Assert.Equal("iPhone", PhoneTrust.CleanName("iPhone")); Assert.Equal("script", PhoneTrust.CleanName("<script>")); Assert.Equal("Phone", PhoneTrust.CleanName("<>/\"")); Assert.Equal("Phone", PhoneTrust.CleanName(null));
        Assert.Equal("scriptalert(1)script", PhoneTrust.CleanName("<script>alert(1)</script>").Replace(" ", ""));
        Assert.True(PhoneTrust.CleanName(new string('a', 90)).Length <= 40);
    }

    [Fact]
    public async Task Checklist_phone_step_ticks_only_when_a_phone_reported_trust_and_a_new_ca_clears_it()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin));
        JsonElement Phone(JsonElement c) => c.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetString() == "phone");
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true })).StatusCode);
        var p = Phone(await admin.GetJson("/api/v1/checklist"));
        Assert.False(p.GetProperty("done").GetBoolean(), "HTTPS on is not a phone set up"); Assert.Equal("Make your phone secure (optional)", p.GetProperty("title").GetString());
        Assert.Equal(DiagnosticsApi.SecureWhy, p.GetProperty("detail").GetString());
        // plain http from the test client: refused, nothing stored
        var r = await f.Http.PostAsync("/api/v1/tls/trusted", new StringContent("{\"device\":\"iPhone\"}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode); Assert.Empty(PhoneTrust.List(f.Server.S.Db));
        for (int i = 0; i < 25; i++) PhoneTrust.Record(f.Server.S.Db, "Phone " + i);
        Assert.Equal(PhoneTrust.Max, PhoneTrust.List(f.Server.S.Db).Count);
        PhoneTrust.Record(f.Server.S.Db, "iPhone");
        p = Phone(await admin.GetJson("/api/v1/checklist"));
        Assert.True(p.GetProperty("done").GetBoolean()); Assert.StartsWith("iPhone: Secure \u2713 (", p.GetProperty("detail").GetString());
        Assert.Equal("iPhone", p.GetProperty("devices")[0].GetProperty("name").GetString());
        var st = await admin.GetJson("/api/v1/status"); Assert.Equal("iPhone", st.GetProperty("tls").GetProperty("trustedDevices")[0].GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true })).StatusCode);   // refresh: kept
        Assert.NotEmpty(PhoneTrust.List(f.Server.S.Db));
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true, recreate = true })).StatusCode);   // new CA: every phone again
        Assert.Empty(PhoneTrust.List(f.Server.S.Db)); Assert.False(Phone(await admin.GetJson("/api/v1/checklist")).GetProperty("done").GetBoolean());
    }
}
