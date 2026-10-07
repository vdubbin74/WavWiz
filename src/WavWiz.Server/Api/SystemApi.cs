using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using WavWiz.Core;
namespace WavWiz.Server.Api;

public static class SystemApi
{
    private static readonly Dictionary<string, (double Min, double Max)> NumericSettings = new()
    {
        ["bt.defaultLatencyMs"] = (0, 1000), ["wired.defaultLatencyMs"] = (0, 1000), ["calibration.recheckDays"] = (1, 365), ["calibration.winLatencyChangeMs"] = (1, 500), ["library.rescanHours"] = (0, 168),
        ["airplay.levelDb"] = (0, 6), ["spotify.levelDb"] = (0, 6),
    };
    private static readonly HashSet<string> BoolSettings = new() { "tls.redirect", "ui.checklistDismissed", "spotify.enabled" };
    private static readonly HashSet<string> StringSettings = new() { "server.name", "acoustid.apiKey" };
    private static readonly Dictionary<string, string[]> ChoiceSettings = new() { ["playback.replayGain"] = Media.Loudness.Modes };     // 0.1.3

    public static object StatusDto(Services s) => new
    {
        appVersion = WavWizInfo.Version, channel = WavWizInfo.Channel, display = WavWizInfo.DisplayName, beta = true,
        uptimeSec = (long)(DateTime.UtcNow - s.Started).TotalSeconds, bind = s.Cfg.BindAddress,
        ports = new { http = s.Cfg.HttpPort, https = s.Cfg.HttpsPort, audio = s.Audio.Port, clock = s.Clock.Port },
        ffmpeg = new { ok = File.Exists(s.FfmpegPath) || s.FfmpegPath == "ffmpeg", path = s.FfmpegPath },
        tls = new { enabled = s.Ca.Enabled, rootSha256 = s.Ca.RootSha256, expires = s.Ca.ServerCertExpires },
        library = new { tracks = s.Library.TrackCount(), scanning = s.Scanning, progress = s.Library.Progress is { } p ? new { done = p.Done, total = p.Total, root = p.Root } : null },
        playersConnected = s.Audio.Sessions.Count, state = s.Conductor.State.ToString().ToLowerInvariant(),
        warnings = Warnings(s),
    };

