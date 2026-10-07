using System.Text.Json;
using WavWiz.Measure;
namespace WavWiz.Server.Api;

public static class ZoneApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/zones", () => Results.Json(s.Zones.Zones())).Req(Role.View);

        g.MapPatch("/zones/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body();
            var err = s.Zones.Patch(id, b.Str("name"), b.Num("volume"), b.Bool("muted"), b.Bool("enabled"));
            return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Zone(id));
        }).Req(Role.Control);

        g.MapGet("/zones/{id:long}/health", (long id) =>
        {
            var z = s.Zones.Zone(id); if (z == null) return Ext.Bad("zone not found", 404);
            return Results.Json(new { room = z.Room, link = z.Link, remoteIp = z.RemoteIp, isWeb = z.IsWeb, events = s.Zones.Rooms.Events(z.PlayerId).Take(40).Select(e => new { at = e.At.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"), kind = e.Kind, text = e.Text }) });
        }).Req(Role.View);

        g.MapPost("/zones/{id:long}/test-sound", (long id) => { var err = s.Zones.TestSound(id); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 409) : Results.Json(new { ok = true }); }).Req(Role.Control);

        g.MapPost("/zones/master", async (HttpContext c) => { var b = await c.Request.Body(); s.Zones.Master(b.Num("delta"), b.Num("scale"), b.Num("set")); return Results.Json(s.Zones.Zones()); }).Req(Role.Control);

        g.MapPost("/zones/{id:long}/output", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var ep = b.Long("endpointId"); if (ep == null) return Ext.Bad("endpointId is required");
            var err = s.Zones.SetActiveOutput(id, ep.Value); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapPost("/outputs/{endpointId:long}/link", async (long endpointId, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Zones.LinkEndpoint(endpointId, b.Str("btAddress") ?? ""); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapGet("/players", () => Results.Json(s.Db.Query("SELECT id,name,machine_name,app_version,last_seen_at,link_type FROM player ORDER BY name COLLATE NOCASE",
            r => new { id = r.GetString(0), name = r.GetString(1), machine = r.IsDBNull(2) ? null : r.GetString(2), appVersion = r.IsDBNull(3) ? null : r.GetString(3), lastSeenAt = r.IsDBNull(4) ? null : r.GetString(4), link = r.IsDBNull(5) ? null : r.GetString(5), connected = s.Audio.Get(r.GetString(0)) != null }))).Req(Role.View);
        g.MapDelete("/players/{id}", (string id) => { s.Zones.RemovePlayer(id); return Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapPost("/players/{id}/forget", (string id) => { s.Zones.RemovePlayer(id); return Results.Json(new { ok = true }); }).Req(Role.Admin);

        // ---- zones = optional groups of devices (0.0.3) ----
        g.MapGet("/groups", () => Results.Json(s.Zones.Groups())).Req(Role.View);
        g.MapPost("/groups", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var (id, err) = s.Zones.CreateGroup(b.Str("name"), b.LongList("deviceIds"));
            return err != null ? Ext.Bad(err) : Results.Json(s.Zones.Groups().First(x => x.Id == id));
        }).Req(Role.Control);
        g.MapPatch("/groups/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Zones.UpdateGroup(id, b.Str("name"), b.LongList("deviceIds"));
            return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Groups().First(x => x.Id == id));
        }).Req(Role.Control);
        g.MapDelete("/groups/{id:long}", (long id) => { var err = s.Zones.DeleteGroup(id); return err != null ? Ext.Bad(err, 404) : Results.Json(new { ok = true }); }).Req(Role.Control);
        g.MapPost("/groups/{id:long}/activate", (long id) => { var err = s.Zones.ActivateGroup(id); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Groups()); }).Req(Role.Control);

        // ---- manual / by-ear delay ----
        g.MapPut("/outputs/{deviceId}/latency", async (string deviceId, HttpContext c) =>
        {
            var b = await c.Request.Body(); var ms = b.Num("latencyMs"); var pid = b.Str("playerId");
            if (ms == null || !double.IsFinite(ms.Value) || ms < 0 || ms > 2000) return Ext.Bad("latencyMs must be between 0 and 2000");
            if (pid == null || Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM output_endpoint WHERE player_id=$p AND output_device_id=$d", ("$p", pid), ("$d", deviceId))) == 0) return Ext.Bad("playerId must be a PC that has this output");
            var method = b.Str("method") == "ear" ? "ear" : "manual";
            // 0.0.8: the delay slider adjusts live; "live" edits fold into the current by-hand entry instead of filling the history
            if (b.Bool("live") == true && s.Cal.UpdateLive(deviceId, pid, ms.Value, method)) return Results.Json(new { ok = true, live = true });
            s.Cal.Save(deviceId, pid, ms.Value, method, method == "ear" ? 0.5 : 1.0, notes: b.Str("note"));
            return Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapGet("/outputs/{deviceId}/calibrations", (string deviceId) => Results.Json(s.Cal.History(deviceId))).Req(Role.View);
        g.MapPost("/calibrations/{id:long}/restore", (long id) => { var e = s.Cal.Restore(id); return e != null ? Ext.Bad(e, 404) : Results.Json(new { ok = true }); }).Req(Role.Control);

        // ---- DSP ----
        g.MapGet("/dsp/presets", () => Results.Json(s.Dsp.Presets())).Req(Role.View);
        g.MapPost("/dsp/presets", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var (id, err) = s.Dsp.Create(b.Str("name") ?? "", b.Prop("preset") ?? default);
            return err != null ? Ext.Bad(err) : Results.Json(new { id });
        }).Req(Role.Control);
        g.MapPut("/dsp/presets/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Dsp.Update(id, b.Str("name"), b.Prop("preset")); return err != null ? Ext.Bad(err, err == "not found" ? 404 : 400) : Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapDelete("/dsp/presets/{id:long}", (long id) => { var err = s.Dsp.Delete(id); return err != null ? Ext.Bad(err, err == "not found" ? 404 : 400) : Results.Json(new { ok = true }); }).Req(Role.Control);

        g.MapPost("/dsp/response", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var (p, err) = Dsp.DspService.Parse(b.Prop("preset") ?? default); return p == null ? Ext.Bad(err ?? "bad preset") : Results.Json(Dsp.DspService.Response(p));
        }).Req(Role.View);

        g.MapGet("/dsp/assignments/{deviceId}", (string deviceId) => Results.Json(s.Dsp.AssignmentFor(deviceId))).Req(Role.View);
        g.MapPut("/dsp/assignments/{deviceId}", async (string deviceId, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Dsp.Assign(deviceId, b.Long("presetId"), b.Bool("enabled") ?? true, b.Bool("bypass") ?? false);
            return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapPost("/dsp/preview", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var dev = b.Str("deviceId") ?? ""; var (p, err) = Dsp.DspService.Parse(b.Prop("preset") ?? default); if (p == null) return Ext.Bad(err ?? "bad preset");
            s.Zones.PushPreview(dev, JsonSerializer.SerializeToElement(p, Dsp.DspService.J), b.Bool("bypass") ?? false); return Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapPost("/dsp/revert", async (HttpContext c) => { var b = await c.Request.Body(); s.Zones.Revert(b.Str("deviceId") ?? ""); return Results.Json(new { ok = true }); }).Req(Role.Control);

        // ---- calibration (phone mic) ----
        g.MapGet("/calibration/pattern", () => Results.Json(new { patternMs = new ChirpPattern().LengthMs, chirps = ChirpPattern.OffsetsMs.Length, lowHz = ChirpPattern.F0, highHz = ChirpPattern.F1, pairGapSec = Calibration.CalibrationService.PairGapSec, runsPerSpeaker = 3 })).Req(Role.View);

        g.MapPost("/calibration/sessions", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var (sess, err) = s.Cal.Start(b.Str("mode") ?? "phone", b.Long("referenceZoneId") ?? 0, b.Str("micSource"), b.Str("micProcessing"));
            return sess == null ? Ext.Bad(err!) : Results.Json(new { id = sess.Id, mode = sess.Mode, secure = c.Request.IsHttps });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/play", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var b = await c.Request.Body(); var kind = b.Str("kind") ?? "dev"; if (kind is not ("ref" or "dev" or "ref-end")) return Ext.Bad("kind must be ref, dev or ref-end");
            long zone = kind is "ref" or "ref-end" ? sess.ReferenceZoneId : b.Long("zoneId") ?? 0;
            var (at, err) = s.Cal.Play(sess, zone, kind, Math.Clamp(b.Num("distanceM") ?? 0, 0, 20), Math.Clamp(b.Num("levelDb") ?? -20, -40, -6));
            return err != null ? Ext.Bad(err, 409) : Results.Json(new { atUs = at, zoneId = zone, kind, patternMs = new ChirpPattern().LengthMs });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/play-pair", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var b = await c.Request.Body(); var (at, gap, err) = s.Cal.PlayPair(sess, b.Long("zoneId") ?? 0, Math.Clamp(b.Num("levelDb") ?? -20, -40, -6));
            return err != null ? Ext.Bad(err, 409) : Results.Json(new { atUs = at, gapSec = gap, patternMs = new ChirpPattern().LengthMs });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/capture", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var q = c.Request.Query; long zone = long.TryParse(q["zoneId"], out var z) ? z : 0; var kind = q["kind"].ToString();
            int rate = int.TryParse(q["rate"], out var r) ? r : 48000; double start = double.TryParse(q["startServerUs"], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var st) ? st : 0;
            if (rate is < 8000 or > 192000) return Ext.Bad("bad sample rate");
            c.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = 32 * 1024 * 1024;
            using var ms = new MemoryStream(); await c.Request.Body.CopyToAsync(ms); var bytes = ms.ToArray();
            if (bytes.Length < 4 || bytes.Length % 4 != 0) return Ext.Bad("the recording must be 32-bit float samples");
            var samples = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            if (samples.Any(x => !float.IsFinite(x))) return Ext.Bad("the recording contains invalid samples");
            var res = s.Cal.Capture(sess, zone, kind, Calibration.CalibrationService.ToMono48k(samples, rate), start);
            return Results.Json(res);
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/finish", (string id) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var (props, msgs) = s.Cal.Finish(sess); sess.Notes.Clear(); sess.Notes.AddRange(msgs); sess.Proposals = props;
            return Results.Json(new { proposals = props, messages = msgs });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/commit", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null || sess.Proposals is not { } props) return Ext.Bad("nothing to save - finish the measurement first", 404);
            var b = await c.Request.Body(); var ids = b.Prop("zoneIds") is JsonElement a && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().Select(x => x.GetInt64()).ToList() : props.Where(p => p.Commit).Select(p => p.ZoneId).ToList();
            s.Cal.Commit(sess, ids, props); s.Events.Publish("zones"); return Results.Json(new { ok = true, saved = ids.Count });
        }).Req(Role.Control);

        g.MapPost("/calibration/ear/play", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var (at, err) = s.Cal.PlayEar(b.Long("referenceZoneId") ?? 0, b.Long("deviceZoneId") ?? 0, b.Num("candidateMs") ?? 0);
            return err != null ? Ext.Bad(err, 409) : Results.Json(new { atUs = at });
        }).Req(Role.Control);
    }

}
