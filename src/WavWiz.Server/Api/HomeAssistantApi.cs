using WavWiz.Server.Playback;
using WavWiz.Server.Media;
namespace WavWiz.Server.Api;

/// <summary>
/// F165: a small, stable control surface for Home Assistant (and any script). One "player" = Master (the house group, master volume)
/// plus one per zone ("g:&lt;zone id&gt;"). Auth is the normal Bearer token (a Control token named "Home Assistant", revoke it in
/// Settings > Paired devices &amp; tokens). It only wraps existing calls, so the app and HA always agree. No announce/duck (parked).
/// Docs: docs/HOME-ASSISTANT.md.
/// </summary>
public static class HomeAssistantApi
{
    public const int ApiVersion = 1;

    private static object? Track(QueueItem? q) => q == null ? null : new
    {
        title = q.Title, artist = q.Artist, album = q.Album, kind = q.Kind, durationMs = q.DurationMs,
        artUrl = q.ArtUrl is { Length: > 0 } a ? a : q.Kind == "track" && q.RefId is long t ? $"/api/v1/art/track/{t}?size=512" : q.Kind == "radio" && q.RefId is long r ? $"/api/v1/art/radio/{r}?size=512" : null,
    };

    private static object Player(Services s, string id, string name, Conductor cd, double volume, bool muted, bool available)
    {
        var now = cd.Now(); var q = cd.Queue();
        var peek = q.Skip(Math.Max(0, now.Index + 1)).Take(5).Select(x => new { title = x.Title, artist = x.Artist });
        return new
        {
            id, name, available,
            state = now.State,                                  // playing | paused | stopped | idle (Conductor states, unchanged)
            volume = Math.Round(volume, 1), muted,              // volume 0-100
            positionMs = now.PositionMs, durationMs = now.DurationMs,
            liveTitle = now.LiveTitle, shuffle = now.Shuffle, repeat = now.Repeat,
            track = Track(now.Item),
            queue = new { count = q.Count, index = now.Index, next = peek },
        };
    }

    private static List<(string Id, object P)> Players(Services s)
    {
        var res = new List<(string, object)>();
        var zs = s.Zones.Zones(); var on = zs.Where(z => z.Enabled).ToList();
        res.Add(("master", Player(s, "master", "WavWiz", s.Conductor, s.Zones.MasterLevel(), on.Count > 0 && on.All(z => z.Muted), true)));
        foreach (var g in s.Zones.Groups())
        {
            var gid = s.Links?.ResolveZone("g:" + g.Id, false); var cd = s.Registry.Get(gid) ?? s.Conductor;
            res.Add(("g:" + g.Id, Player(s, "g:" + g.Id, g.Name, cd, g.Volume, g.Muted, g.Online > 0)));
        }
        return res;
    }

    private static object? Find(Services s, string id) => Players(s).FirstOrDefault(p => p.Id == id).P;

    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/ha", () => Results.Json(new { api = ApiVersion, server = s.Db.Setting("server.name")?.Trim('"') ?? Environment.MachineName, version = WavWiz.Core.WavWizInfo.Version })).Req(Role.View);
        g.MapGet("/ha/players", () => Results.Json(new { players = Players(s).Select(p => p.P) })).Req(Role.View);
        g.MapGet("/ha/players/{id}", (string id) => Find(s, id) is { } p ? Results.Json(p) : Ext.Bad("no such player", 404)).Req(Role.View);

        // POST /ha/players/{id}/{play|pause|stop|next|prev|volume|mute}; volume {"volume":0-100}, mute {"muted":true|false}
        g.MapPost("/ha/players/{id}/{cmd}", async (string id, string cmd, HttpContext c) =>
        {
            var b = await c.Request.Body();
            bool master = id == "master"; long zid = 0;
            if (!master && !(id.StartsWith("g:") && long.TryParse(id.AsSpan(2), out zid) && s.Zones.Groups().Any(x => x.Id == zid))) return Ext.Bad("no such player", 404);
            Conductor Cd(bool forPlay) => master ? s.Conductor : s.Registry.Get(s.Links?.ResolveZone(id, forPlay)) ?? s.Conductor;
            switch (cmd)
            {
                case "play": { var cd = Cd(true); if (cd.Now().State == "paused") cd.Resume(); else if (cd.Queue().Count > 0) cd.Jump(Math.Max(0, cd.Now().Index)); PlaybackApi.MarkFirstSound(s); break; }
                case "pause": Cd(false).Pause(); break;
                case "stop": Cd(false).Stop(); break;
                case "next": { var cd = Cd(false); s.Keep.FillForSkip(cd); cd.Next(); break; }   // 0.6.8-#3
                case "prev": case "previous": Cd(false).Prev(); break;
                case "volume":
                    {
                        var v = b.Num("volume"); if (v == null || !double.IsFinite(v.Value)) return Ext.Bad("volume (0-100) is required");
                        if (master) s.Zones.Master(null, null, Math.Clamp(v.Value, 0, 100));
                        else { var (_, err) = s.Zones.GroupVolume(zid, Math.Clamp(v.Value, 0, 100)); if (err != null) return Ext.Bad(err); }
                        break;
                    }
                case "mute":
                    {
                        var m = b.Bool("muted") ?? true;
                        if (master) s.Zones.MuteAll(m); else if (s.Zones.GroupMute(zid, m) is { } err) return Ext.Bad(err);
                        break;
                    }
                default: return Ext.Bad("unknown command (play, pause, stop, next, prev, volume, mute)", 404);
            }
            s.Events.Publish("zones");
            return Find(s, id) is { } p ? Results.Json(p) : Results.Json(new { ok = true });
        }).Req(Role.Control);

        // One click in Settings: a Control token named "Home Assistant" (shown once; revoke from the token list).
        g.MapPost("/tokens/home-assistant", () => Results.Json(new { token = s.Auth.CreateToken("Home Assistant", Role.Control), note = "Copy it now. It cannot be shown again. Paste it into Home Assistant (WavWiz integration or rest_command)." })).Req(Role.Admin);
    }
}
