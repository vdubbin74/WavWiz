using System.Text.Json;
namespace WavWiz.Server.Api;

/// <summary>0.3.0 §1 Jukebox (beta) and §2 Remote mode endpoints.</summary>
public static class JukeboxApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        var jb = s.Jukebox;
        g.MapGet("/jukebox/config", () => Results.Json(jb.CfgDto())).Req(Role.View);
        g.MapPut("/jukebox/config", async (HttpContext c) => { var b = await c.Request.Body(); if (b.ValueKind != JsonValueKind.Object) return Ext.Bad("expected an object"); var err = jb.Update(b); return err != null ? Ext.Bad(err) : Results.Json(jb.CfgDto()); }).Req(Role.Admin);
        g.MapGet("/jukebox", () => Results.Json(jb.State())).Req(Role.View);
        g.MapPost("/jukebox/start", async (HttpContext c) => { var b = await c.Request.Body(); var code = jb.Start(b.ValueKind == JsonValueKind.Object && b.TryGetProperty("theme", out var th) ? th : null); return Results.Json(new { ok = true, code }); }).Req(Role.Admin);
        // leaving the kiosk: admin, or the host PIN typed on the locked screen
        g.MapPost("/jukebox/stop", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var who = c.Items["auth"] as AuthInfo;
            if (who?.Role != Role.Admin && !jb.CheckPin(b.Str("pin"))) return Ext.Bad("That PIN isn't right.", 403);
            jb.Stop(); return Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapPost("/jukebox/unlock", async (HttpContext c) => { var b = await c.Request.Body(); return jb.CheckPin(b.Str("pin")) ? Results.Json(new { ok = true }) : Ext.Bad("That PIN isn't right.", 403); }).Req(Role.Control);
        g.MapPost("/jukebox/lock", async (HttpContext c) => { var b = await c.Request.Body(); jb.SetLocked(b.Bool("locked") ?? true); return Results.Json(jb.State()); }).Req(Role.Control);
        g.MapPost("/jukebox/ban", async (HttpContext c) => { var b = await c.Request.Body(); var gId = b.Str("guest"); if (string.IsNullOrEmpty(gId)) return Ext.Bad("guest missing"); jb.Ban(gId); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapGet("/jukebox/board", () => Results.Json(jb.Board(true))).Req(Role.View);
        // join QR for the big screen: the guest page with this session's code
        g.MapGet("/jukebox/qr.svg", (HttpContext c) => { c.Response.Headers.CacheControl = "no-store"; return jb.Running ? Results.Content(SystemApi.QrSvg(JoinUrl(c)), "image/svg+xml") : Results.NotFound(); }).Req(Role.View);
        g.MapGet("/jukebox/join", (HttpContext c) => jb.Running ? Results.Json(new { url = JoinUrl(c) }) : Results.NotFound()).Req(Role.View);
        string JoinUrl(HttpContext c) => $"http://{PhoneApi.PhoneHost(c, s)}:{s.Cfg.HttpPort}/jukebox.html?j={jb.Code}";

        // ---- guests: no sign-in, the session code only ----
        IResult Guard(HttpContext c, Func<IResult> f) => jb.Guest(c) ? f() : Results.Json(new { error = "This Jukebox link has ended. Scan the QR code on the big screen again." }, statusCode: 403);
        g.MapGet("/jukebox/guest/board", (HttpContext c) => Guard(c, () => Results.Json(jb.Board()))).Anon();
        g.MapGet("/jukebox/guest/search", (HttpContext c, string? q) => Guard(c, () => Results.Json(jb.Search(q ?? "")))).Anon();
        g.MapGet("/jukebox/guest/artist", (HttpContext c, string name) => Guard(c, () => Results.Json(jb.ArtistSongs(name)))).Anon();
        g.MapGet("/jukebox/guest/album", (HttpContext c, string artist, string album) => Guard(c, () => Results.Json(jb.AlbumSongs(artist, album)))).Anon();
        // cover art for guests: only songs from the allowed music
        g.MapGet("/jukebox/guest/art/{id:long}", async (long id, int? size, HttpContext c) => jb.Guest(c) && jb.IsAllowed(id) ? await LibraryApi.Cover(c, s, s.Library.Track(id), size) : Results.NotFound()).Anon();
        g.MapPost("/jukebox/guest/add", async (HttpContext c) =>
        {
            if (!jb.Guest(c)) return Results.Json(new { error = "This Jukebox link has ended. Scan the QR code on the big screen again." }, statusCode: 403);
            var b = await c.Request.Body(); var gid = (b.Str("guest") ?? "").Trim(); var id = b.Long("trackId");
            if (gid.Length is < 8 or > 64 || id == null) return Ext.Bad("Something went wrong. Reload the page.");
            var err = jb.Add(gid, b.Str("name") ?? "", id.Value); return err != null ? Results.Json(new { error = err }, statusCode: 409) : Results.Json(new { ok = true });
        }).Anon();
        g.MapPost("/jukebox/guest/vote", async (HttpContext c) =>
        {
            if (!jb.Guest(c)) return Results.Json(new { error = "This Jukebox link has ended." }, statusCode: 403);
            var b = await c.Request.Body(); var gid = (b.Str("guest") ?? "").Trim(); if (gid.Length is < 8 or > 64) return Ext.Bad("Something went wrong. Reload the page.");
            var (v, n, sk, err) = jb.Vote(gid); return err != null ? Results.Json(new { error = err }, statusCode: 409) : Results.Json(new { votes = v, needed = n, skipped = sk });
        }).Anon();

        // ---- §2 remote mode: this device controls playback but plays nothing and is not a speaker card ----
        g.MapPut("/zones/{id:long}/remote", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var on = b.Bool("remote") ?? true;
            var set = RemoteZones(s); if (on) set.Add(id); else set.Remove(id);
            s.Db.SetSetting("remote.zones", JsonSerializer.Serialize(set.OrderBy(x => x)));
            s.Zones.Patch(id, null, null, null, !on);
            s.Events.Publish("zones"); return Results.Json(new { ok = true, remote = on });
        }).Req(Role.Control);
    }
    public static HashSet<long> RemoteZones(Services s) { try { var j = s.Db.Setting("remote.zones"); return j == null ? new() : JsonSerializer.Deserialize<HashSet<long>>(j) ?? new(); } catch { return new(); } }
}
