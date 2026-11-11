using System.Net;
using WavWiz.Server.Cast;
namespace WavWiz.Server.Api;

/// <summary>0.7.0 F169: Google Cast speakers - the Find / Test / Add to zone card (admin), the dev snapshot, and the device-facing live stream.</summary>
public static class CastApi
{
    public sealed record SetupReq(string Key, string? Endpoint, long? GroupId, string? NewZone);
    public sealed record Problem(string Code, string Title, string Text, bool Retry);
    /// <summary>0.7.0 item 5b: a Cast device added by IP address. Key = the mDNS id when discovery already knows that address, else "ip-…".</summary>
    public sealed record Manual(string Key, string Endpoint, string Name, string Address, int Port);
    public sealed record ByIpReq(string? Address, int? Port, string? Name);
    public const int CastPort = 8009;
    const string IpHelp = "Enter the device's IP address, for example 192.168.1.40. Your router's list of connected devices shows it (Google Home app: the device's settings > Device information).";

    /// <summary>Validates what was typed on the card. Accepts "192.168.1.40", "192.168.1.40:8009", "fe80::1" or "[fe80::1]:8009"; no host names
    /// (a Cast device without mDNS has no name to look up). Returns the error text, or null with <paramref name="m"/> set. Pure apart from the
    /// optional lookup of an already-discovered device at that address.</summary>
    public static string? ParseManual(string? address, int? port, string? name, out Manual? m, Func<IPAddress, (string Id, string Name)?>? known = null)
    {
        m = null; var a = (address ?? "").Trim();
        if (a.Length == 0) return IpHelp;
        IPAddress? ip; int p = port ?? CastPort;
        bool withPort = a.StartsWith('[') || a.Count(c => c == ':') == 1;            // "1.2.3.4:8009" / "[fe80::1]:8009"; a bare IPv6 has 2+ colons
        if (withPort && IPEndPoint.TryParse(a, out var ep)) { ip = ep.Address; if (ep.Port > 0) p = ep.Port; }
        else if (!withPort && IPAddress.TryParse(a, out var ip0)) ip = ip0;
        else ip = null;
        // IPAddress also takes legacy short forms ("192.168.1" = 192.168.0.1, "3232235777"); a typo must not dial a different device
        if (ip?.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !System.Text.RegularExpressions.Regex.IsMatch(withPort ? a[..a.LastIndexOf(':')] : a, @"^\d{1,3}(\.\d{1,3}){3}$")) ip = null;
        if (ip == null) return "\"" + (a.Length > 60 ? a[..60] + "…" : a) + "\" is not an IP address. " + IpHelp;
        if (p < 1 || p > 65535) return "The port must be between 1 and 65535 (Cast devices use 8009).";
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast) || ip.Equals(IPAddress.None) || ip.IsIPv6Multicast
            || (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && ip.GetAddressBytes()[0] >= 224))
            return $"{ip} can't be a Cast device. " + IpHelp;
        var hit = known?.Invoke(ip);
        var nm = (name ?? "").Trim(); if (nm.Length > 40) nm = nm[..40];
        var key = hit?.Id ?? "ip-" + ip.ToString().Replace(':', '-').Replace('%', '-') + (p == CastPort ? "" : "-" + p);
        if (nm.Length == 0) nm = hit?.Name ?? $"Cast device ({ip})";
        m = new Manual(key, new IPEndPoint(ip, p).ToString(), nm, ip.ToString(), p);
        return null;
    }

    /// <summary>Failed Test / Add -> words for the card (discovery / denied / transport / other), the AirPlay card's four classes.</summary>
    public static Problem Classify(string? message, string name)
    {
        var m = message ?? "";
        bool Has(string re) => System.Text.RegularExpressions.Regex.IsMatch(m, re, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (Has(@"LAUNCH_ERROR|launch refused|app did not start|NOT_ALLOWED|denied"))
            return new("denied", "The device said no", $"{name} would not start the Cast media player. Make sure it isn't in a guest-only or restricted mode, then press Retry.", true);
        if (Has(@"LOAD_FAILED|LOAD failed|LOAD_CANCELLED|MEDIA_SRC|no media status"))
            return new("transport", "It couldn't play WavWiz's stream", $"{name} answered but could not fetch or play the audio from this PC. Check that the PC firewall allows WavWiz on the private network (port {{http}}) and that the device and this PC are on the same network, then press Retry.", true);
        if (Has(@"not found|search again|no address|refused|timed? ?out|timeout|no reply|unreachable|no route|network is|connection (reset|closed)|actively|host|ssl|tls|authentication"))
            return new("discovery", "Couldn't reach it", $"WavWiz couldn't reach {name}. Check it is switched on and on the same network as this PC, then press Retry.", true);
        return new("other", "Couldn't connect", $"Couldn't connect to {name} ({(m.Length > 120 ? m[..120] + "…" : m)}).", true);
    }

    static IResult Fail(Exception e, string name, Services s)
    {
        var p = Classify(e.Message, name);
        return Results.Json(new { ok = false, error = e.Message, code = p.Code, title = p.Title, text = p.Text.Replace("{http}", s.Cfg.HttpPort.ToString()), retry = p.Retry }, statusCode: 409);
    }

    public static void Map(RouteGroupBuilder g, Services s)
    {
        // The Cast device pulls the live WAV here. No sign-in (a Cast receiver can't send one): the 128-bit token in the path is the key, and only while
        // the device is connected. LAN-only like everything else (spec 13), never redirected to https (/api/ is excluded from RedirectPolicy).
        g.MapMethods("/cast/stream/{file}", new[] { "GET", "HEAD" }, async (HttpContext c, string file) =>
        {
            var token = file.EndsWith(".wav", StringComparison.OrdinalIgnoreCase) ? file[..^4] : file;
            var sink = s.CastOut?.SinkFor(token);
            if (sink == null) { c.Response.StatusCode = 404; return; }
            c.Response.ContentType = "audio/wav"; c.Response.Headers.CacheControl = "no-store"; c.Response.Headers["Accept-Ranges"] = "none";
            c.Response.Headers.AccessControlAllowOrigin = "*";
            if (HttpMethods.IsHead(c.Request.Method)) return;
            var r = sink.Attach();
            try { await foreach (var b in r.ReadAllAsync(c.RequestAborted)) await c.Response.Body.WriteAsync(b, c.RequestAborted); }
            catch (OperationCanceledException) { } catch (IOException) { }
            finally { sink.Detach(r); }
        }).Anon();

        g.MapGet("/dev/cast/outputs", () => Results.Json(Outs(s).Snapshot())).Req(Role.Admin);
        g.MapPost("/cast/setup/query", () => { Ensure(s); s.CastBrowse!.QueryNow(); return Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapGet("/cast/setup/devices", () =>
        {
            Ensure(s); var b = s.CastBrowse!; var outs = Outs(s); var saved = CastSpeakers.Load(s).Select(x => x.Key).ToHashSet();
            var list = b.State.Devices(DateTimeOffset.Now).Select(d => new
            {
                id = d.Id, name = d.Name, address = d.Addresses.FirstOrDefault(), port = d.Port, model = d.Model, kind = d.Kind, group = d.IsGroup, tv = d.IsTv,
                status = string.IsNullOrWhiteSpace(d.Status) ? null : d.Status, connected = outs.IsConnected(d.Id), added = saved.Contains(d.Id),
            }).OrderBy(x => x.group).ThenBy(x => x.name, StringComparer.OrdinalIgnoreCase).ToList();
            // 0.7.0 item 5b: devices typed in by IP that discovery doesn't list (after them, in the order added)
            var seen = list.Select(x => x.id).ToHashSet();
            var manual = s.CastManual.Values.Where(m => !seen.Contains(m.Key)).Select(m => new
            {
                id = m.Key, name = m.Name, address = m.Address, port = m.Port, model = "Added by IP address", kind = "speaker", group = false, tv = false, status = (string?)null,
                connected = outs.IsConnected(m.Key), added = saved.Contains(m.Key), manual = true,
            }).ToList();
            return Results.Json(new { running = b.Running, problem = b.Problem, devices = list.Cast<object>().Concat(manual) });
        }).Req(Role.Admin);
        // 0.7.0 item 5b: "Add by IP address" for a device discovery can't see (another subnet / VLAN, mDNS blocked by the router). Only records it:
        // the card then offers the usual Play test sound, which is the real connection test (one connection, the classified error words).
        g.MapPost("/cast/setup/byip", (ByIpReq r) =>
        {
            Ensure(s);
            var err = ParseManual(r.Address, r.Port, r.Name, out var m, ip =>
            {
                var d = s.CastBrowse!.State.Devices(DateTimeOffset.Now).FirstOrDefault(x => x.Addresses.Any(a => IPAddress.TryParse(a, out var y) && y.Equals(ip)));
                return d == null ? null : (d.Id, d.Name);
            });
            if (err != null) return Results.Json(new { ok = false, error = err, code = "input", title = "Check the address", text = err, retry = false }, statusCode: 400);
            s.CastManual[m!.Key] = m;
            s.Log?.Invoke($"cast {m.Key}: added by IP {m.Endpoint} ({m.Name})");
            return Results.Json(new { ok = true, id = m.Key, name = m.Name, endpoint = m.Endpoint });
        }).Req(Role.Admin);
        g.MapPost("/cast/setup/test", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            try
            {
                var o = await Outs(s).ConnectAsync(r.Key, EndpointOf(s, r), 0, 50, default, subscribe: false, displayName: name);
                await Outs(s).TestToneAsync(r.Key);
                return Results.Json(new { ok = true, kind = o.Kind, name = o.Name });
            }
            catch (Exception e) { return Fail(e, name, s); }
        }).Req(Role.Admin);
        g.MapPost("/cast/setup/add", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            CastOutputs.Out o;
            var ep = EndpointOf(s, r);
            try { o = await Outs(s).ConnectAsync(r.Key, ep, 0, 50, default, subscribe: false, displayName: name); }
            catch (Exception e) { return Fail(e, name, s); }
            CastSpeakers.Register(s, o, ep);   // 0.7.0 item 5b: an added-by-IP device is remembered with its address (reconnects without mDNS)
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
            await CastSpeakers.Push(s, o.Sink.Id);
            return Results.Json(new { ok = true, id = o.Sink.Id, kind = o.Kind, zoneId = zid, groupId = gid, warning = err });
        }).Req(Role.Admin);
        g.MapPost("/cast/setup/cancel", async (SetupReq r) =>
        {
            if (CastSpeakers.Load(s).Any(x => x.Key == r.Key)) return Results.Json(new { ok = true, kept = true });
            return Results.Json(new { ok = await Outs(s).DisconnectAsync(r.Key) });
        }).Req(Role.Admin);
        g.MapPost("/cast/forget", async (SetupReq r) =>
        {
            var pid = CastOutputs.PlayerId(r.Key); var had = Outs(s).IsConnected(r.Key);
            s.Zones.RemovePlayer(pid); await Outs(s).DisconnectAsync(r.Key);
            return Results.Json(new { ok = true, wasConnected = had });
        }).Req(Role.Admin);
    }

    static string NameOf(Services s, string key) => s.CastBrowse?.State.Devices(DateTimeOffset.Now).FirstOrDefault(d => d.Id == key)?.Name
        ?? (s.CastManual.TryGetValue(key, out var m) ? m.Name : null) ?? key;
    /// <summary>The address to dial: the one sent, else an added-by-IP entry's (discovery wins when it lists the device itself).</summary>
    static string? EndpointOf(Services s, SetupReq r) => r.Endpoint
        ?? (s.CastManual.TryGetValue(r.Key, out var m) && s.CastBrowse?.State.Devices(DateTimeOffset.Now).Any(d => d.Id == r.Key) != true ? m.Endpoint : null);

    static readonly object Gate = new();
    public static CastOutputs Outs(Services s)
    {
        lock (Gate)
        {
            if (s.CastOut != null) return s.CastOut;
            var o = new CastOutputs(s.Registry, () => s.CastBrowse, s.Log) { HttpPort = () => s.Cfg.HttpPort, BindAddress = () => s.Cfg.BindAddress };
            o.Dropped = (k, _) => { if (CastSpeakers.Load(s).Any(x => x.Key == k)) CastSpeakers.Reconnect(s, s.Log, new() { k }); };
            return s.CastOut = o;
        }
    }

    /// <summary>Starts the browser the first time an admin opens the Cast card (or a remembered device reconnects).</summary>
    public static void Ensure(Services s)
    {
        lock (Gate)
        {
            if (s.CastBrowse != null) return;
            var b = new CastBrowser(s.Log); s.CastBrowse = b;
            b.Start(IPAddress.TryParse(s.Cfg.BindAddress.Trim('[', ']'), out var ip) ? ip : IPAddress.Loopback);
        }
    }
}
