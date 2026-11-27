using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Net;
namespace WavWiz.Server.Tests;

/// <summary>F273 (0.7.3): "Check your network" is step 1 - the deciding adapter's type (bound, else the best LAN adapter; never Tailscale/VPN or
/// Hyper-V/WSL), the checklist "network" + "phone-open" items, and the Player's exact allowlist of three Windows network pages.</summary>
public class F273NetworkTests
{
    static NetworkHelper.Adapter A(string name, string addr, bool gw, string kind, string profile, string net = "") => new(name, name, addr, 24, gw, kind, profile, false, net);

    [Fact]
    public void The_bound_or_best_lan_adapter_decides_and_virtual_adapters_never_do()
    {
        try
        {
            // bound Wi-Fi Public -> fail, state public with the network name and the Wi-Fi page
            NetworkHelper.AdapterOverride = () => new[] { A("Wi-Fi", "192.168.1.57", true, "Wi-Fi", "Public", "Home-WiFi"), A("vEthernet (WSL)", "172.20.0.1", false, "Virtual", "Private") };
            var pub = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.57" });
            Assert.Equal("fail", pub.Status); Assert.Equal("public", pub.Net!.State); Assert.Equal("Home-WiFi", pub.Net.Network); Assert.Equal("ms-settings:network-wifi", pub.Net.SettingsUri);
            // bound Ethernet Private + a Public vEthernet -> ok
            NetworkHelper.AdapterOverride = () => new[] { A("Ethernet", "192.168.1.20", true, "Ethernet", "Private", "Home"), A("vEthernet (Default Switch)", "172.17.0.1", false, "Virtual", "Public", "Unidentified network") };
            var eth = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.20" });
            Assert.Equal("ok", eth.Status); Assert.Equal("private", eth.Net!.State); Assert.Equal("ms-settings:network-ethernet", eth.Net.SettingsUri);
            // wildcard bind: the gateway LAN adapter decides, not a Public Tailscale
            NetworkHelper.AdapterOverride = () => new[] { A("Tailscale", "100.101.1.2", false, "Virtual", "Public", "Tailscale"), A("Ethernet", "192.168.1.20", true, "Ethernet", "Private", "Home") };
            var all = NetworkHelper.Check(new ServerConfig { BindAddress = "0.0.0.0" });
            Assert.Equal("private", all.Net!.State); Assert.DoesNotContain(all.Problems, p => p.Contains("Public"));
            // bound Private + Public Tailscale
            Assert.Equal("private", NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.20" }).Net!.State);
            // Domain -> the domain message, never "fail" for it
            NetworkHelper.AdapterOverride = () => new[] { A("Ethernet", "10.1.2.3", true, "Ethernet", "Domain", "corp.example") };
            var dom = NetworkHelper.Check(new ServerConfig { BindAddress = "10.1.2.3" });
            Assert.Equal("domain", dom.Net!.State); Assert.Contains(dom.Problems, p => p.Contains("work (domain) network")); Assert.NotEqual("fail", dom.Status);
            // Unknown (blocked / slow) -> unknown, no warning
            NetworkHelper.AdapterOverride = () => new[] { A("Ethernet", "192.168.1.20", true, "Ethernet", "Unknown") };
            var unk = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.20" });
            Assert.Equal("unknown", unk.Net!.State); Assert.Equal("ok", unk.Status);
            Assert.Equal("ms-settings:network-status", NetworkHelper.SettingsUriFor("Other"));
        }
        finally { NetworkHelper.AdapterOverride = null; }
    }

    [Fact]
    public async Task Checklist_has_network_first_on_windows_none_elsewhere_and_phone_open_flips_for_another_lan_device()
    {
        try
        {
            NetworkHelper.AdapterOverride = () => new[] { A("Wi-Fi", "192.168.1.57", true, "Wi-Fi", "Public", "Home-WiFi") };
            await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
            var view = f.As(f.Token(Role.View));
            NetworkHelper.WindowsOverride = () => true;
            var c = await view.GetJson("/api/v1/checklist?fresh=true"); var items = c.GetProperty("items").EnumerateArray().ToList();
            Assert.Equal("network", items[0].GetProperty("id").GetString());
            Assert.Equal("public", items[0].GetProperty("state").GetString()); Assert.False(items[0].GetProperty("done").GetBoolean());
            Assert.Equal("Home-WiFi", items[0].GetProperty("network").GetString()); Assert.Equal("ms-settings:network-wifi", items[0].GetProperty("settingsUri").GetString());
            Assert.True(items[0].GetProperty("required").GetBoolean());
            var phone = items.First(i => i.GetProperty("id").GetString() == "phone-open"); Assert.False(phone.GetProperty("done").GetBoolean());
            NetworkHelper.WindowsOverride = () => false;   // Linux / Docker: no network step
            c = await view.GetJson("/api/v1/checklist"); Assert.DoesNotContain(c.GetProperty("items").EnumerateArray(), i => i.GetProperty("id").GetString() == "network");
            // phone-open: loopback and this PC never count; another LAN device does (stored once)
            Assert.False(DiagnosticsApi.IsOtherLanClient(IPAddress.Loopback, _ => false));
            Assert.False(DiagnosticsApi.IsOtherLanClient(IPAddress.Parse("192.168.1.57"), _ => true));
            Assert.False(DiagnosticsApi.IsOtherLanClient(null, _ => false));
            Assert.True(DiagnosticsApi.IsOtherLanClient(IPAddress.Parse("::ffff:192.168.1.80"), _ => false));
            DiagnosticsApi.NoteClient(f.Server.S, IPAddress.Loopback);
            c = await view.GetJson("/api/v1/checklist"); Assert.False(c.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetString() == "phone-open").GetProperty("done").GetBoolean());
            DiagnosticsApi.NoteClient(f.Server.S, IPAddress.Parse("192.0.2.80"));   // TEST-NET: never this machine
            c = await view.GetJson("/api/v1/checklist"); Assert.True(c.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetString() == "phone-open").GetProperty("done").GetBoolean());
            Assert.Equal("true", f.Server.S.Db.Setting(DiagnosticsApi.LanClientSeenKey));
            // /network carries the same state for the banner
            NetworkHelper.WindowsOverride = () => true;
            var n = await view.GetJson("/api/v1/network"); Assert.Equal("public", n.GetProperty("net").GetProperty("state").GetString());
        }
        finally { NetworkHelper.AdapterOverride = null; NetworkHelper.WindowsOverride = null; }
    }

    [Fact]
    public void Player_opens_exactly_the_three_network_pages_and_nothing_else()
    {
        foreach (var u in new[] { "ms-settings:network-wifi", "ms-settings:network-ethernet", "ms-settings:network-status" })
        {
            Assert.True(WavWiz.PlayerCore.UiUrl.IsNetSettingsMessage("{\"open\":\"" + u + "\"}")); Assert.Equal(u, WavWiz.PlayerCore.UiUrl.NetSettingsUriOf("{\"open\":\"" + u + "\"}"));
        }
        foreach (var bad in new[] { "{\"open\":\"ms-settings:network-proxy\"}", "{\"open\":\"ms-settings:privacy-microphone\"}", "{\"open\":\"https://example.com\"}", "{\"open\":\"ms-settings:network-wifi\",\"x\":1}",
                                    "{ \"open\":\"ms-settings:network-wifi\"}", "{\"open\":\"ms-settings:network-wifi \"}", "{\"open\":\"MS-SETTINGS:NETWORK-WIFI\"}", "", null })
            Assert.False(WavWiz.PlayerCore.UiUrl.IsNetSettingsMessage(bad));
        Assert.True(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage("{\"open\":\"ms-settings:privacy-microphone\"}"));   // unchanged
        Assert.False(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage("{\"open\":\"ms-settings:network-wifi\"}"));
    }
}
