using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
namespace WavWiz.Server.Api;

/// <summary>One "use your phone as the microphone" link from the Calibrate speakers page (0.2.2 T9). Lives in memory for 20 minutes.</summary>
public sealed class CalPhoneLink
{
    public string Token { get; init; } = "";
    public bool ByAdmin { get; init; }
    public DateTimeOffset Expires { get; init; }
    public DateTimeOffset? LastSeen { get; set; }
    public string State { get; set; } = "waiting";
    public string? Device { get; set; }
    public int Opens { get; set; }
}

/// <summary>
/// 0.2.2 T9: the Calibrate speakers page on a PC shows a QR code + short link (http://host:port/c/CODE). The phone opens it, goes through the
/// certificate check (/tls/check installs the WavWiz certificate once if needed), and lands on the secure (HTTPS) page with ?cal=CODE, which
/// starts the calibration wizard there and reports "connected" back, so the PC page can show "Phone connected / waiting" live.
/// A link made by an administrator also lets an unpaired phone sign in (a fresh 5-minute pairing code is minted when the link is opened)
/// and lets that phone calibrate every speaker, like the administrator could; links expire after 20 minutes.
/// </summary>
public static class CalPhoneApi
{
    static readonly ConcurrentDictionary<string, CalPhoneLink> Links = new(StringComparer.OrdinalIgnoreCase);
    const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";       // no 0/O, 1/I/L: easy to type from the short link
    public static readonly TimeSpan Life = TimeSpan.FromMinutes(20);
    public static readonly TimeSpan Fresh = TimeSpan.FromSeconds(12);   // a phone that said hello this recently counts as connected
    public const int MaxOpens = 8;

    public static string NewToken() => RandomNumberGenerator.GetString(Alphabet, 6);
    public static bool WellFormed(string? t) => t is { Length: 6 } && t.All(ch => Alphabet.Contains(char.ToUpperInvariant(ch)));

    public static CalPhoneLink Create(bool byAdmin, DateTimeOffset now)
    {
        Prune(now);
        string t; do t = NewToken(); while (Links.ContainsKey(t));
        var l = new CalPhoneLink { Token = t, ByAdmin = byAdmin, Expires = now + Life };
        Links[t] = l; return l;
    }
    public static CalPhoneLink? Valid(string? token, DateTimeOffset now) => WellFormed(token) && Links.TryGetValue(token!, out var l) && l.Expires > now ? l : null;
    static void Prune(DateTimeOffset now) { foreach (var k in Links.Where(kv => kv.Value.Expires <= now).Select(kv => kv.Key).ToList()) Links.TryRemove(k, out _); }
    public static object Status(CalPhoneLink l, DateTimeOffset now) => new { state = l.State, device = l.Device, connected = l.LastSeen is { } t && now - t < Fresh && l.State != "left", expires = l.Expires };

    /// <summary>The phone's secure calibration address, with the pairing code when there is one.</summary>
    public static string SecureUrl(string host, int httpsPort, string token, string? pair) => $"https://{host}:{httpsPort}/?cal={token}" + (pair != null ? $"&pair={pair}" : "");

    public static void Map(RouteGroupBuilder g, WebApplication app, Services s)
    {
        g.MapPost("/calibration/phone-link", (HttpContext c) =>
        {
            var l = Create(ZoneApi.IsAdmin(c), DateTimeOffset.UtcNow); var host = PhoneApi.PhoneHost(c, s);
            return Results.Json(new { token = l.Token, shortUrl = $"http://{host}:{s.Cfg.HttpPort}/c/{l.Token}", secureUrl = SecureUrl(host, s.Cfg.HttpsPort, l.Token, null), https = s.Ca.Enabled, signsIn = l.ByAdmin, expires = l.Expires });
        }).Req(Role.Control);

        g.MapGet("/calibration/phone-link/{token}", (string token) =>
        {
            var now = DateTimeOffset.UtcNow; var l = Valid(token, now);
            return l == null ? Ext.Bad("This phone link has expired. Make a new one.", 404) : Results.Json(Status(l, now));
        }).Req(Role.Control);

        g.MapGet("/calibration/phone-link/{token}/qr.svg", (string token, HttpContext c) =>
        {
            var l = Valid(token, DateTimeOffset.UtcNow); if (l == null) return Results.NotFound();
            c.Response.Headers.CacheControl = "no-store";
            return Results.Content(SystemApi.QrSvg($"http://{PhoneApi.PhoneHost(c, s)}:{s.Cfg.HttpPort}/c/{l.Token}"), "image/svg+xml");
        }).Req(Role.Control);

        // the phone: "I am here" (state opened / measuring / done / left), every few seconds while the wizard is open
        g.MapPost("/calibration/phone-link/{token}/hello", async (string token, HttpContext c) =>
        {
            var now = DateTimeOffset.UtcNow; var l = Valid(token, now); if (l == null) return Ext.Bad("This phone link has expired. Scan the new QR code on the PC.", 404);
            var b = await c.Request.Body(); var st = b.Str("state") ?? "opened";
            if (st is not ("opened" or "measuring" or "done" or "left")) st = "opened";
            var dev = (b.Str("device") ?? c.Who()?.Name ?? "Phone").Trim(); if (dev.Length > 40) dev = dev[..40];
            bool changed = l.State != st || l.LastSeen is null || now - l.LastSeen >= Fresh;
            l.State = st; l.Device = dev; l.LastSeen = now;
            if (changed) s.Events.Publish("calphone", new { token = l.Token, state = st, device = dev });
            return Results.Json(new { ok = true, byAdmin = l.ByAdmin, https = c.Request.IsHttps });
        }).Req(Role.View);

        // the short link from the QR code: certificate check first (http), which sends a trusting phone on to the secure page
        app.MapGet("/c/{token}", (string token, HttpContext c) =>
        {
            var now = DateTimeOffset.UtcNow; var l = Valid(token, now);
            c.Response.Headers.CacheControl = "no-store";
            if (l == null) return Results.Content(Expired, "text/html; charset=utf-8", null, 404);
            var host = PhoneHost(c, s);
            string? pair = null;
            if (l.ByAdmin && l.Opens++ < MaxOpens) pair = s.Auth.NewPairingCode().Code;
            var q = $"cal={l.Token}" + (pair != null ? $"&pair={pair}" : "");
            return Results.Redirect(s.Ca.Enabled ? $"http://{host}:{s.Cfg.HttpPort}/tls/check?{q}" : $"http://{host}:{s.Cfg.HttpPort}/?{q}");
        }).Anon();
    }
    static string PhoneHost(HttpContext c, Services s) => PhoneApi.PhoneHost(c, s);
    const string Expired = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>WavWiz</title><body style='font-family:system-ui;background:#14171A;color:#E8EDF0;padding:24px'><h2>This link has expired</h2><p>Open Devices &gt; Calibrate speakers on the PC again and scan the new QR code.</p></body>";
}
