using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
namespace WavWiz.PlayerCore.Discovery;

public sealed record PairResult(string? Token, string? Error, int AudioPort = 0, int ClockPort = 0, bool Retryable = false, string? UiToken = null);

/// <summary>0.6.9 #15: an approval request: the id + secret to poll with and the 4-digit code both screens show.</summary>
public sealed record ApprovalRequest(string? Id, string? Secret, string? Match, string? Error, bool Retryable = false);
/// <summary>0.6.9 #15: "pending" | "approved" | "denied" | "expired" | "offline" (could not ask; try again later).</summary>
public sealed record ApprovalAnswer(string Status, PairResult? Result = null, string? Error = null);

/// <summary>
/// Pairs a player with the server over plain HTTP on the LAN. The person types at most an address and a 6-digit code - never a scheme or a port
/// (anything extra that was pasted is ignored). Redirects are NEVER followed: the 0.0.1 bug was a redirect to https:// that a player without the
/// server's certificate authority could not follow ("The SSL connection could not be established").
/// </summary>
/// <summary>0.7.1 t2072: what the Player does with its saved window session after a pairing.</summary>
public enum WindowTokenAction { Save, Keep, Delete }
/// <summary>0.7.1 t2072: what the Player window does with its cookie jar when it opens.</summary>
public enum WindowCookieAction { None, Inject, Replace }
/// <summary>0.7.1 t2072: POST /auth/window-session. Status 0 = the server could not be reached.</summary>
public sealed record WindowSessionAnswer(string? UiToken, int Status, string? Error);

public static class PairingClient
{
    /// <summary>0.7.1 t2072: a new window session is saved; a pairing on the server PC itself that returns none (before setup, or an older server)
    /// keeps the saved one (the same server, so it is still good); pairing with another server without one drops it (it would not work there).</summary>
    public static WindowTokenAction WindowTokenStep(string? newUiToken, bool serverIsThisPc) =>
        !string.IsNullOrEmpty(newUiToken) ? WindowTokenAction.Save : serverIsThisPc ? WindowTokenAction.Keep : WindowTokenAction.Delete;

    /// <summary>"http://192.168.1.10:47800/x" -> "192.168.1.10"; "myserver" stays; garbage -> null.</summary>
    /// <summary>0.7.1 t2072 (pure): no saved window session = leave the jar alone; no cookie = inject it. A different cookie is replaced only on the
    /// first window of this Player run, so a long-lived admin sign-in left from first-run setup (or any earlier admin sign-in) becomes the window's
    /// normal Control session at the next launch, while an administrator who signs in during this run stays signed in until the Player restarts.
    /// "Sign in as admin..." on the window session itself is the same cookie and is kept (Leave admin mode switches back).</summary>
    public static WindowCookieAction WindowCookieStep(string? savedUi, string? currentCookie, bool firstWindowThisRun) =>
        string.IsNullOrEmpty(savedUi) ? WindowCookieAction.None
        : string.IsNullOrEmpty(currentCookie) ? WindowCookieAction.Inject
        : currentCookie == savedUi || !firstWindowThisRun ? WindowCookieAction.None
        : WindowCookieAction.Replace;

