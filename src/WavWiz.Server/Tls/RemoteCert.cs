using System.Diagnostics;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tls;

/// <summary>F261: runs the tailscale CLI. Tests inject a fake.</summary>
public interface ITailscaleCli
{
    /// <summary>Runs tailscale with the given arguments (no shell). Returns exit code, stdout, stderr. Throws FileNotFoundException when the CLI is not installed.</summary>
    Task<(int Exit, string Out, string Err)> RunAsync(IReadOnlyList<string> args, TimeSpan timeout, CancellationToken ct = default);
}

/// <summary>F261: the real CLI, found only at its install location (never the working directory, never via a shell string).</summary>
public sealed class TailscaleCli : ITailscaleCli
{
    public static string? Locate()
    {
        var c = OperatingSystem.IsWindows()
            ? new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tailscale", "tailscale.exe") }
            : new[] { "/usr/bin/tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale" };
        return c.FirstOrDefault(File.Exists);
    }
    public async Task<(int Exit, string Out, string Err)> RunAsync(IReadOnlyList<string> args, TimeSpan timeout, CancellationToken ct = default)
    {
        var exe = Locate() ?? throw new FileNotFoundException("tailscale CLI not installed");
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(timeout);
        var o = p.StandardOutput.ReadToEndAsync(cts.Token); var e = p.StandardError.ReadToEndAsync(cts.Token);
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch { } throw new TimeoutException("tailscale did not answer in time"); }
        return (p.ExitCode, await o, await e);
    }
}

/// <summary>F261: Tailscale HTTPS certificate helper (detect via Status.CertDomains, issue to files, load).</summary>
public static class TailscaleCert
{
    /// <summary>Top-level Status.CertDomains (ipnstate.Status), exact FQDNs without trailing dot. Absent/null/empty = unavailable; never built from the machine name.</summary>
    public static IReadOnlyList<string> ParseCertDomains(string statusJson)
    {
        try
        {
            using var d = JsonDocument.Parse(statusJson);
            if (d.RootElement.ValueKind != JsonValueKind.Object || !d.RootElement.TryGetProperty("CertDomains", out var cd) || cd.ValueKind != JsonValueKind.Array) return Array.Empty<string>();
            return cd.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!.Trim().TrimEnd('.')).Where(x => x.Length > 0 && !x.StartsWith("_acme-challenge.", StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }
        catch (JsonException) { return Array.Empty<string>(); }
    }
    public static bool LooksLikePermissionDenied(string err) =>
        err.Contains("access is denied", StringComparison.OrdinalIgnoreCase) || err.Contains("permission", StringComparison.OrdinalIgnoreCase) || err.Contains("not permitted", StringComparison.OrdinalIgnoreCase) || err.Contains("Access denied", StringComparison.OrdinalIgnoreCase);
    public static string CertFile(string dir, string host) => Path.Combine(dir, host.ToLowerInvariant() + ".crt");
    public static string KeyFile(string dir, string host) => Path.Combine(dir, host.ToLowerInvariant() + ".key");
}

/// <summary>F261: one remote certificate snapshot (immutable; swapped atomically).</summary>
public sealed record RemoteCertSnapshot(string Host, X509Certificate2 Cert, string Source, DateTime FileStampUtc, bool PubliclyTrusted = false)
{
    /// <summary>F261-A2 N1: intermediates supplied with the leaf (PEM chain / PFX), sent in the handshake.</summary>
    public X509Certificate2Collection Intermediates { get; init; } = new();
    /// <summary>F261-A2 N1: built once at load (offline, no AIA downloads); the selector only hands it out.</summary>
    public SslStreamCertificateContext? Context { get; init; }
}

/// <summary>F261-A2: caches one SslStreamCertificateContext per local-CA leaf object so the TLS callback does no chain building per handshake.</summary>
public sealed class CertContextCache
{
    private (X509Certificate2 Leaf, SslStreamCertificateContext Ctx)? _c;
    public SslStreamCertificateContext For(X509Certificate2 leaf)
    {
        var c = _c; if (c is { } x && ReferenceEquals(x.Leaf, leaf)) return x.Ctx;
        var ctx = SslStreamCertificateContext.Create(leaf, null, offline: true); _c = (leaf, ctx); return ctx;
    }
}

/// <summary>F261: exact-SNI remote certificate next to the local-CA leaf. Default OFF. Any failure or expiry falls back to the local leaf (null from Select) with a warning.</summary>
public sealed class RemoteCertStore : IDisposable
{
    public const string CtDisclosure = "A Tailscale HTTPS certificate is issued by Let's Encrypt. Your machine name and tailnet name (for example box.tailnet-name.ts.net) are published in public Certificate Transparency logs, which anyone can search. This cannot be undone. MagicDNS and HTTPS must also be turned on in the Tailscale admin console; WavWiz never changes Tailscale settings.";
    public const string ServiceAccountCaveat = "Unverified on every platform: whether the account WavWiz runs as may run 'tailscale cert' has not been tested (Windows: the service account; Linux: tailscale cert needs root or the Tailscale operator user). If Tailscale refuses, WavWiz keeps using its own certificate.";
    public const string PfxApiOnlyNote = "Own-certificate (PFX) mode is an advanced, API-only beta option (POST /api/v1/tls/remote with mode, host, certPath, pfxPassword); there is no Settings form for it.";
    private static readonly TimeSpan Throttle = TimeSpan.FromSeconds(30);
    private readonly ServerConfig _cfg; private readonly ISecretProtector _secrets; private readonly ITailscaleCli _cli; private readonly Action<string> _log; private readonly Func<DateTimeOffset> _now;
    private volatile RemoteCertSnapshot? _snap; private int _busy; private DateTimeOffset _nextCheck, _backoffUntil; private TimeSpan _backoff = TimeSpan.FromHours(1); private string? _pfxFailSig;
    public string? LastError { get; private set; }
    public int IssueCount { get; private set; }

