using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
using WavWiz.Server.Tls;
namespace WavWiz.Server.Tests;

/// <summary>F261: exact-SNI remote certificate (Tailscale or own PFX), default off, CT acknowledgement, secret handling, expiry reload and local fallback.</summary>
public class F261RemoteCertTests
{
    sealed class XorProtector : ISecretProtector { public bool Available => true; public byte[] Protect(byte[] p) => p.Select(b => (byte)(b ^ 0x5A)).ToArray(); public byte[] Unprotect(byte[] b) => Protect(b); }
    sealed class FakeCli : ITailscaleCli
    {
        public string Status = """{"Version":"1.90","Self":{"DNSName":"box.tail1234.ts.net."},"CertDomains":["box.tail1234.ts.net"]}""";
        public TimeSpan Life = TimeSpan.FromDays(90); public int StatusExit; public string CertErr = ""; public int CertExit; public Func<DateTimeOffset> Clock = () => DateTimeOffset.UtcNow; public List<string> Calls = new();
        public Task<(int, string, string)> RunAsync(IReadOnlyList<string> a, TimeSpan t, CancellationToken ct = default)
        {
            Calls.Add(string.Join(' ', a));
            if (a[0] == "status") return Task.FromResult((StatusExit, Status, StatusExit == 0 ? "" : "Access is denied."));
            if (CertExit != 0) return Task.FromResult((CertExit, "", CertErr));
            var crt = a.First(x => x.StartsWith("--cert-file="))[12..]; var key = a.First(x => x.StartsWith("--key-file="))[11..]; var host = a[^1];
            using var c = Make(host, Clock() - TimeSpan.FromDays(1), Clock() - TimeSpan.FromDays(1) + Life);
            File.WriteAllText(crt, c.ExportCertificatePem()); File.WriteAllText(key, c.GetECDsaPrivateKey()!.ExportPkcs8PrivateKeyPem());
            return Task.FromResult((0, "", ""));
        }
    }
    static X509Certificate2 MakeRsa(string host, int bits, DateTimeOffset nb, DateTimeOffset na)
    {
        using var k = RSA.Create(bits); var r = new CertificateRequest("CN=" + host, k, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); san.AddDnsName(host); r.CertificateExtensions.Add(san.Build()); return r.CreateSelfSigned(nb, na);
    }
    static X509Certificate2 Make(string host, DateTimeOffset nb, DateTimeOffset na)
    {
        using var k = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var r = new CertificateRequest("CN=" + host, k, HashAlgorithmName.SHA256);
        var san = new SubjectAlternativeNameBuilder(); san.AddDnsName(host); r.CertificateExtensions.Add(san.Build());
        r.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        return r.CreateSelfSigned(nb, na);
    }
    static (ServerConfig cfg, string dir) Cfg() { var d = Path.Combine(Path.GetTempPath(), "f261-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return (new ServerConfig { DataDir = d }, d); }

    [Fact]
    public async Task Default_is_off_and_never_runs_tailscale()
    {
        var (cfg, _) = Cfg(); var cli = new FakeCli(); using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        Assert.Equal("off", cfg.RemoteCertMode); Assert.False(st.Active);
        await st.RefreshAsync(); Assert.Null(st.Select("box.tail1234.ts.net")); Assert.Empty(cli.Calls);
    }

    [Fact]
    public async Task Tailscale_mode_without_CT_acknowledgement_stays_inactive()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; var cli = new FakeCli(); using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        Assert.False(st.Active); await st.RefreshAsync();
        Assert.Empty(cli.Calls); Assert.Null(st.Select("box.tail1234.ts.net"));
        var j = JsonSerializer.Serialize(st.Status()); Assert.Contains("Certificate Transparency", j); Assert.Contains("\"ctAcknowledged\":false", j);
    }

    [Fact]
    public async Task Stubbed_tailscale_issues_once_and_SNI_routes_exact_names_only()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "2026-11-06T00:00:00Z";
        var cli = new FakeCli(); using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        await st.RefreshAsync();
        Assert.Equal(1, st.IssueCount); Assert.Contains(cli.Calls, c => c.StartsWith("cert --cert-file=") && c.EndsWith(" box.tail1234.ts.net"));
        Assert.NotNull(st.Select("box.tail1234.ts.net")); Assert.NotNull(st.Select("BOX.Tail1234.TS.NET.")); // case + trailing dot
        Assert.Null(st.Select(null)); Assert.Null(st.Select("")); Assert.Null(st.Select("192.168.1.169")); Assert.Null(st.Select("other.tail1234.ts.net")); Assert.Null(st.Select("x.box.tail1234.ts.net"));
        await st.RefreshAsync(); Assert.Equal(1, st.IssueCount);   // no reissue before renewAt
    }

