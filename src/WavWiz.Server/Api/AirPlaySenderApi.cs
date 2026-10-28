using System.Net;
namespace WavWiz.Server.Api;

/// <summary>0.5.0 AirPlay sender, admin-only developer endpoints. Stage 1: discovery (no connection to any speaker).</summary>
public static class AirPlaySenderApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/dev/airplay", () => { Ensure(s); return Results.Json(s.AirPlayBrowse!.Snapshot()); }).Req(Role.Admin);
        g.MapGet("/dev/airplay/outputs", () => Results.Json(Outs(s).Snapshot())).Req(Role.Admin);
        g.MapPost("/dev/airplay/connect", async (ConnectReq r) =>
        {
            Ensure(s);
            try { var o = await Outs(s).ConnectAsync(r.Key, r.Endpoint, r.DelayMs ?? 0, r.Volume ?? 50); return Results.Json(new { ok = true, id = o.Sink.Id, kind = o.Kind }); }
            catch (Exception e) { return Results.Json(new { ok = false, error = e.Message }, statusCode: 409); }
        }).Req(Role.Admin);
        g.MapPost("/dev/airplay/disconnect", async (KeyReq r) => Results.Json(new { ok = await Outs(s).DisconnectAsync(r.Key) })).Req(Role.Admin);
        g.MapPost("/dev/airplay/volume", async (VolReq r) => Results.Json(new { ok = await Outs(s).SetVolumeAsync(r.Key, r.Volume) })).Req(Role.Admin);
        g.MapPost("/dev/airplay/delay", (DelayReq r) => Results.Json(new { ok = Outs(s).SetDelay(r.Key, r.DelayMs) })).Req(Role.Admin);
        g.MapGet("/airplay/settings", () => Results.Json(Settings(s))).Req(Role.Admin);
        g.MapPost("/airplay/settings", (SettingsReq r) =>
        {
            if (r.AirPlay2Experimental is bool e) s.Cfg.AirPlay2Experimental = e;
            if (r.AirPlay2Buffered is bool b) s.Cfg.AirPlay2Buffered = b;
            s.Cfg.Save(); var o = Outs(s); o.AirPlay2Enabled = s.Cfg.AirPlay2Experimental; o.PreferBuffered = s.Cfg.AirPlay2Buffered;
            return Results.Json(Settings(s));
        }).Req(Role.Admin);
        g.MapPost("/dev/airplay/query", () => { Ensure(s); s.AirPlayBrowse!.QueryNow(); return Results.Json(new { ok = true }); }).Req(Role.Admin);
    }

    public sealed record ConnectReq(string Key, string? Endpoint, int? DelayMs, int? Volume);
    public sealed record SettingsReq(bool? AirPlay2Experimental, bool? AirPlay2Buffered);
    static object Settings(Services s) => new
    {
        airPlay2Experimental = s.Cfg.AirPlay2Experimental, airPlay2Buffered = s.Cfg.AirPlay2Buffered,
        ffmpeg = File.Exists(s.FfmpegPath) || s.FfmpegPath == "ffmpeg",
        firewall = WavWiz.Core.AirPlay.AirPlayQuirks.FirewallRules,
        quirks = WavWiz.Core.AirPlay.AirPlayQuirks.Table.Select(q => new { model = q.ModelPrefix, q.Label, q.Buffered, q.Verified, q.Note }),
    };
    public sealed record KeyReq(string Key);
    public sealed record VolReq(string Key, int Volume);
    public sealed record DelayReq(string Key, int DelayMs);

    public static AirPlay.AirPlayOutputs Outs(Services s)
    {
        lock (Gate) return s.AirPlayOut ??= new AirPlay.AirPlayOutputs(s.Registry, () => s.AirPlayBrowse)
            { AirPlay2Enabled = s.Cfg.AirPlay2Experimental, PreferBuffered = s.Cfg.AirPlay2Buffered, FfmpegPath = s.FfmpegPath };
    }

    static readonly object Gate = new();
    /// <summary>Starts the browser the first time an admin opens the dev card, so an idle server does no AirPlay browsing.</summary>
    public static void Ensure(Services s)
    {
        lock (Gate)
        {
            if (s.AirPlayBrowse != null) return;
            var b = new AirPlay.AirPlayBrowser(); s.AirPlayBrowse = b;
            b.Start(IPAddress.TryParse(s.Cfg.BindAddress.Trim('[', ']'), out var ip) ? ip : IPAddress.Loopback);
        }
    }
}