    private static List<string> Warnings(Services s)
    {
        var w = new List<string>();
        if (!File.Exists(s.FfmpegPath) && s.FfmpegPath != "ffmpeg") w.Add("ffmpeg was not found - playback and library scanning will not work. Re-run the installer (Repair).");
        if (Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM library_root")) == 0) w.Add("No music folders yet - add one in Settings > Library.");
        if (s.Audio.Sessions.Count == 0) w.Add("No player is connected - start WavWiz Player on a PC with speakers.");
        if (!s.Ca.Enabled) w.Add("Phone calibration needs HTTPS - set up the local certificate in Settings > Phone & HTTPS.");
        return w;
    }

    public static void Map(RouteGroupBuilder g, WebApplication app, Services s)
    {
        g.MapGet("/status", () => Results.Json(StatusDto(s))).Req(Role.View);

        // ---- library ----
        g.MapGet("/library/roots", () => Results.Json(s.Library.Roots())).Req(Role.View);
        g.MapPost("/library/roots", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var path = (b.Str("path") ?? "").Trim();
            var nasErr = s.Nas?.EnsureFor(path, true);       // 0.1.3: connect a password-protected share first
            var problem = Library.LibraryService.RootProblem(path); if (problem != null && nasErr != null) problem = nasErr; if (problem != null) return Ext.Bad(problem);
            try { var id = s.Library.AddRoot(path); StartScan(s); return Results.Json(new { id }); }
            catch (Exception e) when (e is InvalidOperationException or Microsoft.Data.Sqlite.SqliteException) { return Ext.Bad(e.Message.Contains("UNIQUE") ? "That folder is already in the library." : e.Message, 409); }
        }).Req(Role.Admin);
        g.MapDelete("/library/roots/{id:long}", (long id) => { s.Library.RemoveRoot(id); s.Events.Publish("library"); return Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapPost("/library/rescan", () => { StartScan(s); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapGet("/library/status", () => Results.Json(new { scanning = s.Scanning, tracks = s.Library.TrackCount(), progress = s.Library.Progress is { } p ? new { done = p.Done, total = p.Total, root = p.Root } : null, last = s.LastScan })).Req(Role.View);
        g.MapGet("/library/tree", (string? node) => Results.Json(s.Library.Tree(node))).Req(Role.View);
        g.MapGet("/library/search", (string? q, int? limit) => Results.Json(s.Library.Search(q ?? "", limit ?? 50))).Req(Role.View);

        // ---- 0.1.3: logins for password-protected network shares (NAS) ----
        g.MapGet("/library/nas", () => Results.Json(new { available = s.Nas?.Available ?? false, shares = s.Nas?.List() ?? new() })).Req(Role.Admin);
        g.MapPost("/library/nas", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); if (s.Nas == null) return Ext.Bad("not available", 409);
            var err = s.Nas.Save(b.Str("share") ?? "", b.Str("user") ?? "", b.Str("password") ?? "");
            if (err != null) return Ext.Bad(err);
            s.Events.Publish("library"); return Results.Json(new { ok = true, message = "Connected and saved. You can add folders from this share now." });
        }).Req(Role.Admin);
        g.MapPost("/library/nas/remove", async (HttpContext c) => { var b = await c.Request.Body(); return Results.Json(new { ok = s.Nas?.Remove(b.Str("share") ?? "") ?? false }); }).Req(Role.Admin);
        g.MapPost("/library/nas/test", async (HttpContext c) => { var b = await c.Request.Body(); var err = s.Nas?.EnsureFor(b.Str("share") ?? "", true); return Results.Json(new { ok = err == null, error = err }); }).Req(Role.Admin);

        // ---- settings ----
        g.MapGet("/settings", () => Results.Json(s.Db.Query("SELECT key,value_json FROM setting WHERE key NOT LIKE 'admin.%' ORDER BY key", r => (K: r.GetString(0), V: r.GetString(1))).ToDictionary(x => x.K, x => JsonDocument.Parse(x.V).RootElement.Clone()))).Req(Role.View);
        g.MapPut("/settings", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); if (b.ValueKind != JsonValueKind.Object) return Ext.Bad("expected an object of settings");
            foreach (var p in b.EnumerateObject())
            {
                if (NumericSettings.TryGetValue(p.Name, out var rng)) { if (p.Value.ValueKind != JsonValueKind.Number || p.Value.GetDouble() < rng.Min || p.Value.GetDouble() > rng.Max) return Ext.Bad($"{p.Name} must be a number between {rng.Min} and {rng.Max}"); }
                else if (BoolSettings.Contains(p.Name)) { if (p.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Ext.Bad($"{p.Name} must be true or false"); }
                else if (ChoiceSettings.TryGetValue(p.Name, out var ch)) { if (p.Value.ValueKind != JsonValueKind.String || !ch.Contains(p.Value.GetString())) return Ext.Bad($"{p.Name} must be one of: {string.Join(", ", ch)}"); }
                else if (StringSettings.Contains(p.Name)) { var max = p.Name == "acoustid.apiKey" ? 80 : 60; if (p.Value.ValueKind != JsonValueKind.String || p.Value.GetString()!.Length > max) return Ext.Bad($"{p.Name} must be text up to {max} characters"); }
                else return Ext.Bad($"unknown setting {p.Name}");
            }
            foreach (var p in b.EnumerateObject()) s.Db.SetSetting(p.Name, p.Value.GetRawText());
            if (b.TryGetProperty("spotify.enabled", out _)) s.Spotify?.Apply();
            if (b.TryGetProperty("airplay.levelDb", out var apLv) && apLv.ValueKind == JsonValueKind.Number) s.AirPlay?.SetLevelDb(apLv.GetDouble());
            if (b.TryGetProperty("spotify.levelDb", out var spLv) && spLv.ValueKind == JsonValueKind.Number) s.Spotify?.SetLevelDb(spLv.GetDouble());
            s.Events.Publish("settings"); foreach (var z in s.Zones.Zones()) if (s.Audio.Get(z.PlayerId) is { } ps) s.Zones.PushZone(ps);
            return Results.Json(new { ok = true });
        }).Req(Role.Admin);

        // ---- 0.1.1: AirPlay / Spotify Connect ----
        g.MapGet("/receivers", () => Results.Json(ReceiversDto(s))).Req(Role.View);
        g.MapGet("/live/art/{kind}", (string kind) =>
        {
            var a = kind == "airplay" ? s.AirPlay?.Art : kind == "spotify" ? s.Spotify?.Art : null;
            return a is { } x ? Results.Bytes(x.Bytes, x.Type) : Results.NotFound();
        }).Req(Role.View);

        // ---- TLS ----
        g.MapPost("/tls/enable", async (HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (!IPAddress.TryParse(s.Cfg.BindAddress, out var ip) || IPAddress.IsLoopback(ip) && b.Bool("allowLoopback") != true)
                return Ext.Bad("Choose the PC's LAN address first (installer or server.json 'bindAddress'); a certificate for 127.0.0.1 is useless on a phone.", 409);
            try { s.Ca.Enable(ip, b.Bool("recreate") == true); } catch (Exception e) { return Ext.Bad("Could not create the certificate: " + e.Message, 500); }
            return Results.Json(new { ok = true, rootSha256 = s.Ca.RootSha256, setupUrl = $"http://{ip}:{s.Cfg.HttpPort}/tls/setup", note = "HTTPS uses the new certificate for new connections; restart the WavWiz service to apply it to the HTTPS port immediately." });
        }).Req(Role.Admin);

        PhoneApi.Map(app, s);

        app.MapGet("/tls/root-ca.crt", () => s.Ca.RootDer is { } d ? Results.File(d, "application/x-x509-ca-cert", "unison-root-ca.crt") : Results.NotFound()).Anon();
        app.MapGet("/tls/root-ca.mobileconfig", (HttpContext c) => s.Ca.Enabled ? Results.File(Encoding.UTF8.GetBytes(s.Ca.MobileConfig(PhoneApi.PhoneHost(c, s))), "application/x-apple-aspen-config", "unison-root-ca.mobileconfig") : Results.NotFound()).Anon();

        // ---- WebSocket: UI events ----
        app.Map("/ws", async (HttpContext c) =>
        {
            if (!c.WebSockets.IsWebSocketRequest) return Results.StatusCode(400);
            using var ws = await c.WebSockets.AcceptWebSocketAsync();
            var (id, reader) = s.Events.Subscribe();
            try
            {
                await Send(ws, JsonSerializer.Serialize(new { type = "hello", data = new { appVersion = WavWizInfo.Version, channel = WavWizInfo.Channel } }));
                var recv = Task.Run(async () => { var buf = new byte[1024]; try { while (ws.State == WebSocketState.Open) { var r = await ws.ReceiveAsync(buf, c.RequestAborted); if (r.MessageType == WebSocketMessageType.Close) break; } } catch { } });
                await foreach (var m in reader.ReadAllAsync(c.RequestAborted)) { await Send(ws, m); if (recv.IsCompleted) break; }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            finally { s.Events.Unsubscribe(id); }
            return Results.Empty;
        }).Req(Role.View);

        // ---- WebSocket: phone clock sync for calibration (NTP-style) ----
        app.Map("/ws/clock", async (HttpContext c) =>
        {
            if (!c.WebSockets.IsWebSocketRequest) return Results.StatusCode(400);
            using var ws = await c.WebSockets.AcceptWebSocketAsync(); var buf = new byte[512];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var r = await ws.ReceiveAsync(buf, c.RequestAborted); if (r.MessageType == WebSocketMessageType.Close) break;
                    long t1 = s.Conductor.Clock.NowUs;
                    using var d = JsonDocument.Parse(buf.AsMemory(0, r.Count)); var root = d.RootElement;
                    await Send(ws, JsonSerializer.Serialize(new { type = "clock.pong", seq = root.Long("seq") ?? 0, t0 = root.Num("t0") ?? 0, t1, t2 = s.Conductor.Clock.NowUs }));
                }
            }
            catch { }
            return Results.Empty;
        }).Req(Role.Control);
    }

