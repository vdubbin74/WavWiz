using System.Net;
using System.Net.NetworkInformation;
using WavWiz.Server.Net;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#9: "listening on" says Home network + Tailscale/VPN with usable addresses, never a bare 0.0.0.0.</summary>
[Collection("NetworkHelperStatics")]
public class ListenLabelTests
{
    private static ServerConfig Cfg(string bind) => new() { BindAddress = bind };

    [Fact]
    public void Wildcard_bind_lists_lan_and_tailscale_and_skips_docker()
    {
        NetworkHelper.ListenOverride = () => new[]
        {
            ("Ethernet", "Intel(R) Ethernet", NetworkInterfaceType.Ethernet, IPAddress.Parse("192.168.1.20")),
            ("Tailscale", "Tailscale Tunnel", NetworkInterfaceType.Unknown, IPAddress.Parse("100.88.1.2")),
            ("docker0", "docker0", NetworkInterfaceType.Ethernet, IPAddress.Parse("172.17.0.1")),
            ("Ethernet", "Intel(R) Ethernet", NetworkInterfaceType.Ethernet, IPAddress.Parse("fe80::1")),
        };
        try
        {
            var l = NetworkHelper.Listening(Cfg("0.0.0.0"));
            Assert.Equal("Home network + Tailscale/VPN", l.Label);
            Assert.Equal(new[] { "192.168.1.20:lan", "100.88.1.2:tailscale" }, l.Addresses.Select(a => a.Address + ":" + a.Kind));
        }
        finally { NetworkHelper.ListenOverride = null; }
    }

    [Fact]
    public void Single_address_is_labelled_by_kind()
    {
        Assert.Equal("Home network", NetworkHelper.Listening(Cfg("192.168.1.20")).Label);
        Assert.Equal("This PC only", NetworkHelper.Listening(Cfg("127.0.0.1")).Label);
    }

    [Fact]
    public void AdvertiseAddress_on_wildcard_picks_lan_never_zero()
    {
        NetworkHelper.ListenOverride = () => new[]
        {
            ("Ethernet", "Intel(R) Ethernet", NetworkInterfaceType.Ethernet, IPAddress.Parse("192.168.1.20")),
            ("Tailscale", "Tailscale Tunnel", NetworkInterfaceType.Unknown, IPAddress.Parse("100.88.1.2")),
        };
        try
        {
            Assert.Equal(IPAddress.Parse("192.168.1.20"), NetworkHelper.AdvertiseAddress(IPAddress.Any));
            Assert.Equal(IPAddress.Parse("10.0.0.5"), NetworkHelper.AdvertiseAddress(IPAddress.Parse("10.0.0.5")));
        }
        finally { NetworkHelper.ListenOverride = null; }
    }
}
