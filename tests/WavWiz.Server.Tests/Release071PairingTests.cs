using System.Net;
using System.Text.Json;
using WavWiz.PlayerCore.Discovery;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2072u: on a Server + Player install the Player on the server PC pairs with no code and its WINDOW now gets a normal Control
/// session too (like a paired phone), once the administrator password exists. Before setup the window keeps the setup page. Never on a
/// headless/Docker server, never from a Docker bridge address, never under TestTreatAllClientsAsRemote. Admin still needs the password.</summary>
public class Release071PairingTests
{
    static async Task<JsonElement> Post(HttpClient c, string url, object body) { var r = await c.PostAsJsonAsync(url, body); return await r.Json(); }
    static Action<ServerConfig> WindowsPc => c => { c.TestHeadless = false; c.TestInContainer = false; };

    [Fact]
    public async Task Server_pc_player_gets_a_control_window_session_after_setup_and_admin_still_needs_the_password()
    {
        await using var f = await ServerFixture.StartAsync(WindowsPc);
        await f.SetupAdmin();
        var p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-here", name = "Living room PC" });
        var auth = f.Server.S.Auth;
        var player = p.GetProperty("token").GetString()!; var ui = p.GetProperty("uiToken").GetString()!;
        Assert.Equal(Role.Player, auth.Validate(player)!.Role);
        var w = auth.Validate(ui)!;
        Assert.Equal(Role.Control, w.Role); Assert.Null(w.PlayerId); Assert.Contains("Player window", w.Name);
        Assert.NotEqual(player, ui);

        var win = f.As(ui);
        var st = await win.GetJson("/api/v1/auth/state");
        Assert.True(st.GetProperty("authenticated").GetBoolean()); Assert.Equal("control", st.GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await win.GetAsync("/api/v1/tokens")).StatusCode);                    // not admin
        Assert.Equal(HttpStatusCode.Forbidden, (await win.PostAsync("/api/v1/pairing/code", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await win.PostAsJsonAsync("/api/v1/auth/elevate", new { password = "wrong password!" })).StatusCode);
        (await win.PostAsJsonAsync("/api/v1/auth/elevate", new { password = "correct horse battery" })).EnsureSuccessStatusCode();   // step-up with the password
    }

    [Fact]
    public async Task Before_setup_the_server_pc_player_gets_no_window_session_so_the_window_shows_the_setup_page()
    {
        await using var f = await ServerFixture.StartAsync(WindowsPc);
        var p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-early", name = "Early PC" });
        Assert.False(string.IsNullOrEmpty(p.GetProperty("token").GetString()));
        Assert.Equal(JsonValueKind.Null, p.GetProperty("uiToken").ValueKind);
        Assert.True((await f.Http.GetJson("/api/v1/auth/state")).GetProperty("setupRequired").GetBoolean());
        // after setup a local re-pair gets one
        await f.SetupAdmin();
        p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-early", name = "Early PC" });
        Assert.Equal(Role.Control, f.Server.S.Auth.Validate(p.GetProperty("uiToken").GetString()!)!.Role);
    }

    [Theory]
    [InlineData(true, false)]    // headless (Linux / Docker): no "this PC" browser
    [InlineData(false, true)]    // in a container
    public async Task Docker_and_headless_servers_never_hand_out_a_window_session_without_a_code(bool headless, bool container)
    {
        await using var f = await ServerFixture.StartAsync(c => { c.TestHeadless = headless; c.TestInContainer = container; });
        await f.SetupAdmin();
        var p = await Post(f.Http, "/api/v1/auth/pair-player", new { playerId = "pc-d", name = "Docker host" });
        Assert.Equal(JsonValueKind.Null, p.GetProperty("uiToken").ValueKind);
    }

    [Fact]
    public async Task A_remote_pc_without_a_code_gets_nothing()
    {
        await using var f = await ServerFixture.StartAsync(c => { c.TestHeadless = false; c.TestInContainer = false; c.TestTreatAllClientsAsRemote = true; });
        await f.SetupAdmin();
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "pc-r", name = "Remote" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        Assert.False((await r.Json()).TryGetProperty("uiToken", out _));
    }

