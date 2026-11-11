using System.Net;
using WavWiz.Server.Cast;
namespace WavWiz.Server.Api;

/// <summary>0.7.0 F169: Google Cast speakers - the Find / Test / Add to zone card (admin), the dev snapshot, and the device-facing live stream.</summary>
public static class CastApi
{
    public sealed record SetupReq(string Key, string? Endpoint, long? GroupId, string? NewZone);
    public sealed record Problem(string Code, string Title, string Text, bool Retry);

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
            return Results.Json(new { running = b.Running, problem = b.Problem, devices = list });
        }).Req(Role.Admin);
        g.MapPost("/cast/setup/test", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            try
            {
                var o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, 0, 50, default, subscribe: false);
                await Outs(s).TestToneAsync(r.Key);
                return Results.Json(new { ok = true, kind = o.Kind, name = o.Name });
            }
            catch (Exception e) { return Fail(e, name, s); }
        }).Req(Role.Admin);
        g.MapPost("/cast/setup/add", async (SetupReq r) =>
        {
            Ensure(s); var name = NameOf(s, r.Key);
            CastOutputs.Out o;
            try { o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, 0, 50, default, subscribe: false); }
            catch (Exception e) { return Fail(e, name, s); }
            CastSpeakers.Register(s, o, r.Endpoint);
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

    static string NameOf(Services s, string key) => s.CastBrowse?.State.Devices(DateTimeOffset.Now).FirstOrDefault(d => d.Id == key)?.Name ?? key;

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
