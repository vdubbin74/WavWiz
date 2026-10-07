using System.Net;
using System.Net.WebSockets;
using System.Text;
using WavWiz.Core;
namespace WavWiz.Server.Api;

/// <summary>
/// Phone-facing pages and sockets (0.0.2): the iPhone/Android certificate set-up screen with QR and trust check, the phone-as-a-room socket,
/// and the visualizer feed. The pages carry no inline scripts (CSP script-src 'self'); their behavior lives in /js/tls-setup.js.
/// </summary>
public static class PhoneApi
{
    /// <summary>The host a phone should use: the request host, except "localhost" (typed on the server PC) is replaced by the LAN address.</summary>
    public static string PhoneHost(HttpContext c, Services s)
    {
        var h = c.Request.Host.Host;
        if (h is "localhost" or "127.0.0.1" or "::1" or "[::1]" && IPAddress.TryParse(s.Cfg.BindAddress, out var ip) && !IPAddress.IsLoopback(ip)) return ip.ToString();
        return h;
    }

    public static void Map(WebApplication app, Services s)
    {
        app.MapGet("/tls/setup", (HttpContext c) => Results.Content(Page(c, s, "setup"), "text/html; charset=utf-8")).Anon();
        app.MapGet("/tls/check", (HttpContext c) => Results.Content(Page(c, s, "check"), "text/html; charset=utf-8")).Anon();
        app.MapGet("/tls/qr.svg", (HttpContext c, string? to) =>
        {
            var host = PhoneHost(c, s);
            string path = to switch { "check" => "/tls/check", "app" => "/", _ => "/tls/setup" };
            c.Response.Headers.CacheControl = "no-store";
            return Results.Content(SystemApi.QrSvg($"http://{host}:{s.Cfg.HttpPort}{path}"), "image/svg+xml");
        }).Anon();
        app.MapGet("/tls/info", (HttpContext c) =>
        {
            var host = PhoneHost(c, s); c.Response.Headers["Access-Control-Allow-Origin"] = "*";
            return Results.Json(new { host, httpPort = s.Cfg.HttpPort, httpsPort = s.Cfg.HttpsPort, enabled = s.Ca.Enabled, setupUrl = $"http://{host}:{s.Cfg.HttpPort}/tls/setup", checkUrl = $"http://{host}:{s.Cfg.HttpPort}/tls/check", rootSha256 = s.Ca.RootSha256 });
        }).Anon();

        // ---- phone as a device: the browser speaks the same frames as the Windows player ----
        app.Map("/ws/room", async (HttpContext c) =>
        {
            if (!c.WebSockets.IsWebSocketRequest) return Results.StatusCode(400);
            using var ws = await c.WebSockets.AcceptWebSocketAsync();
            await using var stream = WebSocketStream.Create(ws, WebSocketMessageType.Binary, ownsWebSocket: false);
            try { await s.Audio.ServeStream(stream, c.Connection.RemoteIpAddress ?? IPAddress.Loopback, c.Who()); } catch { }
            return Results.Empty;
        }).Req(Role.Control);

        // ---- visualizer feed: [1][1024 x u8 mono waveform][4 x u8 stereo rms/peak dB (0.0.8)] about 30 times a second while music is audible, [0] once when it stops ----
        app.Map("/ws/viz", async (HttpContext c) =>
        {
            if (!c.WebSockets.IsWebSocketRequest) return Results.StatusCode(400);
            int delayMs = int.TryParse(c.Request.Query["delayMs"], out var dm) ? Math.Clamp(dm, 0, 3000) : 0;
            using var ws = await c.WebSockets.AcceptWebSocketAsync();
            var recv = Task.Run(async () => { var b = new byte[256]; try { while (ws.State == WebSocketState.Open) { var r = await ws.ReceiveAsync(b, CancellationToken.None); if (r.MessageType == WebSocketMessageType.Close) break; } } catch { } });
            var msg = new byte[1 + VizHub1.Window + Playback.VizHub.Extra]; bool idleSent = false;
            try
            {
                using var tick = new PeriodicTimer(TimeSpan.FromMilliseconds(33));
                while (await tick.WaitForNextTickAsync(c.RequestAborted) && ws.State == WebSocketState.Open && !recv.IsCompleted)
                {
                    var w = s.Viz.At(s.Conductor.Clock.NowUs - delayMs * 1000L);
                    if (w == null) { if (!idleSent) { idleSent = true; await ws.SendAsync(new byte[] { 0 }, WebSocketMessageType.Binary, true, c.RequestAborted); } continue; }
                    idleSent = false; msg[0] = 1; Buffer.BlockCopy(w, 0, msg, 1, Math.Min(w.Length, msg.Length - 1));
                    await ws.SendAsync(msg, WebSocketMessageType.Binary, true, c.RequestAborted);
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            return Results.Empty;
        }).Req(Role.View);
    }

    private static class VizHub1 { public const int Window = Playback.VizHub.Window; }

    private static string E(string x) => WebUtility.HtmlEncode(x);

    private static string Page(HttpContext c, Services s, string mode)
    {
        var host = PhoneHost(c, s); var http = $"http://{host}:{s.Cfg.HttpPort}"; var https = $"https://{host}:{s.Cfg.HttpsPort}";
        var h = new StringBuilder();
        h.Append("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'><meta name=theme-color content='#FF3C00'>")
         .Append("<title>WavWiz - phone set-up</title><link rel=icon href='/favicon.ico'><link rel=stylesheet href='/tls.css'></head>")
         .Append($"<body data-mode='{mode}' data-enabled='{(s.Ca.Enabled ? 1 : 0)}' data-host='{E(host)}' data-http='{s.Cfg.HttpPort}' data-https='{s.Cfg.HttpsPort}'><main>")
         .Append($"<header><img src='/assets/logo-64.png' width=40 height=40 alt=''><div><h1>WavWiz</h1><small>BETA {WavWizInfo.Version} - phone set-up</small></div></header>");
        if (!s.Ca.Enabled)
        {
            h.Append("<section class='card warn'><h2>HTTPS is not switched on yet</h2><p>Phones only allow the microphone (for speaker calibration) and background audio controls on a secure page. Ask the person who runs WavWiz to open <b>Settings &rsaquo; Phone &amp; HTTPS</b> on the PC and press <b>Set up HTTPS</b>. Then come back to this page.</p>")
             .Append($"<p><a class=btn href='{E(http)}/tls/setup'>Reload this page</a></p></section>");
        }
        else
        {
            h.Append("<section class='card only-desktop'><h2>Scan this with your phone's camera</h2><p>Point the camera at the square. Tap the link that appears.</p>")
             .Append($"<div class=qr><img src='/tls/qr.svg?to=setup' alt='QR code for {E(http)}/tls/setup' width=220 height=220></div><p class=small>No camera? On the phone open Safari and type:<br><code>{E(http)}/tls/setup</code></p></section>");
            h.Append("<section class=card id=status><h2 id=statusTitle>Does this phone already trust WavWiz?</h2><p id=statusText>Tap the button to find out. It takes a few seconds.</p><p><button class=btn id=check>Check my phone</button></p><div id=advice></div></section>");
            h.Append("<section class='card dev dev-ios'><h2>iPhone / iPad - 4 steps</h2><p class=small>Use <b>Safari</b> (not a browser inside another app, and not a Private tab).</p><ol class=steps>")
             .Append("<li data-step=1><h3>Download the profile</h3><p>Tap the button, then tap <b>Allow</b> when iPhone asks &ldquo;This website is trying to download a configuration profile&rdquo;.</p><p><a class=btn href='/tls/root-ca.mobileconfig'>Download profile</a></p><p class=small>Then tap <b>Close</b>. Nothing is installed yet.</p></li>")
             .Append("<li data-step=2><h3>Install it</h3><p>Open the <b>Settings</b> app. At the top you see <b>Profile Downloaded</b>. Tap it, tap <b>Install</b> (top right), type your iPhone passcode, then tap <b>Install</b> twice more and <b>Done</b>.</p><p class=small>iPhone says &ldquo;Not Signed&rdquo;. That is expected for a private home certificate; it only works for this WavWiz server.</p></li>")
             .Append("<li data-step=3><h3>Turn trust on <span class=must>(most often forgotten)</span></h3><p>Settings &rsaquo; <b>General</b> &rsaquo; <b>About</b> &rsaquo; scroll to the bottom &rsaquo; <b>Certificate Trust Settings</b>. Switch <b>WavWiz Local CA (BETA)</b> to <b>on</b>, then tap <b>Continue</b>.</p></li>")
             .Append("<li data-step=4><h3>Check</h3><p>Come back to Safari and tap <b>Check my phone</b> above. A green tick means you are done.</p></li></ol></section>");
            h.Append("<section class='card dev dev-android'><h2>Android - 3 steps</h2><ol class=steps>")
             .Append("<li><h3>Download the certificate</h3><p><a class=btn href='/tls/root-ca.crt'>Download certificate</a></p></li>")
             .Append("<li><h3>Install it</h3><p>Settings &rsaquo; Security (or Biometrics &amp; security) &rsaquo; More security settings &rsaquo; <b>Install from device storage</b> &rsaquo; <b>CA certificate</b> &rsaquo; <b>Install anyway</b>, then pick the file you just downloaded.</p></li>")
             .Append("<li><h3>Check</h3><p>Tap <b>Check my phone</b> above. Chrome on Android trusts user-installed certificates; some apps do not, which does not matter here.</p></li></ol></section>");
            h.Append("<section class=card><h2>Good to know</h2><ul class=small><li>The certificate is valid <b>only</b> for this server's address on your home network. Even if someone had the file they could not use it for any other website.</li>")
             .Append($"<li>Fingerprint (SHA-256) to compare if you like:<br><code class=fp>{E(s.Ca.RootSha256 ?? "")}</code></li>")
             .Append("<li>Remove it any time: Settings &rsaquo; General &rsaquo; VPN &amp; Device Management (iPhone).</li>")
             .Append("<li>If the server's address ever changes, press <b>Set up HTTPS</b> again on the PC. You do not need to repeat these steps on the phone.</li></ul></section>");
            h.Append($"<section class=card id=done hidden><h2>All set</h2><p>Your phone trusts WavWiz.</p><p><a class=btn href='{E(https)}/'>Open WavWiz (secure)</a></p></section>");
        }
        h.Append("</main><script src='/js/tls-setup.js' type='module'></script></body></html>");
        return h.ToString();
    }
}