    /// <summary>0.7.1 t2072: an already-paired Player on the server PC asks for its window session (a normal Control session) with its own token.
    /// The server only answers on the server PC itself, after setup, and never on a headless/Docker server.</summary>
    public static async Task<WindowSessionAnswer> RequestWindowSessionAsync(string host, int httpPort, string playerToken, CancellationToken ct = default, TimeSpan? timeout = null)
    {
        try
        {
            using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(3) }) { Timeout = timeout ?? TimeSpan.FromSeconds(5), BaseAddress = new Uri($"http://{host}:{httpPort}") };
            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/window-session") { Content = JsonContent.Create(new { }) };
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", playerToken);
            using var r = await http.SendAsync(req, ct);
            var body = await r.Content.ReadAsStringAsync(ct);
            JsonElement root = default; try { root = JsonDocument.Parse(body).RootElement; } catch { }
            var ok = r.IsSuccessStatusCode && root.ValueKind == JsonValueKind.Object;
            return new WindowSessionAnswer(ok ? Str(root, "uiToken") : null, (int)r.StatusCode, ok ? null : root.ValueKind == JsonValueKind.Object ? Str(root, "error") : null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested) { return new WindowSessionAnswer(null, 0, e.Message); }
    }

    /// <summary>0.7.1 t2072: signs out a session the Player window is dropping (the admin sign-in left from first-run setup), so no unused admin
    /// session stays valid on the server. Sent like the window's own cookie (same Origin), best effort.</summary>
    public static async Task<bool> SignOutSessionAsync(string host, int httpPort, string sessionToken, CancellationToken ct = default)
    {
        try
        {
            var origin = $"http://{host}:{httpPort}";
            using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(3) }) { Timeout = TimeSpan.FromSeconds(5), BaseAddress = new Uri(origin) };
            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/logout") { Content = JsonContent.Create(new { }) };
            req.Headers.Add("Cookie", "wavwiz_session=" + sessionToken); req.Headers.Add("Origin", origin);
            using var r = await http.SendAsync(req, ct);
            return r.IsSuccessStatusCode;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested) { return false; }
    }

    public static string? NormalizeHost(string? input, out int? port)
    {
        port = null; var t = (input ?? "").Trim(); if (t.Length == 0) return null;
        int i = t.IndexOf("://", StringComparison.Ordinal); if (i >= 0) t = t[(i + 3)..];
        int slash = t.IndexOfAny(new[] { '/', '?', '#' }); if (slash >= 0) t = t[..slash];
        int at = t.LastIndexOf('@'); if (at >= 0) t = t[(at + 1)..];
        if (t.StartsWith('[')) return null;
        int colon = t.LastIndexOf(':'); if (colon >= 0) { if (int.TryParse(t[(colon + 1)..], out var p) && p is > 0 and < 65536) port = p; t = t[..colon]; }
        t = t.Trim().Trim('.');
        if (t.Length == 0 || t.Length > 253 || t.Any(c => !(char.IsLetterOrDigit(c) || c is '.' or '-' or '_'))) return null;
        return t;
    }

    /// <summary>True when the address belongs to this PC (then the server needs no pairing code).</summary>
    public static bool IsThisMachine(string host)
    {
        try
        {
            var ips = Dns.GetHostAddresses(host);
            var mine = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces().SelectMany(n => n.GetIPProperties().UnicastAddresses.Select(u => u.Address)).ToList();
            return ips.Any(i => IPAddress.IsLoopback(i) || mine.Contains(i));
        }
        catch { return false; }
    }

    public static async Task<PairResult> PairAsync(string host, int httpPort, string playerId, string name, string? code, CancellationToken ct = default, TimeSpan? timeout = null)
    {
        try
        {
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(6) };
            using var http = new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(12), BaseAddress = new Uri($"http://{host}:{httpPort}") };
            using var r = await http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId, name, code }, ct);
            var body = await r.Content.ReadAsStringAsync(ct);
            if ((int)r.StatusCode is >= 300 and < 400)
                return new PairResult(null, "This WavWiz server (an older version) wants to switch to a secure address, which a player cannot use. Update WavWiz on the server PC to the same version as this player, then try again.");
            string? err = null; JsonElement root = default;
            try { root = JsonDocument.Parse(body).RootElement; if (root.TryGetProperty("error", out var e)) err = e.GetString(); } catch { }
            if (r.IsSuccessStatusCode && root.ValueKind == JsonValueKind.Object && root.TryGetProperty("token", out var t))
                return new PairResult(t.GetString(), null, root.TryGetProperty("audioPort", out var ap) ? ap.GetInt32() : 0, root.TryGetProperty("clockPort", out var cp) ? cp.GetInt32() : 0, UiToken: Str(root, "uiToken"));
            if (r.StatusCode == HttpStatusCode.TooManyRequests) return new PairResult(null, err ?? "Too many attempts. Wait a minute and try again.");
            return new PairResult(null, err ?? $"The server answered {(int)r.StatusCode}.");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return new PairResult(null, $"Could not reach the WavWiz server at {host}. Is it switched on, and is this PC on the same home network?" + DockerHint(host), Retryable: true); }
        catch (HttpRequestException e) { return new PairResult(null, $"Could not reach the WavWiz server at {host}: {Plain(e)}" + DockerHint(host), Retryable: true); }
    }

    /// <summary>0.7.1 t2069u (pure): a Docker container address this PC cannot reach gets a plain hint ("" otherwise).</summary>
    public static string DockerHint(string host, IReadOnlyList<(IPAddress Ip, IPAddress Mask)>? ifs = null) =>
        ServerFinder.Unreachable(host, ifs ?? ServerFinder.LocalInterfaces())
            ? $" {host} is an address inside Docker that other computers cannot reach. Type the address of the computer that runs Docker instead (and on the server set WAVWIZ_ADVERTISE_ADDRESS to it, see docs/DOCKER.md)."
            : "";
    /// <summary>0.7.1 t2069u (pure): addresses to try, most likely to work first - Docker container addresses this PC cannot reach go last (never dropped).</summary>
    public static List<string> OrderCandidates(IEnumerable<string> hosts, IReadOnlyList<(IPAddress Ip, IPAddress Mask)>? ifs = null)
    {
        var l = ifs ?? ServerFinder.LocalInterfaces();
        return hosts.Where(h => !string.IsNullOrWhiteSpace(h)).Distinct(StringComparer.OrdinalIgnoreCase).Select((h, i) => (h, i)).OrderBy(x => ServerFinder.Unreachable(x.h, l) ? 1 : 0).ThenBy(x => x.i).Select(x => x.h).ToList();
    }

    private static string? Str(JsonElement r, string n) => r.ValueKind == JsonValueKind.Object && r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static HttpClient Http(string host, int port) => new(new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(6) }) { Timeout = TimeSpan.FromSeconds(12), BaseAddress = new Uri($"http://{host}:{port}") };

    /// <summary>0.6.9 #15: ask the administrator to approve this PC (no code to type). The request shows up at once on every admin screen.</summary>
    public static async Task<ApprovalRequest> RequestApprovalAsync(string host, int httpPort, string playerId, string name, string machine, CancellationToken ct = default)
    {
        try
        {
            using var http = Http(host, httpPort);
            using var r = await http.PostAsJsonAsync("/api/v1/auth/pair-request", new { kind = "player", playerId, name, machine }, ct);
            JsonElement root = default; try { root = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct)).RootElement; } catch { }
            if (r.IsSuccessStatusCode && Str(root, "id") is { } id) return new ApprovalRequest(id, Str(root, "secret"), Str(root, "match"), null);
            if (r.StatusCode == HttpStatusCode.NotFound) return new ApprovalRequest(null, null, null, "This WavWiz server is older and cannot approve PCs. Type the 6-digit pairing code instead (Settings > Devices > Pair a phone or a PC player).");
            return new ApprovalRequest(null, null, null, Str(root, "error") ?? $"The server answered {(int)r.StatusCode}.");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return new ApprovalRequest(null, null, null, $"Could not reach the WavWiz server at {host}." + DockerHint(host), true); }
        catch (HttpRequestException e) { return new ApprovalRequest(null, null, null, $"Could not reach the WavWiz server at {host}: {Plain(e)}" + DockerHint(host), true); }
    }

    /// <summary>0.6.9 #15: how is the request doing? Approved = the Player token + the window session (handed out once).</summary>
    public static async Task<ApprovalAnswer> PollApprovalAsync(string host, int httpPort, string id, string secret, CancellationToken ct = default)
    {
        try
        {
            using var http = Http(host, httpPort);
            using var r = await http.PostAsJsonAsync($"/api/v1/auth/pair-request/{Uri.EscapeDataString(id)}/poll", new { secret }, ct);
            JsonElement root = default; try { root = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct)).RootElement; } catch { }
            return ParseAnswer((int)r.StatusCode, root);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return new ApprovalAnswer("offline"); }
        catch (HttpRequestException) { return new ApprovalAnswer("offline"); }
    }

    /// <summary>Pure (unit-tested): the poll answer -> status (+ tokens on approval).</summary>
    public static ApprovalAnswer ParseAnswer(int httpStatus, JsonElement root)
    {
        var st = Str(root, "status");
        if (httpStatus == 404 || st == "expired") return new ApprovalAnswer("expired");
        if (httpStatus is < 200 or >= 300) return new ApprovalAnswer("offline", Error: Str(root, "error"));
        if (st == "approved" && Str(root, "token") is { } tok)
            return new ApprovalAnswer("approved", new PairResult(tok, null, root.TryGetProperty("audioPort", out var ap) && ap.ValueKind == JsonValueKind.Number ? ap.GetInt32() : 0,
                root.TryGetProperty("clockPort", out var cp) && cp.ValueKind == JsonValueKind.Number ? cp.GetInt32() : 0, UiToken: Str(root, "uiToken")));
        return new ApprovalAnswer(st is "denied" ? "denied" : "pending");
    }

    private static string Plain(HttpRequestException e) => e.InnerException is System.Net.Sockets.SocketException se ? se.SocketErrorCode switch
    {
        System.Net.Sockets.SocketError.ConnectionRefused => "nothing is listening on that address (is the WavWiz server running? is the address right?)",
        System.Net.Sockets.SocketError.HostNotFound or System.Net.Sockets.SocketError.NoData => "that name could not be found - try the server's numeric address like 192.168.1.20",
        System.Net.Sockets.SocketError.TimedOut => "no answer (a firewall may be blocking port 47800 on the server PC)",
        _ => se.Message,
    } : e.Message;

    /// <summary>Asks a server for its identity (works with 0.0.1 servers too: /auth/state).</summary>
    public static async Task<(string? Id, string? Name, string? Error)> WhoAreYouAsync(string host, int httpPort, CancellationToken ct = default)
    {
        try
        {
            using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(4) }) { Timeout = TimeSpan.FromSeconds(6) };
            using var resp = await http.GetAsync($"http://{host}:{httpPort}/api/v1/auth/state", ct);
            using var d = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct)); var r = d.RootElement;
            return (r.TryGetProperty("serverId", out var i) ? i.GetString() : null, r.TryGetProperty("serverName", out var n) ? n.GetString() : null, null);
        }
        catch (Exception e) { return (null, null, e.Message); }
    }
}

