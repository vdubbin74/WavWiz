using System.Collections.Concurrent;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Api;

/// <summary>
/// 0.7.2 D: "Check with phone" on a zone's Timing vs house row. Control may run the check (it only plays test sounds and pauses the two zones'
/// music, like calibration); applying the suggestion is the existing Admin-only PUT /groups/{id}/house-offset.
///   POST /groups/{id}/timing-check {againstId?}        - starts a session and plays the first pair (returns recordMs: how long to record)
///   POST /groups/{id}/timing-check/{sid}/play          - plays the pair again (the next run)
///   POST /groups/{id}/timing-check/{sid}/capture?rate= - the phone's recording (32-bit float mono) -> laterMs + suggestedMs
///   POST /groups/{id}/timing-check/{sid}/end           - ends; offers Resume when the music was paused (never resumes by itself)
/// </summary>
public static class ZoneCheckApi
{
    sealed record Check(long GroupId, long AgainstId, long ZoneSpeaker, long AgainstSpeaker, string Name, string AgainstName);
    static readonly ConcurrentDictionary<string, Check> Checks = new();

    public static void Map(RouteGroupBuilder g, Services s)
    {
        bool CanPlay(long speaker) => s.Zones.ZonePlayer(speaker) is { } pid && s.Audio.Get(pid) is { } ps && ps.Outputs.Any(o => o.Active);
        object? Play(Calibration.CalSession sess, Check ck, out string? err)
        {
            var zs = s.Audio.Get(s.Zones.ZonePlayer(ck.ZoneSpeaker) ?? ""); var asx = s.Audio.Get(s.Zones.ZonePlayer(ck.AgainstSpeaker) ?? "");
            double zd = zs == null ? 0 : s.Zones.PlaybackDelayMs(zs) ?? 0, ad = asx == null ? 0 : s.Zones.PlaybackDelayMs(asx) ?? 0;
            var (at, gap, e) = s.Cal.PlayZoneCheck(sess, ck.AgainstSpeaker, ad, ck.ZoneSpeaker, zd);
            err = e; if (e != null) return null;
            int patternMs = (int)new WavWiz.Measure.ChirpPattern().LengthMs;
            return new { sessionId = sess.Id, atUs = at, gapSec = gap, patternMs, recordMs = (int)(Calibration.CalibrationService.LeadUs / 1000 + gap * 1000 + patternMs + 1500),
                zone = new { id = ck.GroupId, name = ck.Name, speakerId = ck.ZoneSpeaker }, against = new { id = ck.AgainstId, name = ck.AgainstName, speakerId = ck.AgainstSpeaker },
                currentMs = s.Zones.HouseOffsets().GetValueOrDefault(ck.GroupId), runs = ZoneCheck.Runs };
        }

        g.MapPost("/groups/{id:long}/timing-check", async (long id, HttpContext c) =>
        {
            var b = await c.Request.Body(); var groups = s.Zones.Groups();
            var z = groups.FirstOrDefault(x => x.Id == id); if (z == null) return Ext.Bad("zone not found", 404);
            // the checked zone's speaker must take its "vs house" offset from THIS zone (a speaker in two zones follows the first one)
            var zsp = ZoneCheck.PickSpeaker(z.ReferenceId, z.DeviceIds, d => CanPlay(d) && s.Zones.GroupOfSpeaker(d) == id);
            if (zsp == null) return Ext.Bad(z.DeviceIds.Any(CanPlay) ? $"{z.Name}'s online speakers take their timing from another zone - check that zone instead" : $"No WavWiz speaker in {z.Name} is online to play the test sound", 409);
            long? Other(ZoneGroupDto x) => ZoneCheck.PickSpeaker(x.ReferenceId, x.DeviceIds, d => d != zsp && CanPlay(d));
            var playable = groups.Where(x => x.Id != id && Other(x) != null).OrderBy(x => x.Name == ZoneManager.EverywhereName ? 1 : 0).Select(x => x.Id).ToList();
            long? against = b.ValueKind == JsonValueKind.Object && b.Long("againstId") is long pick ? pick : ZoneCheck.DefaultAgainst(id, s.Zones.GroupOfSpeaker(s.Zones.ReferenceZoneId), playable);
            if (against == id) return Ext.Bad("pick another zone to compare with");
            var az = against is long ag ? groups.FirstOrDefault(x => x.Id == ag) : null;
            if (az == null) return Ext.Bad("There is no other zone with a speaker online to compare with", 409);
            var asp = Other(az); if (asp == null) return Ext.Bad($"No other WavWiz speaker in {az.Name} is online to play the test sound", 409);
            var (sess, err) = s.Cal.Start("same-recording", asp.Value, "phone", b.ValueKind == JsonValueKind.Object ? b.Str("micProcessing") : null);
            if (sess == null) return Ext.Bad(err!, 409);
            var ck = new Check(id, az.Id, zsp.Value, asp.Value, z.Name, az.Name); Checks[sess.Id] = ck;
            var r = Play(sess, ck, out var perr); if (r == null) { s.Cal.End(sess, "failed"); Checks.TryRemove(sess.Id, out _); return Ext.Bad(perr!, 409); }
            return Results.Json(r);
        }).Req(Role.Control);

        g.MapPost("/groups/{id:long}/timing-check/{sid}/play", (long id, string sid) =>
        {
            if (!Checks.TryGetValue(sid, out var ck) || ck.GroupId != id || s.Cal.Get(sid) is not { } sess) return Ext.Bad("the check expired - start it again", 404);
            var r = Play(sess, ck, out var err); return r == null ? Ext.Bad(err!, 409) : Results.Json(r);
        }).Req(Role.Control);

        g.MapPost("/groups/{id:long}/timing-check/{sid}/capture", async (long id, string sid, HttpContext c) =>
        {
            if (!Checks.TryGetValue(sid, out var ck) || ck.GroupId != id || s.Cal.Get(sid) is not { } sess) return Ext.Bad("the check expired - start it again", 404);
            int rate = int.TryParse(c.Request.Query["rate"], out var r) ? r : 48000; if (rate is < 8000 or > 192000) return Ext.Bad("bad sample rate");
            c.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = 32 * 1024 * 1024;
            using var ms = new MemoryStream(); await c.Request.Body.CopyToAsync(ms); var bytes = ms.ToArray();
            if (bytes.Length < 4 || bytes.Length % 4 != 0) return Ext.Bad("the recording must be 32-bit float samples");
            var samples = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            if (samples.Any(x => !float.IsFinite(x))) return Ext.Bad("the recording contains invalid samples");
            var (later, q, err) = s.Cal.CaptureZoneCheck(sess, ck.ZoneSpeaker, Calibration.CalibrationService.ToMono48k(samples, rate));
            double cur = s.Zones.HouseOffsets().GetValueOrDefault(id);
            return Results.Json(new { ok = later != null, laterMs = later is double l ? Math.Round(l, 1) : (double?)null, quality = q, error = err, currentMs = cur,
                suggestedMs = later is double l2 ? ZoneCheck.Suggest(cur, l2) : (double?)null, outOfRange = later is double l3 && ZoneCheck.OutOfRange(cur, l3) });
        }).Req(Role.Control);

        g.MapPost("/groups/{id:long}/timing-check/{sid}/end", (long id, string sid) =>
        {
            Checks.TryRemove(sid, out _);
            if (s.Cal.Get(sid) is not { } sess) return Results.Json(new { ok = true, canResume = false });
            var cr = s.Cal.End(sess, "ended"); return Results.Json(new { ok = true, canResume = cr, resumeGroups = sess.ResumeGroupIds });
        }).Req(Role.Control);
    }
}
