using System.Formats.Asn1;
using System.Net;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
namespace WavWiz.Server.Tls;

/// <summary>
/// Per-install local certificate authority (spec 8.4 / 13). Phones need HTTPS to use the microphone, so the server issues a certificate for its own LAN IP
/// from a private root the user installs on their phone. The root carries a critical NameConstraints extension (only this server's endpoint IPs + names), so even if
/// its key leaked it could not be used to impersonate other sites. The key never leaves the data folder (restricted ACL / 0600).
/// </summary>
public sealed class LocalCa
{
    private readonly string _dir; private readonly object _l = new();
    private X509Certificate2? _serverCert, _bootstrap;
    private readonly Func<IPAddress, IReadOnlyList<IPAddress>> _endpoints;
    private readonly Action<string, string> _replacePfx;
    private DateTime _retryRenewalAfter;
    public string? LastRenewalError { get; private set; }
    public const string CaFileName = "wavwiz-root-ca.crt", MobileConfigFileName = "wavwiz-root-ca.mobileconfig";
    public string CaCertPath => Path.Combine(_dir, CaFileName);
    private string CaKeyPath => Path.Combine(_dir, "ca.key.pem");
    private string ServerPfxPath => Path.Combine(_dir, "server.pfx");
    private string StatePath => Path.Combine(_dir, "tls-state.txt");

    public LocalCa(string dataDir) : this(dataDir, CertificateEndpoints.Resolve) { }
    internal LocalCa(string dataDir, Func<IPAddress, IReadOnlyList<IPAddress>> endpoints, Action<string, string>? replacePfx = null)
    { _dir = Path.Combine(dataDir, "tls"); Directory.CreateDirectory(_dir); _endpoints = endpoints; _replacePfx = replacePfx ?? ((from, to) => File.Move(from, to, true)); }

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

    /// <summary>F257: the endpoint IPs the root's critical NameConstraints permit (exact ip/mask subtrees). No constraint = all permitted.
    /// Lets a leaf-only reissue under the EXISTING root add the LAN IP (and the Tailscale IP only where permitted) instead of refusing outright.</summary>
    internal static IReadOnlyList<IPAddress> PermittedBy(X509Certificate2 root, IReadOnlyList<IPAddress> endpoints)
    {
        var ext = root.Extensions.Cast<X509Extension>().FirstOrDefault(e => e.Oid?.Value == "2.5.29.30");
        if (ext == null) return endpoints;
        var nets = new List<(byte[] Addr, byte[] Mask)>();
        try
        {
            var seq = new AsnReader(ext.RawData, AsnEncodingRules.DER).ReadSequence();
            var permittedTag = new Asn1Tag(TagClass.ContextSpecific, 0);
            if (!seq.HasData || !seq.PeekTag().HasSameClassAndValue(permittedTag)) return endpoints;
            var permitted = seq.ReadSequence(permittedTag);
            while (permitted.HasData)
            {
                var sub = permitted.ReadSequence();
                var tag = sub.PeekTag();
                if (tag.HasSameClassAndValue(new Asn1Tag(TagClass.ContextSpecific, 7)))
                {
                    var b = sub.ReadOctetString(new Asn1Tag(TagClass.ContextSpecific, 7)); var n = b.Length / 2;
                    nets.Add((b[..n], b[n..]));
                }
            }
        }
        catch (AsnContentException) { return []; }
        if (nets.Count == 0) return endpoints;
        return endpoints.Where(ip =>
        {
            var a = CertificateEndpoints.Normalize(ip).GetAddressBytes();
            return nets.Any(net => net.Addr.Length == a.Length && Enumerable.Range(0, a.Length).All(i => (a[i] & net.Mask[i]) == (net.Addr[i] & net.Mask[i])));
        }).ToArray();
    }

