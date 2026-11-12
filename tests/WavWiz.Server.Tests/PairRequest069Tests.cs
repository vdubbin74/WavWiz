using System.Net;
using System.Text.Json;
using WavWiz.PlayerCore.Discovery;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #15: smooth first-run pairing by administrator approval. Nothing is granted before an admin approves; a Player token stays a Player token.</summary>
public class PairRequest069Tests
{
    static async Task<JsonElement> Post(HttpClient c, string url, object body) { var r = await c.PostAsJsonAsync(url, body); return await r.Json(); }

    [Fact]
    public async Task A_new_PC_shows_up_at_once_for_admins_and_gets_a_player_token_plus_a_window_session_only_after_approval()
    {
        await using var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true);
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        var req = await Post(f.Http, "/api/v1/auth/pair-request", new { kind = "player", playerId = "pc-office", name = "Office PC", machine = "OFFICE-PC" });
        string id = req.GetProperty("id").GetString()!, secret = req.GetProperty("secret").GetString()!, match = req.GetProperty("match").GetString()!;
        Assert.Matches("^[0-9]{4}$", match);

        // listed for admins at once, with the same match code; never for a paired phone (Control)
        var list = (await admin.GetJson("/api/v1/pairing/requests")).GetProperty("requests");
        var item = Assert.Single(list.EnumerateArray());
        Assert.Equal("Office PC", item.GetProperty("name").GetString()); Assert.Equal(match, item.GetProperty("match").GetString()); Assert.Equal("player", item.GetProperty("kind").GetString());
        Assert.False(item.TryGetProperty("secret", out _));
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).GetAsync("/api/v1/pairing/requests")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).PostAsync($"/api/v1/pairing/requests/{id}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.PostAsync($"/api/v1/pairing/requests/{id}/approve", null)).StatusCode);

        // pending: no token; a wrong secret learns nothing
        var p = await Post(f.Http, $"/api/v1/auth/pair-request/{id}/poll", new { secret });
        Assert.Equal("pending", p.GetProperty("status").GetString()); Assert.False(p.TryGetProperty("token", out _));
        var wrong = await f.Http.PostAsJsonAsync($"/api/v1/auth/pair-request/{id}/poll", new { secret = "guess" });
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode); Assert.Equal("expired", (await wrong.Json()).GetProperty("status").GetString());

        (await admin.PostAsync($"/api/v1/pairing/requests/{id}/approve", null)).EnsureSuccessStatusCode();
        Assert.Empty((await admin.GetJson("/api/v1/pairing/requests")).GetProperty("requests").EnumerateArray());
        p = await Post(f.Http, $"/api/v1/auth/pair-request/{id}/poll", new { secret });
        Assert.Equal("approved", p.GetProperty("status").GetString());
        var player = p.GetProperty("token").GetString()!; var ui = p.GetProperty("uiToken").GetString()!;
        Assert.True(p.GetProperty("audioPort").GetInt32() > 0);

        var auth = f.Server.S.Auth;
        Assert.Equal(Role.Player, auth.Validate(player)!.Role); Assert.Equal("pc-office", auth.Validate(player)!.PlayerId);
        Assert.Equal(Role.Control, auth.Validate(ui)!.Role);
        Assert.Null(auth.Validate(ui)!.PlayerId);

        // the Player token opens nothing in the UI and can never be elevated, even with the right admin password
        var asPlayer = f.As(player);
        Assert.False((await asPlayer.GetJson("/api/v1/auth/state")).GetProperty("authenticated").GetBoolean());
        Assert.NotEqual(HttpStatusCode.OK, (await asPlayer.PostAsJsonAsync("/api/v1/auth/elevate", new { password = "correct horse battery" })).StatusCode);
        Assert.Equal(Role.Player, auth.Validate(player)!.Role);
        // the window session is a normal paired Control session: signed in, not admin
        var st = await f.As(ui).GetJson("/api/v1/auth/state");
        Assert.True(st.GetProperty("authenticated").GetBoolean()); Assert.Equal("control", st.GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(ui).GetAsync("/api/v1/tokens")).StatusCode);

        // answers are given once
        Assert.Equal(HttpStatusCode.NotFound, (await f.Http.PostAsJsonAsync($"/api/v1/auth/pair-request/{id}/poll", new { secret })).StatusCode);
    }

    [Fact]
    public async Task Deny_gives_nothing_and_a_window_request_gets_its_own_cookie_session_never_a_token_in_the_body()
    {
        await using var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true);
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        var a = await Post(f.Http, "/api/v1/auth/pair-request", new { kind = "player", playerId = "pc-x", name = "Stranger" });
        (await admin.PostAsync($"/api/v1/pairing/requests/{a.GetProperty("id").GetString()}/deny", null)).EnsureSuccessStatusCode();
        var p = await Post(f.Http, $"/api/v1/auth/pair-request/{a.GetProperty("id").GetString()}/poll", new { secret = a.GetProperty("secret").GetString() });
        Assert.Equal("denied", p.GetProperty("status").GetString()); Assert.False(p.TryGetProperty("token", out _));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/v1/pairing/requests/{a.GetProperty("id").GetString()}/approve", null)).StatusCode);   // decided already

        var w = await Post(f.Http, "/api/v1/auth/pair-request", new { kind = "window", name = "Kitchen PC" });
        (await admin.PostAsync($"/api/v1/pairing/requests/{w.GetProperty("id").GetString()}/approve", null)).EnsureSuccessStatusCode();
        var r = await f.Http.PostAsJsonAsync($"/api/v1/auth/pair-request/{w.GetProperty("id").GetString()}/poll", new { secret = w.GetProperty("secret").GetString() });
        var body = await r.Json();
        Assert.Equal("approved", body.GetProperty("status").GetString()); Assert.False(body.TryGetProperty("token", out _)); Assert.False(body.TryGetProperty("uiToken", out _));
        var cookie = r.Headers.GetValues("Set-Cookie").First();
        Assert.StartsWith("wavwiz_session=", cookie); Assert.Contains("httponly", cookie.ToLowerInvariant());
        var tok = cookie.Split(';')[0].Split('=', 2)[1];
        Assert.Equal(Role.Control, f.Server.S.Auth.Validate(tok)!.Role);
    }

    [Fact]
    public async Task Requests_are_capped_per_device_a_restarted_player_replaces_its_own_and_they_expire()
    {
        await using var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true);
        await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin));
        for (int i = 0; i < 3; i++) (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-request", new { kind = "player", playerId = "pc-same", name = "Same PC" })).EnsureSuccessStatusCode();
        Assert.Single((await admin.GetJson("/api/v1/pairing/requests")).GetProperty("requests").EnumerateArray());   // one card per PC, not three
        for (int i = 0; i < 2; i++) (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-request", new { kind = "window", name = "w" + i })).EnsureSuccessStatusCode();
        Assert.Equal((HttpStatusCode)429, (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-request", new { kind = "window", name = "w3" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Http.PostAsJsonAsync("/api/v1/auth/pair-request", new { kind = "player", playerId = "../x" })).StatusCode);

        var reqs = f.Server.S.PairReqs; var now = DateTimeOffset.UtcNow; reqs.Now = () => now + PairRequests.Ttl + TimeSpan.FromSeconds(1);
        Assert.Empty((await admin.GetJson("/api/v1/pairing/requests")).GetProperty("requests").EnumerateArray());
    }

    [Fact]
    public async Task A_code_from_the_admin_also_opens_the_player_window_but_pairing_on_the_server_pc_without_a_code_does_not()
    {
        await using (var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true))
        {
            await f.SetupAdmin();
            var code = (await (await f.As(f.Token(Role.Admin)).PostAsync("/api/v1/pairing/code", null)).Json()).GetProperty("code").GetString();
            var p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-c", name = "Den PC", code });
            Assert.Equal(Role.Control, f.Server.S.Auth.Validate(p.GetProperty("uiToken").GetString()!)!.Role);
            Assert.Equal(Role.Player, f.Server.S.Auth.Validate(p.GetProperty("token").GetString()!)!.Role);
        }
        await using (var f = await ServerFixture.StartAsync())
        {
            await f.SetupAdmin();
            var p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-l", name = "Server PC" });
            Assert.Equal(JsonValueKind.Null, p.GetProperty("uiToken").ValueKind);
        }
    }

    [Fact]
    public async Task The_Player_client_asks_waits_and_receives_both_tokens_once_the_admin_approves()
    {
        await using var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true);
        await f.SetupAdmin();
        var u = new Uri(f.Base);
        var req = await PairingClient.RequestApprovalAsync(u.Host, u.Port, "pc-den", "Den PC", "DEN");
        Assert.NotNull(req.Id); Assert.Matches("^[0-9]{4}$", req.Match!);
        Assert.Equal("pending", (await PairingClient.PollApprovalAsync(u.Host, u.Port, req.Id!, req.Secret!)).Status);
        (await f.As(f.Token(Role.Admin)).PostAsync($"/api/v1/pairing/requests/{req.Id}/approve", null)).EnsureSuccessStatusCode();
        var a = await PairingClient.PollApprovalAsync(u.Host, u.Port, req.Id!, req.Secret!);
        Assert.Equal("approved", a.Status);
        Assert.Equal(Role.Player, f.Server.S.Auth.Validate(a.Result!.Token!)!.Role);
        Assert.Equal(Role.Control, f.Server.S.Auth.Validate(a.Result!.UiToken!)!.Role);
        Assert.Equal("expired", (await PairingClient.PollApprovalAsync(u.Host, u.Port, req.Id!, req.Secret!)).Status);
        // nobody listening = "offline" (keep waiting), never an exception
        Assert.Equal("offline", (await PairingClient.PollApprovalAsync("127.0.0.1", 1, "x", "y")).Status);
    }

    [Theory]
    [InlineData(200, "{\"status\":\"pending\"}", "pending")]
    [InlineData(200, "{\"status\":\"denied\"}", "denied")]
    [InlineData(404, "{\"status\":\"expired\"}", "expired")]
    [InlineData(500, "{}", "offline")]
    [InlineData(200, "{\"status\":\"approved\"}", "pending")]   // approved without a token is not a pairing (window-kind answers never reach the Player)
    public void Poll_answers_map_to_a_status(int http, string json, string want) => Assert.Equal(want, PairingClient.ParseAnswer(http, JsonDocument.Parse(json).RootElement).Status);

    [Fact]
    public void The_Player_window_gets_its_session_only_when_it_has_none_and_never_the_player_token()
    {
        var root = AppContext.BaseDirectory; while (!File.Exists(Path.Combine(root, "WavWiz.sln"))) root = Path.GetDirectoryName(root)!;
        var forms = File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "Forms.cs"));
        var app = File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "PlayerApp.cs"));
        Assert.Contains("new DpapiSecretStore().Load(\"uitoken\")", forms);
        Assert.Contains("if (have.Any(c => c.Name == \"wavwiz_session\")) return;", forms);
        Assert.DoesNotContain("Load(\"token\")", forms);
        Assert.Contains("await EnsureWindowSession(cw);", forms);
        Assert.Contains("if (!here && code == null)", app);   // no code typed -> approval
        Assert.Contains("_secrets.Delete(\"uitoken\"); Application.Restart();", app);
    }
}
