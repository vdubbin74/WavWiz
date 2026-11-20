using System.Net;
using WavWiz.Core.Discovery;
using WavWiz.PlayerCore.Discovery;
using WavWiz.Server.Net;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2069u: Docker bridge mode. The server only sees its container address (172.17-31.x), which no other device can reach, so it
/// advertised that and Players could not connect. WAVWIZ_ADVERTISE_ADDRESS sets the address to advertise; bridge mode without it logs a hint;
/// a bare container-id host name shows as "WavWiz (Docker)" (WAVWIZ_SERVER_NAME overrides); Players prefer a reachable address.</summary>
[Collection("NetworkHelperStatics")]
public class Release071DockerTests
{
    private static string Root() { var d = new DirectoryInfo(AppContext.BaseDirectory); while (d != null && !Directory.Exists(Path.Combine(d.FullName, "src", "WavWiz.Player"))) d = d.Parent; return d!.FullName; }
    private static readonly IReadOnlyList<(IPAddress Ip, IPAddress Mask)> HomeLan = new[] { (IPAddress.Parse("192.168.1.50"), IPAddress.Parse("255.255.255.0")) };

    [Theory]
    [InlineData("172.17.0.2", true)] [InlineData("172.31.255.1", true)] [InlineData("172.16.0.5", false)] [InlineData("172.32.0.1", false)] [InlineData("192.168.1.20", false)] [InlineData("10.0.0.2", false)]
    public void Docker_bridge_range_is_172_17_to_31(string ip, bool bridge)
    {
        Assert.Equal(bridge, NetworkHelper.IsDockerBridgeAddress(IPAddress.Parse(ip)));
        Assert.Equal(bridge, ServerFinder.IsDockerBridge(IPAddress.Parse(ip)));
    }