    public RemoteCertStore(ServerConfig cfg, ISecretProtector secrets, ITailscaleCli? cli = null, Action<string>? log = null, Func<DateTimeOffset>? now = null)
    { _cfg = cfg; _secrets = secrets; _cli = cli ?? new TailscaleCli(); _log = log ?? (_ => { }); _now = now ?? (() => DateTimeOffset.UtcNow); }

    public string Dir => Path.Combine(_cfg.DataDir, "tls", "remote");
    public string PasswordPath => Path.Combine(_cfg.DataDir, "tls", "remote-pfx.pwd");
    public string Mode => (_cfg.RemoteCertMode ?? "off").Trim().ToLowerInvariant() switch { "tailscale" => "tailscale", "pfx" => "pfx", _ => "off" };
    public bool CtAcknowledged => !string.IsNullOrWhiteSpace(_cfg.RemoteCertCtAcknowledgedAt);
    public bool Active => Mode == "pfx" || (Mode == "tailscale" && CtAcknowledged);
    public RemoteCertSnapshot? Current => _snap;

    public static string? NormalizeHost(string? h) { h = h?.Trim().TrimEnd('.'); return string.IsNullOrEmpty(h) ? null : h.ToLowerInvariant(); }

    /// <summary>Kestrel ServerCertificateSelector hook: the remote cert for an exact, valid SNI match; otherwise null (= use the local-CA leaf). Never blocks on I/O.</summary>
    /// <summary>F261-A2: the remote certificate context (leaf + supplied intermediates) for an exact, valid SNI match; null = local-CA leaf.</summary>
    public SslStreamCertificateContext? SelectContext(string? sni) => Select(sni) is { } c && _snap is { } s && ReferenceEquals(s.Cert, c) ? s.Context : null;

    public X509Certificate2? Select(string? sni)
    {
        if (!Active) return null;
        MaybeRefreshInBackground();
        var host = NormalizeHost(sni); var s = _snap;
        if (host == null || s == null || !string.Equals(host, s.Host, StringComparison.Ordinal)) return null;
        var now = _now().UtcDateTime;
        return s.Cert.NotBefore.ToUniversalTime() <= now && now < s.Cert.NotAfter.ToUniversalTime() ? s.Cert : null;
    }

