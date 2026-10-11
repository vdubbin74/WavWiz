using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using WavWiz.Core.Discovery;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

/// <summary>
/// 0.2.4: the security certificate a phone installs no longer mentions the old "Unison" name (subject/issuer, file names, profile). A root made by the
/// 0.0.1/0.0.2 betas (subject "Unison Local CA") is replaced by a WavWiz one on first start (old files kept as backups); a WavWiz root is only renamed so
/// phones keep their trust. /ping says app "wavwiz"; the UDP beacon keeps "unison" for 0.0.2..0.2.3 players and every reader accepts both.
/// </summary>
public class CertNameTests
{
    private static readonly IPAddress Ip = IPAddress.Parse("192.168.1.169");

    /// <summary>Writes the files a 0.0.2 server left behind: unison-root-ca.crt (CN=Unison Local CA, O=Unison), ca.key.pem, server.pfx (CN=Unison server), tls-state.txt.</summary>
    private static string MakeLegacy(string data, string org)
    {
        var dir = Path.Combine(data, "tls"); Directory.CreateDirectory(dir);
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest($"CN={org} Local CA (BETA) TESTPC, O={org}", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        using var ca = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        File.WriteAllText(Path.Combine(dir, "unison-root-ca.crt"), ca.ExportCertificatePem());
        File.WriteAllText(Path.Combine(dir, "ca.key.pem"), rsa.ExportPkcs8PrivateKeyPem());
        using var k = RSA.Create(2048);
        var lr = new CertificateRequest($"CN={org} server {Ip}", k, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var leaf = lr.Create(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(300), RandomNumberGenerator.GetBytes(8));
        using var lk = leaf.CopyWithPrivateKey(k);
        File.WriteAllBytes(Path.Combine(dir, "server.pfx"), lk.Export(X509ContentType.Pfx));
        File.WriteAllText(Path.Combine(dir, "tls-state.txt"), Ip.ToString());
        return Convert.ToHexString(SHA256.HashData(ca.RawData));
    }

    private static X509Certificate2 Root(LocalCa ca) => X509Certificate2.CreateFromPem(File.ReadAllText(ca.CaCertPath));

    [Fact]
    public void A_fresh_root_server_cert_and_profile_never_mention_unison_and_use_wavwiz_file_names()
    {
        using var t = new TempDir(); var ca = new LocalCa(t.Path); ca.Enable(Ip);
        Assert.Equal("wavwiz-root-ca.crt", Path.GetFileName(ca.CaCertPath)); Assert.Equal("wavwiz-root-ca.crt", LocalCa.CaFileName); Assert.Equal("wavwiz-root-ca.mobileconfig", LocalCa.MobileConfigFileName);
        Assert.False(File.Exists(ca.LegacyCaCertPath));
        using var root = Root(ca); var leaf = ca.CurrentServerCert(Ip);
        foreach (var s in new[] { root.Subject, root.Issuer, leaf.Subject, leaf.Issuer, root.FriendlyName, leaf.FriendlyName }) Assert.DoesNotContain("unison", s, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("O=WavWiz", root.Subject); Assert.StartsWith("CN=WavWiz", root.Subject); Assert.StartsWith("CN=WavWiz", leaf.Subject);
        foreach (var d in leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single().EnumerateDnsNames()) Assert.DoesNotContain("unison", d, StringComparison.OrdinalIgnoreCase);
        var mc = ca.MobileConfig(Ip.ToString());
        var text = mc[..mc.IndexOf("<data>", StringComparison.Ordinal)] + mc[mc.IndexOf("</data>", StringComparison.Ordinal)..];     // the base64 blob itself can contain any letters
        Assert.DoesNotContain("unison", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("<string>wavwiz-root-ca.crt</string>", mc); Assert.Contains("<key>PayloadOrganization</key><string>WavWiz</string>", mc);
        Assert.Contains("app.wavwiz.profile.", mc); Assert.Contains("app.wavwiz.rootca.", mc);
        Assert.DoesNotContain("unison", Convert.ToBase64String(root.RawData), StringComparison.Ordinal);   // sanity on the DER text too (subject is in it)
        Assert.DoesNotContain("unison", System.Text.Encoding.ASCII.GetString(root.RawData), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("unison", System.Text.Encoding.ASCII.GetString(leaf.RawData), StringComparison.OrdinalIgnoreCase);
        Assert.Null(ca.MigrateLegacy(Ip)); Assert.Null(ca.RegeneratedFromLegacyAt);         // nothing to do on a new install
    }

    [Fact]
    public void A_unison_root_from_the_early_betas_is_replaced_by_a_wavwiz_one_and_the_old_files_are_kept()
    {
        using var t = new TempDir(); var oldSha = MakeLegacy(t.Path, "Unison");
        var ca = new LocalCa(t.Path);
        Assert.False(ca.Enabled);                                                           // before the migration the new name is not there yet
        var log = ca.MigrateLegacy(null);                                                   // address comes from tls-state.txt
        Assert.NotNull(log); Assert.Contains("install and trust the new certificate", log);
        Assert.True(ca.Enabled); Assert.NotEqual(oldSha, ca.RootSha256); Assert.NotNull(ca.RegeneratedFromLegacyAt);
        using var root = Root(ca); var leaf = ca.CurrentServerCert(Ip);
        Assert.DoesNotContain("unison", root.Subject + root.Issuer + leaf.Subject + leaf.Issuer, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(IPAddress.Parse("192.168.1.169"), leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single().EnumerateIPAddresses());
        var tls = Path.Combine(t.Path, "tls"); var files = Directory.GetFiles(tls).Select(Path.GetFileName).ToList();
        Assert.DoesNotContain("unison-root-ca.crt", files);
        Assert.Contains(files, f => f!.StartsWith("wavwiz-root-ca.crt.unison-backup-"));
        Assert.Contains(files, f => f!.StartsWith("ca.key.pem.unison-backup-"));
        Assert.Contains(files, f => f!.StartsWith("server.pfx.unison-backup-"));
        using (var bak = X509Certificate2.CreateFromPem(File.ReadAllText(Directory.GetFiles(tls, "wavwiz-root-ca.crt.unison-backup-*").Single()))) Assert.Equal(oldSha, Convert.ToHexString(SHA256.HashData(bak.RawData)));
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Directory.GetFiles(tls, "ca.key.pem.unison-backup-*").Single()));
        // runs once: the next start leaves the new root alone
        var sha = ca.RootSha256; Assert.Null(new LocalCa(t.Path).MigrateLegacy(Ip)); Assert.Equal(sha, new LocalCa(t.Path).RootSha256);
    }

    [Fact]
    public void A_root_that_already_says_wavwiz_is_only_renamed_so_phones_keep_their_trust()
    {
        using var t = new TempDir(); var oldSha = MakeLegacy(t.Path, "WavWiz");
        File.Delete(Path.Combine(t.Path, "tls", "server.pfx"));
        var ca = new LocalCa(t.Path);
        var log = ca.MigrateLegacy(Ip);
        Assert.NotNull(log); Assert.Contains("moved unison-root-ca.crt", log); Assert.DoesNotContain("new WavWiz root", log);
        Assert.Equal(oldSha, ca.RootSha256); Assert.Null(ca.RegeneratedFromLegacyAt);
        Assert.False(File.Exists(ca.LegacyCaCertPath)); Assert.Empty(Directory.GetFiles(Path.Combine(t.Path, "tls"), "*unison-backup*"));
        ca.Enable(Ip); Assert.Equal(oldSha, ca.RootSha256);                                  // "Set up HTTPS" again keeps the same root
    }

    [Fact]
    public void A_wavwiz_root_with_a_leftover_unison_server_cert_gets_only_a_new_server_cert()
    {
        using var t = new TempDir(); var ca0 = new LocalCa(t.Path); ca0.Enable(Ip); var sha = ca0.RootSha256;
        // simulate an old leaf name under the WavWiz root
        using (var caCert = X509Certificate2.CreateFromPem(File.ReadAllText(ca0.CaCertPath)))
        using (var caKey = RSA.Create())
        {
            caKey.ImportFromPem(File.ReadAllText(Path.Combine(t.Path, "tls", "ca.key.pem"))); using var full = caCert.CopyWithPrivateKey(caKey); using var k = RSA.Create(2048);
            using var leaf = new CertificateRequest("CN=Unison server " + Ip, k, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1).Create(full, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(300), RandomNumberGenerator.GetBytes(8));
            using var lk = leaf.CopyWithPrivateKey(k); File.WriteAllBytes(Path.Combine(t.Path, "tls", "server.pfx"), lk.Export(X509ContentType.Pfx));
        }
        var ca = new LocalCa(t.Path); var log = ca.MigrateLegacy(Ip);
        Assert.NotNull(log); Assert.Contains("root is unchanged", log);
        Assert.Equal(sha, ca.RootSha256); Assert.Null(ca.RegeneratedFromLegacyAt);
        Assert.DoesNotContain("unison", ca.CurrentServerCert(Ip).Subject, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void A_unison_root_without_any_known_address_is_left_working_until_https_is_set_up_again()
    {
        using var t = new TempDir(); var oldSha = MakeLegacy(t.Path, "Unison"); File.Delete(Path.Combine(t.Path, "tls", "tls-state.txt"));
        var ca = new LocalCa(t.Path); var log = ca.MigrateLegacy(null);
        Assert.Contains("no server address is known", log); Assert.Equal(oldSha, ca.RootSha256); Assert.True(ca.Enabled);   // renamed, still serving
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
    public void Beacons_keep_saying_unison_for_old_players_and_both_names_are_accepted()
    {
        var b = new ServerBeacon("id1", "PC-HMS", "192.168.1.169", 47800, 47801, 47802, "0.2.4");
        Assert.Contains("\"app\":\"unison\"", System.Text.Encoding.UTF8.GetString(b.ToUdp()));          // what a 0.2.3 player's FromUdp requires
        foreach (var app in new[] { "unison", "wavwiz" })
            Assert.NotNull(ServerBeacon.FromUdp(System.Text.Encoding.UTF8.GetBytes($"{{\"app\":\"{app}\",\"v\":1,\"id\":\"a\",\"name\":\"b\",\"host\":\"1.2.3.4\",\"httpPort\":47800,\"audioPort\":47802}}"), IPAddress.Parse("1.2.3.4")));
        Assert.Null(ServerBeacon.FromUdp("{\"app\":\"other\"}"u8, null));
        Assert.True(ServerBeacon.IsOurApp("wavwiz")); Assert.True(ServerBeacon.IsOurApp("unison")); Assert.False(ServerBeacon.IsOurApp("WavWiz2")); Assert.False(ServerBeacon.IsOurApp(null));
    }
}