    private static Task Send(WebSocket ws, string text) => ws.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

    internal static string QrSvg(string text)
    {
        using var gen = new QRCoder.QRCodeGenerator(); using var data = gen.CreateQrCode(text, QRCoder.QRCodeGenerator.ECCLevel.M);
        return new QRCoder.SvgQRCode(data).GetGraphic(4);
    }

    public static void StartScan(Services s)
    {
        if (s.Scanning) return; s.Scanning = true; s.Events.Publish("library");
        _ = Task.Run(() =>
        {
            try { s.Nas?.EnsureAll(); } catch { /* the scan reports unreachable folders */ }
            try { s.LastScan = s.Library.Scan(s.Stop.Token); }
            catch (Exception e) { s.LastScan = new Library.ScanResult(0, 0, 0, 0, 1, TimeSpan.Zero, new() { e.Message }); }
            finally { s.Scanning = false; s.Events.Publish("library"); }
        });
    }

    public static object ReceiversDto(Services s) => new
    {
        airplay = new { name = Receivers.AirPlayReceiver.Name, enabled = s.Cfg.AirPlay, installed = s.AirPlay?.Installed ?? false, running = s.AirPlay?.Running ?? false, ready = s.AirPlay?.Ready ?? false, port = s.Cfg.AirPlayPort, inSession = s.AirPlay?.InSession ?? false, title = s.AirPlay?.Title, lastSender = s.AirPlay?.LastSender, levelDb = s.AirPlay?.LevelDb ?? 0, lastError = s.AirPlay?.LastError, restarts = s.AirPlay?.Restarts ?? 0 },
        spotify = new { name = Receivers.SpotifyReceiver.Name, enabled = s.Spotify?.Enabled ?? false, installed = s.Spotify?.Installed ?? false, running = s.Spotify?.Running ?? false, port = s.Cfg.SpotifyPort, inSession = s.Spotify?.SessionActive ?? false, title = s.Spotify?.Title, user = s.Spotify?.User, levelDb = s.Spotify?.LevelDb ?? 0, zeroconfFallback = s.Spotify?.ZeroconfFallback ?? false, lastError = s.Spotify?.LastError, restarts = s.Spotify?.Restarts ?? 0 },
    };
}
