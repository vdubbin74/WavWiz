using System.Net;
namespace WavWiz.Server.Api;

/// <summary>0.5.0 AirPlay sender, admin-only developer endpoints. Stage 1: discovery (no connection to any speaker).</summary>
public static class AirPlaySenderApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/dev/airplay", () => { Ensure(s); return Results.Json(s.AirPlayBrowse!.Snapshot()); }).Req(Role.Admin);
        g.MapGet("/dev/airplay/outputs", () => Results.Json(Outs(s).Snapshot())).Req(Role.Admin);
        g.MapPost("/dev/airplay/connect", async (ConnectReq r) =>
        {
            Ensure(s);
            try
            {
                var o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, r.DelayMs ?? 0, r.Volume ?? 50);
                AirPlay.AirPlaySpeakers.Register(s, o, r.Endpoint);   // F170: only a successful connect becomes a Speaker (no orphan row on failure)
                var zid = s.Zones.Zones().FirstOrDefault(z => z.PlayerId == o.Sink.Id)?.Id;
                return Results.Json(new { ok = true, id = o.Sink.Id, kind = o.Kind, zoneId = zid });
            }
            catch (Exception e) { var pr = AirPlay.AirPlaySetup.Classify(e.Message, r.Key); return Results.Json(new { ok = false, error = e.Message, code = pr.Code, title = pr.Title, text = pr.Text, retry = pr.Retry }, statusCode: 409); }
        }).Req(Role.Admin);
        MapSetup(g, s);
        g.MapPost("/dev/airplay/disconnect", async (KeyReq r) =>
        {   // F170: Remove = forget the Speaker too (rows, zone membership, saved reconnect); RemovePlayer -> ZoneManager.ExternalRemoved disconnects
            var pid = AirPlay.AirPlayOutputs.PlayerId(r.Key); var had = Outs(s).IsConnected(r.Key);
            s.Zones.RemovePlayer(pid); await Outs(s).DisconnectAsync(r.Key);
            return Results.Json(new { ok = true, wasConnected = had });
        }).Req(Role.Admin);
        g.MapPost("/dev/airplay/volume", async (VolReq r) => Results.Json(new { ok = await Outs(s).SetVolumeAsync(r.Key, r.Volume) })).Req(Role.Admin);
        g.MapPost("/dev/airplay/delay", (DelayReq r) => Results.Json(new { ok = Outs(s).SetDelay(r.Key, r.DelayMs) })).Req(Role.Admin);
        g.MapGet("/airplay/settings", () => Results.Json(Settings(s))).Req(Role.Admin);
        g.MapPost("/airplay/settings", (SettingsReq r) =>
        {
            if (r.AirPlay2Experimental is bool e) s.Cfg.AirPlay2Experimental = e;
            if (r.AirPlay2Buffered is bool b) s.Cfg.AirPlay2Buffered = b;
            s.Cfg.Save(); var o = Outs(s); o.AirPlay2Enabled = s.Cfg.AirPlay2Experimental; o.PreferBuffered = s.Cfg.AirPlay2Buffered;
            return Results.Json(Settings(s));
        }).Req(Role.Admin);
        g.MapPost("/dev/airplay/query", () => { Ensure(s); var b = s.AirPlayBrowse!; b.QueryNow(); return Results.Json(new { ok = true, running = b.Running, status = b.Status, problem = b.Problem, lastError = b.LastError }); }).Req(Role.Admin);
    }

    // ---------------- 0.6.8-#14: Find / Test / Add to zone ----------------
    public sealed record SetupReq(string Key, string? Endpoint, long? GroupId, string? NewZone);
    static void MapSetup(RouteGroupBuilder g, Services s)
    {
        // Find: speakers the browser heard, minus this server's own receivers (still detected via wwid / IsSelf so they can never be added). Other WavWiz servers stay listed.
        g.MapGet("/airplay/setup/devices", () =>
        {
            Ensure(s); var b = s.AirPlayBrowse!; var local = AirPlay.AirPlaySetup.LocalAddresses(); var outs = Outs(s);
            var saved = SavedKeys(s);
            var ports = OwnRaopPorts(s);
            var list = b.State.Devices(DateTimeOffset.Now).Select(d =>
            {
                var wwid = Txt(d, AirPlay.AirPlaySetup.SelfTxtKey);
                bool self = AirPlay.AirPlaySetup.IsSelf(d.Name, d.Addresses, d.Host, local, wwid, s.ServerId, d.RaopPort, ports);
                string? block = self ? null : Block(d, s.Cfg.AirPlay2Experimental);
                return new
                {
                    id = d.Id, name = d.Name, address = AirPlay.AirPlaySetup.DisplayAddress(d.Addresses, d.Host), model = d.Model, manufacturer = d.Manufacturer, route = d.Route,
                    airplay2 = d.SupportsAirPlay2, password = d.PasswordRequired, pin = d.PinRequired, self, block = block?.Split('|')[1], blockCode = block?.Split('|')[0],
                    tv = IsTv(d), connected = outs.IsConnected(d.Id), added = saved.Contains(d.Id),
                };
            }).Where(x => !x.self).OrderBy(x => x.block != null).ThenBy(x => x.name, StringComparer.OrdinalIgnoreCase).ToList();
            // 0.6.9 #22b: status 'retrying' + lastError + retryInSec while the browse could not start / died and is being retried
            return Results.Json(new { running = b.Running, status = b.Status, problem = b.Problem, lastError = b.LastError, retryInSec = b.NextRetry is { } nr ? Math.Max(0, (int)Math.Ceiling((nr - DateTimeOffset.Now).TotalSeconds)) : (int?)null,
                airPlay2Experimental = s.Cfg.AirPlay2Experimental, devices = list });
        }).Req(Role.Admin);
        // Test: connect WITHOUT joining a group (nothing is saved), play the chime. The person then says whether they heard it.
        g.MapPost("/airplay/setup/test", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            try
            {
                var o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, 0, 50, default, subscribe: false);
                await Outs(s).TestToneAsync(r.Key);
                return Results.Json(new { ok = true, kind = o.Kind, name = o.Name });
            }
            catch (Exception e) { var pr = AirPlay.AirPlaySetup.Classify(e.Message, name); return Results.Json(new { ok = false, error = e.Message, code = pr.Code, title = pr.Title, text = pr.Text, retry = pr.Retry }, statusCode: 409); }
        }).Req(Role.Admin);
        // Add to zone: the tested speaker becomes a regular Speaker (F170 rows) and joins the picked zone, or a new one
        g.MapPost("/airplay/setup/add", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            AirPlay.AirPlayOutputs.Out o;
            try { o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, 0, 50, default, subscribe: false); }
            catch (Exception e) { var pr = AirPlay.AirPlaySetup.Classify(e.Message, name); return Results.Json(new { ok = false, error = e.Message, code = pr.Code, title = pr.Title, text = pr.Text, retry = pr.Retry }, statusCode: 409); }
            AirPlay.AirPlaySpeakers.Register(s, o, r.Endpoint);
            var zid = s.Zones.Zones().FirstOrDefault(z => z.PlayerId == o.Sink.Id)?.Id;
            string? err = null; long? gid = r.GroupId;
            if (zid is long id)
            {
                if (!string.IsNullOrWhiteSpace(r.NewZone)) { var (ng, e2) = s.Zones.CreateGroup(r.NewZone, new[] { id }); err = e2; gid = e2 == null ? ng : null; }
                else if (r.GroupId is long g0)
                {
                    var grp = s.Zones.Groups().FirstOrDefault(x => x.Id == g0);
                    err = grp == null ? "zone not found" : s.Zones.UpdateGroup(g0, null, grp.DeviceIds.Append(id).Distinct().ToList());
                }
            }
            await AirPlay.AirPlaySpeakers.Push(s, o.Sink.Id);   // card state -> sink (joins its group when the card is on)
            return Results.Json(new { ok = true, id = o.Sink.Id, kind = o.Kind, zoneId = zid, groupId = gid, warning = err });
        }).Req(Role.Admin);
        // Cancel: drops a test connection that was never added. Added speakers are never touched here.
        g.MapPost("/airplay/setup/cancel", async (SetupReq r) =>
        {
            if (SavedKeys(s).Contains(r.Key)) return Results.Json(new { ok = true, kept = true });
            return Results.Json(new { ok = await Outs(s).DisconnectAsync(r.Key) });
        }).Req(Role.Admin);
    }
    static string? Txt(WavWiz.Core.AirPlay.AirPlayDevice d, string key) =>
        d.RaopTxt.TryGetValue(key, out var a) && a.Length > 0 ? a : d.AirPlayTxt.TryGetValue(key, out var b) && b.Length > 0 ? b : null;
    static IReadOnlyCollection<int> OwnRaopPorts(Services s)
    {
        var p = new HashSet<int>();
        if (s.Cfg.AirPlayPort > 0) p.Add(s.Cfg.AirPlayPort);
        if (s.AirPlay is { Port: > 0 } a) p.Add(a.Port);
        if (s.ZoneRecv != null) foreach (var n in s.ZoneRecv.AirPlayPorts()) p.Add(n);
        return p;
    }
    static HashSet<string> SavedKeys(Services s)
    {
        try { return (System.Text.Json.JsonSerializer.Deserialize<List<AirPlay.AirPlaySpeakers.Saved>>(s.Db.Setting(AirPlay.AirPlaySpeakers.Key) ?? "[]") ?? new()).Select(x => x.Key).ToHashSet(); }
        catch { return new(); }
    }
    static string NameOf(Services s, string key) => s.AirPlayBrowse?.State.Devices(DateTimeOffset.Now).FirstOrDefault(d => d.Id == key)?.Name ?? key;
    /// <summary>TVs: Apple TV, or a TV maker's AirPlay 2 receiver (Samsung / LG / Sony / Vizio / Roku / Hisense / TCL / Philips / Panasonic) or the Video feature bit.</summary>
    public static bool IsTv(WavWiz.Core.AirPlay.AirPlayDevice d) =>
        System.Text.RegularExpressions.Regex.IsMatch((d.Model ?? "") + " " + (d.Manufacturer ?? ""), @"AppleTV|Samsung|LG|Sony|BRAVIA|Vizio|Roku|Hisense|TCL|Philips|Panasonic|TV", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
        || WavWiz.Core.AirPlay.AirPlayFeatures.Has(d.Features, WavWiz.Core.AirPlay.AirPlayFeatures.Video);
    /// <summary>"code|why" when a row cannot be added, else null. Only what WavWiz really implements is offered.</summary>
    public static string? Block(WavWiz.Core.AirPlay.AirPlayDevice d, bool ap2On)
    {
        var m = d.Model ?? "";
        if (m.StartsWith("AudioAccessory", StringComparison.OrdinalIgnoreCase) || m.StartsWith("AppleTV", StringComparison.OrdinalIgnoreCase)) return "auth|HomePod and Apple TV need a pairing WavWiz can't do yet.";
        if (d.PasswordRequired) return "auth|Needs an AirPlay password - not supported yet. Turn the password off on the device to add it.";
        if (d.PinRequired) return "auth|Shows a code to type - not supported yet. Turn off \"Require code\" in the device's AirPlay settings to add it.";
        var route = d.Route;
        if (route == "airplay2-ptp") { if (ap2On) return null; if (d.Raop && d.Encryption.Contains(0)) return null; return "transport|AirPlay 2 speaker: turn on AirPlay 2 speakers (experimental) in Settings > Network."; }
        if (route == "airplay2-ntp") return d.Raop && d.Encryption.Contains(0) ? null : "transport|This AirPlay 2 mode (NTP timing) isn't supported yet.";
        if (route is "raop" or "raop-rsa") return null;
        return route == "raop-mfi" ? "transport|Needs Apple MFi authentication - not supported." : "transport|Uses an AirPlay mode WavWiz can't send to (" + d.EncryptionNames + ").";
    }

    public sealed record ConnectReq(string Key, string? Endpoint, int? DelayMs, int? Volume);
    public sealed record SettingsReq(bool? AirPlay2Experimental, bool? AirPlay2Buffered);
    static object Settings(Services s) => new
    {
        airPlay2Experimental = s.Cfg.AirPlay2Experimental, airPlay2Buffered = s.Cfg.AirPlay2Buffered,
        ffmpeg = File.Exists(s.FfmpegPath) || s.FfmpegPath == "ffmpeg",
        firewall = WavWiz.Core.AirPlay.AirPlayQuirks.FirewallRules,
        quirks = WavWiz.Core.AirPlay.AirPlayQuirks.Table.Select(q => new { model = q.ModelPrefix, q.Label, q.Buffered, q.Verified, q.Note }),
    };
    public sealed record KeyReq(string Key);
    public sealed record VolReq(string Key, int Volume);
    public sealed record DelayReq(string Key, int DelayMs);

    public static AirPlay.AirPlayOutputs Outs(Services s)
    {
        lock (Gate) return s.AirPlayOut ??= new AirPlay.AirPlayOutputs(s.Registry, () => s.AirPlayBrowse, s.Log)   // 0.7.0 t1930: PTP / SETRATEANCHORTIME / metadata must reach wavwiz-server.log
            { AirPlay2Enabled = s.Cfg.AirPlay2Experimental, PreferBuffered = s.Cfg.AirPlay2Buffered, FfmpegPath = s.FfmpegPath,
              ArtFor = async (it, ct) => it.Kind == "track" && it.RefId is long tid && s.Library.Track(tid) is { } t ? await s.Art.GetAsync(t, 384, ct) : null };   // 0.6.8-#14e
    }

    static readonly object Gate = new();
    /// <summary>Starts the browser the first time an admin opens the dev card, so an idle server does no AirPlay browsing.</summary>
    public static void Ensure(Services s)
    {
        lock (Gate)
        {
            if (s.AirPlayBrowse != null) return;
            var b = new AirPlay.AirPlayBrowser(s.Log); s.AirPlayBrowse = b;   // 0.6.9 #22b: logs start / failures / retries / speakers seen
            var ip = IPAddress.TryParse(s.Cfg.BindAddress.Trim('[', ']'), out var p) ? p : IPAddress.Loopback;
            // 0.6.9 #22b: a wildcard bind browses on the real LAN address (the one WavWiz advertises), like DiscoveryHost's mDNS responder
            if (ip.Equals(IPAddress.Any)) ip = Net.NetworkHelper.AdvertiseAddress(ip);
            b.Start(ip);
        }
    }
}
