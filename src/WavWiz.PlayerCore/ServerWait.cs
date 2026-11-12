using System.Net;
namespace WavWiz.PlayerCore;

/// <summary>
/// 0.6.9 #14: the Player window waits for the server instead of giving up. After a reboot the WavWiz service can take minutes to start
/// (delayed auto-start), so "could not be reached" after 20 seconds was wrong: the window shows "Waiting for the WavWiz server…" and tries
/// again with a growing pause (2, 4, 8, 16, then every 30 s), forever, until the page loads. "Try now" and "Open in my browser" stay available.
/// Only errors that mean "nobody answered (yet)" wait; anything else (a certificate problem, a bad address) still shows the problem page.
/// </summary>
public static class ServerWait
{
    public static readonly TimeSpan First = TimeSpan.FromSeconds(2), Max = TimeSpan.FromSeconds(30);

    /// <summary>Pause before try number <paramref name="attempt"/> (1-based): 2 s, 4 s, 8 s, 16 s, then 30 s for good.</summary>
    public static TimeSpan Delay(int attempt)
    {
        if (attempt < 1) attempt = 1;
        if (attempt > 5) return Max;
        var s = First.TotalSeconds * Math.Pow(2, attempt - 1);
        return TimeSpan.FromSeconds(Math.Min(s, Max.TotalSeconds));
    }

    /// <summary>WebView2 CoreWebView2WebErrorStatus names that mean "the server is not answering (yet)" - keep waiting.</summary>
    private static readonly HashSet<string> WaitErrors = new(StringComparer.Ordinal)
    {
        "CannotConnect", "Timeout", "ConnectionAborted", "ConnectionReset", "Disconnected", "ServerUnreachable",
        "HostNameNotResolved", "Unknown", "ErrorHttpInvalidServerResponse",
    };
    public static bool ShouldWait(string? webErrorStatus) => webErrorStatus != null && WaitErrors.Contains(webErrorStatus);

    /// <summary>The waiting page (shown with NavigateToString). Counts down to the next try by itself; the host navigates when the pause is over.</summary>
    public static string Page(string url, int attempt, TimeSpan next, string? serverName = null)
    {
        string E(string x) => WebUtility.HtmlEncode(x);
        var who = string.IsNullOrWhiteSpace(serverName) ? "the WavWiz server" : "WavWiz on " + serverName;
        int secs = (int)Math.Ceiling(next.TotalSeconds);
        return "<!doctype html><html><head><meta charset='utf-8'><title>Waiting for the WavWiz server</title><style>"
            + "body{background:#0b0d12;color:#e8eaf0;font:15px 'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}"
            + "main{max-width:520px;border:1px solid #2a2f3a;padding:26px 28px;border-radius:8px;background:#121620;text-align:center}"
            + "h2{margin:12px 0 6px;font-weight:600}p{color:#aab1bf;margin:6px 0}"
            + ".sp{width:34px;height:34px;margin:0 auto;border:3px solid #2a2f3a;border-top-color:#FF3C00;border-radius:50%;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}"
            + "a{display:inline-block;margin:16px 6px 0;padding:8px 16px;border:1px solid #FF3C00;color:#e8eaf0;text-decoration:none;border-radius:4px}a.p{background:#FF3C00;color:#111}"
            + "</style></head><body><main><div class='sp' aria-hidden='true'></div>"
            + "<h2>Waiting for the WavWiz server…</h2>"
            + $"<p>{E(who)} is not answering yet. After a restart the server can take a few minutes to start.</p>"
            + $"<p id='n' data-s='{secs}'>Trying again in {secs} s (try {attempt}).</p>"
            + $"<p style='font-size:12px;color:#6f7787'>{E(url)}</p>"
            + $"<a class='p' href='{E(url)}'>Try now</a><a href='wavwiz-browser:'>Open in my browser</a>"
            + "</main><script>(function(){var n=document.getElementById('n'),s=+n.dataset.s,a=" + attempt + ";setInterval(function(){if(s>1){s--;n.textContent='Trying again in '+s+' s (try '+a+').';}else n.textContent='Trying now…';},1000);})();</script></body></html>";
    }
}
