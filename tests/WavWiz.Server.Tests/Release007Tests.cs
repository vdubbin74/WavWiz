using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using WavWiz.Core.Protocol;
namespace WavWiz.Server.Tests;

/// <summary>0.0.7: iPhone Safari over plain http - WebSockets authenticate with a one-time ticket (the session cookie is not reliably sent on the handshake).</summary>
public class Release007Tests
{
    private static async Task<string> Ticket(ServerFixture f, string cookie)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/ws-ticket") { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        req.Headers.Add("Cookie", "unison_session=" + cookie); req.Headers.Add("Origin", f.Base);
        var r = await f.Http.SendAsync(req); r.EnsureSuccessStatusCode();
        using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync()); return d.RootElement.GetProperty("ticket").GetString()!;
    }

    [Fact]
    public async Task A_ticket_opens_the_ui_socket_without_any_cookie_once_only()
    {
        await using var f = await ServerFixture.StartAsync();
        var cookie = await f.SetupAdmin();
        var t = await Ticket(f, cookie);
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Origin", f.Base);
        await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws?ticket=" + t), CancellationToken.None);
        var buf = new byte[4096]; var r = await ws.ReceiveAsync(buf, CancellationToken.None);
        Assert.Contains("hello", Encoding.UTF8.GetString(buf, 0, r.Count));
        using var ws2 = new ClientWebSocket(); ws2.Options.SetRequestHeader("Origin", f.Base);
        await Assert.ThrowsAsync<WebSocketException>(() => ws2.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws?ticket=" + t), CancellationToken.None));
    }

    [Fact]
    public async Task A_ticket_from_another_site_is_refused_and_garbage_tickets_are_unauthorized()
    {
        await using var f = await ServerFixture.StartAsync();
        var cookie = await f.SetupAdmin();
        var t = await Ticket(f, cookie);
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Origin", "http://evil.example");
        await Assert.ThrowsAsync<WebSocketException>(() => ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws?ticket=" + t), CancellationToken.None));
        using var ws2 = new ClientWebSocket();
        await Assert.ThrowsAsync<WebSocketException>(() => ws2.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room?ticket=nope"), CancellationToken.None));
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.PostAsync("/api/v1/auth/ws-ticket", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
    }

    [Fact]
    public async Task The_clock_socket_works_with_a_ticket()
    {
        await using var f = await ServerFixture.StartAsync();
        var cookie = await f.SetupAdmin();
        using var cws = new ClientWebSocket(); cws.Options.SetRequestHeader("Origin", f.Base);
        await cws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/clock?ticket=" + await Ticket(f, cookie)), CancellationToken.None);
        await cws.SendAsync(Encoding.UTF8.GetBytes("{\"type\":\"clock.ping\",\"seq\":1,\"t0\":5}"), WebSocketMessageType.Text, true, CancellationToken.None);
        var b = new byte[512]; var rr = await cws.ReceiveAsync(b, CancellationToken.None);
        Assert.Contains("clock.pong", Encoding.UTF8.GetString(b, 0, rr.Count));
    }

    [Fact]
    public async Task A_phone_page_device_gets_a_keepalive_frame_while_idle_so_its_watchdog_can_spot_dead_links()
    {
        await using var f = await ServerFixture.StartAsync();
        var tok = f.Token(Role.Control);
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + tok); await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room"), CancellationToken.None);
        await using var stream = WebSocketStream.Create(ws, WebSocketMessageType.Binary, ownsWebSocket: false);
        await FrameIO.WriteAsync(stream, Wire.EncodeJson(MsgType.Hello, 0, new Hello("web-keep01", null, "web", new[] { "pcm24" }, 48000, "wifi", "Keepalive phone", "")), CancellationToken.None);
        using var to = new CancellationTokenSource(12000); bool keep = false;
        while (!keep) { var (h, p) = await FrameIO.ReadAsync(stream, to.Token); if (h.Type == MsgType.CalResult && Encoding.UTF8.GetString(p).Contains("keepalive")) keep = true; }
        Assert.True(keep);
    }
}
