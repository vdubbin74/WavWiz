using System.Net;
using System.Text.Json;
using WavWiz.Core;
using WavWiz.Core.Discovery;
using WavWiz.PlayerCore;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

public class UiScaleTests
{
    [Theory]
    [InlineData(100, 3840, 2160, 1.0)]
    [InlineData(150, 2560, 1440, 1.5)]
    [InlineData(200, 1920, 1080, 2.0)]
    [InlineData(250, 1536, 864, 2.5)]
    [InlineData(300, 1280, 720, 3.0)]
    public void A_4K_screen_at_100_to_300_percent_gives_the_css_viewport_the_web_layout_is_tested_at(int windowsPercent, int cssW, int cssH, double scale)
    {
        Assert.Equal((cssW, cssH), UiScale.CssViewport(3840, 2160, windowsPercent / 100.0));
        Assert.Equal(scale, windowsPercent / 100.0);
        Assert.Equal(scale, UiScale.FormFactor(UiScale.Auto, (int)(96 * scale)), 3);        // Auto: native forms follow the monitor DPI
        Assert.Equal(1.0, UiScale.WebZoom(UiScale.Auto));                                   // Auto: the page is already drawn at the monitor scale
    }

    [Theory]
    [InlineData(-5, 0)] [InlineData(0, 0)] [InlineData(40, 100)] [InlineData(100, 100)] [InlineData(137, 135)] [InlineData(250, 250)] [InlineData(300, 300)] [InlineData(999, 300)]
    public void Normalize_clamps_to_Auto_or_100_to_300_in_steps_of_5(int input, int expected) => Assert.Equal(expected, UiScale.Normalize(input));

    [Theory]
    [InlineData(100, 96, 1.0)] [InlineData(150, 96, 1.5)] [InlineData(200, 96, 2.0)] [InlineData(250, 96, 2.5)] [InlineData(300, 96, 3.0)]
    [InlineData(150, 192, 3.0)]      // a fixed 150 % on a 200 % monitor multiplies
    [InlineData(300, 288, 4.0)]      // capped at 4
    public void A_fixed_choice_multiplies_the_window_scale_and_is_capped(int choice, int dpi, double expected) => Assert.Equal(expected, UiScale.FormFactor(choice, dpi), 3);

    [Theory]
    [InlineData(1.0, 3840, 2160, 520, 340)]
    [InlineData(3.0, 1280, 720, 1256, 696)]      // 3x of a 520x340 window would not fit a 1280x720 work area: it is shrunk to the screen
    [InlineData(2.0, 3840, 2160, 1040, 680)]
    public void A_window_never_gets_bigger_than_the_screen(double f, int workW, int workH, int expW, int expH)
    {
        var (w, h) = UiScale.FitWindow(520, 340, f, workW, workH);
        Assert.True(w <= workW && h <= workH);
        Assert.Equal((expW, expH), (w, h));
    }

    [Fact]
    public void Choices_are_Auto_and_100_to_300_and_labeled()
    {
        Assert.Equal(0, UiScale.Choices[0]); Assert.Equal(300, UiScale.Choices[^1]);
        Assert.All(UiScale.Choices.Skip(1), c => Assert.Equal(c, UiScale.Normalize(c)));
        Assert.Contains("Auto", UiScale.Label(0)); Assert.Equal("200 %", UiScale.Label(200));
    }
}

