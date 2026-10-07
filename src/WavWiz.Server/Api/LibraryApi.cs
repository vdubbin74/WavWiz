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
        g.MapGet("/art/radio/{id:long}", async (long id, int? size, HttpContext c) =>
        {
            var logo = s.Db.Scalar("SELECT logo_url FROM radio_station WHERE id=$i", ("$i", id)) as string;
            byte[]? jpg = await s.Art.GetRemoteAsync(logo, size ?? 192, c.RequestAborted);
            c.Response.Headers.CacheControl = jpg == null ? "private, max-age=300" : "private, max-age=86400";
            return jpg == null ? Results.StatusCode(204) : Results.File(jpg, "image/jpeg");
        }).Req(Role.View);
    }

    private static async Task<IResult> Cover(HttpContext c, Services s, Library.TrackRow? t, int? size)
    {
        byte[]? jpg = t == null ? null : await s.Art.GetAsync(t, size ?? 192, c.RequestAborted);
        c.Response.Headers.CacheControl = jpg == null ? "private, max-age=300" : "private, max-age=604800";
        return jpg == null ? Results.StatusCode(204) : Results.File(jpg, "image/jpeg");   // 204 = no cover: not an error, so browsers do not log one for every song without art
    }
}