    /// <summary>F257: required leaf identities under the existing root: all wanted endpoints the root permits. At least one non-loopback must remain,
    /// otherwise the root (e.g. one created for 0.0.0.0) cannot cover LAN/Tailscale and only an explicit CA recreation + phone re-trust can fix it.</summary>
    private IReadOnlyList<IPAddress> LeafEndpoints(IPAddress ip)
    {
        var wanted = _endpoints(ip);
        if (!File.Exists(CaCertPath)) return wanted;
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(CaCertPath));
        var ok = PermittedBy(root, wanted);
        if (wanted.Any(a => !IPAddress.IsLoopback(a)) && !ok.Any(a => !IPAddress.IsLoopback(a)))
            throw new InvalidOperationException("The existing CA's name constraints permit none of this server's LAN/Tailscale addresses (" + string.Join(", ", wanted.Where(a => !IPAddress.IsLoopback(a))) + "). Explicit CA recreation and phone re-trust are required; the existing CA and leaf are unchanged.");
        return ok;
    }

    /// <summary>Create (or re-create) the root CA and a server certificate for <paramref name="ip"/>. Existing trust on phones keeps working only if the CA is not re-created.</summary>
    public void Enable(IPAddress ip, bool recreateCa = false)
    {
        lock (_l)
        {
            var endpoints = _endpoints(ip);
            if (!recreateCa && File.Exists(CaCertPath) != File.Exists(CaKeyPath))
                throw new InvalidOperationException("The existing CA or its key is missing; restore it from backup. Trust will not be reset automatically.");
            if (!recreateCa && !File.Exists(CaCertPath) && File.Exists(ServerPfxPath))
                throw new InvalidOperationException("An existing leaf has no local CA; it will not be replaced automatically. Use your certificate administrator.");
            if (recreateCa || !File.Exists(CaCertPath)) CreateRoot(ip);
            if (!recreateCa && File.Exists(ServerPfxPath))
            {
                using var current = LoadPfx();
                EnsureOwned(current);
                if (Usable(current) && current.NotAfter.ToUniversalTime() >= DateTime.UtcNow.AddDays(30) && CertificateEndpoints.Covers(current, endpoints)) { LastRenewalError = null; return; }
            }
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
        var dns = CertificateEndpoints.DnsNames();
        // Exact endpoint constraints remain the safety net. A newly discovered address outside an
        // existing root's constraints requires explicit CA recreation/re-trust, NEVER silent widening.
        req.CertificateExtensions.Add(new X509Extension(new Oid("2.5.29.30"), NameConstraints(_endpoints(ip), dns), true));
        using var ca = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        File.WriteAllText(CaCertPath, ca.ExportCertificatePem());
        File.WriteAllText(CaKeyPath, rsa.ExportPkcs8PrivateKeyPem());
        Restrict(CaKeyPath);
    }

    private void IssueServer(IPAddress ip, IReadOnlyList<IPAddress>? permitted = null)
    {
        var endpoints = permitted ?? _endpoints(ip);
        if (endpoints.Any(CertificateEndpoints.Wildcard)) throw new InvalidOperationException("Wildcard addresses cannot be certificate identities.");
        using var caCert = X509Certificate2.CreateFromPem(File.ReadAllText(CaCertPath));
        using var caKey = RSA.Create(); caKey.ImportFromPem(File.ReadAllText(CaKeyPath));
        using var ca = caCert.CopyWithPrivateKey(caKey);
        using var key = RSA.Create(2048);
        var identity = endpoints.FirstOrDefault(a => !IPAddress.IsLoopback(a)) ?? IPAddress.Loopback;
        var req = new CertificateRequest("CN=WavWiz server " + identity, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        foreach (var endpoint in endpoints) san.AddIpAddress(endpoint);
        foreach (var d in CertificateEndpoints.DnsNames()) san.AddDnsName(d);
        req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        req.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(caCert, true, false));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        var serial = RandomNumberGenerator.GetBytes(16); serial[0] &= 0x7F;
        // iOS/Android require <= 398 days
        var expires = new DateTimeOffset(caCert.NotAfter.ToUniversalTime());
        if (expires <= DateTimeOffset.UtcNow.AddDays(30)) throw new InvalidOperationException("The existing CA expires too soon; explicit CA renewal and phone re-trust are required. Existing certificates are unchanged.");
        using var leaf = req.Create(ca, DateTimeOffset.UtcNow.AddMinutes(-5), expires < DateTimeOffset.UtcNow.AddDays(397) ? expires : DateTimeOffset.UtcNow.AddDays(397), serial);
        // A same-CA signature is insufficient if the old root's critical NameConstraints forbid
        // LAN/Tailscale SANs (notably roots created for 0.0.0.0). Refuse, retain trust/files, report.
        if (!ChainsTo(leaf, caCert, false)) throw new InvalidOperationException("The existing CA cannot validate the required endpoint SANs (check its name constraints and validity). Explicit CA recreation and phone re-trust are required; the existing CA and leaf are unchanged.");
        using var withKey = leaf.CopyWithPrivateKey(key);
        var temp = ServerPfxPath + ".new-" + Guid.NewGuid().ToString("N");
        try
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var file = new FileStream(temp, options)) { }
            Restrict(temp);
            File.WriteAllBytes(temp, withKey.Export(X509ContentType.Pfx));
            using (var check = X509CertificateLoader.LoadPkcs12FromFile(temp, null))
                if (!check.HasPrivateKey || !CertificateEndpoints.Covers(check, endpoints)) throw new InvalidOperationException("Staged leaf validation failed; existing certificates are unchanged.");
            _replacePfx(temp, ServerPfxPath); // same-directory atomic replacement, only after all validation
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
        try { File.WriteAllText(StatePath, ip.ToString()); } catch { /* SANs, not this hint, determine reuse */ }
        _serverCert?.Dispose(); _serverCert = null; LastRenewalError = null; _retryRenewalAfter = default;
    }

    private static bool Usable(X509Certificate2 c) => c.HasPrivateKey && c.NotBefore.ToUniversalTime() <= DateTime.UtcNow && c.NotAfter.ToUniversalTime() > DateTime.UtcNow;
    private static bool ChainsTo(X509Certificate2 leaf, X509Certificate2 root, bool ignoreTime)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust; chain.ChainPolicy.CustomTrustStore.Add(root);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; chain.ChainPolicy.DisableCertificateDownloads = true;
        chain.ChainPolicy.VerificationFlags = ignoreTime ? X509VerificationFlags.IgnoreNotTimeValid : X509VerificationFlags.NoFlag;
        return chain.Build(leaf) && chain.ChainElements[^1].Certificate.RawData.AsSpan().SequenceEqual(root.RawData);
    }
    private void EnsureOwned(X509Certificate2 leaf)
    {
        using var root = X509Certificate2.CreateFromPem(File.ReadAllText(CaCertPath));
        if (!File.Exists(StatePath) || !ChainsTo(leaf, root, true))
            throw new InvalidOperationException("The current leaf is not verifiably managed by this local CA; it will not be replaced automatically. Restore the managed certificate/CA or use your certificate administrator.");
    }

    /// <summary>Reuse actual SAN coverage, renew the managed leaf within the existing root's constraints.
    /// Failure retains a usable current certificate (and its files), never silently replaces the CA.</summary>
    public X509Certificate2 CurrentServerCert(IPAddress? ip)
    {
        lock (_l)
        {
            X509Certificate2? current = null;
            if (Enabled)
            {
                try
                {
                    current = _serverCert ??= LoadPfx();
                    if (ip != null)
                    {
                        // Failed renewal must not generate a new RSA key on every TLS handshake.
                        // Explicit Refresh certificate (Enable) bypasses this short retry backoff.
                        if (DateTime.UtcNow < _retryRenewalAfter) return Usable(current) ? current : (_bootstrap ??= Bootstrap());
                        // F257: stale = SAN misses a LAN/Tailscale IP the EXISTING root permits -> reissue only the leaf for that permitted set.
                        var wanted = _endpoints(ip); var endpoints = LeafEndpoints(ip);
                        if (!Usable(current) || current.NotAfter.ToUniversalTime() < DateTime.UtcNow.AddDays(30) || !CertificateEndpoints.Covers(current, endpoints))
                        { EnsureOwned(current); IssueServer(ip, endpoints); current = _serverCert ??= LoadPfx(); }
                        var omitted = wanted.Where(a => !endpoints.Contains(a)).ToArray();
                        LastRenewalError = omitted.Length == 0 ? null : "The existing CA's name constraints do not permit " + string.Join(", ", omitted) + "; the certificate covers " + string.Join(", ", endpoints) + " only. Explicit CA recreation and phone re-trust are required to add them.";
                        if (omitted.Length > 0) _retryRenewalAfter = DateTime.UtcNow.AddSeconds(30);
                    }
                    if (Usable(current)) return current;
                }
                catch (Exception e)
                {
                    _retryRenewalAfter = DateTime.UtcNow.AddSeconds(30);
                    LastRenewalError = e is InvalidOperationException ? e.Message : "Certificate renewal failed; existing CA and leaf retained. Check CA/key availability, certificate validity and file permissions.";
                    if (current != null && Usable(current)) return current;
                }
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
  <key>PayloadCertificateFileName</key><string>{CaFileName}</string>
  <key>PayloadContent</key><data>
{b64}
  </data>
  <key>PayloadDescription</key><string>Lets this phone trust the WavWiz server on your home network (limited to {System.Security.SecurityElement.Escape(host)}).</string>
  <key>PayloadDisplayName</key><string>WavWiz Local CA (BETA)</string>
  <key>PayloadIdentifier</key><string>app.wavwiz.rootca.{u1}</string>
  <key>PayloadOrganization</key><string>WavWiz</string>
  <key>PayloadType</key><string>com.apple.security.root</string>
  <key>PayloadUUID</key><string>{u1}</string><key>PayloadVersion</key><integer>1</integer>
 </dict></array>
 <key>PayloadDescription</key><string>Installs the WavWiz local certificate authority</string>
 <key>PayloadDisplayName</key><string>WavWiz Local CA (BETA)</string>
 <key>PayloadIdentifier</key><string>app.wavwiz.profile.{u2}</string>
 <key>PayloadOrganization</key><string>WavWiz</string>
 <key>PayloadRemovalDisallowed</key><false/>
 <key>PayloadType</key><string>Configuration</string>
 <key>PayloadUUID</key><string>{u2}</string><key>PayloadVersion</key><integer>1</integer>
</dict></plist>
""";
    }

    internal static void Restrict(string path)
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