/// <summary>0.7.1 t2072: makes sure an already-paired Player on the server PC has its window session ("uitoken"). On a fresh Server + Player install the
/// Player pairs before the administrator password exists, and Players paired before 0.7.1 never got one; this asks for it at launch, when the window
/// opens without one, and right after first-run setup finishes in the window. One request at a time; a saved session is never asked for again.</summary>
public static class WindowSessionKeeper
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task<string?> EnsureAsync(ISecretStore store, string? host, int httpPort, CancellationToken ct = default, Action<string>? log = null)
    {
        var saved = store.Load("uitoken"); if (!string.IsNullOrEmpty(saved)) return saved;
        if (string.IsNullOrWhiteSpace(host) || httpPort <= 0 || !PairingClient.IsThisMachine(host)) return null;   // other PCs: approval / code only
        await Gate.WaitAsync(ct);
        try
        {
            saved = store.Load("uitoken"); if (!string.IsNullOrEmpty(saved)) return saved;
            var player = store.Load("token"); if (string.IsNullOrEmpty(player)) return null;
            var a = await PairingClient.RequestWindowSessionAsync(host, httpPort, player, ct);
            if (!string.IsNullOrEmpty(a.UiToken)) { store.Save("uitoken", a.UiToken); log?.Invoke("window session: received"); return a.UiToken; }
            log?.Invoke($"window session: not yet ({a.Status}{(a.Error != null ? ": " + a.Error : "")})");
            return null;
        }
        finally { Gate.Release(); }
    }
}