    [Theory]
    [InlineData("127.0.0.1", false, false, false, false, true)]
    [InlineData("::1", false, false, false, false, true)]
    [InlineData("::ffff:127.0.0.1", false, false, false, false, true)]
    [InlineData("127.0.0.1", true, false, false, false, false)]     // setup not done yet
    [InlineData("127.0.0.1", false, true, false, false, false)]     // TestTreatAllClientsAsRemote
    [InlineData("127.0.0.1", false, false, true, false, false)]     // headless
    [InlineData("127.0.0.1", false, false, false, true, false)]     // container
    [InlineData("172.17.0.1", false, false, false, false, false)]   // Docker bridge gateway never counts as this PC
    [InlineData("172.31.255.1", false, false, false, false, false)]
    [InlineData("192.0.2.77", false, false, false, false, false)]   // another PC
    public void Local_window_session_rules(string ip, bool setupRequired, bool testRemote, bool headless, bool container, bool expected)
    {
        var cfg = new ServerConfig { TestTreatAllClientsAsRemote = testRemote, TestHeadless = headless };
        Assert.Equal(expected, Api.AuthApi.LocalWindowSession(cfg, setupRequired, IPAddress.Parse(ip), container));
        Assert.False(Api.AuthApi.LocalWindowSession(new ServerConfig { TestHeadless = false }, false, null, false));
    }

    [Fact]
    public void Player_keeps_its_saved_window_session_when_a_local_re_pair_returns_none()
    {
        Assert.Equal(WindowTokenAction.Save, PairingClient.WindowTokenStep("new-ui", true));
        Assert.Equal(WindowTokenAction.Save, PairingClient.WindowTokenStep("new-ui", false));
        Assert.Equal(WindowTokenAction.Keep, PairingClient.WindowTokenStep(null, true));      // server PC, before setup / older server: keep the saved one
        Assert.Equal(WindowTokenAction.Keep, PairingClient.WindowTokenStep("", true));
        Assert.Equal(WindowTokenAction.Delete, PairingClient.WindowTokenStep(null, false));   // another server without one: the old one would not work there
    }

    [Fact]
    public void Pair_a_pc_location_text_is_the_same_everywhere()
    {
        var root = FindRoot();
        const string P = "Settings > Devices > Pair a phone or a PC player";
        foreach (var f in new[] { "src/WavWiz.Player/PlayerApp.cs", "src/WavWiz.Server/Api/AuthApi.cs", "src/WavWiz.PlayerCore/Discovery/PairingClient.cs", "src/WavWiz.Player/Forms.cs", "src/WavWiz.Server/Api/DiagnosticsApi.cs", "src/WavWiz.Server/wwwroot/js/main.js", "installer/WavWiz.iss" })
        {
            var t = File.ReadAllText(Path.Combine(root, f));
            Assert.Contains(P, t);
            Assert.DoesNotContain("Settings > Players", t); Assert.DoesNotContain("Settings > Pair a PC", t); Assert.DoesNotContain("> Pair a PC)", t);
        }
        var iss = File.ReadAllText(Path.Combine(root, "installer/WavWiz.iss"));
        var step3 = iss[iss.IndexOf("'3. On each PC with speakers", StringComparison.Ordinal)..]; step3 = step3[..step3.IndexOf("#13#10", StringComparison.Ordinal)];
        Assert.Contains("approve", step3, StringComparison.OrdinalIgnoreCase); Assert.Contains(P, step3);
        var doc = File.ReadAllText(Path.Combine(root, "docs/FIRST-RUN.md"));
        var s5 = doc[doc.IndexOf("## 5.", StringComparison.Ordinal)..]; s5 = s5[..s5.IndexOf("\n## ", 5, StringComparison.Ordinal)];
        Assert.Contains("**Settings → Devices → Pair a phone or a PC player**", s5);
        Assert.Contains("Approve", s5);
        Assert.DoesNotContain("Settings → Players", doc);
    }

    static string FindRoot()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d != null && !File.Exists(Path.Combine(d.FullName, "installer", "WavWiz.iss"))) d = d.Parent;
        return d?.FullName ?? throw new InvalidOperationException("repo root not found");
    }
}
