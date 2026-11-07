using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

// F257: stale leaf (SAN missing the current LAN IP) is reissued under the EXISTING root for every endpoint that root permits; never a new root.
// Synthetic material in TempDirs only. Does not prove the iPhone Home Screen icon fix.
public class F257CertificateTests
{
    private static readonly IPAddress Lan = IPAddress.Parse("192.168.1.169"), Tail = IPAddress.Parse("100.102.134.105");
    private static string Pfx(string dir) => Path.Combine(dir, "tls", "server.pfx");
    private static void WriteLeaf(string dir, IEnumerable<IPAddress> ips)
    {
        using var ca = X509Certificate2.CreateFromPemFile(Path.Combine(dir, "tls", LocalCa.CaFileName), Path.Combine(dir, "tls", "ca.key.pem"));
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=WavWiz server 0.0.0.0", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); foreach (var ip in ips) san.AddIpAddress(ip);
        foreach (var d in CertificateEndpoints.DnsNames()) san.AddDnsName(d); req.CertificateExtensions.Add(san.Build());
        using var leaf = req.Create(ca, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow.AddDays(100), RandomNumberGenerator.GetBytes(8));
        using var full = leaf.CopyWithPrivateKey(key); File.WriteAllBytes(Pfx(dir), full.Export(X509ContentType.Pfx));
    }

    [Fact]
    public void Stale_leaf_missing_LAN_is_reissued_under_existing_root_with_LAN_and_Tailscale_omitted_only_where_root_forbids_it()
    {
        using var t = new TempDir();
        new LocalCa(t.Path, _ => [Lan, IPAddress.Loopback]).Enable(Lan);            // root permits LAN + loopback, not Tailscale
        var rootSha = new LocalCa(t.Path).RootSha256; var keyBytes = File.ReadAllBytes(Path.Combine(t.Path, "tls", "ca.key.pem"));
        WriteLeaf(t.Path, [IPAddress.Loopback]);                                      // stale: SAN lacks 192.168.1.169
        var old = File.ReadAllBytes(Pfx(t.Path));
        var wildcard = new LocalCa(t.Path, _ => [Lan, Tail, IPAddress.Loopback]);     // bind 0.0.0.0 resolves LAN + Tailscale
        var leaf = wildcard.CurrentServerCert(IPAddress.Any);
        Assert.True(CertificateEndpoints.Covers(leaf, [Lan, IPAddress.Loopback]));
        Assert.False(CertificateEndpoints.Covers(leaf, [Tail]));
        Assert.NotEqual(old, File.ReadAllBytes(Pfx(t.Path)));
        Assert.Equal(rootSha, wildcard.RootSha256); Assert.Equal(keyBytes, File.ReadAllBytes(Path.Combine(t.Path, "tls", "ca.key.pem")));
        Assert.Contains("100.102.134.105", wildcard.LastRenewalError); Assert.Contains("re-trust", wildcard.LastRenewalError);
    }

    [Fact]
    public void PermittedBy_reads_exact_ip_constraints()
    {
        using var t = new TempDir();
        new LocalCa(t.Path, _ => [Lan, Tail, IPAddress.Loopback]).Enable(Lan);
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(t.Path, "tls", LocalCa.CaFileName)));
        Assert.Equal(new[] { Lan, Tail }, LocalCa.PermittedBy(root, [Lan, Tail, IPAddress.Parse("10.0.0.9")]));
    }
}
