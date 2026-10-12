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
    /// <summary>0.2.5: the speaker of the person who made a regular (non-admin) link - the only one its phone may measure. Null for an admin's link.</summary>
    public long? OwnerZoneId { get; init; }
    /// <summary>0.2.5: "Stop using as mic" from Devices: the phone page stops and the code no longer authorizes anything.</summary>
    public bool Stopped { get; set; }
    public string? SessionId { get; set; }
}

/// <summary>
/// 0.2.5: the QR code opens a dedicated mic-only page (/calmic.html) that never joins as a speaker and never plays sound, so iOS Safari can open the
/// microphone ("AudioSession category is not compatible with audio capture" in 0.2.4 came from the page joining as a speaker first).
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

    public static CalPhoneLink Create(bool byAdmin, DateTimeOffset now, long? ownerZoneId = null)
    {
        Prune(now);
        string t; do t = NewToken(); while (Links.ContainsKey(t));
        var l = new CalPhoneLink { Token = t, ByAdmin = byAdmin, Expires = now + Life, OwnerZoneId = byAdmin ? null : ownerZoneId };
        Links[t] = l; return l;
    }
    public static CalPhoneLink? Valid(string? token, DateTimeOffset now) => WellFormed(token) && Links.TryGetValue(token!, out var l) && l.Expires > now ? l : null;
    static void Prune(DateTimeOffset now) { foreach (var k in Links.Where(kv => kv.Value.Expires <= now).Select(kv => kv.Key).ToList()) Links.TryRemove(k, out _); }
    public static bool Connected(CalPhoneLink l, DateTimeOffset now) => l.LastSeen is { } t && now - t < Fresh && l.State != "left" && !l.Stopped;
    public static object Status(CalPhoneLink l, DateTimeOffset now) => new { state = l.Stopped ? "stopped" : l.State, device = l.Device, connected = Connected(l, now), expires = l.Expires, sessionId = l.SessionId };
    /// <summary>0.2.5: phones connected as a calibration mic right now (the Devices "Calibration mic" line).</summary>
    public static List<CalPhoneLink> ConnectedLinks(DateTimeOffset now) => Links.Values.Where(l => l.Expires > now && Connected(l, now)).ToList();

    /// <summary>The phone's secure calibration address. 0.2.5: the dedicated mic-only page (it never joins as a speaker or plays sound); the one-time
    /// code authorizes the calibration by itself, so no pairing code is passed on any more (<paramref name="pair"/> is ignored, kept for old callers).</summary>
    public static string SecureUrl(string host, int httpsPort, string token, string? pair = null) => $"https://{host}:{httpsPort}{MicPage}?cal={token}";
    public const string MicPage = "/calmic.html";
    public const string Header = "X-WavWiz-Cal";

    /// <summary>
    /// 0.2.5: the identity of the phone's mic-only calibration page, which has no sign-in. Only for calibration calls (/api/v1/calibration/...) and the
    /// clock WebSocket, only with a live, unexpired, not-stopped link code; it acts with Control rights there (an admin's link: like the admin).
    /// </summary>
    public static AuthInfo? LinkIdentity(HttpContext c)
    {
        var path = c.Request.Path.Value ?? "";
        bool ws = path == "/ws/clock" && c.WebSockets.IsWebSocketRequest;
        if (!ws && !path.StartsWith("/api/v1/calibration/", StringComparison.Ordinal)) return null;
        var tok = ws ? c.Request.Query["cal"].ToString() : c.Request.Headers[Header].ToString();
        if (tok.Length == 0) return null;
        var l = Valid(tok, DateTimeOffset.UtcNow); if (l == null || l.Stopped) return null;
        c.Items["calLink"] = l;
        return new AuthInfo(Role.Control, "Calibration mic", -1, null);
    }
    public static CalPhoneLink? LinkOf(HttpContext c) => c.Items["calLink"] as CalPhoneLink;

    public static void Map(RouteGroupBuilder g, WebApplication app, Services s)
    {
        g.MapPost("/calibration/phone-link", (HttpContext c) =>
        {
            bool admin = ZoneApi.IsAdmin(c) || LinkOf(c)?.ByAdmin == true;
            long? owner = LinkOf(c)?.OwnerZoneId ?? s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress).FirstOrDefault(z => z.Mine)?.Id;
            var l = Create(admin, DateTimeOffset.UtcNow, owner); var host = PhoneApi.PhoneHost(c, s);
            // 0.2.5: signsIn stays false - the mic-only page needs no sign-in; allSpeakers says whether the phone may measure every speaker (an admin's link)
            return Results.Json(new { token = l.Token, shortUrl = $"http://{host}:{s.Cfg.HttpPort}/c/{l.Token}", secureUrl = SecureUrl(host, s.Cfg.HttpsPort, l.Token), micUrl = MicPage + "?cal=" + l.Token, https = s.Ca.Enabled, signsIn = false, allSpeakers = l.ByAdmin, ownSpeaker = l.OwnerZoneId != null, expires = l.Expires });
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
            if (l.Stopped) return Results.Json(new { ok = false, stop = true, byAdmin = l.ByAdmin, https = c.Request.IsHttps });
            bool changed = l.State != st || l.LastSeen is null || now - l.LastSeen >= Fresh;
            l.State = st; l.Device = dev; l.LastSeen = now;
            if (changed) { s.Events.Publish("calphone", new { token = l.Token, state = st, device = dev }); s.Events.Publish("calmics"); }
            return Results.Json(new { ok = true, stop = false, byAdmin = l.ByAdmin, https = c.Request.IsHttps });
        }).Req(Role.View);

        // 0.2.5: what the phone's mic-only page will measure: the house reference and the speakers this link may calibrate (never the phone itself - it is not a speaker)
        g.MapGet("/calibration/phone-link/{token}/plan", (string token, HttpContext c) =>
        {
            var l = Valid(token, DateTimeOffset.UtcNow); if (l == null || l.Stopped) return Ext.Bad("This phone link has expired. Scan the new QR code on the PC.", 404);
            var zs = s.Zones.Zones(null, null).Where(z => z.Connected && z.Outputs.Any(o => o.Active)).ToList();
            var refId = s.Zones.ReferenceZoneId; var rz = refId == 0 ? null : s.Zones.Zone(refId);
            if (rz == null) { var w = zs.FirstOrDefault(z => z.Outputs.First(o => o.Active).Kind == "wired") ?? zs.FirstOrDefault(); if (w != null) { refId = w.Id; rz = s.Zones.Zone(w.Id); } }
            var speakers = zs.Where(z => z.Id != refId && (l.ByAdmin || z.Id == l.OwnerZoneId)).Select(z => new { id = z.Id, name = z.Name }).ToList();
            return Results.Json(new { reference = rz == null ? null : new { id = rz.Id, name = rz.Name, connected = rz.Connected }, speakers, allSpeakers = l.ByAdmin, device = l.Device });
        }).Req(Role.Control);

        // 0.2.5: "Stop using as mic" (Devices > Calibration mic line, or the PC's Calibrate screen): the phone page stops, its code stops working
        g.MapPost("/calibration/phone-link/{token}/stop", (string token, HttpContext c) =>
        {
            var l = Valid(token, DateTimeOffset.UtcNow); if (l == null) return Results.Json(new { ok = true });
            if (!ZoneApi.IsAdmin(c) && LinkOf(c)?.Token != l.Token && l.ByAdmin) return Ext.Bad(ZoneApi.AdminOnly("stop an administrator's calibration mic"), 403);
            l.Stopped = true; l.State = "left";
            if (l.SessionId != null && s.Cal.Get(l.SessionId) is { } cs) s.Cal.End(cs, "stopped");
            s.Events.Publish("calphone", new { token = l.Token, state = "stopped", device = l.Device }); s.Events.Publish("calmics");
            return Results.Json(new { ok = true });
        }).Req(Role.Control);

        // 0.2.5: everything listening as a calibration mic right now - phones (mic-only page) and PC mics in a running measurement. Never a speaker.
        g.MapGet("/calibration/mics", () =>
        {
            var now = DateTimeOffset.UtcNow;
            var phones = ConnectedLinks(now).Select(l => (object)new { kind = "phone", token = l.Token, device = l.Device ?? "Phone", state = l.State, label = l.State switch { "measuring" => "measuring", "done" => "measured", _ => "connected · ready to measure" } });
            var pcs = s.Cal.Open.Where(x => x.Mode == "pc-mic" && x.MicPlayerId != null).Select(x => (object)new { kind = "pc", sessionId = x.Id, device = (s.Audio.Get(x.MicPlayerId!)?.Hello.Name ?? "PC") + " · " + x.MicName, state = x.Phase, label = x.Phase == "running" ? $"measuring {x.Step}/{x.Steps}" : x.Phase, bluetooth = x.MicBluetooth });
            return Results.Json(phones.Concat(pcs).ToList());
        }).Req(Role.View);

        // the short link from the QR code: certificate check first (http), which sends a trusting phone on to the secure page
        app.MapGet("/c/{token}", (string token, HttpContext c) =>
        {
            var now = DateTimeOffset.UtcNow; var l = Valid(token, now);
            c.Response.Headers.CacheControl = "no-store";
            if (l == null) return Results.Content(Expired, "text/html; charset=utf-8", null, 404);
            var host = PhoneHost(c, s); l.Opens++;
            // 0.2.5: no pairing code any more - the mic-only page needs no sign-in. With HTTPS: the certificate check first (it continues to the secure
            // mic page by itself once the phone trusts WavWiz); without HTTPS: the mic page explains that the microphone needs HTTPS.
            var q = $"cal={l.Token}";
            return Results.Redirect(s.Ca.Enabled ? $"http://{host}:{s.Cfg.HttpPort}/tls/check?{q}" : $"http://{host}:{s.Cfg.HttpPort}{MicPage}?{q}");
        }).Anon();
    }
    static string PhoneHost(HttpContext c, Services s) => PhoneApi.PhoneHost(c, s);
    const string Expired = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>WavWiz</title><body style='font-family:system-ui;background:#14171A;color:#E8EDF0;padding:24px'><h2>This link has expired</h2><p>Open Devices &gt; Calibrate speakers on the PC again and scan the new QR code.</p></body>";
}
