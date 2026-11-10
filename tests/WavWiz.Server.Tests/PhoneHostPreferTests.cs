using System.Net;
using WavWiz.Server.Tls;
using Xunit;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#11g: the phone set-up QR / address prefers the home network over Tailscale.</summary>
public class PhoneHostPreferTests
{
    static IPAddress[] Ips(params string[] s) => s.Select(IPAddress.Parse).ToArray();

    [Fact]
    public void Home_network_addresses_come_before_tailscale_and_loopback_is_dropped()
    {
        var r = CertificateEndpoints.PreferForPhone(Ips("127.0.0.1", "100.101.1.2", "192.168.1.20", "10.0.0.5", "172.16.3.4"));
        Assert.Equal(Ips("192.168.1.20", "10.0.0.5", "172.16.3.4", "100.101.1.2"), r);
    }

    [Fact]
    public void The_address_the_request_came_in_on_wins_when_it_is_a_lan_address()
    {
        var r = CertificateEndpoints.PreferForPhone(Ips("100.101.1.2", "192.168.1.20", "10.0.0.5"), IPAddress.Parse("10.0.0.5"));
        Assert.Equal(IPAddress.Parse("10.0.0.5"), r[0]);
        var t = CertificateEndpoints.PreferForPhone(Ips("100.101.1.2", "192.168.1.20"), IPAddress.Parse("100.101.1.2"));   // came in on Tailscale: still LAN first
        Assert.Equal(IPAddress.Parse("192.168.1.20"), t[0]);
        Assert.Equal(IPAddress.Parse("192.168.1.20"), CertificateEndpoints.PreferForPhone(Ips("192.168.1.20", "100.64.0.1"), IPAddress.Loopback)[0]);
    }
}
