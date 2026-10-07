using System.Text.Json;
using WavWiz.Server.Features;
namespace WavWiz.Server.Api;

public static class FeaturesApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        // ---- B1/B2 speaker profiles + follow ----
        g.MapGet("/speakers/profiles", () => Results.Json(s.Speakers.Profiles())).Req(Role.View);
        g.MapPost("/speakers/profiles", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.Speakers.Upsert(b); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Control);
        g.MapDelete("/speakers/profiles/{id:long}", (long id) => { s.Speakers.Delete(id); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/speakers/profiles/capture", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var zid = b.Long("deviceId") ?? b.Long("zoneId"); if (zid == null) return Ext.Bad("deviceId required");
            var (id, err) = s.Speakers.CaptureFromDevice(zid.Value, b.Str("name"), b.Bool("follow") == true);
            return err != null ? Ext.Bad(err) : Results.Json(new { id });
        }).Req(Role.Control);

        // ---- B3 scenes ----
        g.MapGet("/scenes", () => Results.Json(s.Scenes.List())).Req(Role.View);
        g.MapPost("/scenes", async (HttpContext c) =>
        {
            var b = await c.Request.Body();
            var members = ParseMembers(b);
            var (id, err) = s.Scenes.Create(b.Str("name"), b.Str("icon"), members);
            return err != null ? Ext.Bad(err) : Results.Json(new { id });
        }).Req(Role.Control);
        g.MapPost("/scenes/capture", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.Scenes.Capture(b.Str("name"), b.Long("id")); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Control);
        g.MapPut("/scenes/{id:long}", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.Scenes.Update(id, b.Str("name"), b.Str("icon"), ParseMembers(b)); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapDelete("/scenes/{id:long}", (long id) => { s.Scenes.Delete(id); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/scenes/{id:long}/apply", (long id) => { var err = s.Scenes.Apply(id); return err != null ? Ext.Bad(err, 404) : Results.Json(new { ok = true }); }).Req(Role.Control);

        // ---- B4 schedules ----
        g.MapGet("/schedules", () => Results.Json(s.Schedules.List())).Req(Role.View);
        g.MapPost("/schedules", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.Schedules.Create(b); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Control);
        g.MapPut("/schedules/{id:long}", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.Schedules.Update(id, b); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapDelete("/schedules/{id:long}", (long id) => { s.Schedules.Delete(id); return Results.Json(new { ok = true }); }).Req(Role.Control);

        // ---- B6 radio finder ----
        g.MapGet("/radio/finder/search", async (string? name, string? tag, string? country, int? limit) =>
        {
            try { return Results.Json(await s.RadioFinder.SearchAsync(name, tag, country, limit ?? 40)); }
            catch (Exception e) { return Ext.Bad(e.Message, 502); }
        }).Req(Role.View);
        g.MapGet("/radio/finder/countries", async () => { try { return Results.Json(await s.RadioFinder.CountriesAsync()); } catch (Exception e) { return Ext.Bad(e.Message, 502); } }).Req(Role.View);
        g.MapGet("/radio/finder/tags", async (int? limit) => { try { return Results.Json(await s.RadioFinder.TagsAsync(limit ?? 80)); } catch (Exception e) { return Ext.Bad(e.Message, 502); } }).Req(Role.View);
        g.MapGet("/radio/finder/favorites", () => Results.Json(s.RadioFinder.Favorites())).Req(Role.View);
        g.MapPost("/radio/finder/favorites", async (HttpContext c) => { var b = await c.Request.Body(); var err = s.RadioFinder.AddFavorite(b); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapDelete("/radio/finder/favorites/{uuid}", (string uuid) => { s.RadioFinder.RemoveFavorite(uuid); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/radio/finder/save", async (HttpContext c) => { var b = await c.Request.Body(); return Results.Json(new { id = s.RadioFinder.SaveToLibrary(b) }); }).Req(Role.Control);
        g.MapGet("/podcasts", () => Results.Json(s.RadioFinder.Podcasts())).Req(Role.View);
        g.MapPost("/podcasts", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = await s.RadioFinder.AddPodcastAsync(b.Str("url")); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Control);
        g.MapDelete("/podcasts/{id:long}", (long id) => { s.RadioFinder.RemovePodcast(id); return Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapGet("/podcasts/{id:long}/episodes", async (long id, int? limit) =>
        {
            try { var r = await s.RadioFinder.PodcastEpisodesAsync(id, limit ?? 30); return r == null ? Ext.Bad("not found", 404) : Results.Json(r); }
            catch (Exception e) { return Ext.Bad(e.Message, 502); }
        }).Req(Role.View);

        // ---- B7 remote / Tailscale ----
        g.MapGet("/remote", () => Results.Json(RemoteAccess.Status(s.Cfg, s.Db))).Req(Role.View);
        g.MapPut("/remote", async (HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (b.Bool("preferTailscale") is bool p) s.Db.SetSetting("remote.preferTailscale", JsonSerializer.Serialize(p));
            return Results.Json(RemoteAccess.Status(s.Cfg, s.Db));
        }).Req(Role.Admin);

        // ---- B8 CD ripper ----
        g.MapGet("/rip/drives", () => Results.Json(s.CdRip.Drives())).Req(Role.View);
        g.MapGet("/rip/formats", () => Results.Json(s.CdRip.Formats())).Req(Role.View);
        g.MapGet("/rip/jobs", () => Results.Json(s.CdRip.Jobs())).Req(Role.View);
        g.MapPost("/rip/start", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.CdRip.Start(b); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Admin);

        // ---- B9 tag / cover auto-fill ----
        g.MapGet("/tags/status", () => Results.Json(s.TagFix.Status())).Req(Role.View);
        g.MapGet("/tags/jobs", () => Results.Json(s.TagFix.Jobs())).Req(Role.Control);
        g.MapGet("/tags/jobs/{id:long}", (long id) => { var j = s.TagFix.Job(id); return j == null ? Ext.Bad("not found", 404) : Results.Json(j); }).Req(Role.Control);
        g.MapPost("/tags/scan", async (HttpContext c) =>
        {
            var b = await c.Request.Body();
            try { return Results.Json(await s.TagFix.ScanAsync((int)(b.Long("limit") ?? 40), b.Bool("writeFiles") == true)); }
            catch (Exception e) { return Ext.Bad(e.Message, 502); }
        }).Req(Role.Control);
        g.MapPost("/tags/jobs/{id:long}/approvals", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.TagFix.SetApprovals(id, b); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/tags/jobs/{id:long}/apply", (long id) => { var err = s.TagFix.Apply(id); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/tags/jobs/{id:long}/undo", (long id) => { var err = s.TagFix.Undo(id); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Control);
    }

    private static List<(long, double, bool)>? ParseMembers(JsonElement b)
    {
        if (b.Prop("members") is not JsonElement arr || arr.ValueKind != JsonValueKind.Array) return null;
        var list = new List<(long, double, bool)>();
        foreach (var e in arr.EnumerateArray())
        {
            var id = e.Long("deviceId") ?? e.Long("id"); if (id == null) continue;
            list.Add((id.Value, e.Num("volume") ?? 60, e.Bool("enabled") != false));
        }
        return list;
    }
}
