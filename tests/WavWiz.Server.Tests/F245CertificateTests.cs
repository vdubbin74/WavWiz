using System.Net;
using System.Formats.Asn1;
using Microsoft.AspNetCore.Http;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

// All certificate/key material in this fixture is synthetic, generated in isolated TempDirs.
// SAN/trust tests do not prove the iPhone Home Screen icon cause or fix.
public class F245CertificateTests
{
    private static readonly IPAddress Lan = IPAddress.Parse("192.168.1.169"), Tail = IPAddress.Parse("100.102.134.105");
    private static readonly IPAddress[] Endpoints = [Lan, Tail, IPAddress.Loopback];
    private static LocalCa Ca(string dir) => new(dir, _ => Endpoints);
    private static string Pfx(string dir) => Path.Combine(dir, "tls", "server.pfx");
    private static string Key(string dir) => Path.Combine(dir, "tls", "ca.key.pem");
    private static byte[] PfxBytes(string dir) => File.ReadAllBytes(Pfx(dir));
    private static bool Chains(X509Certificate2 leaf, X509Certificate2 root)
    {
        using var chain = new X509Chain(); chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(root); chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        return chain.Build(leaf);
    }
    private static void WriteLeaf(string dir, IEnumerable<IPAddress> ips, DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        using var ca = X509Certificate2.CreateFromPemFile(Path.Combine(dir, "tls", LocalCa.CaFileName), Key(dir));
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=WavWiz test managed leaf", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); foreach (var ip in ips) san.AddIpAddress(ip);
        foreach (var dns in CertificateEndpoints.DnsNames()) san.AddDnsName(dns); req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        using var leaf = req.Create(ca, from ?? DateTimeOffset.UtcNow.AddHours(-1), to ?? DateTimeOffset.UtcNow.AddDays(100), RandomNumberGenerator.GetBytes(8));
        using var full = leaf.CopyWithPrivateKey(key); File.WriteAllBytes(Pfx(dir), full.Export(X509ContentType.Pfx));
    }

