using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
namespace WavWiz.Server.Tests;

public class ApiTests
{
    [Fact]
    public async Task Fresh_server_reports_BETA_version_requires_login_and_serves_the_static_shell()
    {
        await using var f = await ServerFixture.StartAsync();
        var st = await f.Http.GetJson("/api/v1/auth/state");
        Assert.True(st.GetProperty("setupRequired").GetBoolean()); Assert.True(st.GetProperty("beta").GetBoolean()); Assert.Equal("BETA", st.GetProperty("channel").GetString());
        Assert.Matches(@"^0\.[01]\.\d+$", st.GetProperty("appVersion").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.GetAsync("/api/v1/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.GetAsync("/api/v1/zones")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await f.Http.GetAsync("/api/v1/does-not-exist")).StatusCode);
        Assert.Contains("ok", await f.Http.GetStringAsync("/"));
        var h = (await f.Http.GetAsync("/")).Headers; Assert.True(h.Contains("Content-Security-Policy")); Assert.Equal("nosniff", h.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task First_run_password_is_set_once_from_this_machine_and_login_is_rate_limited()
    {
        await using var f = await ServerFixture.StartAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Http.PostAsJsonAsync("/api/v1/auth/setup", new { password = "short" })).StatusCode);
        var cookie = await f.SetupAdmin("a long enough password");
        Assert.Equal(HttpStatusCode.Conflict, (await f.Http.PostAsJsonAsync("/api/v1/auth/setup", new { password = "another long password" })).StatusCode);   // cannot be re-run by a stranger
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/v1/status"); req.Headers.Add("Cookie", "unison_session=" + cookie);
        var ok = await f.Http.SendAsync(req); Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var s = await ok.Json(); Assert.Equal("BETA", s.GetProperty("channel").GetString()); Assert.True(s.GetProperty("beta").GetBoolean());
        for (int i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.PostAsJsonAsync("/api/v1/auth/login", new { password = "wrong" + i })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await f.Http.PostAsJsonAsync("/api/v1/auth/login", new { password = "a long enough password" })).StatusCode);   // even the right one, until the minute passes
        var set = (await f.Http.PostAsJsonAsync("/api/v1/auth/setup", new { password = "xxxxxxxxxx" })); Assert.Equal(HttpStatusCode.Conflict, set.StatusCode);
    }

    [Fact]
    public async Task Session_cookie_is_httponly_samesite_strict_and_cross_site_writes_are_refused()
    {
        await using var f = await ServerFixture.StartAsync();
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/setup", new { password = "a long enough password" });
        var sc = r.Headers.GetValues("Set-Cookie").First(); Assert.Contains("httponly", sc, StringComparison.OrdinalIgnoreCase); Assert.Contains("samesite=strict", sc, StringComparison.OrdinalIgnoreCase);
        var cookie = sc.Split(';')[0];
        HttpRequestMessage Post(string origin) { var q = new HttpRequestMessage(HttpMethod.Post, "/api/v1/stream/pause"); q.Headers.Add("Cookie", cookie); if (origin != "") q.Headers.Add("Origin", origin); return q; }
        Assert.Equal(HttpStatusCode.Forbidden, (await f.Http.SendAsync(Post("http://evil.example"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.Http.SendAsync(Post(""))).StatusCode);                       // browsers always send Origin on POST
        Assert.Equal(HttpStatusCode.OK, (await f.Http.SendAsync(Post(f.Base))).StatusCode);
        // a bearer token (non-browser client) has no ambient authority, so no Origin is needed
        var bearer = f.As(f.Token(Role.Control)); Assert.Equal(HttpStatusCode.OK, (await bearer.PostAsync("/api/v1/stream/pause", null)).StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/v1/zones", Role.View)] [InlineData("GET", "/api/v1/status", Role.View)] [InlineData("GET", "/api/v1/library/tree", Role.View)] [InlineData("GET", "/api/v1/radio", Role.View)]
    [InlineData("POST", "/api/v1/stream/pause", Role.Control)] [InlineData("POST", "/api/v1/zones/master", Role.Control)] [InlineData("POST", "/api/v1/radio", Role.Control)] [InlineData("POST", "/api/v1/calibration/sessions", Role.Control)]
    [InlineData("PUT", "/api/v1/dsp/assignments/x", Role.Control)] [InlineData("POST", "/api/v1/library/rescan", Role.Control)]
    [InlineData("POST", "/api/v1/library/roots", Role.Admin)] [InlineData("GET", "/api/v1/tokens", Role.Admin)] [InlineData("POST", "/api/v1/tokens", Role.Admin)] [InlineData("POST", "/api/v1/pairing/code", Role.Admin)]
    [InlineData("PUT", "/api/v1/settings", Role.Admin)] [InlineData("POST", "/api/v1/tls/enable", Role.Admin)] [InlineData("DELETE", "/api/v1/players/x", Role.Admin)]
    public async Task Role_x_endpoint_matrix(string method, string url, Role needed)
    {
        await using var f = await ServerFixture.StartAsync();
        HttpResponseMessage? Call(HttpClient c) => c.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = method == "GET" ? null : new StringContent("{}", System.Text.Encoding.UTF8, "application/json") }).Result;
        Assert.Equal(HttpStatusCode.Unauthorized, Call(f.Http)!.StatusCode);
        foreach (var role in new[] { Role.View, Role.Control, Role.Admin })
        {
            var code = Call(f.As(f.Token(role)))!.StatusCode;
            if ((int)role < (int)needed) Assert.Equal(HttpStatusCode.Forbidden, code);
            else Assert.NotEqual(HttpStatusCode.Forbidden, code);
            Assert.NotEqual(HttpStatusCode.Unauthorized, code);
        }
        var player = f.As(f.Server.S.Auth.CreateToken("p", Role.Player, "pid"));      // a player token must open nothing on the web API
        Assert.Equal(HttpStatusCode.Forbidden, Call(player)!.StatusCode);
    }

    [Fact]
    public async Task Pairing_gives_control_access_once_per_code_and_local_player_pairing_returns_a_player_only_token()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin));
        var code = (await (await admin.PostAsync("/api/v1/pairing/code", null)).Json()).GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.PostAsJsonAsync("/api/v1/auth/pair", new { code = "000000" })).StatusCode);
        var p = await f.Http.PostAsJsonAsync("/api/v1/auth/pair", new { code, name = "Kitchen phone", wantToken = true }); Assert.Equal(HttpStatusCode.OK, p.StatusCode);
        var tok = (await p.Json()).GetProperty("token").GetString()!; var phone = f.As(tok);
        Assert.Equal(HttpStatusCode.OK, (await phone.PostAsync("/api/v1/stream/pause", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.GetAsync("/api/v1/tokens")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.PostAsJsonAsync("/api/v1/auth/pair", new { code })).StatusCode);              // single use
        var pp = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "pc-1", name = "Office PC" }); Assert.Equal(HttpStatusCode.OK, pp.StatusCode);   // loopback = this machine
        var ptok = (await pp.Json()).GetProperty("token").GetString()!;
        Assert.Equal(Role.Player, f.Server.S.Auth.Validate(ptok)!.Role); Assert.Equal("pc-1", f.Server.S.Auth.Validate(ptok)!.PlayerId);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "../etc", name = "x" })).StatusCode);
        var again = (await (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "pc-1" })).Json()).GetProperty("token").GetString()!;
        Assert.Null(f.Server.S.Auth.Validate(ptok)); Assert.NotNull(f.Server.S.Auth.Validate(again));                                          // re-pairing revokes the old token
    }

    [Fact]
    public async Task Tokens_can_be_created_listed_and_revoked_and_are_shown_only_once()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var created = await (await admin.PostAsJsonAsync("/api/v1/tokens", new { name = "wall tablet", role = "view" })).Json(); var tok = created.GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await f.As(tok).GetAsync("/api/v1/zones")).StatusCode);
        var list = await (await admin.GetAsync("/api/v1/tokens")).Content.ReadAsStringAsync(); Assert.DoesNotContain(tok, list);
        var id = JsonDocument.Parse(list).RootElement.EnumerateArray().First(x => x.GetProperty("name").GetString() == "wall tablet").GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/api/v1/tokens/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.As(tok).GetAsync("/api/v1/zones")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/tokens", new { name = "x", role = "root" })).StatusCode);
    }

    [Fact]
    public async Task Server_refuses_to_start_on_all_interfaces_unless_opted_in()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(async () => { await using var f = await ServerFixture.StartAsync(c => c.BindAddress = "0.0.0.0"); });
    }

    [Fact]
    public async Task Library_via_api_scan_search_tree_and_validation()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        TestMedia.Tone(Path.Combine(music, "a.flac"), 1, 440, "Alpha Song", "The Band", "First Album", 1); TestMedia.Tone(Path.Combine(music, "b.flac"), 1, 440, "Beta Song", "The Band", "First Album", 2);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = "/no/such/place" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music })).StatusCode);      // adding the same folder twice is harmless (idempotent)
        for (int i = 0; i < 100; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 2) break; await Task.Delay(100); }
        var hits = await admin.GetJson("/api/v1/library/search?q=beta"); Assert.Equal(1, hits.GetArrayLength()); Assert.Equal("Beta Song", hits[0].GetProperty("title").GetString());
        var tree = await admin.GetJson("/api/v1/library/tree"); Assert.Equal(4, tree.GetProperty("nodes").GetArrayLength());
        Assert.Matches(@"^0\.[01]\.\d+$", (await admin.GetJson("/api/v1/status")).GetProperty("appVersion").GetString());
    }

    [Fact]
    public async Task Settings_are_validated_and_secrets_are_never_listed()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new { bt_x = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["bt.defaultLatencyMs"] = 99999 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["bt.defaultLatencyMs"] = 180, ["server.name"] = "Home" })).StatusCode);
        var all = await (await admin.GetAsync("/api/v1/settings")).Content.ReadAsStringAsync(); Assert.Contains("180", all); Assert.DoesNotContain("pbkdf2", all, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("admin.password", all);
    }

    [Fact]
    public async Task Tls_setup_page_and_downloads_work_only_after_an_admin_enables_it()
    {
        await using var f = await ServerFixture.StartAsync(c => c.BindAddress = "127.0.0.1"); var admin = f.As(f.Token(Role.Admin));
        Assert.Equal(HttpStatusCode.NotFound, (await f.Http.GetAsync("/tls/root-ca.crt")).StatusCode);
        Assert.Contains("not switched on yet", await f.Http.GetStringAsync("/tls/setup"));
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { })).StatusCode);            // 127.0.0.1 is useless to a phone: say so
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/tls/enable", new { allowLoopback = true })).StatusCode);
        var crt = await f.Http.GetAsync("/tls/root-ca.crt"); Assert.Equal("application/x-x509-ca-cert", crt.Content.Headers.ContentType!.MediaType);
        Assert.NotNull(System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadCertificate(await crt.Content.ReadAsByteArrayAsync()));
        Assert.Contains("<plist", await f.Http.GetStringAsync("/tls/root-ca.mobileconfig")); Assert.Contains("/tls/qr.svg", await f.Http.GetStringAsync("/tls/setup")); Assert.Contains("<svg", await f.Http.GetStringAsync("/tls/qr.svg")); Assert.Contains("Certificate Trust Settings", await f.Http.GetStringAsync("/tls/setup"));
    }
}
