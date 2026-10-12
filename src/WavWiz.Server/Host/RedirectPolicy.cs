namespace WavWiz.Server.Host;

/// <summary>
/// When may the server send a browser from http:// to https://? Only for a person opening a PAGE (GET/HEAD navigation) from another device while the
/// "tls.redirect" setting is on. NEVER for API/WebSocket calls (a player cannot follow a redirect to an https address whose certificate authority it does not
/// trust - the 0.0.1 pairing failure "The SSL connection could not be established"), never for the phone set-up pages (they must work over plain http so a phone
/// can fetch the certificate), and never for WavWiz Player's own window.
/// </summary>
public static class RedirectPolicy
{
    /// <summary>0.2.3 fix: the static files the phone set-up pages (/tls/setup, /tls/check) load. They must come over plain http from the same origin as the page:
    /// redirected to https they are blocked by the page's CSP ('self' = the http origin), refused as a cross-origin module script, and on a phone that does not
    /// trust WavWiz yet they could not load anyway. These are public, non-secret files (no auth gate on static files); only the redirect is skipped.</summary>
    public static readonly string[] SetupPageAssets = { "/tls.css", "/js/tls-setup.js", "/assets/logo-64.png", "/favicon.ico",
        // 0.2.5: the phone's mic-only calibration page shows the one-time certificate steps over plain http when the phone does not trust WavWiz yet,
        // then moves itself to https - so it and its own files are never redirected (same lesson as the set-up page: page AND its assets)
        "/calmic.html", "/calmic.css", "/js/calmic.js", "/js/calmic-core.js", "/js/calerrors.js", "/js/roomsched.js" };

    public static bool ShouldRedirect(string method, string path, bool isHttps, bool redirectSettingOn, bool caEnabled, bool thisMachine, string? userAgent)
    {
        if (isHttps || !redirectSettingOn || !caEnabled || thisMachine) return false;
        if (!(HttpMethods.IsGet(method) || HttpMethods.IsHead(method))) return false;
        if (path.StartsWith("/tls", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/ws", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/c/", StringComparison.OrdinalIgnoreCase)) return false;   // 0.2.2 T9: the phone-mic short link goes through the certificate check first
        if (Array.Exists(SetupPageAssets, a => string.Equals(a, path, StringComparison.OrdinalIgnoreCase))) return false;
        if (userAgent != null && (userAgent.Contains("WavWizPlayer/", StringComparison.OrdinalIgnoreCase) || userAgent.Contains("UnisonPlayer/", StringComparison.OrdinalIgnoreCase))) return false;
        return true;
    }
}
