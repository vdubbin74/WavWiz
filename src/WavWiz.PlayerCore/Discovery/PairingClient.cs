using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
namespace WavWiz.PlayerCore.Discovery;

public sealed record PairResult(string? Token, string? Error, int AudioPort = 0, int ClockPort = 0, bool Retryable = false);

/// <summary>
/// Pairs a player with the server over plain HTTP on the LAN. The person types at most an address and a 6-digit code - never a scheme or a port
/// (anything extra that was pasted is ignored). Redirects are NEVER followed: the 0.0.1 bug was a redirect to https:// that a player without the
/// server's certificate authority could not follow ("The SSL connection could not be established").
/// </summary>
public static class PairingClient
{
    /// <summary>"http://192.168.1.10:47800/x" -> "192.168.1.10"; "myserver" stays; garbage -> null.</summary>
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
                return new PairResult(t.GetString(), null, root.TryGetProperty("audioPort", out var ap) ? ap.GetInt32() : 0, root.TryGetProperty("clockPort", out var cp) ? cp.GetInt32() : 0);
            if (r.StatusCode == HttpStatusCode.TooManyRequests) return new PairResult(null, err ?? "Too many attempts. Wait a minute and try again.");
            return new PairResult(null, err ?? $"The server answered {(int)r.StatusCode}.");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return new PairResult(null, $"Could not reach the WavWiz server at {host}. Is it switched on, and is this PC on the same home network?", Retryable: true); }
        catch (HttpRequestException e) { return new PairResult(null, $"Could not reach the WavWiz server at {host}: {Plain(e)}", Retryable: true); }
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
