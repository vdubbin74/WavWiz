using System.Formats.Asn1;
using System.Net;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
namespace WavWiz.Server.Tls;

/// <summary>
/// Per-install local certificate authority (spec 8.4 / 13). Phones need HTTPS to use the microphone, so the server issues a certificate for its own LAN IP
/// from a private root the user installs on their phone. The root carries a critical NameConstraints extension (only this server's IP + names), so even if
/// its key leaked it could not be used to impersonate other sites. The key never leaves the data folder (restricted ACL / 0600).
/// </summary>
public sealed class LocalCa
{
    private readonly string _dir; private readonly object _l = new();
    private X509Certificate2? _serverCert, _bootstrap;
    public string CaCertPath => Path.Combine(_dir, "unison-root-ca.crt");
    private string CaKeyPath => Path.Combine(_dir, "ca.key.pem");
    private string ServerPfxPath => Path.Combine(_dir, "server.pfx");
    private string StatePath => Path.Combine(_dir, "tls-state.txt");

    public LocalCa(string dataDir) { _dir = Path.Combine(dataDir, "tls"); Directory.CreateDirectory(_dir); }

    public bool Enabled => File.Exists(CaCertPath) && File.Exists(ServerPfxPath);
    public byte[]? RootDer => File.Exists(CaCertPath) ? X509Certificate2.CreateFromPem(File.ReadAllText(CaCertPath)).RawData : null;
    public string? RootSha256 => RootDer is { } d ? Convert.ToHexString(SHA256.HashData(d)) : null;
    public DateTimeOffset? ServerCertExpires { get { try { return CurrentServerCert(null)?.NotAfter; } catch { return null; } } }