    private void MaybeRefreshInBackground()
    {
        var now = _now(); if (now < _nextCheck) return; _nextCheck = now + Throttle;
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;
        _ = Task.Run(async () => { try { await RefreshCoreAsync(); } finally { Volatile.Write(ref _busy, 0); } });
    }

    /// <summary>Loads / renews now (startup, settings change, tests).</summary>
    public async Task RefreshAsync() { while (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) await Task.Delay(20); try { await RefreshCoreAsync(); } finally { Volatile.Write(ref _busy, 0); } }

    /// <summary>Renew a third of the actual lifetime before NotAfter (from the certificate's own NotBefore/NotAfter, no assumed lifetime).</summary>
    public static DateTime RenewAtUtc(X509Certificate2 c) { var nb = c.NotBefore.ToUniversalTime(); var na = c.NotAfter.ToUniversalTime(); return na - TimeSpan.FromTicks(Math.Max(0, (na - nb).Ticks) / 3); }

    private async Task RefreshCoreAsync()
    {
        try
        {
            switch (Mode)
            {
                case "pfx": RefreshPfx(); break;
                case "tailscale": if (CtAcknowledged) await RefreshTailscaleAsync(); else { Swap(null); LastError = "Remote HTTPS (Tailscale) is waiting for the Certificate Transparency acknowledgement."; } break;
                default: Swap(null); LastError = null; break;
            }
        }
        catch (Exception e) { Fail("Remote certificate update failed (" + e.GetType().Name + ")."); }
        ExpireCheck();
    }

    private void ExpireCheck()
    {
        var s = _snap; if (s == null) return;
        if (_now().UtcDateTime >= s.Cert.NotAfter.ToUniversalTime()) { Swap(null); Fail("The remote certificate for " + s.Host + " expired; WavWiz is using its own certificate, so that host name may not be trusted until it is renewed."); }
    }

    private void Fail(string msg) { if (msg != LastError) _log("TLS remote: " + msg); LastError = msg;   /* F261-A L3: log a failure once, not every refresh */ var now = _now(); _backoffUntil = now + _backoff; _backoff = TimeSpan.FromTicks(Math.Min(_backoff.Ticks * 2, TimeSpan.FromHours(24).Ticks)); }
    private void Ok() { LastError = null; _backoff = TimeSpan.FromHours(1); _backoffUntil = default; }

