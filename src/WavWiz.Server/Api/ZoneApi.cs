using System.Text.Json;
using WavWiz.Measure;
namespace WavWiz.Server.Api;

public static class ZoneApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        // 0.2.0: each device says whether it is the caller's own ("mine": this browser's speaker, or the Player on the same PC) and which is the house reference
        g.MapGet("/zones", (HttpContext c, int? all) => { var rm = JukeboxApi.RemoteZones(s); var zs = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress); return Results.Json(all == 1 || rm.Count == 0 ? zs : zs.Where(z => !rm.Contains(z.Id)).ToList()); }).Req(Role.View);   // 0.3.0 §2: a remote-only device is no speaker card

        g.MapPatch("/zones/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (b.Str("name") != null && !IsAdmin(c)) return Ext.Bad(AdminOnly("rename a device"), 403);      // item 28: rename = admin; volume/mute/on-off = everyone with Control
            var err = s.Zones.Patch(id, b.Str("name"), b.Num("volume"), b.Bool("muted"), b.Bool("enabled"));
            return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress).FirstOrDefault(z => z.Id == id));
        }).Req(Role.Control);

        g.MapGet("/zones/{id:long}/health", (long id) =>
        {
            var z = s.Zones.Zone(id); if (z == null) return Ext.Bad("zone not found", 404);
            return Results.Json(new { room = z.Room, link = z.Link, remoteIp = z.RemoteIp, isWeb = z.IsWeb, events = s.Zones.Rooms.Events(z.PlayerId).Take(40).Select(e => new { at = e.At.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"), kind = e.Kind, text = e.Text }) });
        }).Req(Role.View);

        g.MapPost("/zones/{id:long}/test-sound", (long id) => { var err = s.Zones.TestSound(id); if (err == null) PlaybackApi.MarkFirstSound(s); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 409) : Results.Json(new { ok = true }); }).Req(Role.Control);

        // 0.2.0 item 10: skips speakers that are off, never changes mute, keeps the balance (see ZoneManager.Master). Body: {delta} | {scale} | {set}.
        g.MapPost("/zones/master", async (HttpContext c) => { var b = await c.Request.Body(); s.Zones.Master(b.Num("delta"), b.Num("scale"), b.Num("set")); return Results.Json(s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress)); }).Req(Role.Control);
        // 0.2.1 F17: Mute all / Unmute all from the master strip. Body: {muted: true|false}. Unmute all restores only what Mute all muted.
        g.MapPost("/zones/mute-all", async (HttpContext c) => { var b = await c.Request.Body(); var on = b.Bool("muted") ?? true; var n = s.Zones.MuteAll(on); return Results.Json(new { ok = true, changed = n, zones = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress) }); }).Req(Role.Control);
        g.MapGet("/zones/master", () => Results.Json(new { level = s.Zones.MasterLevel() })).Req(Role.View);

        g.MapPost("/zones/{id:long}/output", async (long id, HttpContext c) =>
        {
            if (!IsAdmin(c) && !s.Zones.IsMine(id, c.Who(), c.Connection.RemoteIpAddress)) return Ext.Bad(AdminOnly("switch the output of another device"), 403);
            var b = await c.Request.Body(); var ep = b.Long("endpointId"); if (ep == null) return Ext.Bad("endpointId is required");
            var err = s.Zones.SetActiveOutput(id, ep.Value); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapPost("/outputs/{endpointId:long}/link", async (long endpointId, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Zones.LinkEndpoint(endpointId, b.Str("btAddress") ?? ""); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Admin);

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
        }).Req(Role.Admin);      // 0.2.0 item 28: creating/editing zones is admin-only (switching zones stays Control)
        g.MapPatch("/groups/{id:long}", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var err = s.Zones.UpdateGroup(id, b.Str("name"), b.LongList("deviceIds"));
            return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Groups().First(x => x.Id == id));
        }).Req(Role.Admin);
        g.MapDelete("/groups/{id:long}", (long id) => { var err = s.Zones.DeleteGroup(id); return err != null ? Ext.Bad(err, 404) : Results.Json(new { ok = true }); }).Req(Role.Admin);
        g.MapPost("/groups/{id:long}/activate", (long id) => { var err = s.Zones.ActivateGroup(id); return err != null ? Ext.Bad(err, err.Contains("not found") ? 404 : 400) : Results.Json(s.Zones.Groups()); }).Req(Role.Control);

        // ---- manual / by-ear delay ----
        g.MapPut("/outputs/{deviceId}/latency", async (string deviceId, HttpContext c) =>
        {
            var b = await c.Request.Body(); var ms = b.Num("latencyMs"); var pid = b.Str("playerId");
            if (ms == null || !double.IsFinite(ms.Value) || ms < 0 || ms > 2000) return Ext.Bad("latencyMs must be between 0 and 2000");
            if (pid == null || Convert.ToInt32(s.Db.Scalar("SELECT COUNT(*) FROM output_endpoint WHERE player_id=$p AND output_device_id=$d", ("$p", pid), ("$d", deviceId))) == 0) return Ext.Bad("playerId must be a PC that has this output");
            if (!IsAdmin(c) && !MineByPlayer(s, c, pid)) return Ext.Bad(AdminOnly("change the delay of another device"), 403);      // item 28: own device only
            var method = b.Str("method") == "ear" ? "ear" : "manual";
            // 0.0.8: the delay slider adjusts live; "live" edits fold into the current by-hand entry instead of filling the history
            if (b.Bool("live") == true && s.Cal.UpdateLive(deviceId, pid, ms.Value, method)) return Results.Json(new { ok = true, live = true });
            s.Cal.Save(deviceId, pid, ms.Value, method, method == "ear" ? 0.5 : 1.0, notes: b.Str("note"));
            return Results.Json(new { ok = true });
        }).Req(Role.Control);

        g.MapGet("/outputs/{deviceId}/calibrations", (string deviceId) => Results.Json(s.Cal.History(deviceId))).Req(Role.View);
        g.MapPost("/calibrations/{id:long}/restore", (long id, HttpContext c) =>
        {
            var pid = s.Db.Scalar("SELECT player_id FROM calibration WHERE id=$i", ("$i", id)) as string;
            if (!IsAdmin(c) && (pid == null || !MineByPlayer(s, c, pid))) return Ext.Bad(AdminOnly("restore the delay of another device"), 403);
            var e = s.Cal.Restore(id); return e != null ? Ext.Bad(e, 404) : Results.Json(new { ok = true });
        }).Req(Role.Control);

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
            var b = await c.Request.Body(); long refId = b.Long("referenceZoneId") ?? 0; long? only = null;
            var mode = b.Str("mode") ?? "phone";
            // 0.2.5: the phone's mic-only page comes with the QR code's one-time link code (no sign-in): an admin's link calibrates like the admin,
            // a regular user's link only that user's own speaker. 0.2.2 T9: a signed-in phone may still name the link in the body.
            var link = CalPhoneApi.LinkOf(c) ?? CalPhoneApi.Valid(b.Str("linkToken"), DateTimeOffset.UtcNow);
            if (CalPhoneApi.LinkOf(c) is { } ml && mode is not ("phone" or "same-recording")) return Ext.Bad("a phone calibration link can only be used for a phone measurement", 403);
            bool viaAdminLink = link is { ByAdmin: true };
            if (CalPhoneApi.LinkOf(c) is { ByAdmin: false } own)
            {
                if (own.OwnerZoneId == null) return Ext.Bad("This QR code was made by someone without a speaker of their own, so there is nothing it may calibrate. Ask an administrator to make the QR code.", 409);
                long house = s.Zones.ReferenceZoneId; if (house != 0) refId = house; only = own.OwnerZoneId;
            }
            else if (!IsAdmin(c) && !viaAdminLink)
            {
                // item 28/30 (Wiz B): a regular user calibrates ONLY their own device, against the house reference; the result saves only to their device
                var mine = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress).FirstOrDefault(z => z.Mine);
                if (mine == null) return Ext.Bad("This browser is not playing as a speaker yet, so there is no device of yours to calibrate. Only an administrator can calibrate other devices (File > Sign in as admin).", 409);
                long house = s.Zones.ReferenceZoneId;
                if (house != 0 && refId != 0 && refId != house) return Ext.Bad(AdminOnly("change the reference speaker"), 403);
                if (house != 0) refId = house;
                only = mine.Id;
            }
            // 0.2.5 PC-mic: which Player PC listens, with which mic; a regular user may only use the mic of the PC they are on
            Net.PlayerSession? micPc = null; WavWiz.Core.Protocol.MicInfo? mic = null;
            if (mode == "pc-mic")
            {
                var pid = b.Str("micPlayerId") ?? ""; micPc = s.Audio.Get(pid);
                if (micPc == null || micPc.IsWeb) return Ext.Bad("That PC is not connected. Start WavWiz Player on the PC with the microphone.", 409);
                if (!IsAdmin(c) && !Zones.ZoneManager.IsMine(micPc.Id, null, micPc, c.Who(), c.Connection.RemoteIpAddress)) return Ext.Bad(AdminOnly("use the microphone of another PC"), 403);
                mic = micPc.Mics.FirstOrDefault(m => m.Id == b.Str("micId")) ?? (micPc.Mics.Length == 0 ? null : WavWiz.Core.Calibration.MicKinds.Choose(micPc.Mics, b.Str("micId")));
                if (mic == null) return Ext.Bad("No microphone found on this PC. Plug in a USB or headset mic (or use your phone instead).", 409);
            }
            var (sess, err) = s.Cal.Start(mode, refId, mode == "pc-mic" ? "pc" : b.Str("micSource"), mode == "pc-mic" ? "raw" : b.Str("micProcessing"), only);
            if (sess == null) return Ext.Bad(err!, err!.Contains("offline") ? 409 : 400);
            if (link != null && CalPhoneApi.LinkOf(c) != null) { sess.LinkToken = link.Token; sess.MicDevice = link.Device; link.SessionId = sess.Id; s.Events.Publish("calmics"); }
            if (micPc != null && mic != null)
            {
                sess.MicPlayerId = micPc.Id; sess.MicId = mic.Id; sess.MicName = mic.Name; sess.MicBluetooth = mic.Bluetooth; sess.MicSource = "pc:" + mic.Kind;
                s.Db.SetSetting("calibration.pcMic." + micPc.Id, System.Text.Json.JsonSerializer.Serialize(mic.Id));       // remembered for next time
                var all = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress).Where(z => z.Connected && z.Outputs.Any(o => o.Active)).ToList();
                var want = b.LongList("zoneIds");
                var picked = all.Where(z => z.Id != sess.ReferenceZoneId && (only == null ? (want == null || want.Contains(z.Id)) : z.Id == only)).Select(z => (z.Id, z.Name)).ToList();
                if (picked.Count == 0) { s.Cal.End(sess, "nothing to measure"); return Ext.Bad("Choose at least one speaker to calibrate (the reference speaker is the one the others are measured against).", 400); }
                var refName = s.Zones.Zone(sess.ReferenceZoneId)?.Name ?? "Reference";
                var plan = Calibration.CalPlan.Build(sess.ReferenceZoneId, refName, picked, (int)Math.Clamp(b.Long("runs") ?? 3, 1, 3));
                s.Events.Publish("calmics");
                _ = Task.Run(() => s.Cal.RunPcMic(sess, plan, Math.Clamp(b.Num("levelDb") ?? -20, -40, -6)));
            }
            return Results.Json(new { id = sess.Id, mode = sess.Mode, secure = c.Request.IsHttps, referenceZoneId = sess.ReferenceZoneId, onlyZoneId = sess.OnlyZoneId, micName = sess.MicName, micBluetooth = sess.MicBluetooth, bluetoothWarning = sess.MicBluetooth ? WavWiz.Core.Calibration.MicKinds.BluetoothWarning : null });
        }).Req(Role.Control);

        // 0.2.5: live progress of a measurement (the PC-mic run, or a phone reporting its own steps) and, when done, the results
        g.MapGet("/calibration/sessions/{id}", (string id) => { var sess = s.Cal.Get(id); return sess == null ? Ext.Bad("session expired - start again", 404) : Results.Json(s.Cal.Progress(sess)); }).Req(Role.View);
        g.MapPost("/calibration/sessions/{id}/progress", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var b = await c.Request.Body(); var lg = b.Str("log"); if (lg is { Length: > 200 }) lg = lg[..200];
            var ph = b.Str("phase"); if (ph is not (null or "running" or "failed")) ph = null;
            s.Cal.Report(sess, phase: ph, step: (int?)b.Long("step"), steps: (int?)b.Long("steps"), label: b.Str("label") is { } l ? (l.Length > 80 ? l[..80] : l) : null, log: lg, error: ph == "failed" ? b.Str("error") : null);
            return Results.Json(new { ok = true });
        }).Req(Role.Control);

        // 0.2.5 PC-mic: the Player PCs with microphones (a regular user sees only the PC they are on), each with the remembered mic and a Bluetooth flag
        g.MapGet("/calibration/pc-mics", (HttpContext c) =>
        {
            bool admin = IsAdmin(c);
            var zs = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress);
            var list = s.Audio.Sessions.Where(p => !p.IsWeb && !p.Dead).Select(p => new { p, z = zs.FirstOrDefault(z => z.PlayerId == p.Id), mine = Zones.ZoneManager.IsMine(p.Id, null, p, c.Who(), c.Connection.RemoteIpAddress) })
                .Where(x => admin || x.mine).Select(x =>
                {
                    var rem = s.Db.Setting("calibration.pcMic." + x.p.Id) is string j ? System.Text.Json.JsonSerializer.Deserialize<string>(j) : null;
                    var pick = WavWiz.Core.Calibration.MicKinds.Choose(x.p.Mics, rem);
                    return new { playerId = x.p.Id, name = x.z?.Name ?? x.p.Hello.Name, zoneId = x.z?.Id, mine = x.mine, supportsMic = Version.TryParse(new string(x.p.Hello.AppVersion.TakeWhile(ch => char.IsDigit(ch) || ch == '.').ToArray()), out var v) && v >= new Version(0, 2, 5),
                        mics = x.p.Mics.Select(m => new { id = m.Id, name = m.Name, kind = m.Kind, bluetooth = m.Bluetooth, isDefault = m.Default, label = WavWiz.Core.Calibration.MicKinds.Describe(m) }), selected = pick?.Id };
                }).OrderByDescending(x => x.mine).ToList();
            return Results.Json(new { pcs = list, bluetoothWarning = WavWiz.Core.Calibration.MicKinds.BluetoothWarning });
        }).Req(Role.View);
        g.MapPost("/calibration/pc-mics/level", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var p = s.Audio.Get(b.Str("playerId") ?? ""); if (p == null || p.IsWeb) return Ext.Bad("That PC is not connected.", 409);
            if (!IsAdmin(c) && !Zones.ZoneManager.IsMine(p.Id, null, p, c.Who(), c.Connection.RemoteIpAddress)) return Ext.Bad(AdminOnly("use the microphone of another PC"), 403);
            var mic = b.Str("micId"); if (mic == null || !p.Mics.Any(m => m.Id == mic)) return Ext.Bad("That microphone is not connected.", 409);
            s.Cal.Mics!.Level(p, mic, b.Bool("on") ?? true);
            if (b.Bool("remember") == true) s.Db.SetSetting("calibration.pcMic." + p.Id, System.Text.Json.JsonSerializer.Serialize(mic));
            return Results.Json(new { ok = true });
        }).Req(Role.Control);
        g.MapPost("/calibration/pc-mics/refresh", async (HttpContext c) => { var b = await c.Request.Body(); if (s.Audio.Get(b.Str("playerId") ?? "") is { IsWeb: false } p) s.Cal.Mics!.RefreshList(p); return Results.Json(new { ok = true }); }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/play", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var b = await c.Request.Body(); var kind = b.Str("kind") ?? "dev"; if (kind is not ("ref" or "dev" or "ref-end")) return Ext.Bad("kind must be ref, dev or ref-end");
            long zone = kind is "ref" or "ref-end" ? sess.ReferenceZoneId : b.Long("zoneId") ?? 0;
            if (kind == "dev" && sess.OnlyZoneId != null && zone != sess.OnlyZoneId) return Ext.Bad(AdminOnly("measure another device"), 403);
            var (at, err) = s.Cal.Play(sess, zone, kind, Math.Clamp(b.Num("distanceM") ?? 0, 0, 20), Math.Clamp(b.Num("levelDb") ?? -20, -40, -6));
            return err != null ? Ext.Bad(err, 409) : Results.Json(new { atUs = at, zoneId = zone, kind, patternMs = new ChirpPattern().LengthMs });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/play-pair", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Ext.Bad("session expired - start again", 404);
            var b = await c.Request.Body();
            if (sess.OnlyZoneId != null && (b.Long("zoneId") ?? 0) != sess.OnlyZoneId) return Ext.Bad(AdminOnly("measure another device"), 403);
            var (at, gap, err) = s.Cal.PlayPair(sess, b.Long("zoneId") ?? 0, Math.Clamp(b.Num("levelDb") ?? -20, -40, -6));
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
            var (props, msgs) = s.Cal.Finish(sess); sess.Notes.Clear(); sess.Notes.AddRange(msgs); sess.Proposals = props; s.Cal.Report(sess, phase: "done");    // 0.2.5: the PC page watching a phone shows the results
            return Results.Json(new { proposals = props, messages = msgs });
        }).Req(Role.Control);

        g.MapPost("/calibration/sessions/{id}/commit", async (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null || sess.Proposals is not { } props) return Ext.Bad("nothing to save - finish the measurement first", 404);
            var b = await c.Request.Body(); var ids = b.Prop("zoneIds") is JsonElement a && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().Select(x => x.GetInt64()).ToList() : props.Where(p => p.Commit).Select(p => p.ZoneId).ToList();
            int skipped = 0;
            if (sess.OnlyZoneId != null) { skipped = ids.Count(x => x != sess.OnlyZoneId); ids = ids.Where(x => x == sess.OnlyZoneId).ToList(); }    // regular user: own device only
            s.Cal.Commit(sess, ids, props); s.Cal.End(sess, "saved"); s.Events.Publish("zones"); return Results.Json(new { ok = true, saved = ids.Count, skipped });
        }).Req(Role.Control);

        // 0.2.0 item 29: end (finish, cancel or failure) - resumes the music if calibration paused it
        g.MapPost("/calibration/sessions/{id}/end", (string id, HttpContext c) =>
        {
            var sess = s.Cal.Get(id); if (sess == null) return Results.Json(new { ok = true, resumed = false });
            if (CalPhoneApi.LinkOf(c) is { } ml && sess.LinkToken != ml.Token) return Ext.Bad("not this phone's calibration", 403);
            return Results.Json(new { ok = true, resumed = s.Cal.End(sess, "ended") });
        }).Req(Role.Control);

        // 0.2.0 item 30: the house reference speaker (setting calibration.referenceZoneId). Everyone can read it; only an admin can change it.
        g.MapGet("/calibration/reference", () => { var id = s.Zones.ReferenceZoneId; var z = id == 0 ? null : s.Zones.Zone(id); return Results.Json(new { zoneId = z?.Id ?? 0, name = z?.Name, connected = z?.Connected ?? false }); }).Req(Role.View);
        g.MapPut("/calibration/reference", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var id = b.Long("zoneId") ?? 0;
            if (id != 0 && s.Zones.Zone(id) == null) return Ext.Bad("device not found", 404);
            s.Zones.ReferenceZoneId = id; s.Events.Publish("zones"); return Results.Json(new { ok = true, zoneId = id });
        }).Req(Role.Admin);

        g.MapPost("/calibration/ear/play", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); long refId = b.Long("referenceZoneId") ?? 0, dev = b.Long("deviceZoneId") ?? 0;
            var sess = b.Str("sessionId") is { } sid ? s.Cal.Get(sid) : null;
            if (!IsAdmin(c))
            {
                if (!s.Zones.IsMine(dev, c.Who(), c.Connection.RemoteIpAddress)) return Ext.Bad(AdminOnly("tune the delay of another device"), 403);
                long house = s.Zones.ReferenceZoneId; if (house != 0) refId = house;
            }
            var (at, err) = s.Cal.PlayEar(refId, dev, b.Num("candidateMs") ?? 0, -20, sess);
            return err != null ? Ext.Bad(err, 409) : Results.Json(new { atUs = at });
        }).Req(Role.Control);
    }

    internal static bool IsAdmin(HttpContext c) => c.Who()?.IsAdmin == true;
    internal static string AdminOnly(string what) => $"Only an administrator can {what}. Use File > Sign in as admin.";
    private static bool MineByPlayer(Services s, HttpContext c, string playerId)
    {
        var z = s.Zones.Zones(c.Who(), c.Connection.RemoteIpAddress).FirstOrDefault(x => x.PlayerId == playerId); return z?.Mine == true;
    }
}
