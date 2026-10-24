using System.Text.Json;
namespace WavWiz.Server.Api;

/// <summary>Tag-based library browsing, search, cleanup and album covers (0.0.2).</summary>
public static class LibraryApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        var L = s.Library;
        g.MapGet("/library/artists", (string? q) => Results.Json(L.Artists(q))).Req(Role.View);
        g.MapGet("/library/albums", (string? artist, string? genre, int? year, string? q, string? sort, int? limit, int? offset) => Results.Json(L.Albums(artist, genre, year, q, sort ?? "artist", limit ?? 3000, offset ?? 0))).Req(Role.View);
        g.MapGet("/library/genres", () => Results.Json(L.Genres())).Req(Role.View);
        // 0.2.0 item 14: favorites (hearts) on the server. Anyone can see them; hearting needs Control (same as playlists).
        g.MapGet("/favorites", () => Results.Json(L.Favorites().Select(f => new { kind = f.Kind, @ref = f.Ref }))).Req(Role.View);
        g.MapGet("/favorites/items", () => { var (t, a) = L.FavoriteItems(); return Results.Json(new { tracks = t, albums = a }); }).Req(Role.View);
        g.MapPut("/favorites", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = L.SetFavorite(b.Str("kind"), b.Str("ref"), b.Bool("on") ?? true);
            if (err != null) return Ext.Bad(err);
            s.Events.Publish("favorites");
            return Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapGet("/library/years", () => Results.Json(L.Years())).Req(Role.View);
        g.MapGet("/library/recent", (int? limit) => Results.Json(L.Albums(sort: "recent", limit: Math.Clamp(limit ?? 60, 1, 500)))).Req(Role.View);
        g.MapGet("/library/tracks", (string? artist, string? album, string? genre, int? year) => Results.Json(L.Tracks(artist, album, genre, year))).Req(Role.View);
        g.MapGet("/library/folders", (string? path) => Results.Json(L.Folders(path))).Req(Role.View);
        g.MapGet("/library/find", (string? q) => { var r = L.Find(q ?? ""); return Results.Json(new { tracks = r.Tracks, albums = r.Albums, artists = r.Artists }); }).Req(Role.View);

        g.MapGet("/library/cleanup", () => Results.Json(L.Cleanup())).Req(Role.Control);
        g.MapGet("/library/aliases", () => Results.Json(L.Aliases().Select(a => new { from = a.Key, to = a.Value }))).Req(Role.Control);
        g.MapPost("/library/aliases", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = L.AddAlias(b.Str("from") ?? "", b.Str("to") ?? "");
            if (err == null) s.Events.Publish("library"); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Admin);
        g.MapPost("/library/aliases/remove", async (HttpContext c) => { var b = await c.Request.Body(); L.RemoveAlias(b.Str("from") ?? ""); s.Events.Publish("library"); return Results.Json(new { ok = true }); }).Req(Role.Admin);

        // ---- covers ----
        g.MapGet("/art/track/{id:long}", async (long id, int? size, HttpContext c) =>
        {
            var t = L.Track(id); return await Cover(c, s, t, size);
        }).Req(Role.View);
        g.MapGet("/art/album", async (string artist, string album, int? size, HttpContext c) => await Cover(c, s, L.FirstTrackOfAlbum(artist, album), size)).Req(Role.View);
        // 0.2.1 F13: artist photo (online, cached) - 204 means "none yet": the UI draws a generated portrait
        g.MapGet("/art/artist", async (string name, int? size, HttpContext c) =>
        {
            byte[]? jpg = await s.Art.ArtistAsync(name, size ?? 384, c.RequestAborted);
            return Send(c, jpg, 120);
        }).Req(Role.View);
        // 0.2.2 T4e: Settings > Library "Online art" status (found / not found / pending) and "Retry missing photos"
        g.MapGet("/library/online-art", () => Results.Json(s.Art.Online?.Status())).Req(Role.View);
        g.MapPost("/library/online-art/retry", () =>
        {
            var oa = s.Art.Online; if (oa == null || !oa.Enabled) return Ext.Bad("Online art is off (Settings > Library).");
            var n = oa.RetryMissing(L.Artists().Select(a => a.Name)); s.Events.Publish("art", new { kind = "retry" });
            return Results.Json(new { ok = true, queued = n });
        }).Req(Role.Admin);
        // 0.4.4 F24: Settings > Library "Rebuild album art" (admin): clears the cover cache and rebuilds it; browsers get new picture URLs
        g.MapPost("/library/art/rebuild", () =>
        {
            var removed = s.Art.Rebuild(); s.Events.Publish("art", new { kind = "rebuild", cv = Library.ArtService.UrlVersion });
            return Results.Json(new { ok = true, removed, artCv = Library.ArtService.UrlVersion });
        }).Req(Role.Admin);
        g.MapGet("/library/art/rebuild", () => Results.Json(new { rebuilding = s.Art.Rebuilding, artCv = Library.ArtService.UrlVersion })).Req(Role.View);
        g.MapGet("/art/radio/{id:long}", async (long id, int? size, HttpContext c) =>
        {
            var logo = s.Db.Scalar("SELECT logo_url FROM radio_station WHERE id=$i", ("$i", id)) as string;
            byte[]? jpg = await s.Art.GetRemoteAsync(logo, size ?? 192, c.RequestAborted);
            return Send(c, jpg, 300);
        }).Req(Role.View);
    }

    /// <summary>0.3.2 F10: pictures carry an ETag (content hash + art version). With the versioned URL (&amp;cv=) they may be cached for a week;
    /// without it (old pages, kiosk) the browser must revalidate (no-cache), so a stale picture from an older build is never shown.</summary>
    public static IResult Send(HttpContext c, byte[]? jpg, int noneSec)
    {
        if (jpg == null) { c.Response.Headers.CacheControl = $"private, max-age={noneSec}"; return Results.StatusCode(204); }
        var tag = "\"" + Library.ArtService.UrlVersion + "-" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(jpg))[..16] + "\"";
        c.Response.Headers.ETag = tag;
        c.Response.Headers.CacheControl = c.Request.Query["cv"] == Library.ArtService.UrlVersion ? "private, max-age=604800" : "private, no-cache";
        if (c.Request.Headers.IfNoneMatch.ToString() == tag) return Results.StatusCode(304);
        return Results.File(jpg, "image/jpeg");
    }

    internal static async Task<IResult> Cover(HttpContext c, Services s, Library.TrackRow? t, int? size)
    {
        byte[]? jpg = t == null ? null : await s.Art.GetAsync(t, size ?? 192, c.RequestAborted);
        return Send(c, jpg, 120);   // 204 = no cover: not an error, so browsers do not log one for every song without art
    }
}
