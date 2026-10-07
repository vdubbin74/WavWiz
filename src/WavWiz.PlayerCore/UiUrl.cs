namespace WavWiz.PlayerCore;

/// <summary>
/// 0.0.8: which address the player's own window ("Open player" in the tray) loads, and which navigations it may follow. Kept free of Windows types so it is
/// unit-tested on Linux. On the server PC the window opens exactly the address the working desktop shortcut uses (ProgramData\WavWiz\first-run-url.txt,
/// written by setup with the address the server listens on); a loopback host (127.0.0.1 / localhost) is never used when that file names the real address,
/// because the server listens on the home-network address only (a loopback page never loads: the 0.0.7 gray window).
/// </summary>
public static class UiUrl
{
    public static string Resolve(string serverHost, int httpPort, bool serverIsHere, string? firstRunUrlText)
    {
        var host = (serverHost ?? "").Trim();
        if (serverIsHere && TryHttpBase(firstRunUrlText, out var fromFile) && (IsLoopbackName(host) || host.Length == 0 || SameHostPort(fromFile, host, httpPort))) return fromFile;
        if (host.Length == 0) return TryHttpBase(firstRunUrlText, out var f2) ? f2 : "";
        if (host.Contains(':') && !host.StartsWith('[')) host = "[" + host + "]";          // bare IPv6
        return $"http://{host}:{(httpPort > 0 ? httpPort : 47800)}/";
    }

    /// <summary>The sign-in chooser lives at the root of the server; "/" always shows it when nobody is signed in.</summary>
    public static bool TryHttpBase(string? text, out string url)
    {
        url = "";
        var t = (text ?? "").Trim().TrimStart('\uFEFF');
        if (!Uri.TryCreate(t, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https") || string.IsNullOrEmpty(u.Host)) return false;
        url = $"{u.Scheme}://{u.Authority}/"; return true;
    }

    public static bool IsLoopbackName(string host) => host is "127.0.0.1" or "::1" or "[::1]" || host.Equals("localhost", StringComparison.OrdinalIgnoreCase);

    private static bool SameHostPort(string baseUrl, string host, int port) =>
        Uri.TryCreate(baseUrl, UriKind.Absolute, out var b) && b.Host.Equals(host.Trim('[', ']'), StringComparison.OrdinalIgnoreCase) && (port <= 0 || b.Port == port);

    /// <summary>May the window follow this navigation? Same server (scheme-insensitive: http and the server's own https port both count), about:blank and data: error pages.
    /// Everything else opens in the default browser instead of being silently canceled (a silent cancel left a blank page).</summary>
    public static bool IsInternal(string baseUrl, string? target, int httpsPort = 0)
    {
        if (string.IsNullOrEmpty(target)) return false;
        if (target.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || target.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return true;
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var b) || !Uri.TryCreate(target, UriKind.Absolute, out var t)) return false;
        if (t.Scheme is not ("http" or "https") || !t.Host.Equals(b.Host, StringComparison.OrdinalIgnoreCase)) return false;
        return t.Port == b.Port || httpsPort > 0 && t.Scheme == "https" && t.Port == httpsPort;
    }
}