    [Fact]
    public void Env_sets_advertise_address_and_server_name()
    {
        using var d = new TempDir();
        string? a0 = Environment.GetEnvironmentVariable("WAVWIZ_ADVERTISE_ADDRESS"), n0 = Environment.GetEnvironmentVariable("WAVWIZ_SERVER_NAME"), d0 = Environment.GetEnvironmentVariable("WAVWIZ_DATA_DIR");
        try
        {
            Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", d.Path); Environment.SetEnvironmentVariable("WAVWIZ_ADVERTISE_ADDRESS", " 192.168.1.20 "); Environment.SetEnvironmentVariable("WAVWIZ_SERVER_NAME", "Living room NAS");
            var c = ServerConfig.Load();
            Assert.Equal("192.168.1.20", c.AdvertiseAddress); Assert.Equal("Living room NAS", c.ServerName);
            Assert.Equal(IPAddress.Parse("192.168.1.20"), NetworkHelper.ConfiguredAdvertise(c));
        }
        finally { Environment.SetEnvironmentVariable("WAVWIZ_ADVERTISE_ADDRESS", a0); Environment.SetEnvironmentVariable("WAVWIZ_SERVER_NAME", n0); Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", d0); }
    }

    [Theory]
    [InlineData("192.168.1.20", "192.168.1.20")] [InlineData("nas.local", null)] [InlineData("127.0.0.1", null)] [InlineData("0.0.0.0", null)] [InlineData("", null)] [InlineData("fe80::1", null)]
    public void Only_a_usable_ipv4_address_is_advertised(string value, string? want)
    {
        Assert.Equal(want, NetworkHelper.ConfiguredAdvertise(new ServerConfig { AdvertiseAddress = value })?.ToString());
        Assert.Equal(want ?? "10.0.0.5", NetworkHelper.ResolveAdvertise(new ServerConfig { AdvertiseAddress = value }, IPAddress.Parse("10.0.0.5")).ToString());
    }

    [Fact]
    public void Bridge_mode_hint_only_in_a_container_with_only_bridge_addresses_and_no_advertise_address()
    {
        try
        {
            NetworkHelper.ContainerOverride = () => true; NetworkHelper.LocalIPv4Override = () => new[] { IPAddress.Parse("172.18.0.3") };
            Assert.True(NetworkHelper.BridgeMode());
            var hint = NetworkHelper.DockerHint(new ServerConfig());
            Assert.NotNull(hint); Assert.Contains("Docker bridge network detected", hint); Assert.Contains("172.18.0.3", hint); Assert.Contains("WAVWIZ_ADVERTISE_ADDRESS", hint); Assert.Contains("network_mode: host", hint);
            Assert.Contains("192.168.1.20", NetworkHelper.DockerHint(new ServerConfig { AdvertiseAddress = "192.168.1.20" }));     // set: says what it uses
            Assert.Contains("not an IPv4 address", NetworkHelper.DockerHint(new ServerConfig { AdvertiseAddress = "nas.local" }));
            NetworkHelper.LocalIPv4Override = () => new[] { IPAddress.Parse("192.168.1.20"), IPAddress.Parse("172.17.0.1") };     // host networking: a real LAN address too
            Assert.False(NetworkHelper.BridgeMode()); Assert.Null(NetworkHelper.DockerHint(new ServerConfig()));
            NetworkHelper.ContainerOverride = () => false; NetworkHelper.LocalIPv4Override = () => new[] { IPAddress.Parse("172.18.0.3") };     // not a container (a LAN on 172.18.x)
            Assert.False(NetworkHelper.BridgeMode()); Assert.Null(NetworkHelper.DockerHint(new ServerConfig()));
        }
        finally { NetworkHelper.ContainerOverride = null; NetworkHelper.LocalIPv4Override = null; }
    }

    [Theory]
    [InlineData("3f2a9c1b7d4e", true, "WavWiz (Docker)")]
    [InlineData("3f2a9c1b7d4e", false, "3f2a9c1b7d4e")]
    [InlineData("music-pi", true, "music-pi")]
    [InlineData("DESKTOP-AB12", false, "DESKTOP-AB12")]
    public void Default_server_name(string machine, bool container, string want) =>
        Assert.Equal(want, NetworkHelper.DefaultServerName(new ServerConfig(), machine, container));

    [Fact]
    public void Server_name_setting_beats_env()
    {
        Assert.Equal("Living room NAS", NetworkHelper.DefaultServerName(new ServerConfig { ServerName = " Living room NAS " }, "3f2a9c1b7d4e", true));
    }

    [Fact]
    public void Mdns_record_and_udp_beacon_carry_the_advertise_address()
    {
        var cfg = new ServerConfig { AdvertiseAddress = "192.168.1.20" };
        Assert.Equal(IPAddress.Parse("192.168.1.20"), DiscoveryHost.RecordAddress(cfg, IPAddress.Parse("172.17.0.2")));
        Assert.Equal(IPAddress.Parse("172.17.0.2"), DiscoveryHost.RecordAddress(new ServerConfig(), IPAddress.Parse("172.17.0.2")));
        var b = new ServerBeacon("id1", "WavWiz (Docker)", "192.168.1.20", 47800, 47443, 47801, "0.7.1");
        var a = b.ToMdns(DiscoveryHost.RecordAddress(cfg, IPAddress.Parse("172.17.0.2"))).Single(r => r.Type == DnsWire.TypeA);
        Assert.Equal(new byte[] { 192, 168, 1, 20 }, a.Data);
    }

    [Fact]
    public async Task Beacon_and_auth_state_use_advertise_address_and_name()
    {
        await using var f = await ServerFixture.StartAsync();
        var s = f.Server.S;
        Assert.Equal("", s.Beacon().Host);                                      // loopback-only server: advertises nothing, even with an advertise address
        f.Cfg.AdvertiseAddress = "192.168.1.20"; Assert.Equal("", s.Beacon().Host);
        f.Cfg.BindAddress = "172.17.0.2";                                     // as in a bridge-mode container (WAVWIZ_BIND)
        f.Cfg.AdvertiseAddress = null; Assert.Equal("172.17.0.2", s.Beacon().Host);
        f.Cfg.AdvertiseAddress = "192.168.1.20"; Assert.Equal("192.168.1.20", s.Beacon().Host);
        f.Cfg.ServerName = "Living room NAS";
        Assert.Equal("Living room NAS", s.Beacon().Name);
        Assert.Equal("Living room NAS", (await f.Http.GetJson("/api/v1/auth/state")).GetProperty("serverName").GetString());
        f.Cfg.BindAddress = "127.0.0.1";
    }

    [Fact]
    public void Player_uses_the_answer_sender_instead_of_an_unreachable_container_address()
    {
        var b = new ServerBeacon("id1", "WavWiz (Docker)", "172.17.0.2", 47800, 47443, 47801, "0.7.1");
        Assert.True(ServerFinder.Unreachable("172.17.0.2", HomeLan));
        Assert.Equal("192.168.1.20", ServerFinder.PreferReachable(b, IPAddress.Parse("192.168.1.20"), HomeLan)!.Host);
        Assert.Equal("172.17.0.2", ServerFinder.PreferReachable(b, IPAddress.Parse("172.17.0.2"), HomeLan)!.Host);     // nothing better: graceful fallback
        Assert.Equal("172.17.0.2", ServerFinder.PreferReachable(b, null, HomeLan)!.Host);
        var docker = new[] { (IPAddress.Parse("172.17.0.1"), IPAddress.Parse("255.255.0.0")) };                        // a Player on the Docker host itself can reach it
        Assert.False(ServerFinder.Unreachable("172.17.0.2", docker));
        Assert.Equal("172.17.0.2", ServerFinder.PreferReachable(b, IPAddress.Parse("192.168.1.20"), docker)!.Host);
        var lan = new ServerBeacon("id1", "WavWiz", "192.168.1.20", 47800, 47443, 47801, "0.7.1");
        Assert.Same(lan, ServerFinder.PreferReachable(lan, IPAddress.Parse("10.9.9.9"), HomeLan));                     // a normal answer is never changed
    }

    [Fact]
    public void Player_list_and_candidates_put_container_addresses_last()
    {
        var bridge = new ServerBeacon("a", "Alpha", "172.18.0.2", 47800, 47443, 47801, "0.7.1"); var good = new ServerBeacon("b", "Zulu", "192.168.1.30", 47800, 47443, 47801, "0.7.1");
        Assert.Equal(new[] { "Zulu", "Alpha" }, ServerFinder.Order(new[] { bridge, good }, HomeLan).Select(x => x.Name));
        Assert.Same(good, ServerFinder.Better(bridge with { Id = "b" }, good, HomeLan));
        Assert.Same(good, ServerFinder.Better(good, bridge, HomeLan));
        Assert.Equal(new[] { "192.168.1.20", "nas.local", "172.17.0.2" }, PairingClient.OrderCandidates(new[] { "172.17.0.2", "192.168.1.20", "nas.local", "192.168.1.20" }, HomeLan));
        Assert.Equal(new[] { "172.17.0.2" }, PairingClient.OrderCandidates(new[] { "172.17.0.2" }, HomeLan));       // never dropped
    }

    [Fact]
    public void Pairing_error_explains_a_docker_internal_address()
    {
        Assert.Contains("inside Docker", PairingClient.DockerHint("172.17.0.2", HomeLan));
        Assert.Contains("WAVWIZ_ADVERTISE_ADDRESS", PairingClient.DockerHint("172.17.0.2", HomeLan));
        Assert.Equal("", PairingClient.DockerHint("192.168.1.20", HomeLan));
        Assert.Equal("", PairingClient.DockerHint("nas.local", HomeLan));
    }

    [Fact]
    public void Player_app_does_not_move_to_an_unreachable_container_address()
    {
        var root = Root();
        var app = File.ReadAllText(Path.Combine(root, "src/WavWiz.Player/PlayerApp.cs"));
        Assert.Contains("if (!string.IsNullOrEmpty(_s.ServerHost) && ServerFinder.Unreachable(b.Host, ServerFinder.LocalInterfaces()))", app);
    }

    [Fact]
    public void Docker_files_document_the_settings()
    {
        var root = Root();
        var compose = File.ReadAllText(Path.Combine(root, "docker-compose.yml")); var doc = File.ReadAllText(Path.Combine(root, "docs/DOCKER.md"));
        Assert.Contains("WAVWIZ_ADVERTISE_ADDRESS", compose); Assert.Contains("WAVWIZ_SERVER_NAME", compose);
        Assert.Contains("WAVWIZ_ADVERTISE_ADDRESS", doc); Assert.Contains("WAVWIZ_SERVER_NAME", doc); Assert.Contains("WavWiz (Docker)", doc);
    }
}
