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
        if (h is "localhost" or "127.0.0.1" or "::1" or "[::1]" && IPAddress.TryParse(s.Cfg.BindAddress, out var ip) && !IPAddress.IsLoopback(ip))
        {
            if (!Tls.CertificateEndpoints.Wildcard(ip)) return ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? "[" + ip + "]" : ip.ToString();
            try
            {
                var endpoint = Tls.CertificateEndpoints.PreferForPhone(Tls.CertificateEndpoints.Resolve(ip), c.Connection.LocalIpAddress).FirstOrDefault();   // 0.6.8-#11g: home network before Tailscale
                if (endpoint != null) return endpoint.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? "[" + endpoint + "]" : endpoint.ToString();
            }
            catch { /* keep the request host, never advertise a wildcard */ }
        }
        return h;
    }

    public static void Map(WebApplication app, Services s)
    {
        // 0.4.1 E: a per-device manifest. The Home Screen icon starts at "/?wr=<device id>", so the Home Screen app (separate storage on iOS) comes up as the SAME device
        // and finds its saved name / calibration / mic settings on the server.
        app.MapGet("/api/v1/phone/manifest", (HttpContext c, string? wr) =>
        {
            var id = !string.IsNullOrEmpty(wr) && System.Text.RegularExpressions.Regex.IsMatch(wr, "^[A-Za-z0-9._-]{6,80}$") ? wr : null;
            var start = id == null ? "/" : "/?wr=" + id;
            var json = "{\"id\":\"/\",\"name\":\"WavWiz\",\"short_name\":\"WavWiz\",\"description\":\"Play your music in sync on every speaker in the house.\",\"start_url\":\"" + start + "\",\"scope\":\"/\",\"display\":\"standalone\",\"background_color\":\"#000614\",\"theme_color\":\"#FF3C00\",\"icons\":[{\"src\":\"/assets/logo-180.png?v=pf070\",\"sizes\":\"180x180\",\"type\":\"image/png\",\"purpose\":\"any\"},{\"src\":\"/assets/logo-192.png\",\"sizes\":\"192x192\",\"type\":\"image/png\",\"purpose\":\"any\"},{\"src\":\"/assets/logo-512.png\",\"sizes\":\"512x512\",\"type\":\"image/png\",\"purpose\":\"any\"},{\"src\":\"/assets/logo-maskable-512.png\",\"sizes\":\"512x512\",\"type\":\"image/png\",\"purpose\":\"maskable\"}]}";
            c.Response.Headers.CacheControl = "no-store";
            return Results.Content(json, "application/manifest+json");
        }).Anon();
        app.MapGet("/tls/setup", (HttpContext c) => Results.Content(Page(c, s, "setup"), "text/html; charset=utf-8")).Anon();
        app.MapGet("/tls/check", (HttpContext c) => Results.Content(Page(c, s, "check"), "text/html; charset=utf-8")).Anon();
        app.MapGet("/tls/qr.svg", (HttpContext c, string? to, string? code) =>
        {
            var host = PhoneHost(c, s);
            string path = to switch { "check" => "/tls/check", "app" => "/", "secure" => SecurePath(c.Request.Query["next"], c.Request.Query["cal"]), _ => "/tls/setup" };
            // 0.3.7 L28: to=pair&code=123456 -> the phone setup page with the pairing code prefilled (only a 6-digit code is ever carried)
            if (to == "pair") path = "/tls/setup" + (code is not null && PairCode.IsMatch(code) ? "?pair=" + code : "");
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
            // 0.2.0: the WavWiz Player window already plays through its own Windows audio connection; its page must never ALSO join as a web speaker (that PC would play twice)
            if (c.Request.Headers.UserAgent.ToString().Contains("WavWizPlayer/", StringComparison.Ordinal)) return Ext.Bad("The WavWiz Player window already plays on this PC.", 409);
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
            string? zid = c.Request.Query["zoneId"]; zid = string.IsNullOrWhiteSpace(zid) ? null : zid.Trim();      // 0.4.3 #10: the zone whose music to show
            using var ws = await c.WebSockets.AcceptWebSocketAsync();
            var recv = Task.Run(async () => { var b = new byte[256]; try { while (ws.State == WebSocketState.Open) { var r = await ws.ReceiveAsync(b, CancellationToken.None); if (r.MessageType == WebSocketMessageType.Close) break; } } catch { } });
            var msg = new byte[1 + VizHub1.Window + Playback.VizHub.Extra]; bool idleSent = false;
            try
            {
                using var tick = new PeriodicTimer(TimeSpan.FromMilliseconds(33));
                while (await tick.WaitForNextTickAsync(c.RequestAborted) && ws.State == WebSocketState.Open && !recv.IsCompleted)
                {
                    // the zone's group is looked up every tick: linking / splitting a zone moves its music to another group
                    var gid = zid == null ? null : (s.Links?.ResolveZone(zid, false) ?? Playback.Conductor.DefaultGroupId);
                    var w = s.Vizs.At(gid, s.Conductor.Clock.NowUs - delayMs * 1000L);
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

    /// <summary>F274 3.2: the "Make your phone secure" QR. Always the plain-http set-up page (an untrusted phone would see "This Connection Is Not
    /// Private" first on https), with next=app, or next=cal&amp;cal=CODE to keep the calibration hand-off (a bad code is dropped).</summary>
    public static string SecurePath(string? next, string? cal) =>
        next == "cal" && cal is not null && CalCode.IsMatch(cal) ? "/tls/setup?next=cal&cal=" + cal : "/tls/setup?next=app";

    private static readonly System.Text.RegularExpressions.Regex CalCode = new("^[A-Za-z0-9]{6}$"), PairCode = new("^[0-9]{6}$");

    /// <summary>0.2.3 fix: the secure calibration address for a set-up page opened with ?cal=CODE[&amp;pair=CODE] (from the Calibrate speakers QR / short link),
    /// or null. Same rules as /js/tls-setup.js: cal must be 6 letters/digits, pair 6 digits (an invalid pair is dropped, an invalid cal means no link);
    /// same host (PhoneHost) and HTTPS port the script uses, so the hand-off works even when the script cannot run.</summary>
    public static string? SecureCalUrl(HttpContext c, Services s)
    {
        var cal = c.Request.Query["cal"].ToString(); var pair = c.Request.Query["pair"].ToString();
        if (!CalCode.IsMatch(cal)) return null;
        return CalPhoneApi.SecureUrl(PhoneHost(c, s), s.Cfg.HttpsPort, cal, PairCode.IsMatch(pair) ? pair : null);
    }

    /// <summary>0.6.8-#11g: other addresses on this server's certificate (not the one the page was opened on), for the phone's trust probe.
    /// A browser's "visit anyway" exception covers only the host it was granted for, so a secure fetch to ANOTHER covered address
    /// succeeds only when the phone really trusts the WavWiz CA.</summary>
    public static IReadOnlyList<string> AltHosts(HttpContext c, Services s, string host)
    {
        try
        {
            if (!IPAddress.TryParse(s.Cfg.BindAddress, out var bind) || IPAddress.IsLoopback(bind)) return Array.Empty<string>();
            return Tls.CertificateEndpoints.PreferForPhone(Tls.CertificateEndpoints.Resolve(bind), c.Connection.LocalIpAddress)
                .Select(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? "[" + a + "]" : a.ToString())
                .Where(a => !string.Equals(a, host.Trim('[', ']'), StringComparison.OrdinalIgnoreCase) && !string.Equals(a, host, StringComparison.OrdinalIgnoreCase)).Take(3).ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    private static string Page(HttpContext c, Services s, string mode)
    {
        var host = PhoneHost(c, s); var http = $"http://{host}:{s.Cfg.HttpPort}"; var https = $"https://{host}:{s.Cfg.HttpsPort}";
        var calUrl = s.Ca.Enabled ? SecureCalUrl(c, s) : null;
        if (calUrl != null) c.Response.Headers.CacheControl = "no-store";     // may carry a one-time pairing code
        var h = new StringBuilder();
        h.Append("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'><meta name=theme-color content='#FF3C00'><link rel=manifest href='/manifest.webmanifest'><link rel=apple-touch-icon sizes=180x180 href='/assets/logo-180.png?v=pf070'><link rel=apple-touch-icon-precomposed sizes=180x180 href='/assets/logo-180.png?v=pf070'><meta name=apple-mobile-web-app-capable content=yes><meta name=mobile-web-app-capable content=yes><meta name=apple-mobile-web-app-title content=WavWiz>")
         .Append("<title>WavWiz - phone set-up</title><link rel=icon href='/favicon.ico'><link rel=stylesheet href='/tls.css'></head>")
         .Append($"<body data-mode='{mode}' data-enabled='{(s.Ca.Enabled ? 1 : 0)}' data-host='{E(host)}' data-http='{s.Cfg.HttpPort}' data-https='{s.Cfg.HttpsPort}' data-alt='{E(string.Join(",", s.Ca.Enabled ? AltHosts(c, s, c.Request.Host.Host) : Array.Empty<string>()))}'><main>")
         .Append($"<header><img src='/assets/logo-64.png' width=40 height=40 alt=''><div><h1>WavWiz</h1><small>BETA {WavWizInfo.Version} - phone set-up{(string.IsNullOrWhiteSpace(s.DisplayName) ? "" : " for " + E(s.DisplayName))}</small></div></header>");   // F274: several servers - say which PC
        if (!s.Ca.Enabled)
        {
            // F274 W1: what it means, what still works, one button (an admin on this phone can set it up; everyone else gets Check again + a 10 s poll)
            h.Append("<section class='card info' id=notready><h2>Secure connection isn't ready yet</h2><p>WavWiz works on this phone already. Only the microphone features (calibrating speakers, Announce) need it. Ask whoever runs WavWiz to press <b>Set up secure connection</b> on the PC. This page updates by itself.</p>")
             .Append($"<p><button class='btn primary' id=enableTls hidden>Set up secure connection</button> <a class=btn id=again href='{E(http)}/tls/setup'>Check again</a></p><p class=small id=enableMsg></p></section>");
        }
        else
        {
            // F274 3.4: the status card first (filled by the silent check), then only this phone's steps (the other platform behind a link)
            h.Append("<section class='card info' id=status><h2 id=statusTitle>Make this phone secure</h2><p id=statusText>WavWiz already works on this phone. A secure connection is only needed for the microphone (calibrating speakers, Announce, Check with phone). It takes about 2 minutes and only works for your WavWiz server.</p><p><button class=btn id=check>Check my phone</button></p><div id=advice></div></section>");
            h.Append("<section class='card only-desktop'><h2>Scan this with your phone's camera</h2><p>Point the camera at the square. Tap the link that appears.</p>")
             .Append($"<div class=qr><img src='/tls/qr.svg?to=secure' alt='QR code for {E(http)}/tls/setup' width=220 height=220></div><p class=small>No camera? On the phone open Safari and type:<br><code>{E(http)}/tls/setup</code></p></section>");
            if (calUrl != null)
                h.Append("<section class='card focus' id=calgo><h2>Calibrate with this phone</h2><p>Once this phone trusts WavWiz (steps below), continue to the secure calibration page. The music pauses there automatically.</p>")
                 .Append($"<p><a class=btn id=calgoLink href='{E(calUrl)}'>Continue to secure calibration</a></p>")
                 .Append("<p class=small>If Safari shows a certificate warning (&ldquo;This Connection Is Not Private&rdquo;), the certificate is not trusted yet: install it below first, and on iPhone switch it on in Settings &rsaquo; General &rsaquo; About &rsaquo; Certificate Trust Settings. Then come back and tap the button again.</p></section>");
            h.Append("<section class='card dev dev-ios' id=steps-ios><h2>iPhone / iPad - 4 steps</h2><p class=small>Use <b>Safari</b> (not a browser inside another app, and not a Private tab).</p><ol class='steps big'>")
             .Append("<li data-step=1><h3>Download the profile</h3><p><a class=btn href='/tls/root-ca.mobileconfig'>Download profile</a></p><p>Tap <b>Allow</b>, then <b>Close</b>. Nothing is installed yet.</p></li>")
             .Append("<li data-step=2><h3>Install it</h3><p>Open <b>Settings</b>, tap <b>Profile Downloaded</b> at the top, <b>Install</b>, enter your passcode, <b>Install</b>, <b>Done</b>.</p><p class=small>&ldquo;Not Signed&rdquo; is normal for a home certificate.</p></li>")
             .Append("<li data-step=3 class=callout><h3>Turn on full trust <span class=must>(the step most people miss)</span></h3><p>Settings &rsaquo; <b>General</b> &rsaquo; <b>About</b> &rsaquo; scroll to the bottom &rsaquo; <b>Certificate Trust Settings</b> &rsaquo; switch on <b>WavWiz Local CA (BETA)</b> &rsaquo; <b>Continue</b>.</p><p class=small>Without this switch the profile is installed but the phone still says the connection is not private.</p></li>")
             .Append("<li data-step=4><h3>Come back here</h3><p>This page checks again by itself when you return. You'll see <b>Secure connection &#10003;</b>.</p></li></ol>")
             .Append("<p class=small><a href='#steps-android' class=other data-show=android>Using Android?</a></p></section>");
            h.Append("<section class='card dev dev-android' id=steps-android><h2>Android - 3 steps</h2><ol class='steps big'>")
             .Append("<li data-step=1><h3>Download the certificate</h3><p><a class=btn href='/tls/root-ca.crt'>Download certificate</a></p></li>")
             .Append("<li data-step=2><h3>Install it</h3><p>Settings &rsaquo; <b>Security</b> (or Security &amp; privacy) &rsaquo; More security settings &rsaquo; Encryption &amp; credentials &rsaquo; <b>Install a certificate</b> &rsaquo; <b>CA certificate</b> &rsaquo; <b>Install anyway</b>, then pick the file.</p><p class=small>Menus differ by brand: search Settings for &ldquo;CA certificate&rdquo;. If your phone won't install it, use the PC's microphone for calibration instead.</p></li>")
             .Append("<li data-step=3><h3>Come back here</h3><p>This page checks again by itself when you return. You'll see <b>Secure connection &#10003;</b>.</p></li></ol>")
             .Append("<p class=small><a href='#steps-ios' class=other data-show=ios>Using an iPhone?</a></p></section>");
            h.Append($"<section class=card id=done hidden><h2>&#128274; Secure connection &#10003;</h2><p>This phone trusts WavWiz. The microphone features work.</p><p><a class=btn href='{E(https)}/'>Open WavWiz (secure)</a></p></section>");
            h.Append("<details class=card id=goodtoknow><summary><b>Good to know</b></summary><ul class=small><li>The certificate is valid <b>only</b> for this server's addresses. Even if someone had the file they could not use it for any other website.</li>")
             .Append($"<li>Fingerprint (SHA-256) to compare if you like:<br><code class=fp>{E(s.Ca.RootSha256 ?? "")}</code></li>")
             .Append("<li>The secure connection renews by itself; phones don't need to do anything.</li>")
             .Append("<li>Remove it any time: Settings &rsaquo; General &rsaquo; VPN &amp; Device Management (iPhone), or Settings &rsaquo; Security &rsaquo; User credentials (Android).</li>")
             .Append("<li>If your PC gets a new address, WavWiz may ask you to set up phones again. Reserving the PC's address in your router avoids this.</li></ul></details>");
        }
        // 0.3.7 L28: Add to Home Screen - the app already ships a manifest (display: standalone), icons and a service worker (0.3.4 H1); this is the phone-friendly flow
        h.Append("<section class='card dev dev-ios' id=a2hs-ios><h2>Add WavWiz to your Home Screen</h2><p class=small>It then opens full screen, like an app (iPhone / iPad, in <b>Safari</b>).</p><p class='small a2hs-note'></p><ol class='steps a2hs'>")
         .Append("<li><svg class=a2hs-pic viewBox=\"0 0 24 24\" width=32 height=32 fill=none stroke=currentColor stroke-width=1.8 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d=\"M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1\"/></svg><h3>Tap Share</h3><p>The square with an arrow, at the bottom (iPhone) or top (iPad) of Safari.</p></li>")
         .Append("<li><svg class=a2hs-pic viewBox=\"0 0 24 24\" width=32 height=32 fill=none stroke=currentColor stroke-width=1.8 stroke-linecap=round stroke-linejoin=round aria-hidden=true><rect x=3.5 y=3.5 width=17 height=17 rx=3 /><path d=\"M12 8v8M8 12h8\"/></svg><h3>Add to Home Screen</h3><p>Scroll down the list, tap <b>Add to Home Screen</b>, then <b>Add</b>.</p></li></ol></section>");
        h.Append("<section class='card dev dev-android' id=a2hs-android><h2>Add WavWiz to your Home Screen</h2><p class=small>It then opens full screen, like an app (Android, in <b>Chrome</b>).</p><p class='small a2hs-note'></p>")
         .Append("<p><button class=btn id=a2hsInstall hidden>Install WavWiz</button></p><ol class='steps a2hs'>")
         .Append("<li><h3>Open the Chrome menu</h3><p>The three dots at the top right.</p></li>")
         .Append("<li><h3>Install app</h3><p>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</p></li></ol></section>");
        h.Append("</main><script src='/js/tls-setup.js' type='module'></script></body></html>");
        return h.ToString();
    }
}
