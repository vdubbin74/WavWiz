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
        }).Req(Role.Admin);
        g.MapPost("/scenes/capture", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.Scenes.Capture(b.Str("name"), b.Long("id")); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Admin);
        g.MapPut("/scenes/{id:long}", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.Scenes.Update(id, b.Str("name"), b.Str("icon"), ParseMembers(b)); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapDelete("/scenes/{id:long}", (long id, bool? force) =>
        {   // 0.3.0: a scene used by schedules is not deleted silently (409 + their names) unless forced
            var users = s.Schedules.UsingScene(id);
            if (users.Count > 0 && force != true) return Results.Json(new { error = "This scene is used by: " + string.Join(", ", users) + ".", schedules = users }, statusCode: 409);
            s.Scenes.Delete(id); return Results.Json(new { ok = true });
        }).Req(Role.Admin);
        g.MapGet("/scenes/active", () => Results.Json(new { activeSceneId = s.Scenes.ActiveSceneId() })).Req(Role.View);
        g.MapPost("/scenes/{id:long}/apply", (long id) => { var err = s.Scenes.Apply(id); return err != null ? Ext.Bad(err, 404) : Results.Json(new { ok = true }); }).Req(Role.Control);

        // ---- B4 schedules ----
        g.MapGet("/schedules", () => Results.Json(s.Schedules.List())).Req(Role.View);
        g.MapPost("/schedules", async (HttpContext c) => { var b = await c.Request.Body(); var (id, err) = s.Schedules.Create(b); return err != null ? Ext.Bad(err) : Results.Json(new { id }); }).Req(Role.Admin);
        g.MapPut("/schedules/{id:long}", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.Schedules.Update(id, b); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapDelete("/schedules/{id:long}", (long id) => { s.Schedules.Delete(id); return Results.Json(new { ok = true }); }).Req(Role.Admin);
        // ---- 0.3.0 §7.1 backup and restore (admin only) ----
        g.MapGet("/backup", () => Results.File(s.Backup.Export(WavWiz.Core.WavWizInfo.Version), "application/octet-stream", $"WavWiz-{DateTime.Now:yyyy-MM-dd}.wavwizbackup")).Req(Role.Admin);
        g.MapPost("/backup/preview", async (HttpContext c) => { var p = Features.BackupService.Read(await ReadAll(c)); return p.Error != null ? Ext.Bad(p.Error) : Results.Json(s.Backup.Preview(p.Root)); }).Req(Role.Admin);
        g.MapPost("/backup/import", async (HttpContext c) => { var p = Features.BackupService.Read(await ReadAll(c)); if (p.Error != null) return Ext.Bad(p.Error); var undo = s.Backup.SaveSnapshot(WavWiz.Core.WavWizInfo.Version, true); var (n, miss) = s.Backup.Import(p.Root); return Results.Json(new { ok = true, rows = n, songsNotInLibrary = miss, undo = undo.Name }); }).Req(Role.Admin);
        // ---- 0.3.6 K20: Back up now (a snapshot on the server), the saved list, restore from one (with an automatic "before restore" snapshot for Undo) ----
        g.MapPost("/backup/now", () => { try { return Results.Json(s.Backup.SaveSnapshot(WavWiz.Core.WavWizInfo.Version)); } catch (Exception e) { return Ext.Bad("Could not save a backup. " + e.Message, 500); } }).Req(Role.Admin);
        g.MapGet("/backup/list", () => Results.Json(s.Backup.ListSnapshots())).Req(Role.Admin);
        g.MapPost("/backup/preview-saved", async (HttpContext c) => { var b = await c.Request.Body(); var raw = s.Backup.ReadSnapshot(b.Str("name") ?? ""); if (raw == null) return Ext.Bad("That backup is not on this server any more.", 404); var p = Features.BackupService.Read(raw); return p.Error != null ? Ext.Bad(p.Error) : Results.Json(s.Backup.Preview(p.Root)); }).Req(Role.Admin);
        g.MapPost("/backup/restore-saved", async (HttpContext c) => { var b = await c.Request.Body(); var raw = s.Backup.ReadSnapshot(b.Str("name") ?? ""); if (raw == null) return Ext.Bad("That backup is not on this server any more.", 404); var p = Features.BackupService.Read(raw); if (p.Error != null) return Ext.Bad(p.Error);
            var undo = s.Backup.SaveSnapshot(WavWiz.Core.WavWizInfo.Version, true); var (n, miss) = s.Backup.Import(p.Root); return Results.Json(new { ok = true, rows = n, songsNotInLibrary = miss, undo = undo.Name }); }).Req(Role.Admin);
        // ---- 0.3.0 alarms + sleep timer ----
        g.MapGet("/schedules/clock", () => Results.Json(s.Schedules.ClockDto())).Req(Role.View);
        g.MapPost("/schedules/{id:long}/run", (long id, double? testFadeSec) => { var err = s.Schedules.RunNow(id, testFadeSec); return err != null ? Ext.Bad(err, 404) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/schedules/{id:long}/skip", (long id) => { var (sk, err) = s.Schedules.Skip(id); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(new { ok = true, skipped = sk }); }).Req(Role.Control);
        g.MapGet("/alarm", () => Results.Json(new { alarm = s.Schedules.Active == null ? null : s.Schedules.AlarmState() })).Req(Role.View);
        g.MapPost("/alarm/snooze", () => { var err = s.Schedules.Snooze(); return err != null ? Ext.Bad(err, 409) : Results.Json(s.Schedules.AlarmState()); }).Req(Role.Control);
        g.MapPost("/alarm/stop", () => { var err = s.Schedules.StopAlarm(); return err != null ? Ext.Bad(err, 409) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapGet("/sleep", () => Results.Json(s.Sleep.State())).Req(Role.View);
        g.MapPost("/sleep", async (HttpContext c) => { var b = await c.Request.Body(); var err = s.Sleep.Set(b.Str("mode"), b.Num("minutes"), b.LongList("zoneIds")); return err != null ? Ext.Bad(err) : Results.Json(s.Sleep.State()); }).Req(Role.Control);

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
        }).Req(Role.Admin);      // 0.2.0 item 28: tag lookups/approval, scenes and schedules editing are admin-only (running a scene stays Control)
        g.MapPost("/tags/jobs/{id:long}/approvals", async (long id, HttpContext c) => { var b = await c.Request.Body(); var err = s.TagFix.SetApprovals(id, b); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapPost("/tags/jobs/{id:long}/apply", (long id) => { var err = s.TagFix.Apply(id); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapPost("/tags/jobs/{id:long}/undo", (long id) => { var err = s.TagFix.Undo(id); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true }); }).Req(Role.Admin);
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
    private static async Task<byte[]> ReadAll(HttpContext c) { using var ms = new MemoryStream(); await c.Request.Body.CopyToAsync(ms); if (ms.Length > 50_000_000) throw new BadHttpRequestException("too big"); return ms.ToArray(); }
}