    private static byte[] NameConstraints(IEnumerable<IPAddress> ips, IEnumerable<string> dns)
    {
        var w = new AsnWriter(AsnEncodingRules.DER);
        using (w.PushSequence())
        {
            using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 0)))              // permittedSubtrees
            {
                foreach (var d in dns) using (w.PushSequence()) w.WriteCharacterString(UniversalTagNumber.IA5String, d, new Asn1Tag(TagClass.ContextSpecific, 2));
                foreach (var ip in ips)
                {
                    var a = ip.GetAddressBytes(); var mask = Enumerable.Repeat((byte)0xFF, a.Length).ToArray();
                    using (w.PushSequence()) w.WriteOctetString(a.Concat(mask).ToArray(), new Asn1Tag(TagClass.ContextSpecific, 7));
                }
            }
        }
        return w.Encode();
    }

    /// <summary>Create (or re-create) the root CA and a server certificate for <paramref name="ip"/>. Existing trust on phones keeps working only if the CA is not re-created.</summary>
    public void Enable(IPAddress ip, bool recreateCa = false)
    {
        lock (_l)
        {
            if (recreateCa || !File.Exists(CaCertPath) || !File.Exists(CaKeyPath)) CreateRoot(ip);
            IssueServer(ip);
        }
    }

    private void CreateRoot(IPAddress ip)
    {
        using var rsa = RSA.Create(3072);
        var req = new CertificateRequest("CN=WavWiz Local CA (BETA) " + Environment.MachineName + ", O=WavWiz", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        var dns = new[] { "localhost", "wavwiz.local", Environment.MachineName.ToLowerInvariant(), Environment.MachineName.ToLowerInvariant() + ".local" }.Distinct();
        // this server's IP (any future IP in the same /24 would need a new CA by design: the constraint is the safety net)
        req.CertificateExtensions.Add(new X509Extension(new Oid("2.5.29.30"), NameConstraints(new[] { ip, IPAddress.Loopback }, dns), true));
        using var ca = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        File.WriteAllText(CaCertPath, ca.ExportCertificatePem());
        File.WriteAllText(CaKeyPath, rsa.ExportPkcs8PrivateKeyPem());
        Restrict(CaKeyPath);
    }

    private void IssueServer(IPAddress ip)
    {
        using var caCert = X509Certificate2.CreateFromPem(File.ReadAllText(CaCertPath));
        using var caKey = RSA.Create(); caKey.ImportFromPem(File.ReadAllText(CaKeyPath));
        using var ca = caCert.CopyWithPrivateKey(caKey);
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=WavWiz server " + ip, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); san.AddIpAddress(ip); san.AddIpAddress(IPAddress.Loopback);
        foreach (var d in new[] { "localhost", "wavwiz.local", Environment.MachineName.ToLowerInvariant(), Environment.MachineName.ToLowerInvariant() + ".local" }.Distinct()) san.AddDnsName(d);
        req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        req.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(caCert, true, false));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        var serial = RandomNumberGenerator.GetBytes(16); serial[0] &= 0x7F;
        // iOS/Android require <= 398 days
        using var leaf = req.Create(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(397), serial);
        using var withKey = leaf.CopyWithPrivateKey(key);
        File.WriteAllBytes(ServerPfxPath, withKey.Export(X509ContentType.Pfx));
        Restrict(ServerPfxPath);
        File.WriteAllText(StatePath, ip.ToString());
        _serverCert?.Dispose(); _serverCert = null;
    }

    /// <summary>Certificate Kestrel should present; renews when the IP changed or less than 30 days remain; a throw-away self-signed one before TLS is set up.</summary>
    public X509Certificate2 CurrentServerCert(IPAddress? ip)
    {
        lock (_l)
        {
            if (Enabled)
            {
                try
                {
                    if (ip != null && (!File.Exists(StatePath) || File.ReadAllText(StatePath).Trim() != ip.ToString() ||
                        (_serverCert ??= LoadPfx()).NotAfter < DateTime.Now.AddDays(30))) IssueServer(ip);
                    return _serverCert ??= LoadPfx();
                }
                catch { /* fall through to bootstrap so the port still answers */ }
            }
            return _bootstrap ??= Bootstrap();
        }
    }

    private X509Certificate2 LoadPfx() => X509CertificateLoader.LoadPkcs12FromFile(ServerPfxPath, null);

    private static X509Certificate2 Bootstrap()
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=WavWiz (not yet trusted)", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var c = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
        return X509CertificateLoader.LoadPkcs12(c.Export(X509ContentType.Pfx), null);
    }

    public string MobileConfig(string host)
    {
        var der = RootDer ?? throw new InvalidOperationException("TLS is not set up");
        string b64 = Convert.ToBase64String(der, Base64FormattingOptions.InsertLineBreaks);
        string u1 = Guid.NewGuid().ToString().ToUpperInvariant(), u2 = Guid.NewGuid().ToString().ToUpperInvariant();
        return $"""
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>PayloadContent</key><array><dict>
  <key>PayloadCertificateFileName</key><string>unison-root-ca.crt</string>
  <key>PayloadContent</key><data>
{b64}
  </data>
  <key>PayloadDescription</key><string>Lets this phone trust the WavWiz server on your home network (limited to {System.Security.SecurityElement.Escape(host)}).</string>
  <key>PayloadDisplayName</key><string>WavWiz Local CA (BETA)</string>
  <key>PayloadIdentifier</key><string>app.wavwiz.rootca.{u1}</string>
  <key>PayloadType</key><string>com.apple.security.root</string>
  <key>PayloadUUID</key><string>{u1}</string><key>PayloadVersion</key><integer>1</integer>
 </dict></array>
 <key>PayloadDescription</key><string>Installs the WavWiz local certificate authority</string>
 <key>PayloadDisplayName</key><string>WavWiz Local CA (BETA)</string>
 <key>PayloadIdentifier</key><string>app.wavwiz.profile.{u2}</string>
 <key>PayloadRemovalDisallowed</key><false/>
 <key>PayloadType</key><string>Configuration</string>
 <key>PayloadUUID</key><string>{u2}</string><key>PayloadVersion</key><integer>1</integer>
</dict></plist>
""";
    }

    private static void Restrict(string path)
    {
        try
        {
            if (OperatingSystem.IsWindows()) RestrictWindows(path);
            else File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch { /* the data folder itself is already ACL-restricted by the installer; this is defense in depth */ }
    }

    [SupportedOSPlatform("windows")]
    private static void RestrictWindows(string path)
    {
        var fi = new FileInfo(path); var sec = fi.GetAccessControl();
        sec.SetAccessRuleProtection(true, false);
        foreach (System.Security.AccessControl.FileSystemAccessRule r in sec.GetAccessRules(true, false, typeof(System.Security.Principal.SecurityIdentifier))) sec.RemoveAccessRule(r);
        foreach (var sid in new[] { System.Security.Principal.WellKnownSidType.LocalSystemSid, System.Security.Principal.WellKnownSidType.BuiltinAdministratorsSid, System.Security.Principal.WellKnownSidType.LocalServiceSid })
            sec.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(new System.Security.Principal.SecurityIdentifier(sid, null), System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.AccessControlType.Allow));
        fi.SetAccessControl(sec);
    }
}
