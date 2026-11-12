using System.Net;
using System.Security.Cryptography.X509Certificates;
using WavWiz.Core.Discovery;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

/// <summary>0.2.4: the security certificate a phone installs uses WavWiz names (subject/issuer, file names, profile); /ping, /discover and the UDP beacon say app "wavwiz".</summary>
public class CertNameTests
{
    private static readonly IPAddress Ip = IPAddress.Parse("192.168.1.169");

    private static X509Certificate2 Root(LocalCa ca) => X509Certificate2.CreateFromPem(File.ReadAllText(ca.CaCertPath));

    [Fact]
    public void A_fresh_root_server_cert_and_profile_use_wavwiz_names()
    {
        using var t = new TempDir(); var ca = new LocalCa(t.Path); ca.Enable(Ip);
        Assert.Equal("wavwiz-root-ca.crt", Path.GetFileName(ca.CaCertPath)); Assert.Equal("wavwiz-root-ca.crt", LocalCa.CaFileName); Assert.Equal("wavwiz-root-ca.mobileconfig", LocalCa.MobileConfigFileName);
        using var root = Root(ca); var leaf = ca.CurrentServerCert(Ip);
        Assert.Contains("O=WavWiz", root.Subject); Assert.StartsWith("CN=WavWiz", root.Subject); Assert.StartsWith("CN=WavWiz", leaf.Subject);
        var mc = ca.MobileConfig(Ip.ToString());
        Assert.Contains("<string>wavwiz-root-ca.crt</string>", mc); Assert.Contains("<key>PayloadOrganization</key><string>WavWiz</string>", mc);
        Assert.Contains("app.wavwiz.profile.", mc); Assert.Contains("app.wavwiz.rootca.", mc);
    }

    [Fact]
    public async Task The_downloads_use_wavwiz_file_names_and_ping_says_wavwiz()
    {
        await using var f = await ServerFixture.StartAsync();
        f.Server.S.Ca.Enable(IPAddress.Loopback);
        var crt = await f.Http.GetAsync("/tls/root-ca.crt"); crt.EnsureSuccessStatusCode();
        Assert.Equal("wavwiz-root-ca.crt", crt.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var mc = await f.Http.GetAsync("/tls/root-ca.mobileconfig"); mc.EnsureSuccessStatusCode();
        Assert.Equal("wavwiz-root-ca.mobileconfig", mc.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.Equal("wavwiz", (await f.Http.GetJson("/api/v1/ping")).GetProperty("app").GetString());
        Assert.Equal("wavwiz", (await f.Http.GetJson("/api/v1/discover")).GetProperty("app").GetString());
    }

    [Fact]
    public void Beacons_say_wavwiz()
    {
        var b = new ServerBeacon("id1", "PC-HMS", "192.168.1.169", 47800, 47801, 47802, "0.2.4");
        Assert.Contains("\"app\":\"wavwiz\"", System.Text.Encoding.UTF8.GetString(b.ToUdp()));
        Assert.NotNull(ServerBeacon.FromUdp(System.Text.Encoding.UTF8.GetBytes("{\"app\":\"wavwiz\",\"v\":1,\"id\":\"a\",\"name\":\"b\",\"host\":\"1.2.3.4\",\"httpPort\":47800,\"audioPort\":47802}"), IPAddress.Parse("1.2.3.4")));
        Assert.Null(ServerBeacon.FromUdp("{\"app\":\"other\"}"u8, null));
        Assert.True(ServerBeacon.IsOurApp("wavwiz")); Assert.False(ServerBeacon.IsOurApp("WavWiz2")); Assert.False(ServerBeacon.IsOurApp(null));
    }
}