    [Fact]
    public async Task Renewal_is_scheduled_from_the_certificates_actual_validity()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "x";
        var now = DateTimeOffset.UtcNow; var cli = new FakeCli { Clock = () => now }; using var st = new RemoteCertStore(cfg, new XorProtector(), cli, null, () => now);
        await st.RefreshAsync(); var c = st.Current!.Cert;
        Assert.Equal(c.NotAfter.ToUniversalTime() - (c.NotAfter - c.NotBefore) / 3, RemoteCertStore.RenewAtUtc(c));
        now += TimeSpan.FromDays(10); await st.RefreshAsync(); Assert.Equal(1, st.IssueCount);
        now += TimeSpan.FromDays(50); await st.RefreshAsync(); Assert.Equal(2, st.IssueCount); Assert.NotNull(st.Select("box.tail1234.ts.net"));
    }

    [Theory]
    [InlineData("""{"CertDomains":null}""")]
    [InlineData("""{"Self":{"DNSName":"box.tail1234.ts.net.","CertDomains":["box.tail1234.ts.net"]}}""")]   // Self.CertDomains is not the field
    [InlineData("""{"CertDomains":[]}""")]
    [InlineData("not json")]
    public async Task No_top_level_CertDomains_means_unavailable_and_no_issue(string status)
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "x";
        var cli = new FakeCli { Status = status }; using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        await st.RefreshAsync(); Assert.Equal(0, st.IssueCount); Assert.Null(st.Select("box.tail1234.ts.net")); Assert.Contains("MagicDNS", st.LastError);
    }

    [Fact]
    public async Task Service_account_permission_denial_is_graceful_with_the_unverified_caveat()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "x";
        var cli = new FakeCli { CertExit = 1, CertErr = "Access is denied." }; using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        await st.RefreshAsync(); Assert.Null(st.Select("box.tail1234.ts.net")); Assert.Contains("Unverified", st.LastError);
    }

    [Fact]
    public async Task Pfx_password_is_protected_and_never_logged_or_in_config_or_status()
    {
        const string pw = "S3cret-Pfx-Pa55!";
        var (cfg, dir) = Cfg(); var log = new List<string>(); var now = DateTimeOffset.UtcNow;
        var pfx = Path.Combine(dir, "own.pfx"); using (var c = Make("music.example.com", now.AddDays(-1), now.AddDays(60))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, pw));
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli(), log.Add);
        await st.RefreshAsync(); Assert.Null(st.Select("music.example.com")); Assert.NotNull(st.LastError);   // no password yet -> fallback
        st.SetPfxPassword("wrong-" + pw); await st.RefreshAsync(); Assert.Null(st.Select("music.example.com"));
        st.SetPfxPassword(pw); await st.RefreshAsync(); Assert.NotNull(st.Select("music.example.com"));
        cfg.Save();
        Assert.DoesNotContain(pw, File.ReadAllText(cfg.ConfigPath));
        Assert.DoesNotContain(pw, Encoding.UTF8.GetString(File.ReadAllBytes(st.PasswordPath)));
        Assert.DoesNotContain(log, l => l.Contains(pw));
        Assert.DoesNotContain(pw, JsonSerializer.Serialize(st.Status()));
    }

    [Fact]
    public async Task Expiry_falls_back_to_the_local_leaf_and_a_replaced_file_is_reloaded()
    {
        var (cfg, dir) = Cfg(); var now = DateTimeOffset.UtcNow; var log = new List<string>();
        var pfx = Path.Combine(dir, "own.pfx"); using (var c = Make("music.example.com", now.AddDays(-1), now.AddHours(1))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, "p"));
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli(), log.Add, () => now); st.SetPfxPassword("p");
        await st.RefreshAsync(); var first = st.Select("music.example.com"); Assert.NotNull(first);
        now += TimeSpan.FromHours(2);
        Assert.Null(st.Select("music.example.com"));                         // expired: local-CA leaf is used
        await st.RefreshAsync(); Assert.Null(st.Current); Assert.Contains("own certificate", st.LastError);
        using (var c = Make("music.example.com", now.AddDays(-1), now.AddDays(30))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, "p"));
        File.SetLastWriteTimeUtc(pfx, DateTime.UtcNow.AddMinutes(5));
        await st.RefreshAsync(); var second = st.Select("music.example.com");
        Assert.NotNull(second); Assert.NotEqual(first!.Thumbprint, second!.Thumbprint); Assert.Null(st.LastError);
    }

    [Fact]
    public async Task A_certificate_for_another_name_is_rejected()
    {
        var (cfg, dir) = Cfg(); var now = DateTimeOffset.UtcNow;
        var pfx = Path.Combine(dir, "own.pfx"); using (var c = Make("evil.example.com", now.AddDays(-1), now.AddDays(30))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, "p"));
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli()); st.SetPfxPassword("p");
        await st.RefreshAsync(); Assert.Null(st.Select("music.example.com")); Assert.Contains("does not cover", st.LastError);
    }

    // ---------------------------------------------------------------- F261-A
    [Fact]
    public void M1_remote_keys_are_saved_without_persisting_env_overrides_or_touching_other_fields()
    {
        var (_, dir) = Cfg(); var path = Path.Combine(dir, "server.json");
        File.WriteAllText(path, "{\n  \"bindAddress\": \"192.168.1.20\",\n  \"httpPort\": 47800,\n  \"futureField\": {\"keep\": true}\n}");
        var cfg = ServerConfig.Load(path);
        cfg.BindAddress = "0.0.0.0"; cfg.AllowAllInterfaces = true; cfg.HttpPort = 9999;   // as WAVWIZ_BIND / _ALLOW_ALL_INTERFACES / _HTTP_PORT would
        cfg.RemoteCertMode = "tailscale"; cfg.RemoteHost = "box.tail1234.ts.net"; cfg.RemoteCertCtAcknowledgedAt = "2026-11-06T00:00:00Z";
        cfg.SaveRemoteCertKeys();
        var j = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        Assert.Equal("192.168.1.20", (string?)j["bindAddress"]); Assert.Equal(47800, (int)j["httpPort"]!); Assert.False(j.ContainsKey("allowAllInterfaces"));
        Assert.True((bool)j["futureField"]!["keep"]!);
        Assert.Equal("tailscale", (string?)j["remoteCertMode"]); Assert.Equal("box.tail1234.ts.net", (string?)j["remoteHost"]); Assert.Null((string?)j["remoteCertPath"]);
        var back = ServerConfig.Load(path); Assert.Equal("tailscale", back.RemoteCertMode); Assert.Equal("192.168.1.20", back.BindAddress); Assert.False(back.AllowAllInterfaces);
    }

    [Fact]
    public async Task M2_self_signed_pfx_is_served_but_reported_not_publicly_trusted_and_not_phone_ready()
    {
        var (cfg, dir) = Cfg(); var now = DateTimeOffset.UtcNow;
        var pfx = Path.Combine(dir, "own.pfx"); using (var c = Make("music.example.com", now.AddDays(-1), now.AddDays(30))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, "p"));
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli()); st.SetPfxPassword("p"); await st.RefreshAsync();
        Assert.False(st.Current!.PubliclyTrusted);
        var j = JsonSerializer.Serialize(st.Status()); Assert.Contains("NOT publicly trusted", j); Assert.Contains("not phone-ready", j); Assert.Contains("\"publiclyTrusted\":false", j); Assert.Contains("API-only", j);
    }

    [Fact]
    public async Task M2_weak_rsa_key_is_refused()
    {
        var (cfg, dir) = Cfg(); var now = DateTimeOffset.UtcNow;
        var pfx = Path.Combine(dir, "own.pfx"); using (var c = MakeRsa("music.example.com", 1024, now.AddDays(-1), now.AddDays(30))) File.WriteAllBytes(pfx, c.Export(X509ContentType.Pkcs12, "p"));
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli()); st.SetPfxPassword("p"); await st.RefreshAsync();
        Assert.Null(st.Select("music.example.com")); Assert.Contains("too weak", st.LastError);
        using var ok = MakeRsa("x", 2048, now.AddDays(-1), now.AddDays(1)); Assert.Null(RemoteCertStore.WeakKey(ok));
    }

    [Fact]
    public async Task L2_a_reissued_cert_that_is_already_due_does_not_loop_the_cli()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "x";
        var cli = new FakeCli { Life = TimeSpan.FromDays(1.2) };   // NotBefore now-1d, NotAfter now+0.2d: renewAt already passed
        using var st = new RemoteCertStore(cfg, new XorProtector(), cli);
        for (int i = 0; i < 5; i++) await st.RefreshAsync();
        Assert.Equal(1, st.IssueCount); Assert.NotNull(st.Select("box.tail1234.ts.net")); Assert.Contains("due for renewal", st.LastError);
    }

    [Fact]
    public async Task L3_pfx_misconfiguration_is_logged_once()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "pfx"; var log = new List<string>();
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli(), log.Add);
        for (int i = 0; i < 5; i++) await st.RefreshAsync();
        Assert.Single(log);
    }

    [Fact]
    public async Task L1_L4_caveat_covers_all_platforms_and_non_admins_get_no_host_or_error()
    {
        var (cfg, _) = Cfg(); cfg.RemoteCertMode = "tailscale"; cfg.RemoteCertCtAcknowledgedAt = "x";
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli { CertExit = 1, CertErr = "permission denied" }); await st.RefreshAsync();
        Assert.Contains("every platform", st.LastError); Assert.Contains("Linux", st.LastError);
        var pub = JsonSerializer.Serialize(st.PublicStatus());
        Assert.DoesNotContain("ts.net", pub); Assert.DoesNotContain("Unverified", pub); Assert.DoesNotContain("error", pub);
    }

    // ---------------------------------------------------------------- F261-A2: on-wire SNI + supplied intermediates
    static X509Certificate2 Ca(string cn, X509Certificate2? issuer, out RSA key, DateTimeOffset now)
    {
        key = RSA.Create(2048); var r = new CertificateRequest("CN=" + cn, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        r.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, issuer == null, issuer == null ? 1 : 0, true));
        r.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        r.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(r.PublicKey, false));
        if (issuer == null) return r.CreateSelfSigned(now.AddDays(-2), now.AddDays(365));
        using var c = r.Create(issuer, now.AddDays(-1), now.AddDays(300), new byte[] { 2, 1 }); return X509CertificateLoader.LoadCertificate(c.RawData);
    }
    static (X509Certificate2 root, X509Certificate2 inter, X509Certificate2 leaf) Chain3(string host)
    {
        var now = DateTimeOffset.UtcNow; var root = Ca("F261 Test Root", null, out _, now); var inter = Ca("F261 Test Intermediate", root, out var ik, now);
        using var interWithKey = inter.CopyWithPrivateKey(ik);
        using var lk = RSA.Create(2048); var r = new CertificateRequest("CN=" + host, lk, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder(); san.AddDnsName(host); r.CertificateExtensions.Add(san.Build());
        r.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        r.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        using var pub = r.Create(interWithKey, now.AddHours(-1), now.AddDays(90), new byte[] { 3, 4, 5 });
        return (root, inter, pub.CopyWithPrivateKey(lk));
    }
    static async Task<(bool ok, System.Net.Security.SslPolicyErrors errs, int sent)> Handshake(System.Net.Security.SslStreamCertificateContext ctx, string sni, X509Certificate2 root)
    {
        var l = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0); l.Start(); var port = ((System.Net.IPEndPoint)l.LocalEndpoint).Port;
        var srv = Task.Run(async () => { using var t = await l.AcceptTcpClientAsync(); using var ss = new System.Net.Security.SslStream(t.GetStream());
            try { await ss.AuthenticateAsServerAsync(new System.Net.Security.SslServerAuthenticationOptions { ServerCertificateContext = ctx }); } catch { } });
        using var c = new System.Net.Sockets.TcpClient(); await c.ConnectAsync(System.Net.IPAddress.Loopback, port);
        System.Net.Security.SslPolicyErrors errs = default; int sent = 0;
        var pol = new X509ChainPolicy { TrustMode = X509ChainTrustMode.CustomRootTrust, DisableCertificateDownloads = true, RevocationMode = X509RevocationMode.NoCheck }; pol.CustomTrustStore.Add(root);
        using var cs = new System.Net.Security.SslStream(c.GetStream(), false, (_, _, ch, e) => { errs = e; sent = ch?.ChainPolicy.ExtraStore.Count ?? 0; return true; });
        await cs.AuthenticateAsClientAsync(new System.Net.Security.SslClientAuthenticationOptions { TargetHost = sni, CertificateChainPolicy = pol });
        await srv; l.Stop(); return (errs == System.Net.Security.SslPolicyErrors.None, errs, sent);
    }

    [Fact]
    public async Task A2_on_wire_SNI_handshake_sends_the_supplied_intermediate_without_AIA()
    {
        var (root, inter, leaf) = Chain3("music.example.com");
        var (cfg, dir) = Cfg(); var pfx = Path.Combine(dir, "own.pfx");
        File.WriteAllBytes(pfx, new X509Certificate2Collection { leaf, inter }.Export(X509ContentType.Pkcs12, "p")!);   // leaf + intermediate, no root, no AIA
        cfg.RemoteCertMode = "pfx"; cfg.RemoteHost = "music.example.com"; cfg.RemoteCertPath = pfx;
        using var st = new RemoteCertStore(cfg, new XorProtector(), new FakeCli()); st.SetPfxPassword("p"); await st.RefreshAsync();
        Assert.Single(st.Current!.Intermediates); Assert.Equal(inter.Thumbprint, st.Current.Intermediates[0].Thumbprint);
        Assert.False(st.Current.PubliclyTrusted);                                    // test root is not a system root
        Assert.Null(st.SelectContext("other.example.com")); Assert.Null(st.SelectContext(null));   // exact-SNI fallback kept
        var ctx = st.SelectContext("MUSIC.example.com.")!; Assert.NotNull(ctx);

        var good = await Handshake(ctx, "music.example.com", root);
        Assert.True(good.ok, "client trusting only the root, downloads off: " + good.errs);

        // negative control: same leaf WITHOUT the intermediate -> the root-only client cannot build the chain
        var bare = System.Net.Security.SslStreamCertificateContext.Create(leaf, new X509Certificate2Collection(), offline: true);
        var bad = await Handshake(bare, "music.example.com", root);
        Assert.False(bad.ok); Assert.True(bad.errs.HasFlag(System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors));
    }

    [Fact]
    public void A2_trust_check_uses_supplied_intermediates_with_downloads_off()
    {
        var (root, inter, leaf) = Chain3("music.example.com");
        Assert.False(RemoteCertStore.ChainsToSystemRoots(leaf, DateTime.UtcNow, new X509Certificate2Collection { inter }));   // private root: never "publicly trusted"
        var src = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "../../../../../src/WavWiz.Server/Tls/RemoteCert.cs"));
        Assert.Contains("DisableCertificateDownloads = true", src); Assert.Contains("ExtraStore.AddRange(supplied)", src);
        Assert.Contains("SslStreamCertificateContext.Create(leaf, inter, offline: true)", src);
    }
}
