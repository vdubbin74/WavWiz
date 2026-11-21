using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Announce;
namespace WavWiz.Server.Api;

/// <summary>
/// 0.7.2 Announce. GET /api/v1/announce (View): who is announcing + the chime default. WebSocket /ws/announce?zone=g:3|everywhere&amp;rate=48000&amp;chime=1
/// (Control): the page sends its microphone as binary 16-bit mono PCM frames while the button is held, then the text "end" (or just closes).
/// The server answers {"type":"ready"} or {"type":"error","message":...} once, then {"type":"done"} after "end".
/// </summary>
public static class AnnounceApi
{
    public static int CleanRate(string? q) => int.TryParse(q, out var r) && r is >= 8000 and <= 96000 ? r : AnnounceMixer.VoiceRate;
    public static bool? CleanChime(string? q) => q switch { "1" or "true" => true, "0" or "false" => false, _ => null };

    public static void Map(RouteGroupBuilder g, WebApplication app, Services s)
    {
        g.MapGet("/announce", () => Results.Json(s.Announce?.Status() ?? new { active = false })).Req(Role.View);
        app.Map("/ws/announce", async (HttpContext c) =>
        {
            if (!c.WebSockets.IsWebSocketRequest) return Results.StatusCode(400);
            if (s.Announce == null) return Results.StatusCode(503);
            string? zone = c.Request.Query["zone"].ToString() is { Length: > 0 } z ? z : null;
            int rate = CleanRate(c.Request.Query["rate"]); bool? chime = CleanChime(c.Request.Query["chime"]);
            using var ws = await c.WebSockets.AcceptWebSocketAsync();
            var (ses, err) = s.Announce.Begin(c.Who()?.Name ?? "Someone", zone, chime);
            if (ses == null) { await Send(ws, new { type = "error", message = err }); try { await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "refused", CancellationToken.None); } catch { } return Results.Empty; }
            try
            {
                await Send(ws, new { type = "ready", id = ses.Id, duckDb = AnnounceMixer.DefaultDuckDb });
                var buf = new byte[64 * 1024]; var ms = new MemoryStream();
                while (ws.State == WebSocketState.Open)
                {
                    var r = await ws.ReceiveAsync(buf, c.RequestAborted);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    ms.Write(buf, 0, r.Count); if (!r.EndOfMessage) { if (ms.Length > 1 << 20) break; continue; }
                    var msg = ms.ToArray(); ms.SetLength(0);
                    if (r.MessageType == WebSocketMessageType.Binary) { s.Announce.Push(ses, msg, rate); continue; }
                    if (Encoding.UTF8.GetString(msg).Trim() == "end") { s.Announce.End(ses); await Send(ws, new { type = "done" }); break; }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            finally { s.Announce.End(ses); try { if (ws.State == WebSocketState.Open) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { } }
            return Results.Empty;
        }).Req(Role.Control);
    }

    private static Task Send(WebSocket ws, object o) => ws.SendAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o, EventHub.Json)), WebSocketMessageType.Text, true, CancellationToken.None);
}