    [Fact]
    public void Wildcard_selects_up_default_route_LAN_and_Tailscale_not_wildcards_or_unrelated_interfaces()
    {
        CertificateEndpoints.InterfaceAddress[] interfaces = [
            new(Lan, true, true, true, false), new(Lan.MapToIPv6(), true, true, true, false),
            new(Tail, true, false, false, true), new(IPAddress.Parse("10.1.2.3"), false, true, true, false),
            new(IPAddress.Parse("172.17.0.1"), true, true, false, false), new(IPAddress.Parse("8.8.8.8"), true, true, true, false),
            new(IPAddress.Parse("169.254.1.1"), true, true, true, false), new(IPAddress.Any, true, true, true, false) ];
        var ips = CertificateEndpoints.Select(IPAddress.Any, interfaces);
        Assert.Equal(3, ips.Count); Assert.Contains(Lan, ips); Assert.Contains(Tail, ips); Assert.Contains(IPAddress.Loopback, ips);
        Assert.DoesNotContain(IPAddress.Any, ips); Assert.DoesNotContain(IPAddress.IPv6Any, ips);
        Assert.Equal(new[] { IPAddress.Loopback, Lan }, CertificateEndpoints.Select(Lan, interfaces));
    }
    [Fact]
    public void Ipv6_wildcard_includes_ULA_and_Tailscale_but_not_scoped_linklocal_or_multicast()
    {
        var ula = IPAddress.Parse("fd12::1"); var tail = IPAddress.Parse("fd7a:115c:a1e0::1234");
        var ips = CertificateEndpoints.Select(IPAddress.IPv6Any, [new(ula, true, true, true, false), new(tail, true, false, false, true),
            new(IPAddress.Parse("fe80::1%3"), true, true, true, false), new(IPAddress.Parse("ff02::1"), true, true, true, false)]);
        Assert.Contains(ula, ips); Assert.Contains(tail, ips); Assert.Contains(IPAddress.IPv6Loopback, ips); Assert.Equal(4, ips.Count);
    }
    [Fact]
    public void Fresh_wildcard_leaf_has_real_LAN_Tailscale_SANs_and_validates_to_the_constrained_root()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any);
        var leaf = ca.CurrentServerCert(IPAddress.Any);
        Assert.True(CertificateEndpoints.Covers(leaf, Endpoints)); Assert.DoesNotContain("0.0.0.0", leaf.Subject);
        var san = leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single(); Assert.DoesNotContain(IPAddress.Any, san.EnumerateIPAddresses());
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(ca.CaCertPath)); Assert.True(Chains(leaf, root));
        Assert.True((leaf.NotAfter - leaf.NotBefore).TotalDays <= 398);
    }
    [Fact]
    public void Matching_actual_SANs_reuse_despite_sidecar_and_order_or_address_representation_changes()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); var bytes = PfxBytes(t.Path); var root = ca.RootSha256;
        File.WriteAllText(Path.Combine(t.Path, "tls", "tls-state.txt"), "unrelated-old-bind");
        var other = new LocalCa(t.Path, _ => [Tail.MapToIPv6(), Lan, IPAddress.Loopback]);
        var leaf = other.CurrentServerCert(IPAddress.Any); other.Enable(IPAddress.Any);
        Assert.True(CertificateEndpoints.Covers(leaf, Endpoints)); Assert.Equal(bytes, PfxBytes(t.Path)); Assert.Equal(root, other.RootSha256); Assert.Null(other.LastRenewalError);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Missing_actual_LAN_or_Tail_SAN_renews_only_leaf_under_existing_permitting_CA(bool missingTail)
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any);
        var root = ca.RootSha256; var keyHash = SHA256.HashData(File.ReadAllBytes(Key(t.Path)));
        WriteLeaf(t.Path, [missingTail ? Lan : Tail, IPAddress.Loopback]); var old = PfxBytes(t.Path);
        var renewed = Ca(t.Path); var leaf = renewed.CurrentServerCert(IPAddress.Any);
        Assert.True(CertificateEndpoints.Covers(leaf, Endpoints)); Assert.NotEqual(old, PfxBytes(t.Path)); Assert.Equal(root, renewed.RootSha256);
        Assert.Equal(keyHash, SHA256.HashData(File.ReadAllBytes(Key(t.Path)))); Assert.Null(renewed.LastRenewalError);
        var stable = PfxBytes(t.Path); Assert.Same(leaf, renewed.CurrentServerCert(IPAddress.Any)); Assert.Equal(stable, PfxBytes(t.Path));
        Assert.Empty(Directory.GetFiles(Path.Combine(t.Path, "tls"), "*.new-*"));
    }
    [Fact]
    public void Root_constraints_for_old_endpoint_refuse_unsafe_expansion_and_retain_current_cert_and_trust()
    {
        using var t = new TempDir(); var initial = new LocalCa(t.Path, _ => [Lan, IPAddress.Loopback]); initial.Enable(Lan);
        var old = PfxBytes(t.Path); var sha = initial.RootSha256; var upgraded = Ca(t.Path);
        var leaf = upgraded.CurrentServerCert(IPAddress.Any);
        Assert.False(CertificateEndpoints.Covers(leaf, Endpoints)); Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(sha, upgraded.RootSha256);
        Assert.Contains("constraints", upgraded.LastRenewalError); Assert.Contains("re-trust", upgraded.LastRenewalError);
        Assert.Throws<InvalidOperationException>(() => upgraded.Enable(IPAddress.Any)); Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(sha, upgraded.RootSha256);
    }
    [Fact]
    public void Missing_CA_key_on_renewal_keeps_valid_leaf_without_creating_a_new_CA()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); WriteLeaf(t.Path, [Lan, IPAddress.Loopback]);
        var old = PfxBytes(t.Path); var root = ca.RootSha256; File.Delete(Key(t.Path)); var upgraded = Ca(t.Path);
        var cert = upgraded.CurrentServerCert(IPAddress.Any); Assert.True(cert.NotAfter > DateTime.Now); Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(root, upgraded.RootSha256); Assert.NotNull(upgraded.LastRenewalError);
        Assert.Throws<InvalidOperationException>(() => upgraded.Enable(IPAddress.Any)); Assert.Equal(root, upgraded.RootSha256);
    }
    [Theory]
    [InlineData(-20, -1)]
    [InlineData(-1, 24)]
    [InlineData(1, 1000)]
    public void Expired_soon_expiring_or_not_yet_valid_managed_leaf_renews_without_CA_churn(int fromHours, int toHours)
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); var root = ca.RootSha256;
        WriteLeaf(t.Path, Endpoints, DateTimeOffset.UtcNow.AddHours(fromHours), DateTimeOffset.UtcNow.AddHours(toHours)); var old = PfxBytes(t.Path);
        var upgraded = Ca(t.Path); var leaf = upgraded.CurrentServerCert(IPAddress.Any);
        Assert.True(leaf.NotBefore <= DateTime.Now); Assert.True(leaf.NotAfter > DateTime.Now.AddDays(30)); Assert.NotEqual(old, PfxBytes(t.Path)); Assert.Equal(root, upgraded.RootSha256); Assert.Null(upgraded.LastRenewalError);
    }
    [Fact]
    public void Foreign_or_unmanaged_cert_is_not_overwritten_even_when_SANs_are_missing()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); var root = ca.RootSha256;
        using var key = RSA.Create(2048); var req = new CertificateRequest("CN=Custom certificate", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var foreign = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(90));
        File.WriteAllBytes(Pfx(t.Path), foreign.Export(X509ContentType.Pfx)); var old = PfxBytes(t.Path);
        var upgraded = Ca(t.Path); Assert.Equal(foreign.Thumbprint, upgraded.CurrentServerCert(IPAddress.Any).Thumbprint);
        Assert.Contains("not verifiably managed", upgraded.LastRenewalError); Assert.Throws<InvalidOperationException>(() => upgraded.Enable(IPAddress.Any));
        Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(root, upgraded.RootSha256);
        File.Delete(upgraded.CaCertPath); File.Delete(Key(t.Path));
        Assert.Throws<InvalidOperationException>(() => upgraded.Enable(IPAddress.Any)); Assert.False(File.Exists(upgraded.CaCertPath)); Assert.Equal(old, PfxBytes(t.Path));
    }
    [Fact]
    public void Corrupt_PFX_is_left_intact_with_bootstrap_and_a_non_secret_error()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); var sha = ca.RootSha256;
        File.WriteAllBytes(Pfx(t.Path), [0, 1, 2]); var upgraded = Ca(t.Path);
        Assert.Contains("not yet trusted", upgraded.CurrentServerCert(IPAddress.Any).Subject);
        Assert.Equal(new byte[] { 0, 1, 2 }, PfxBytes(t.Path)); Assert.Equal(sha, upgraded.RootSha256); Assert.NotNull(upgraded.LastRenewalError);
    }
    [Fact]
    public void Staged_replace_failure_preserves_leaf_CA_and_active_certificate_and_cleans_temp()
    {
        using var t = new TempDir(); var ca = Ca(t.Path); ca.Enable(IPAddress.Any); WriteLeaf(t.Path, [Lan, IPAddress.Loopback]);
        var old = PfxBytes(t.Path); var sha = ca.RootSha256; var attempts = 0;
        var upgraded = new LocalCa(t.Path, _ => Endpoints, (_, _) => { attempts++; throw new IOException("simulated replace failure"); });
        var current = upgraded.CurrentServerCert(IPAddress.Any);
        Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(sha, upgraded.RootSha256); Assert.NotNull(upgraded.LastRenewalError);
        Assert.Same(current, upgraded.CurrentServerCert(IPAddress.Any)); Assert.Equal(1, attempts);
        Assert.Empty(Directory.GetFiles(Path.Combine(t.Path, "tls"), "*.new-*"));
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Pfx(t.Path)));
    }

    [Fact]
    public void Old_wildcard_name_constrained_CA_cannot_silently_expand_to_LAN_and_Tailscale()
    {
        using var t = new TempDir(); var initial = Ca(t.Path); initial.Enable(IPAddress.Any);
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=WavWiz old wildcard CA", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign, true));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        var w = new AsnWriter(AsnEncodingRules.DER);
        using (w.PushSequence()) using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 0)))
        {
            foreach (var dns in CertificateEndpoints.DnsNames()) using (w.PushSequence()) w.WriteCharacterString(UniversalTagNumber.IA5String, dns, new Asn1Tag(TagClass.ContextSpecific, 2));
            foreach (var ip in new[] { IPAddress.Any, IPAddress.Loopback }) using (w.PushSequence()) w.WriteOctetString(ip.GetAddressBytes().Concat(new byte[] { 255, 255, 255, 255 }).ToArray(), new Asn1Tag(TagClass.ContextSpecific, 7));
        }
        req.CertificateExtensions.Add(new X509Extension(new Oid("2.5.29.30"), w.Encode(), true));
        using var root = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        File.WriteAllText(initial.CaCertPath, root.ExportCertificatePem()); File.WriteAllText(Key(t.Path), key.ExportPkcs8PrivateKeyPem());
        WriteLeaf(t.Path, [IPAddress.Any, IPAddress.Loopback]); var old = PfxBytes(t.Path); var sha = initial.RootSha256;
        var upgraded = Ca(t.Path); var current = upgraded.CurrentServerCert(IPAddress.Any);
        Assert.Equal(old, PfxBytes(t.Path)); Assert.Equal(sha, upgraded.RootSha256); Assert.Contains("constraints", upgraded.LastRenewalError);
        Assert.False(CertificateEndpoints.Covers(current, Endpoints));
    }
    [Fact]
    public async Task Phone_host_never_advertises_the_wildcard_and_keeps_the_requested_Tailscale_origin()
    {
        await using var f = await ServerFixture.StartAsync(); var c = new DefaultHttpContext();
        f.Cfg.BindAddress = "0.0.0.0"; c.Request.Host = new HostString("localhost");
        var host = Api.PhoneApi.PhoneHost(c, f.Server.S); Assert.NotEqual("0.0.0.0", host); Assert.NotEqual("::", host);
        c.Request.Host = new HostString(Tail.ToString()); Assert.Equal(Tail.ToString(), Api.PhoneApi.PhoneHost(c, f.Server.S));
        f.Cfg.BindAddress = "fd12::1"; c.Request.Host = new HostString("localhost"); Assert.Equal("[fd12::1]", Api.PhoneApi.PhoneHost(c, f.Server.S));
    }

}
