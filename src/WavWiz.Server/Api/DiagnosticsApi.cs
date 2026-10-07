using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using WavWiz.Core;
namespace WavWiz.Server.Api;

public sealed record DiagCheck(string Id, string Title, string Status, string Detail, string? Fix);

/// <summary>
/// Diagnostics (0.0.2): every check says ok / warn / fail / unknown and, when it is not ok, what to do about it in plain English.
/// "unknown" is used when a check could not run (for example the firewall query on a non-Windows host); it is never reported as ok.
/// </summary>
public static class DiagnosticsApi
{
    public const string FirewallRule = "WavWiz Server (web, audio, clock)";

    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/diagnostics", async () => Results.Json(await Run(s))).Req(Role.Control);
        g.MapGet("/checklist", () => Results.Json(Checklist(s))).Req(Role.View);
    }

    public static object Checklist(Services s)
    {
        int roots = Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM library_root WHERE enabled=1"));
        int tracks = s.Library.TrackCount();
        int players = Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM player WHERE revoked=0 AND token_hash IS NOT NULL AND id NOT LIKE 'web-%'"));
        int cals = Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM calibration WHERE is_current=1"));
        bool dismissed = s.Db.Setting("ui.checklistDismissed") == "true";
        var items = new List<object>
        {
            new { id = "server", title = "WavWiz server is running", done = true, detail = $"Version {WavWizInfo.Version}, listening on {s.Cfg.BindAddress}.", action = (string?)null, required = true },
            new { id = "library", title = "Add your music folder", done = roots > 0 && tracks > 0, detail = roots == 0 ? "No folder yet. Open Settings > Library and add the folder that holds your music." : tracks == 0 ? (s.Scanning ? "Scanning now - this can take a few minutes the first time." : "The folder has no songs WavWiz can read yet. Run a rescan in Settings > Library.") : $"{tracks:N0} songs found.", action = "settings:library", required = true },
            new { id = "player", title = "Connect your first player (a PC with speakers)", done = players > 0, detail = players > 0 ? $"{players} player(s) paired." : "On the PC with the speakers, open WavWiz Player and type the 6-digit code from Settings > Players. WavWiz finds the server by itself.", action = "settings:players", required = true },
            new { id = "calibrate", title = "Calibrate your first speaker", done = cals > 0, detail = cals > 0 ? "At least one speaker has a measured delay." : "Open Devices, pick a speaker and choose Calibrate. Until then the delay is shown as unknown, never zero.", action = "zones", required = true },
            new { id = "phone", title = "Set up your phone (optional)", done = s.Ca.Enabled, detail = s.Ca.Enabled ? "HTTPS is on. Use the QR code in Settings > Phone & HTTPS to trust it on the phone." : "Needed to calibrate with the phone microphone and to use the phone as a device.", action = "settings:phone", required = false },
        };
        var req = items.Cast<dynamic>().Where(i => i.required).ToList();
        return new { items, done = req.All(i => (bool)i.done), dismissed, remaining = req.Count(i => !(bool)i.done) };
    }

    public static async Task<object> Run(Services s)
    {
        var checks = new List<DiagCheck>();
        checks.Add(new("server", "WavWiz server", "ok", $"Version {WavWizInfo.Version}, up {FormatSpan(DateTime.UtcNow - s.Started)}.", null));

        // --- address ---
        bool bindOk = IPAddress.TryParse(s.Cfg.BindAddress, out var bind);
        if (!bindOk) checks.Add(new("address", "Network address", "fail", $"'{s.Cfg.BindAddress}' is not a valid address.", "Open server.json and set bindAddress to this PC's home-network address, then restart the WavWiz service."));
        else if (IPAddress.IsLoopback(bind!)) checks.Add(new("address", "Network address", "warn", "WavWiz only listens on this PC (127.0.0.1). Other PCs and phones cannot reach it.", "Set bindAddress in server.json to this PC's home-network address (for example 192.168.1.10) and restart the WavWiz service, or run the installer's repair."));
        else if (!AuthService.IsPrivateSource(bind, s.Cfg.ExtraAllowedSubnets)) checks.Add(new("address", "Network address", "warn", $"{bind} is not a home-network (private) address.", "WavWiz only accepts local-network traffic. Check that the PC is on your home router."));
        else checks.Add(new("address", "Network address", "ok", $"Listening on {bind} (home network only).", null));

        // --- ports (TCP self-connect, UDP bound) ---
        if (bindOk)
        {
            foreach (var (id, name, port) in new[] { ("http", "Web page (HTTP)", s.Cfg.HttpPort), ("https", "Secure web page (HTTPS)", s.Cfg.HttpsPort), ("audio", "Audio port", s.Audio.Port) })
            {
                if (port == 0) continue;
                var ok = await TcpOpen(bind!, port == 0 ? 0 : port);
                checks.Add(new($"port-{id}", name, ok ? "ok" : "fail", ok ? $"TCP {port} accepts connections on this PC." : $"TCP {port} did not answer on this PC.", ok ? null : "Another program may be using the port. Restart the WavWiz service; if it persists, change the port in server.json."));
            }
            checks.Add(new("port-clock", "Clock port", s.Clock.Port > 0 ? "ok" : "fail", s.Clock.Port > 0 ? $"UDP {s.Clock.Port} is open for time sync." : "The clock port could not be opened.", s.Clock.Port > 0 ? null : "Restart the WavWiz service. Without the clock, speakers cannot stay in sync."));
        }
        checks.Add(s.Discovery is { UdpPort: > 0 } d
            ? new DiagCheck("discovery", "Automatic finding of the server", d.Problem == null ? "ok" : "warn", d.Problem == null ? $"UDP {d.UdpPort} answers 'where is WavWiz?'; mDNS (Bonjour) is {(d.MdnsActive ? "on" : "off")}." : d.Problem, d.Problem == null ? null : "Players can still connect if you type the PC's address once.")
            : new DiagCheck("discovery", "Automatic finding of the server", s.Cfg.Discovery ? "warn" : "ok", s.Cfg.Discovery ? "Discovery could not start." : "Switched off in server.json (discovery: false).", s.Cfg.Discovery ? "Players can still connect if you type the PC's address once." : null));

        // --- 0.1.1: AirPlay / Spotify Connect receivers ---
        if (s.AirPlay is { } ap)
            checks.Add(!s.Cfg.AirPlay ? new DiagCheck("airplay", "AirPlay speaker", "ok", "Switched off in server.json (airPlay: false).", null)
                : !ap.Installed ? new DiagCheck("airplay", "AirPlay speaker", "warn", "The AirPlay receiver is not installed.", "Run the WavWiz installer again.")
                : ap.Running && ap.Ready ? new DiagCheck("airplay", "AirPlay speaker", "ok", $"\"{Receivers.AirPlayReceiver.Name}\" is listening on TCP {s.Cfg.AirPlayPort}{(ap.InSession ? " and is playing from a phone or Mac" + (ap.Title != null ? $" ({ap.Title})" : "") : "")}; mDNS (Bonjour) is {(s.Discovery?.MdnsActive == true ? "on" : "off")}.", s.Discovery?.MdnsActive == true ? null : "Without mDNS iPhones cannot see the speaker; check that UDP 5353 is allowed on the private network.")
                : new DiagCheck("airplay", "AirPlay speaker", "fail", "The AirPlay receiver is not running" + (ap.LastError != null ? $" ({ap.LastError})" : "") + ".", $"Another program may be using TCP {s.Cfg.AirPlayPort}. Restart the WavWiz service."));
        if (s.Spotify is { } sp)
            checks.Add(!sp.Enabled ? new DiagCheck("spotify", "Spotify Connect", "ok", "Off (optional add-on; turn it on in Settings > Network).", null)
                : !sp.Installed ? new DiagCheck("spotify", "Spotify Connect", "warn", "librespot is not installed.", "Run the WavWiz installer again.")
                : sp.Running ? new DiagCheck("spotify", "Spotify Connect", "ok", $"\"{Receivers.SpotifyReceiver.Name}\" is available in the Spotify app on this network (zeroconf TCP {s.Cfg.SpotifyPort}{(sp.ZeroconfFallback ? ", advertised by WavWiz" : "")}){(sp.SessionActive ? "; playing" + (sp.Title != null ? $" {sp.Title}" : "") : "")}. Requires Spotify Premium.", null)
                : new DiagCheck("spotify", "Spotify Connect", "fail", "librespot is not running" + (sp.LastError != null ? $" ({sp.LastError})" : "") + ".", "Turn Spotify Connect off and on again, or restart the WavWiz service."));

        // --- firewall (Windows only, best effort) ---
        checks.Add(await Firewall());

        // --- certificate ---
        if (!s.Ca.Enabled) checks.Add(new("tls", "HTTPS certificate", "unknown", "HTTPS is not set up. That is fine for music; phones need it for the microphone (calibration) and for the phone-as-a-device page.", "Settings > Phone & HTTPS > Set up HTTPS."));
        else
        {
            var exp = s.Ca.ServerCertExpires; var days = exp == null ? (double?)null : (exp.Value - DateTimeOffset.UtcNow).TotalDays;
            checks.Add(new("tls", "HTTPS certificate", days is null ? "warn" : days < 0 ? "fail" : days < 30 ? "warn" : "ok",
                days is null ? "The server certificate could not be read." : days < 0 ? "The server certificate has expired." : $"Valid for another {days:0} days (renews itself).",
                days is null or < 30 ? "Settings > Phone & HTTPS > Set up HTTPS again (this keeps the phone's trusted profile)." : null));
            checks.Add(new("tls-phone", "Phone trusts the certificate", "unknown", "WavWiz cannot see this from the PC.", "On the phone open the set-up page (QR code in Settings > Phone & HTTPS) and tap 'Check my phone'."));
        }

        // --- ffmpeg ---
        var ff = File.Exists(s.FfmpegPath) || s.FfmpegPath == "ffmpeg";
        checks.Add(new("ffmpeg", "Audio decoder (ffmpeg)", ff ? "ok" : "fail", ff ? s.FfmpegPath : "ffmpeg was not found.", ff ? null : "Re-run the WavWiz installer (it includes ffmpeg), or set ffmpegPath in server.json."));

        // --- library ---
        int tracks = s.Library.TrackCount(); int roots = Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM library_root WHERE enabled=1"));
        var lastErr = s.Db.Query("SELECT path,last_error FROM library_root WHERE last_error IS NOT NULL AND last_error<>''", r => r.GetString(0) + ": " + r.GetString(1));
        checks.Add(new("library", "Music library", roots == 0 ? "warn" : lastErr.Count > 0 ? "warn" : tracks == 0 ? "warn" : "ok",
            roots == 0 ? "No music folder added." : lastErr.Count > 0 ? string.Join("; ", lastErr.Take(3)) : $"{tracks:N0} songs in {roots} folder(s).",
            roots == 0 ? "Settings > Library > Add folder." : lastErr.Count > 0 ? "The WavWiz service runs as a limited account (LocalService). Network shares need permission for that account - save the share's login under Settings > Library > Network share logins (NAS)." : tracks == 0 ? "Run a rescan." : null));

        // --- 0.1.3 network / bind address ---
        try
        {
            var nr = Net.NetworkHelper.Check(s.Cfg);
            var mine = nr.Adapters.FirstOrDefault(a => a.IsBind);
            checks.Add(new("network", "Network address", nr.Status, nr.Problems.Count > 0 ? string.Join(" ", nr.Problems) : $"Listening on {nr.Bind}" + (mine != null ? $" ({mine.Kind}, {(mine.Profile == "Unknown" ? "network type not reported" : mine.Profile + " network")})." : "."),
                nr.Fixes.Count > 0 ? string.Join(" ", nr.Fixes) + " (See Network below.)" : null));
        }
        catch (Exception e) { checks.Add(new("network", "Network address", "unknown", "Could not read the network adapters: " + e.Message, null)); }

        // --- devices ---
        var zones = s.Zones.Zones(); var devices = new List<object>();
        foreach (var z in zones)
        {
            var ev = s.Zones.Rooms.Events(z.PlayerId).Take(12).Select(e => new { at = e.At.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"), kind = e.Kind, text = e.Text }).ToList();
            var st = z.Room;
            devices.Add(new { zoneId = z.Id, name = z.Name, playerId = z.PlayerId, isWeb = z.IsWeb, state = st?.State ?? "offline", text = st?.Text, detail = st?.Detail, link = z.Link, remoteIp = z.RemoteIp, drops = st?.Drops ?? 0, reconnects = st?.Reconnects ?? 0, underrunEvents = st?.UnderrunEvents ?? 0, syncErrorMs = z.SyncErrorMs, bufferMs = z.BufferMs, events = ev });
            if (z.Link is "wifi" && !z.IsWeb && (st?.Drops ?? 0) > 0)
                checks.Add(new($"device-{z.Id}", $"Device: {z.Name}", "warn", $"Connected over Wi-Fi and has dropped {st!.Drops} time(s) since the server started.", "Wi-Fi is the usual cause of dropouts. Plug this PC into the router with a network cable, or move it closer to the access point; WavWiz keeps a larger buffer on Wi-Fi to ride out short gaps."));
            else if (st is { State: "dropped" or "reconnecting" or "offline" } && z.Enabled)
                checks.Add(new($"device-{z.Id}", $"Device: {z.Name}", st.State == "offline" ? "warn" : "fail", st.Text ?? st.State, "Check that the PC is on and WavWiz Player is running (tray icon). WavWiz reconnects by itself as soon as the network is back."));
            else if (z.Link != null) checks.Add(new($"device-{z.Id}", $"Device: {z.Name}", "ok", $"{st?.Text ?? "Connected"} ({z.Link}).", null));
        }
        // --- clock/sync ---
        var syncs = zones.Where(z => z.Connected && z.SyncErrorMs.HasValue).ToList();
        if (syncs.Count == 0) checks.Add(new("sync", "Speaker sync", "unknown", "No player has reported its sync error yet (nothing playing, or no player connected).", null));
        else
        {
            var worst = syncs.OrderByDescending(z => Math.Abs(z.SyncErrorMs!.Value)).First();
            var w = Math.Abs(worst.SyncErrorMs!.Value);
            checks.Add(new("sync", "Speaker sync", w < 2 ? "ok" : w < 10 ? "warn" : "fail", $"Largest error: {w:0.0} ms ({worst.Name}).", w < 2 ? null : "Let the music play for a minute, then re-check. If it stays high, that PC's network may be unstable."));
        }
        return new
        {
            generatedAt = DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss zzz"), version = WavWizInfo.Version, channel = WavWizInfo.Channel, os = System.Runtime.InteropServices.RuntimeInformation.OSDescription, checks, devices,
            worst = checks.Any(c => c.Status == "fail") ? "fail" : checks.Any(c => c.Status == "warn") ? "warn" : "ok",
        };
    }

    private static async Task<bool> TcpOpen(IPAddress ip, int port)
    {
        try { using var c = new TcpClient(); using var cts = new CancellationTokenSource(1500); await c.ConnectAsync(ip, port, cts.Token); return true; } catch { return false; }
    }

    private static async Task<DiagCheck> Firewall()
    {
        if (!OperatingSystem.IsWindows()) return new("firewall", "Windows Firewall", "unknown", "Not a Windows PC, so the firewall was not checked.", null);
        try
        {
            var prof = await Netsh("advfirewall show currentprofile");
            if (prof == null) return new("firewall", "Windows Firewall", "unknown", "Could not ask Windows about the firewall (no permission or netsh not available).", "Open Windows Security > Firewall & network protection and make sure your home network is 'Private'.");
            string? name = prof.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Contains("Profile Settings", StringComparison.OrdinalIgnoreCase));
            var rule = await Netsh($"advfirewall firewall show rule name=\"{FirewallRule}\"");
            bool ruleOk = rule != null && rule.Contains("Enabled", StringComparison.OrdinalIgnoreCase) && !rule.Contains("No rules match", StringComparison.OrdinalIgnoreCase);
            bool isPublic = name != null && name.StartsWith("Public", StringComparison.OrdinalIgnoreCase);
            if (!ruleOk) return new("firewall", "Windows Firewall", "fail", "WavWiz's firewall rule was not found.", "Run the WavWiz installer again (it adds a rule for the home network only), or in Windows Defender Firewall allow wavwiz-server.exe on Private networks.");
            if (isPublic) return new("firewall", "Windows Firewall", "fail", "Windows thinks this network is 'Public'. WavWiz's rule only applies to Private networks, so other PCs cannot connect.", "Settings > Network & internet > Wi-Fi (or Ethernet) > your network > set Network profile type to Private.");
            return new("firewall", "Windows Firewall", "ok", $"Rule present; active profile: {name?.Replace(" Settings:", "") ?? "unknown"}.", null);
        }
        catch (Exception e) { return new("firewall", "Windows Firewall", "unknown", "The firewall check failed: " + e.Message, null); }
    }

    private static async Task<string?> Netsh(string args)
    {
        try
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "netsh.exe"), args) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!; using var cts = new CancellationTokenSource(5000);
            var o = await p.StandardOutput.ReadToEndAsync(cts.Token); await p.WaitForExitAsync(cts.Token);
            return o;
        }
        catch { return null; }
    }

    private static string FormatSpan(TimeSpan t) => t.TotalDays >= 1 ? $"{t.TotalDays:0.#} days" : t.TotalHours >= 1 ? $"{t.TotalHours:0.#} hours" : $"{t.TotalMinutes:0} minutes";
}
