using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using WavWiz.Core.Protocol;
namespace WavWiz.Server.Tests;

/// <summary>0.2.3 U11: revoking a device (or forgetting it) takes it off the Devices list at once, on every open page, and it has to pair again.</summary>
public class Release023Tests
{
    private static Uri Ws(ServerFixture f, string path) => new(f.Base.Replace("http", "ws") + path);

    /// <summary>Opens a browser speaker ("web-…") the way a paired phone page does, with that phone's own token.</summary>
    private static async Task<(ClientWebSocket Ws, Stream S)> WebSpeaker(ServerFixture f, string token, string id)
    {
        var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + token);
        await ws.ConnectAsync(Ws(f, "/ws/room"), CancellationToken.None);
        var s = WebSocketStream.Create(ws, WebSocketMessageType.Binary, ownsWebSocket: false);
        await FrameIO.WriteAsync(s, Wire.EncodeJson(MsgType.Hello, 0, new Hello(id, null, "web", new[] { "pcm24" }, 48000, "wifi", "Test phone", "Web page")), CancellationToken.None);
        using var to = new CancellationTokenSource(5000);
        var (h, _) = await FrameIO.ReadAsync(s, to.Token); Assert.Equal(MsgType.Welcome, h.Type);
        await FrameIO.WriteAsync(s, Wire.EncodeJson(MsgType.Outputs, 0, new OutputsMsg(new[] { new OutputInfo("web-speaker", "Phone speaker", "other", null, true, true) })), CancellationToken.None);
        return (ws, s);
    }
    private static async Task<string[]> Ids(HttpClient a) => (await a.GetJson("/api/v1/zones")).EnumerateArray().Select(z => z.GetProperty("playerId").GetString()!).ToArray();
    private static async Task<bool> Until(Func<Task<bool>> ok, int ms = 5000) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (sw.ElapsedMilliseconds < ms) { if (await ok()) return true; await Task.Delay(50); } return await ok(); }
    private static long TokenId(ServerFixture f, string name) => Convert.ToInt64(f.Server.S.Db.Scalar("SELECT id FROM api_token WHERE name=$n", ("$n", name)));

    /// <summary>Reads frames until a Bye (or the socket ends) and returns its reason.</summary>
    private static async Task<string?> ByeReason(Stream s)
    {
        using var to = new CancellationTokenSource(5000);
        try { while (true) { var (h, p) = await FrameIO.ReadAsync(s, to.Token); if (h.Type == MsgType.Bye) return Wire.DecodeJson<Bye>(p)?.Reason; } }
        catch (Exception e) when (e is IOException or WebSocketException or EndOfStreamException or OperationCanceledException) { return null; }
    }

    [Fact]
    public async Task U11_revoking_a_paired_phone_removes_its_browser_speaker_live_and_it_has_to_pair_again()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin, "admin")); var phone = f.Token(Role.Control, "Anna's phone");
        var (ws, s) = await WebSpeaker(f, phone, "web-anna1");
        await using var _s = s; using var _ws = ws;
        Assert.True(await Until(async () => (await Ids(admin)).Contains("web-anna1")), "the phone's speaker is listed");
        Assert.Equal(TokenId(f, "Anna's phone"), Convert.ToInt64(f.Server.S.Db.Scalar("SELECT owner_token_id FROM player WHERE id='web-anna1'")));

        // another open page (its UI event socket) must hear about it without a reload
        using var ev = new ClientWebSocket(); ev.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View, "tv")); await ev.ConnectAsync(Ws(f, "/ws"), CancellationToken.None);
        // the phone's own event socket
        using var mine = new ClientWebSocket(); mine.Options.SetRequestHeader("Authorization", "Bearer " + phone); await mine.ConnectAsync(Ws(f, "/ws"), CancellationToken.None);
        var ticket = (await f.As(phone).PostAsync("/api/v1/auth/ws-ticket", null).ContinueWith(t => t.Result.Json())).Result.GetProperty("ticket").GetString();   // issued before the revoke

        var r = await admin.DeleteAsync($"/api/v1/tokens/{TokenId(f, "Anna's phone")}");      // plain revoke, no ?removeFromList
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Json(); Assert.True(j.GetProperty("removed").GetBoolean()); Assert.Contains("web-anna1", j.GetProperty("players").EnumerateArray().Select(x => x.GetString()));

        Assert.DoesNotContain("web-anna1", await Ids(admin));                                  // gone at once, not "offline"
        Assert.Equal(0, Convert.ToInt32(f.Server.S.Db.Scalar("SELECT COUNT(*) FROM player WHERE id='web-anna1'")));
        Assert.StartsWith("unauthorized", await ByeReason(s) ?? "unauthorized");               // the speaker connection is told and closed
        Assert.True(await Until(() => Task.FromResult(f.Server.S.Audio.Get("web-anna1") == null)), "its audio session is closed");

        // the other page got a "zones" push
        var buf = new byte[8192]; bool zones = false; using var cts = new CancellationTokenSource(4000);
        try { while (!zones) { var m = await ev.ReceiveAsync(buf, cts.Token); zones = System.Text.Encoding.UTF8.GetString(buf, 0, m.Count).Contains("\"zones\""); } } catch (OperationCanceledException) { }
        Assert.True(zones, "every open page gets a zones update");

        // the revoked session lost its event feed and every way back in
        bool closed = false; using var c2 = new CancellationTokenSource(4000);
        try { while (true) { var m = await mine.ReceiveAsync(buf, c2.Token); if (m.MessageType == WebSocketMessageType.Close) { closed = true; break; } } } catch (Exception e) when (e is WebSocketException or OperationCanceledException) { closed = mine.State != WebSocketState.Open || !c2.IsCancellationRequested; }
        Assert.True(closed, "the revoked page's event socket is closed");
        using var again = new ClientWebSocket(); again.Options.SetRequestHeader("Authorization", "Bearer " + phone);
        await Assert.ThrowsAnyAsync<WebSocketException>(() => again.ConnectAsync(Ws(f, "/ws/room"), CancellationToken.None));
        using var byTicket = new ClientWebSocket();
        await Assert.ThrowsAnyAsync<WebSocketException>(() => byTicket.ConnectAsync(Ws(f, "/ws/room?ticket=" + ticket), CancellationToken.None));
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.As(phone).GetAsync("/api/v1/zones")).StatusCode);
        await Task.Delay(800); Assert.DoesNotContain("web-anna1", await Ids(admin));            // and it does not come back
    }

    [Fact]
    public async Task U11_revoking_one_phone_keeps_the_other_devices()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin, "admin"));
        var (w1, s1) = await WebSpeaker(f, f.Token(Role.Control, "p1"), "web-p1"); var (w2, s2) = await WebSpeaker(f, f.Token(Role.Control, "p2"), "web-p2");
        await using var _1 = s1; await using var _2 = s2; using var _w1 = w1; using var _w2 = w2;
        Assert.True(await Until(async () => (await Ids(admin)).Length == 2));
        (await admin.DeleteAsync($"/api/v1/tokens/{TokenId(f, "p1")}")).EnsureSuccessStatusCode();
        Assert.Equal(new[] { "web-p2" }, await Ids(admin));
        Assert.NotNull(f.Server.S.Audio.Get("web-p2"));
    }

    [Fact]
    public async Task U11_forgetting_a_browser_speaker_removes_it_at_once()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin, "admin"));
        var (ws, s) = await WebSpeaker(f, f.Token(Role.Control, "tablet"), "web-tab1");
        await using var _s = s; using var _ws = ws;
        Assert.True(await Until(async () => (await Ids(admin)).Contains("web-tab1")));
        (await admin.DeleteAsync("/api/v1/players/web-tab1")).EnsureSuccessStatusCode();
        Assert.DoesNotContain("web-tab1", await Ids(admin));
        Assert.StartsWith("unauthorized", await ByeReason(s) ?? "unauthorized");               // the page is told, and (room.js) stops instead of rejoining
        await Task.Delay(800); Assert.DoesNotContain("web-tab1", await Ids(admin));
    }
}
