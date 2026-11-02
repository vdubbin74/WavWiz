using WavWiz.Server.Library;
namespace WavWiz.Server.Api;

/// <summary>0.5.x F164: Settings > Library > Remote libraries (Subsonic / OpenSubsonic, Navidrome first) and the Library "Remote" browse.</summary>
public static class RemoteLibraryApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        IResult Err(Exception e) => Ext.Bad(e.Message, e is SubsonicService.SubsonicError { Code: < 0 } ? 502 : 400);
        async Task<IResult> Do(Func<SubsonicService, Task<object>> f) { if (s.Remote == null) return Ext.Bad("not available", 409); try { return Results.Json(await f(s.Remote)); } catch (Exception e) { return Err(e); } }

        // settings (admin)
        g.MapGet("/remote/servers", () => Results.Json(new { available = s.Remote?.Available ?? false, servers = s.Remote?.List() ?? new() })).Req(Role.View);
        g.MapPost("/remote/servers", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); if (s.Remote == null) return Ext.Bad("not available", 409);
            var err = await s.Remote.Save(b.Str("url") ?? "", b.Str("user") ?? "", b.Str("password") ?? "", b.Str("label"), b.Str("id"));
            if (err == null) s.Events.Publish("library");
            return err == null ? Results.Json(new { ok = true, message = "Connected and saved." }) : Ext.Bad(err);
        }).Req(Role.Admin);
        g.MapPost("/remote/servers/remove", async (HttpContext c) => { var b = await c.Request.Body(); var ok = s.Remote?.Remove(b.Str("id") ?? "") ?? false; if (ok) s.Events.Publish("library"); return Results.Json(new { ok }); }).Req(Role.Admin);
        g.MapPost("/remote/servers/test", async (HttpContext c) => { var b = await c.Request.Body(); if (s.Remote == null) return Ext.Bad("not available", 409); var err = await s.Remote.Test(b.Str("id") ?? ""); return Results.Json(new { ok = err == null, error = err }); }).Req(Role.Admin);

        // browse (view)
        g.MapGet("/remote/{sid}/artists", (string sid) => Do(r => r.Artists(sid))).Req(Role.View);
        g.MapGet("/remote/{sid}/artist/{id}", (string sid, string id) => Do(r => r.ArtistAlbums(sid, id))).Req(Role.View);
        g.MapGet("/remote/{sid}/albums", (string sid, string? type, int? size, int? offset) => Do(r => r.Albums(sid, type ?? "alphabeticalByName", size ?? 200, offset ?? 0))).Req(Role.View);
        g.MapGet("/remote/{sid}/album/{id}", (string sid, string id) => Do(r => r.Album(sid, id))).Req(Role.View);
        g.MapGet("/remote/{sid}/search", (string sid, string q) => Do(r => r.Search(sid, q ?? ""))).Req(Role.View);
        g.MapGet("/remote/{sid}/art/{id}", async (string sid, string id, int? size, HttpContext c) =>
            s.Remote == null ? Results.NotFound() : LibraryApi.Send(c, await s.Remote.Cover(sid, id, size ?? 384, c.RequestAborted), 60)).Req(Role.View);
    }
}
