namespace WavWiz.Server.Host;

/// <summary>
/// When may the server send a browser from http:// to https://? Only for a person opening a PAGE (GET/HEAD navigation) from another device while the
/// "tls.redirect" setting is on. NEVER for API/WebSocket calls (a player cannot follow a redirect to an https address whose certificate authority it does not
/// trust - the 0.0.1 pairing failure "The SSL connection could not be established"), never for the phone set-up pages (they must work over plain http so a phone
/// can fetch the certificate), and never for WavWiz Player's own window.
/// </summary>
public static class RedirectPolicy
{
    public static bool ShouldRedirect(string method, string path, bool isHttps, bool redirectSettingOn, bool caEnabled, bool thisMachine, string? userAgent)
    {
        if (isHttps || !redirectSettingOn || !caEnabled || thisMachine) return false;
        if (!(HttpMethods.IsGet(method) || HttpMethods.IsHead(method))) return false;
        if (path.StartsWith("/tls", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/ws", StringComparison.OrdinalIgnoreCase)) return false;
        if (userAgent != null && (userAgent.Contains("WavWizPlayer/", StringComparison.OrdinalIgnoreCase) || userAgent.Contains("UnisonPlayer/", StringComparison.OrdinalIgnoreCase))) return false;
        return true;
    }
}