    // ---- own PFX
    public void SetPfxPassword(string? password)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(PasswordPath)!);
        if (string.IsNullOrEmpty(password)) { if (File.Exists(PasswordPath)) File.Delete(PasswordPath); return; }
        if (!_secrets.Available) throw new InvalidOperationException("No secret protection is available on this system; the PFX password was not saved.");
        File.WriteAllBytes(PasswordPath, _secrets.Protect(Encoding.UTF8.GetBytes(password))); LocalCa.Restrict(PasswordPath);
    }
    private string? ReadPfxPassword() => File.Exists(PasswordPath) ? Encoding.UTF8.GetString(_secrets.Unprotect(File.ReadAllBytes(PasswordPath))) : null;

    private void RefreshPfx()
    {
        var path = _cfg.RemoteCertPath; var host = NormalizeHost(_cfg.RemoteHost);
        var sig = (path ?? "") + "|" + host + "|" + (path != null && File.Exists(path) ? File.GetLastWriteTimeUtc(path).Ticks : 0) + "|" + (File.Exists(PasswordPath) ? Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(PasswordPath))) : "");
        if (LastError != null && sig == _pfxFailSig && _now() < _backoffUntil && (_snap == null || _now().UtcDateTime < _snap.Cert.NotAfter.ToUniversalTime())) return;   // F261-A L3: nothing changed since the last failure
        _pfxFailSig = sig;
        if (string.IsNullOrWhiteSpace(path) || host == null) { Swap(null); Fail("Remote HTTPS (own certificate) needs both remoteHost and remoteCertPath in server.json."); return; }
        if (!File.Exists(path)) { Swap(null); Fail("The remote certificate file was not found; WavWiz is using its own certificate."); return; }
        var stamp = File.GetLastWriteTimeUtc(path); var cur = _snap;
        if (cur != null && cur.Source == "pfx" && cur.Host == host && cur.FileStampUtc == stamp && _now().UtcDateTime < cur.Cert.NotAfter.ToUniversalTime()) return;
        X509Certificate2 c; X509Certificate2Collection all;
        try { all = X509CertificateLoader.LoadPkcs12CollectionFromFile(path, ReadPfxPassword(), X509KeyStorageFlags.DefaultKeySet); c = all.FirstOrDefault(x => x.HasPrivateKey) ?? throw new CryptographicException("no key"); }
        catch (CryptographicException) { Fail("The remote certificate could not be opened (wrong password or damaged file); WavWiz is using its own certificate."); if (cur != null && cur.Host != host) Swap(null); return; }
        if (Validate(c, host) is { } why) { c.Dispose(); Fail("The remote certificate was not used: " + why + (cur == null || _now().UtcDateTime >= cur.Cert.NotAfter.ToUniversalTime() ? " WavWiz is using its own certificate, so the remote host name may not be trusted." : " The previous certificate stays in use until it expires.")); return; }
        Swap(Snap(host, c, all.Cast<X509Certificate2>(), "pfx", stamp)); Ok(); _log($"TLS remote: using own certificate for {host} until {c.NotAfter.ToUniversalTime():u}");
    }

    // ---- Tailscale
    private async Task RefreshTailscaleAsync()
    {
        var now = _now(); var cur = _snap;
        if (cur != null && cur.Source == "tailscale")
        {
            var cf = TailscaleCert.CertFile(Dir, cur.Host);
            bool changed = File.Exists(cf) && File.GetLastWriteTimeUtc(cf) != cur.FileStampUtc;
            if (!changed && now.UtcDateTime < RenewAtUtc(cur.Cert)) return;
            if (!changed && now < _backoffUntil) return;   // F261-A L2
            if (changed && TryLoadTailscaleFiles(cur.Host) is { } fresh && now.UtcDateTime < RenewAtUtc(fresh.Cert)) { Swap(fresh); Ok(); return; }
        }
        if (now < _backoffUntil) return;
        (int Exit, string Out, string Err) st;
        try { st = await _cli.RunAsync(new[] { "status", "--json" }, TimeSpan.FromSeconds(20)); }
        catch (FileNotFoundException) { Fail("Tailscale is not installed on this PC; remote HTTPS stays off."); return; }
        catch (TimeoutException) { Fail("Tailscale did not answer; WavWiz keeps its own certificate."); return; }
        if (st.Exit != 0) { Fail(TailscaleCert.LooksLikePermissionDenied(st.Err) ? "Tailscale refused the WavWiz service account. " + ServiceAccountCaveat : "Tailscale is not running or not signed in."); return; }
        var domains = TailscaleCert.ParseCertDomains(st.Out);
        if (domains.Count == 0) { Fail("Tailscale HTTPS certificates are not available: turn on MagicDNS and HTTPS in the Tailscale admin console."); return; }
        var want = NormalizeHost(_cfg.RemoteHost);
        string? host = want != null ? domains.FirstOrDefault(d => string.Equals(d, want, StringComparison.OrdinalIgnoreCase)) : domains.Count == 1 ? domains[0] : null;
        if (host == null) { Fail(want != null ? "Tailscale cannot issue a certificate for " + want + " (not in its CertDomains)." : "Tailscale offers several names; set remoteHost in server.json to pick one."); return; }
        host = host.ToLowerInvariant();
        Directory.CreateDirectory(Dir);
        var crt = TailscaleCert.CertFile(Dir, host); var key = TailscaleCert.KeyFile(Dir, host);
        IssueCount++;
        (int Exit, string Out, string Err) r;
        try { r = await _cli.RunAsync(new[] { "cert", "--cert-file=" + crt, "--key-file=" + key, "--min-validity=720h", host }, TimeSpan.FromMinutes(3)); }
        catch (TimeoutException) { Fail("Tailscale did not finish issuing the certificate; WavWiz keeps its own certificate."); return; }
        if (r.Exit != 0) { Fail(TailscaleCert.LooksLikePermissionDenied(r.Err) ? "Tailscale refused the certificate request for the WavWiz service account. " + ServiceAccountCaveat : "Tailscale could not issue the certificate; WavWiz keeps its own certificate."); return; }
        LocalCa.Restrict(key); LocalCa.Restrict(crt);
        var snap = TryLoadTailscaleFiles(host);
        if (snap == null) return;
        Swap(snap);
        if (now.UtcDateTime >= RenewAtUtc(snap.Cert)) { Fail("Tailscale returned a certificate that is already due for renewal; WavWiz uses it and tries again later."); return; }   // F261-A L2: keep backoff, no 30 s loop
        Ok(); _log($"TLS remote: Tailscale certificate for {host} until {snap.Cert.NotAfter.ToUniversalTime():u}");
    }

    private RemoteCertSnapshot? TryLoadTailscaleFiles(string host)
    {
        var crt = TailscaleCert.CertFile(Dir, host); var key = TailscaleCert.KeyFile(Dir, host);
        try
        {
            using var pem = X509Certificate2.CreateFromPemFile(crt, key);
            var c = OperatingSystem.IsWindows() ? X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pkcs12), null) : X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pkcs12), null, X509KeyStorageFlags.EphemeralKeySet);
            if (Validate(c, host) is { } why) { c.Dispose(); Fail("The Tailscale certificate was not used: " + why); return null; }
            var chain = new X509Certificate2Collection(); chain.ImportFromPemFile(crt);   // F261-A2: tailscale writes leaf + intermediates
            return Snap(host, c, chain.Cast<X509Certificate2>(), "tailscale", File.GetLastWriteTimeUtc(crt));
        }
        catch (Exception e) when (e is CryptographicException or IOException) { Fail("The Tailscale certificate files could not be read; WavWiz keeps its own certificate."); return null; }
    }

    /// <summary>Null when usable: private key, valid now, covers exactly the host, server-auth EKU when an EKU is present.</summary>
    public string? Validate(X509Certificate2 c, string host)
    {
        var now = _now().UtcDateTime;
        if (!c.HasPrivateKey) return "it has no private key.";
        if (now < c.NotBefore.ToUniversalTime()) return "it is not valid yet.";
        if (now >= c.NotAfter.ToUniversalTime()) return "it has expired.";
        if (!c.MatchesHostname(host, allowWildcards: true, allowCommonName: false)) return "it does not cover " + host + ".";
        var eku = c.Extensions.OfType<X509EnhancedKeyUsageExtension>().FirstOrDefault();
        if (eku != null && !eku.EnhancedKeyUsages.Cast<Oid>().Any(o => o.Value == "1.3.6.1.5.5.7.3.1")) return "it is not a server (TLS) certificate.";
        if (WeakKey(c) is { } weak) return weak;
        return null;
    }

    /// <summary>F261-A M2: RSA below 2048 bits, EC below P-256 or DSA are refused.</summary>
    public static string? WeakKey(X509Certificate2 c)
    {
        using (var rsa = c.GetRSAPublicKey()) if (rsa != null) return rsa.KeySize < 2048 ? $"its RSA key is too weak ({rsa.KeySize} bits; 2048 or more needed)." : null;
        using (var ec = c.GetECDsaPublicKey()) if (ec != null) return ec.KeySize < 256 ? $"its EC key is too weak ({ec.KeySize} bits; P-256 or stronger needed)." : null;
        return "its key type is not supported (RSA 2048+ or EC P-256+ needed).";
    }

    /// <summary>F261-A2: snapshot with its supplied intermediates (self-signed roots dropped), trust check against them with downloads off, and the cached TLS context.</summary>
    private RemoteCertSnapshot Snap(string host, X509Certificate2 leaf, IEnumerable<X509Certificate2> supplied, string source, DateTime stamp)
    {
        var inter = new X509Certificate2Collection();
        foreach (var x in supplied) if (x.Thumbprint != leaf.Thumbprint && x.SubjectName.RawData.AsSpan().SequenceEqual(x.IssuerName.RawData) == false) inter.Add(x);
        return new RemoteCertSnapshot(host, leaf, source, stamp, ChainsToSystemRoots(leaf, _now().UtcDateTime, inter))
        { Intermediates = inter, Context = SslStreamCertificateContext.Create(leaf, inter, offline: true) };
    }

    /// <summary>F261-A M2: does the certificate chain to a root this system trusts (no network revocation check)? Phones may still differ; this is not device proof.</summary>
    public static bool ChainsToSystemRoots(X509Certificate2 c, DateTime atUtc, X509Certificate2Collection? supplied = null)
    {
        using var ch = new X509Chain();
        ch.ChainPolicy.DisableCertificateDownloads = true;   // F261-A2 N1: only what we send (supplied intermediates) may complete the chain, like a phone without AIA
        if (supplied != null) ch.ChainPolicy.ExtraStore.AddRange(supplied);
        ch.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; ch.ChainPolicy.TrustMode = X509ChainTrustMode.System;
        ch.ChainPolicy.VerificationTime = atUtc.ToLocalTime(); ch.ChainPolicy.ApplicationPolicy.Add(new Oid("1.3.6.1.5.5.7.3.1"));
        try { return ch.Build(c); } catch (CryptographicException) { return false; }
    }

    private void Swap(RemoteCertSnapshot? n)
    {
        var old = Interlocked.Exchange(ref _snap, n);
        if (old != null && !ReferenceEquals(old.Cert, n?.Cert)) _ = Task.Delay(TimeSpan.FromMinutes(2)).ContinueWith(_ => old.Cert.Dispose());   // in-flight handshakes keep the old object a while
    }

    /// <summary>Settings / status text. Never contains secrets.</summary>
    public object Status()
    {
        var s = _snap;
        return new
        {
            mode = Mode, host = s?.Host ?? NormalizeHost(_cfg.RemoteHost), active = s != null, source = s?.Source, expires = s?.Cert.NotAfter.ToUniversalTime(),
            renewAt = s?.Source == "tailscale" ? RenewAtUtc(s.Cert) : (DateTime?)null,
            ctAcknowledged = CtAcknowledged, ctDisclosure = CtAcknowledged ? null : CtDisclosure, error = LastError, pfxPasswordSaved = File.Exists(PasswordPath),
            publiclyTrusted = s?.PubliclyTrusted, caveat = Mode == "tailscale" ? ServiceAccountCaveat : Mode == "pfx" ? PfxApiOnlyNote : null,
            text = Mode == "off" ? "Remote HTTPS is off. Phones use WavWiz's own certificate."
                 : s != null && !s.PubliclyTrusted ? $"Remote HTTPS: https://{s.Host}:{_cfg.HttpsPort} uses a certificate that is NOT publicly trusted on this PC (self-signed or a private CA). Phones will reject it unless that CA is installed and trusted on them; this is not phone-ready."
                 : s != null ? $"Remote HTTPS: https://{s.Host}:{_cfg.HttpsPort} uses a {(s.Source == "tailscale" ? "Tailscale" : "custom")} certificate that chains to a public root on this PC, valid until {s.Cert.NotAfter.ToUniversalTime():yyyy-MM-dd}. Not yet verified on a phone."
                 : "Remote HTTPS is not active yet. Phones use WavWiz's own certificate." + (LastError != null ? " " + LastError : ""),
        };
    }

    /// <summary>F261-A L4: what non-admins see - no host name, no error text.</summary>
    public object PublicStatus() => new { mode = Mode, active = _snap != null, text = Mode == "off" ? "Remote HTTPS is off." : _snap != null ? "Remote HTTPS is on." : "Remote HTTPS is not active." };

    public void Dispose() { var s = Interlocked.Exchange(ref _snap, null); s?.Cert.Dispose(); }
}
