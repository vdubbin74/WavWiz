using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

public class TlsTests
{
    private static bool Validates(X509Certificate2 leaf, X509Certificate2 root, out X509ChainStatusFlags flags)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust; chain.ChainPolicy.CustomTrustStore.Add(root);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        bool ok = chain.Build(leaf); flags = chain.ChainStatus.Aggregate(X509ChainStatusFlags.NoError, (a, s) => a | s.Status); return ok;
    }

    private static X509Certificate2 Issue(string dir, string? dns, IPAddress? ip)
    {
        using var ca = X509Certificate2.CreateFromPem(File.ReadAllText(Path.Combine(dir, "tls", "unison-root-ca.crt")));
        using var caKey = RSA.Create(); caKey.ImportFromPem(File.ReadAllText(Path.Combine(dir, "tls", "ca.key.pem")));
        using var caFull = ca.CopyWithPrivateKey(caKey);
        using var k = RSA.Create(2048);
        var req = new CertificateRequest("CN=x", k, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); if (dns != null) san.AddDnsName(dns); if (ip != null) san.AddIpAddress(ip); req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        using var c = req.Create(caFull, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), RandomNumberGenerator.GetBytes(8));
        return X509CertificateLoader.LoadCertificate(c.Export(X509ContentType.Cert));
    }

    [Fact]
    public void Server_cert_chains_to_the_local_root_is_short_lived_and_has_the_right_SANs()
    {
        using var t = new TempDir(); var ca = new LocalCa(t.Path); Assert.False(ca.Enabled);
        var ip = IPAddress.Parse("192.168.1.50"); ca.Enable(ip); Assert.True(ca.Enabled);
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(ca.CaCertPath));
        var leaf = ca.CurrentServerCert(ip);
        Assert.True(Validates(leaf, root, out var f), f.ToString());
        Assert.True((leaf.NotAfter - leaf.NotBefore).TotalDays <= 398);
        var san = leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single();
        Assert.Contains(IPAddress.Parse("192.168.1.50"), san.EnumerateIPAddresses()); Assert.Contains("localhost", san.EnumerateDnsNames());
        Assert.Contains(leaf.Extensions, e => e.Oid?.Value == "2.5.29.37");
        var bc = root.Extensions.OfType<X509BasicConstraintsExtension>().Single(); Assert.True(bc.CertificateAuthority); Assert.True(bc.Critical);
        var nc = root.Extensions.Cast<X509Extension>().Single(e => e.Oid?.Value == "2.5.29.30"); Assert.True(nc.Critical);
        Assert.NotNull(ca.MobileConfig("192.168.1.50")); Assert.Equal(64, ca.RootSha256!.Length);
    }

    [Fact]
    public void The_root_is_name_constrained_so_it_cannot_vouch_for_other_sites_or_addresses()
    {
        using var t = new TempDir(); var ca = new LocalCa(t.Path); ca.Enable(IPAddress.Parse("192.168.1.50"));
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(ca.CaCertPath));
        Assert.True(Validates(Issue(t.Path, null, IPAddress.Parse("192.168.1.50")), root, out var f0), f0.ToString());
        Assert.False(Validates(Issue(t.Path, "bank.example.com", null), root, out var f1)); Assert.True(f1.HasFlag(X509ChainStatusFlags.HasNotPermittedNameConstraint), f1.ToString());
        Assert.False(Validates(Issue(t.Path, null, IPAddress.Parse("8.8.8.8")), root, out var f2)); Assert.True(f2.HasFlag(X509ChainStatusFlags.HasNotPermittedNameConstraint), f2.ToString());
        Assert.False(Validates(Issue(t.Path, null, IPAddress.Parse("192.168.1.51")), root, out _));
    }

    [Fact]
    public void Ip_change_reissues_the_server_cert_without_changing_the_root_and_key_files_are_private()
    {
        using var t = new TempDir(); var ca = new LocalCa(t.Path); var ip1 = IPAddress.Parse("192.168.1.50"); ca.Enable(ip1);
        var sha = ca.RootSha256; var c1 = ca.CurrentServerCert(ip1).Thumbprint;
        var c2 = ca.CurrentServerCert(IPAddress.Parse("192.168.1.50")).Thumbprint; Assert.Equal(c1, c2);       // stable while nothing changed
        var boot = new LocalCa(Path.Combine(t.Path, "other")); Assert.Equal("CN=WavWiz (not yet trusted)", boot.CurrentServerCert(null).Subject);   // before setup: bootstrap cert, port still answers
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(t.Path, "tls", "ca.key.pem")));
        Assert.Equal(sha, ca.RootSha256);
    }
}
