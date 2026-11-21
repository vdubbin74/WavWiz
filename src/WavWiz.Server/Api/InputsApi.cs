using System.Text.Json;
namespace WavWiz.Server.Api;

/// <summary>
/// 0.7.2 audio inputs. View: see the inputs and their meters. Control: play / stop an enabled input. Admin: turn inputs on, rename, gain,
/// Turntable mode / auto-start, and let a microphone be a live source (spec section 8).
/// </summary>
public static class InputsApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/inputs", () => Results.Json(s.Inputs?.View() ?? new { available = false, note = Inputs.InputService.NoPlayerNote, limiter = true, inputs = Array.Empty<object>() })).Req(Role.View);
        g.MapPut("/inputs/{id}", async (string id, HttpContext c) =>
        {
            var b = await c.Request.Body(); if (b.ValueKind != JsonValueKind.Object) return Ext.Bad("expected an object");
            if (s.Inputs == null) return Ext.Bad("audio inputs are not available", 409);
            var err = s.Inputs.Patch(id, b); return err == null ? Results.Json(s.Inputs.View()) : Ext.Bad(err, err == "input not found" ? 404 : 400);
        }).Req(Role.Admin);
        g.MapPost("/inputs/{id}/play", async (string id, HttpContext c) =>
        {
            var b = await c.Request.Body(); if (s.Inputs == null) return Ext.Bad("audio inputs are not available", 409);
            var err = s.Inputs.Play(id, b.ValueKind == JsonValueKind.Object ? b.Str("zoneId") : null);
            return err == null ? Results.Json(s.Inputs.View()) : Ext.Bad(err, err == "input not found" || err == "no such zone" ? 404 : 409);
        }).Req(Role.Control);
        g.MapPost("/inputs/{id}/stop", (string id) =>
        {
            if (s.Inputs == null) return Ext.Bad("audio inputs are not available", 409);
            var err = s.Inputs.Stop(id); return err == null ? Results.Json(s.Inputs.View()) : Ext.Bad(err, 404);
        }).Req(Role.Control);
        // Settings > Devices > Audio inputs is open: show live meters for enabled Aux / S/PDIF inputs for 30 s (the card renews it)
        g.MapPost("/inputs/meter", async (HttpContext c) => { var b = await c.Request.Body(); s.Inputs?.Meter(b.ValueKind != JsonValueKind.Object || b.Bool("on") != false); return Results.Json(new { ok = true }); }).Req(Role.View);
    }
}