public class LegacyFolderTests
{
    [Fact]
    public void The_0_0_2_player_folder_is_copied_once_and_left_in_place()
    {
        using var t = new TempDir(); var oldDir = Path.Combine(t.Path, "Unison"); Directory.CreateDirectory(Path.Combine(oldDir, "logs")); Directory.CreateDirectory(Path.Combine(oldDir, "webview"));
        File.WriteAllText(Path.Combine(oldDir, "player.json"), "{\"serverHost\":\"192.168.1.5\"}"); File.WriteAllText(Path.Combine(oldDir, "token.dpapi"), "x"); File.WriteAllText(Path.Combine(oldDir, "logs", "player.log"), "hi"); File.WriteAllText(Path.Combine(oldDir, "webview", "junk"), "x");
        Assert.True(LegacyFolder.Migrate(t.Path));
        var nd = Path.Combine(t.Path, "WavWiz");
        Assert.Contains("192.168.1.5", File.ReadAllText(Path.Combine(nd, "player.json"))); Assert.True(File.Exists(Path.Combine(nd, "token.dpapi"))); Assert.True(File.Exists(Path.Combine(nd, "logs", "player.log")));
        Assert.False(Directory.Exists(Path.Combine(nd, "webview"))); Assert.True(File.Exists(Path.Combine(oldDir, "player.json")));
        File.WriteAllText(Path.Combine(nd, "player.json"), "{\"serverHost\":\"NEW\"}");
        Assert.False(LegacyFolder.Migrate(t.Path));      // idempotent: never overwrites the new settings
        Assert.Contains("NEW", File.ReadAllText(Path.Combine(nd, "player.json")));
    }
    [Fact] public void Nothing_to_migrate_is_fine() { using var t = new TempDir(); Assert.False(LegacyFolder.Migrate(t.Path)); }
}

public class WireCompatibilityTests
{
    [Fact]
    public void Identifiers_that_0_0_2_players_look_for_are_unchanged()
    {
        Assert.Equal("UNISON?1", ServerBeacon.Probe);
        var b = new ServerBeacon("id", "n", "10.0.0.2", 8180, 8443, 8181, "0.0.3");
        var json = System.Text.Encoding.UTF8.GetString(b.ToUdp());
        Assert.Contains("\"app\":\"unison\"", json); Assert.NotNull(ServerBeacon.FromUdp(System.Text.Encoding.UTF8.GetBytes("{\"app\":\"unison\",\"v\":1,\"id\":\"a\",\"name\":\"b\",\"host\":\"1.2.3.4\",\"httpPort\":8180,\"audioPort\":8181}"), IPAddress.Parse("1.2.3.4")));
        Assert.Equal("_unison._tcp", WavWizInfo.MdnsService);
    }

    [Fact]
    public async Task Ping_and_discover_still_say_app_unison_and_a_0_0_2_style_pairing_still_works()
    {
        await using var f = await ServerFixture.StartAsync();
        var ping = await f.Http.GetJson("/api/v1/ping"); Assert.Equal("unison", ping.GetProperty("app").GetString());
        await f.SetupAdmin();
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "old-player", name = "Old PC" }); r.EnsureSuccessStatusCode();     // same body a 0.0.2 PairingClient sends
        Assert.False(string.IsNullOrEmpty((await r.Json()).GetProperty("token").GetString()));
    }
}

