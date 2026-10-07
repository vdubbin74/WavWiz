using System.Net;
using WavWiz.Server.Media;
namespace WavWiz.Server.Api;

/// <summary>
/// 0.1.3 Diagnostics: receiver health (AirPlay / Spotify buffer, drop-outs, restarts), orphaned sessions (players that stopped talking, stream
/// subscribers with no player, receivers stuck "in session" with no audio) with "Restart AirPlay" and "Clear orphans", plus the network/bind helper.
/// </summary>
public static class HealthApi
{
    public sealed record Orphan(string Kind, string Id, string Name, string Detail);

    public static List<Orphan> Orphans(Services s)
    {
        var list = new List<Orphan>(); var now = DateTime.UtcNow;
        var sessions = s.Audio.Sessions;
        foreach (var p in sessions)
        {
            var since = p.StatusAt == DateTime.MinValue ? (now - p.ConnectedAt.UtcDateTime) : now - p.StatusAt;
            if (p.Dead) list.Add(new("player", p.Id, Name(p), "the connection is closed but it was never cleaned up"));
            else if (since.TotalSeconds > 30 && (now - p.ConnectedAt.UtcDateTime).TotalSeconds > 30) list.Add(new("player", p.Id, Name(p), $"no word from this player for {Ago(since)}"));
        }
        foreach (var sub in s.Conductor.Subscribers())
        {
            var live = s.Audio.Get(sub.Id);
            if (live == null || !ReferenceEquals(live, sub) || live.Dead) list.Add(new("stream", sub.Id, sub is Net.PlayerSession ps ? Name(ps) : sub.Id, "the house stream is still sending to a player that has gone"));
        }
        if (s.AirPlay is { StaleSession: true }) list.Add(new("airplay", "airplay", "AirPlay", "a phone's AirPlay session is still open but no audio for over a minute"));
        if (s.Conductor.StaleLiveKind() is { } k && !(k == "airplay" && s.AirPlay is { StaleSession: true })) list.Add(new("live", k, k == "airplay" ? "AirPlay" : "Spotify", "Now Playing still shows the phone, but it stopped sending over a minute ago"));
        return list;
    }

    private static string Name(Net.PlayerSession p) => p.Hello.Name is { Length: > 0 } n ? n : p.Hello.MachineName is { Length: > 0 } m ? m : p.Id;
    private static string Ago(TimeSpan t) => t.TotalMinutes >= 2 ? $"{(int)t.TotalMinutes} min" : $"{(int)t.TotalSeconds} s";

    public static int ClearOrphans(Services s)
    {
        int n = 0;
        foreach (var o in Orphans(s))
        {
            try
            {
                switch (o.Kind)
                {
                    case "player": if (s.Audio.Get(o.Id) is { } p) { p.EndReason = "cleared from Diagnostics (it had stopped responding)"; p.Close(); } s.Conductor.Unsubscribe(o.Id); n++; break;
                    case "stream": s.Conductor.Unsubscribe(o.Id); n++; break;
                    case "airplay": s.AirPlay?.EndStaleSession(); n++; break;
                    case "live": s.Conductor.EndLive(o.Id); n++; break;
                }
            }
            catch { /* keep going */ }
        }
        return n;
    }

    private static object Feed(LiveFeed? f) => f == null ? new { } : new { bufferedMs = f.BufferedMs, targetMs = f.TargetMs, underruns = f.Underruns, lastUnderrunAgoSec = f.LastUnderrunAgoMs / 1000, dataAgeSec = f.DataAgeMs / 1000, active = f.Active, reading = f.Reading };

    public static object ReceiversDto(Services s)
    {
        var orphans = Orphans(s);
        return new
        {
            airplay = new { enabled = s.Cfg.AirPlay, running = s.AirPlay?.Running ?? false, ready = s.AirPlay?.Ready ?? false, inSession = s.AirPlay?.InSession ?? false, restarts = s.AirPlay?.Restarts ?? 0, lastError = s.AirPlay?.LastError, feed = Feed(s.AirPlay?.Feed) },
            spotify = new { enabled = s.Spotify?.Enabled ?? false, running = s.Spotify?.Running ?? false, inSession = s.Spotify?.SessionActive ?? false, restarts = s.Spotify?.Restarts ?? 0, lastError = s.Spotify?.LastError, feed = Feed(s.Spotify?.Feed) },
            orphans,
        };
    }

    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/health/receivers", () => Results.Json(ReceiversDto(s))).Req(Role.View);
        g.MapPost("/health/airplay/restart", () =>
        {
            if (s.AirPlay == null || !s.Cfg.AirPlay) return Ext.Bad("AirPlay is switched off on this server.", 409);
            s.AirPlay.Restart(); _ = Task.Run(async () => { for (int i = 0; i < 20 && !s.AirPlay.Ready; i++) await Task.Delay(500); if (s.AirPlay.Ready) s.Discovery?.AnnounceSoon(); });
            return Results.Json(new { ok = true, message = "AirPlay restarted. It shows up on phones again within a few seconds." });
        }).Req(Role.Admin);
        g.MapPost("/health/orphans/clear", () => { int n = ClearOrphans(s); return Results.Json(new { ok = true, cleared = n, message = n == 0 ? "Nothing to clear." : $"Cleared {n}." }); }).Req(Role.Admin);

        g.MapGet("/network", (bool? fresh) => Results.Json(Net.NetworkHelper.Check(s.Cfg, fresh == true))).Req(Role.View);
        g.MapPost("/network/bind", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var addr = (b.Str("address") ?? "").Trim();
            var rep = Net.NetworkHelper.Check(s.Cfg, true);
            if (!IPAddress.TryParse(addr, out _) || !rep.Adapters.Any(a => a.Address == addr)) return Ext.Bad("That address does not belong to this PC's home network. Click Re-detect and pick one from the list.");
            if (!rep.CanRebind) return Ext.Bad("Changing the address from here only works on Windows. Edit bindAddress in server.json instead.", 409);
            var path = Net.NetworkHelper.SaveBind(s.Cfg, addr);
            bool svc = Microsoft.Extensions.Hosting.WindowsServices.WindowsServiceHelpers.IsWindowsService();
            if (svc) _ = Task.Run(async () => { await Task.Delay(1500); Environment.Exit(1); });     // the service's recovery setting starts it again after 5 s
            return Results.Json(new { ok = true, address = addr, path, restarting = svc, url = $"http://{addr}:{s.Cfg.HttpPort}/",
                message = svc ? $"Saved. WavWiz restarts now; open http://{addr}:{s.Cfg.HttpPort}/ in about 10 seconds." : "Saved. Restart WavWiz to use the new address." });
        }).Req(Role.Admin);
    }
}