public class ZonesAndForgetTests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, long ida, long idb)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones"); long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        return (f, admin, a, b, Id("pc-a"), Id("pc-b"));
    }

    [Fact]
    public async Task Zones_are_groups_of_devices_create_edit_activate_and_remove()
    {
        var (f, admin, a, b, ida, idb) = await Setup();
        await using var _f = f; await using var _a = a; await using var _b = b;
        var r = await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Downstairs", deviceIds = new[] { ida } }); r.EnsureSuccessStatusCode();
        var g = await r.Json(); var gid = g.GetProperty("id").GetInt64(); Assert.Equal("Downstairs", g.GetProperty("name").GetString()); Assert.Equal(1, g.GetProperty("members").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "", deviceIds = new long[0] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Downstairs", deviceIds = new[] { idb } })).StatusCode);      // duplicate name
        var upd = await admin.PatchAsJsonAsync($"/api/v1/groups/{gid}", new { name = "Ground floor", deviceIds = new[] { ida, idb } }); upd.EnsureSuccessStatusCode();
        Assert.Equal(2, (await upd.Json()).GetProperty("members").GetInt32());
        (await admin.PostAsync($"/api/v1/groups/{gid}/activate", null)).EnsureSuccessStatusCode();
        var gs = await admin.GetJson("/api/v1/groups"); Assert.True(gs.EnumerateArray().First().GetProperty("active").GetBoolean());
        // a device that is in no zone is "unassigned"
        var zs = await admin.GetJson("/api/v1/zones"); Assert.All(zs.EnumerateArray(), z => Assert.Contains(gid, z.GetProperty("groupIds").EnumerateArray().Select(x => x.GetInt64())));
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{gid}")).StatusCode);
        Assert.Empty((await admin.GetJson("/api/v1/groups")).EnumerateArray());
        zs = await admin.GetJson("/api/v1/zones"); Assert.Equal(2, zs.GetArrayLength()); Assert.All(zs.EnumerateArray(), z => Assert.Equal(0, z.GetProperty("groupIds").GetArrayLength()));       // devices are untouched
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/v1/groups/{gid}")).StatusCode);
    }

    [Fact]
    public async Task Removing_a_zone_that_is_active_activates_nothing_else_and_view_role_cannot_edit()
    {
        var (f, admin, a, b, ida, idb) = await Setup();
        await using var _f = f; await using var _a = a; await using var _b = b;
        var g1 = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "One", deviceIds = new[] { ida } })).Json()).GetProperty("id").GetInt64();
        var g2 = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Two", deviceIds = new[] { idb } })).Json()).GetProperty("id").GetInt64();
        (await admin.PostAsync($"/api/v1/groups/{g1}/activate", null)).EnsureSuccessStatusCode();
        var gs = (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(x => x.GetProperty("id").GetInt64());
        Assert.True(gs[g1].GetProperty("active").GetBoolean()); Assert.False(gs[g2].GetProperty("active").GetBoolean());
        var viewer = f.As(f.Token(Role.View, "v"));
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsJsonAsync("/api/v1/groups", new { name = "X", deviceIds = new long[0] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.DeleteAsync($"/api/v1/groups/{g1}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync("/api/v1/groups")).StatusCode);
    }

    [Fact]
    public async Task Forgetting_a_device_revokes_its_token_tells_the_running_player_it_is_not_paired_and_removes_it_from_the_list_and_zones()
    {
        var (f, admin, a, b, ida, idb) = await Setup();
        await using var _f = f; await using var _a = a; await using var _b = b;
        await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Both", deviceIds = new[] { ida, idb } });
        Assert.False(a.Client.State.NotPaired);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/v1/players/pc-a/forget", null)).StatusCode);
        var sw = System.Diagnostics.Stopwatch.StartNew(); while (!a.Client.State.NotPaired && sw.ElapsedMilliseconds < 8000) await Task.Delay(50);
        Assert.True(a.Client.State.NotPaired, "the running player must learn that it was removed"); Assert.Equal("notpaired", a.Client.State.Health);
        var zs = await admin.GetJson("/api/v1/zones"); Assert.Equal(new[] { "pc-b" }, zs.EnumerateArray().Select(z => z.GetProperty("playerId").GetString()!).ToArray());
        var gs = await admin.GetJson("/api/v1/groups"); Assert.Equal(1, gs.EnumerateArray().First().GetProperty("members").GetInt32());
        await Task.Delay(1500); Assert.True(a.Client.State.NotPaired); Assert.False(a.Client.State.Connected);      // it stopped retrying; it does not come back by itself
        Assert.Equal(1, (await admin.GetJson("/api/v1/zones")).GetArrayLength());
        // its old token is dead
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = "pc-a", name = "Kitchen" });      // pairing again from the same machine is the supported way back (server PC / valid code rules apply)
        Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Revoking_a_player_token_signs_it_out_and_optionally_removes_it_from_the_list()
    {
        var (f, admin, a, b, ida, idb) = await Setup();
        await using var _f = f; await using var _a = a; await using var _b = b;
        var toks = await admin.GetJson("/api/v1/tokens");
        long TokenOf(string name) => toks.EnumerateArray().First(t => t.GetProperty("name").GetString()!.Contains(name)).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/tokens/{TokenOf("Kitchen")}")).StatusCode);       // revoke only
        var sw = System.Diagnostics.Stopwatch.StartNew(); while (!a.Client.State.NotPaired && sw.ElapsedMilliseconds < 8000) await Task.Delay(50);
        Assert.True(a.Client.State.NotPaired);
        Assert.Equal(2, (await admin.GetJson("/api/v1/zones")).GetArrayLength());       // still listed (as offline)
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/tokens/{TokenOf("Garage")}?removeFromList=1")).StatusCode);
        var zs = await admin.GetJson("/api/v1/zones"); Assert.Equal(new[] { "pc-a" }, zs.EnumerateArray().Select(z => z.GetProperty("playerId").GetString()!).ToArray());
    }
}
