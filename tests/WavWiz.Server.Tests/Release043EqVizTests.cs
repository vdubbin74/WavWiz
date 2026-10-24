using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using WavWiz.Core.Protocol;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.4.3 #10: EQ and the visualizer on ZONE playback (every zone has its own playback group since 0.4.1).
/// EQ must change what the speaker plays (speaker page = saved assignment, EQ view = live preview), per speaker, in a solo zone and in linked zones;
/// the visualizer / EQ meters (/ws/viz) must get frames from the zone that plays (non-default and linked groups); idle groups run no analysis.</summary>
public class Release043EqVizTests
{
    private static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    private static async Task<long> Tone(ServerFixture f, HttpClient admin, double hz = 1000, double sec = 30)
    {
        var m = Directory.CreateDirectory(f.Dir.File("music")).FullName; TestMedia.Tone(Path.Combine(m, "tone.flac"), sec, hz, "Tone");
        (await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = m })).EnsureSuccessStatusCode();
        for (int i = 0; i < 150 && (await admin.GetJson("/api/v1/library/artists")).GetArrayLength() == 0; i++) await Task.Delay(100);
        return (await admin.GetJson("/api/v1/library/find?q=Tone")).GetProperty("tracks")[0].GetProperty("id").GetInt64();
    }
    private static async Task<Dictionary<string, (long Id, string Dev)>> Devices(HttpClient admin)
        => (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!,
            z => (z.GetProperty("id").GetInt64(), z.GetProperty("outputs").EnumerateArray().Where(o => o.GetProperty("active").GetBoolean()).Select(o => o.GetProperty("deviceId").GetString()).FirstOrDefault() ?? ""));
    private static async Task Until(Func<Task<bool>> c, int ms, string what) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (sw.ElapsedMilliseconds < ms) { if (await c()) return; await Task.Delay(100); } Assert.Fail("timed out: " + what); }
    private static async Task<long> CutPreset(HttpClient admin, string name = "Cut 1k")
        => (await (await admin.PostAsJsonAsync("/api/v1/dsp/presets", new { name, preset = new { graphicDb = new double[] { 0, 0, 0, 0, 0, -12, 0, 0, 0, 0 } } })).Json()).GetProperty("id").GetInt64();

    private static async Task<int> VizFrames(ServerFixture f, string? zoneId, int want = 15, int ms = 6000)
    {
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View));
        await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/viz?delayMs=0" + (zoneId != null ? "&zoneId=" + Uri.EscapeDataString(zoneId) : "")), CancellationToken.None);
        int frames = 0; var buf = new byte[4096]; using var cts = new CancellationTokenSource(ms);
        try { while (frames < want) { var r = await ws.ReceiveAsync(buf, cts.Token); if (r.Count >= 1025 && buf[0] == 1 && buf.Skip(1).Take(1024).Max(b => Math.Abs(b - 128)) > 10) frames++; } } catch (OperationCanceledException) { }
        return frames;
    }

    /// <summary>A browser / phone / TV speaker ("web-…", /ws/room) the way room.js connects. It reports one output, "web-speaker".</summary>
    private static async Task<(ClientWebSocket Ws, Stream S)> WebSpeaker(ServerFixture f, string id)
    {
        var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.Control, id));
        await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room"), CancellationToken.None);
        var st = WebSocketStream.Create(ws, WebSocketMessageType.Binary, ownsWebSocket: false);
        await FrameIO.WriteAsync(st, Wire.EncodeJson(MsgType.Hello, 0, new Hello(id, null, "web", new[] { "pcm24" }, 48000, "wifi", "Test phone", "Web page")), CancellationToken.None);
        using var to = new CancellationTokenSource(5000); var (h, _) = await FrameIO.ReadAsync(st, to.Token); Assert.Equal(MsgType.Welcome, h.Type);
        await FrameIO.WriteAsync(st, Wire.EncodeJson(MsgType.Outputs, 0, new OutputsMsg(new[] { new OutputInfo("web-speaker", "Phone speaker", "other", null, true, true) })), CancellationToken.None);
        return (ws, st);
    }
    /// <summary>Reads frames until a DspConfig matching <paramref name="ok"/> arrives (null = none within ms).</summary>
    private static async Task<JsonElement?> NextDsp(Stream st, Func<JsonElement, bool> ok, int ms = 5000)
    {
        using var to = new CancellationTokenSource(ms);
        try { while (true) { var (h, p) = await FrameIO.ReadAsync(st, to.Token); if (h.Type != MsgType.DspConfig) continue; var j = JsonDocument.Parse(p.ToArray()).RootElement.Clone(); if (ok(j)) return j; } }
        catch (Exception e) when (e is OperationCanceledException or IOException or WebSocketException) { return null; }
    }
    private static double Band(JsonElement cfg, int i) => cfg.GetProperty("preset").ValueKind == JsonValueKind.Object ? cfg.GetProperty("preset").GetProperty("graphicDb")[i].GetDouble() : 0;

    [Fact]
    public async Task A_browser_or_phone_speaker_in_a_zone_is_sent_its_saved_EQ_its_live_preview_and_the_revert()
    {
        // room.js (browser, phone and TV speakers share it) applies these with Web Audio filters; tests/ui/eq043.mjs measures that the sound changes.
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var (ws, st) = await WebSpeaker(f, "web-eq1"); await using var _st = st; using var _ws = ws;
        await Until(async () => (await Devices(admin)).TryGetValue("web-eq1", out var x) && x.Dev != "", 8000, "the phone's speaker is listed with its output");
        var d = await Devices(admin); long z = await MakeZone(admin, "Bedroom", d["web-eq1"].Id); await MakeZone(admin, "Hall");      // a second zone: Bedroom plays in its own group
        var pid = await CutPreset(admin, "Phone cut");
        (await admin.PutAsJsonAsync($"/api/v1/dsp/assignments/{Uri.EscapeDataString(d["web-eq1"].Dev)}", new { presetId = pid, enabled = true, bypass = false })).EnsureSuccessStatusCode();
        var saved = await NextDsp(st, j => j.TryGetProperty("preset", out var pr) && pr.ValueKind == JsonValueKind.Object);
        Assert.NotNull(saved); Assert.Equal(-12, Band(saved!.Value, 5), 1); Assert.False(saved.Value.GetProperty("preview").GetBoolean());
        (await admin.PostAsJsonAsync("/api/v1/dsp/preview", new { deviceId = d["web-eq1"].Dev, preset = new { graphicDb = new double[] { 6, 0, 0, 0, 0, 0, 0, 0, 0, 0 } }, bypass = false })).EnsureSuccessStatusCode();
        var prev = await NextDsp(st, j => j.GetProperty("preview").GetBoolean());
        Assert.NotNull(prev); Assert.Equal(6, Band(prev!.Value, 0), 1);
        (await admin.PostAsJsonAsync("/api/v1/dsp/revert", new { deviceId = d["web-eq1"].Dev })).EnsureSuccessStatusCode();
        var back = await NextDsp(st, j => !j.GetProperty("preview").GetBoolean());
        Assert.NotNull(back); Assert.Equal(-12, Band(back!.Value, 5), 1);
        (await admin.PutAsJsonAsync($"/api/v1/dsp/assignments/{Uri.EscapeDataString(d["web-eq1"].Dev)}", new { presetId = pid, enabled = true, bypass = true })).EnsureSuccessStatusCode();
        var byp = await NextDsp(st, j => j.GetProperty("bypass").GetBoolean());
        Assert.NotNull(byp);
    }

    [Fact]
    public async Task Idle_runs_no_playback_engine_and_no_visualizer_analysis()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); await a.WaitConnected();
        await Until(async () => { var x = await Devices(admin); return x.Count == 1 && x.Values.All(v => v.Dev != ""); }, 8000, "1 device"); var d = await Devices(admin);
        long k = await MakeZone(admin, "Kitchen", d["pc-a"].Id);
        Assert.Equal(0, await VizFrames(f, "g:" + k, want: 3, ms: 1200));
        Assert.Equal(0, await VizFrames(f, null, want: 3, ms: 800));
        Assert.All(f.Server.S.Registry.Live(), c => { Assert.True(c.IsIdle, c.GroupId + " is idle"); Assert.False(c.Engine.Playing, c.GroupId + " engine is not pumping"); });
        Assert.True(a.RmsDb() < -90, "nothing plays");
    }

    [Fact]
    public async Task The_visualizer_gets_frames_from_a_playing_zone_group_and_from_a_linked_group()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var tid = await Tone(f, admin, 440);
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); await using var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker"); await a.WaitConnected(); await b.WaitConnected();
        await Until(async () => { var x = await Devices(admin); return x.Count == 2 && x.Values.All(v => v.Dev != ""); }, 8000, "2 devices with their active output"); var d = await Devices(admin);
        long k = await MakeZone(admin, "Kitchen", d["pc-a"].Id), p = await MakeZone(admin, "Patio", d["pc-b"].Id);
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });   // 409 when it already has its own group (0.4.1+)
        Assert.NotEqual("default", f.Server.S.Links.PlaybackId(k));
        (await admin.PostAsJsonAsync($"/api/v1/stream/play?zoneId=g:{k}", new { kind = "tracks", ids = new[] { tid } })).EnsureSuccessStatusCode();
        Assert.True(await VizFrames(f, "g:" + k) >= 10, "the visualizer of the playing zone gets frames");
        Assert.True(await VizFrames(f, null) >= 10, "a page that names no zone follows the zone that plays");
        Assert.True(await VizFrames(f, "g:" + p, want: 3, ms: 2000) == 0, "a quiet zone shows nothing (no frames from another zone's music)");
        // linked: Patio joins Kitchen's group -> both zone ids give the shared group's frames
        (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = k })).EnsureSuccessStatusCode();
        Assert.Equal(f.Server.S.Links.PlaybackId(k), f.Server.S.Links.PlaybackId(p));
        Assert.True(await VizFrames(f, "g:" + p) >= 10, "a linked zone's visualizer gets the shared group's frames");
        (await admin.PostAsync($"/api/v1/stream/stop?zoneId=g:{k}", null)).EnsureSuccessStatusCode(); await Task.Delay(800);
        Assert.Equal(0, await VizFrames(f, "g:" + k, want: 3, ms: 1500));
        Assert.All(f.Server.S.Registry.Live(), c => Assert.True(c.IsIdle || c.State == WavWiz.Server.Playback.PlayState.Stopped, $"{c.GroupId} should be idle"));
    }

    [Fact]
    public async Task EQ_changes_what_the_speaker_plays_in_a_solo_zone_and_in_linked_zones_from_the_speaker_page_and_the_EQ_view()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var tid = await Tone(f, admin, 1000);
        await using var a = await FakePc.StartAsync(f, "pc-a", "Kitchen Speaker"); await using var b = await FakePc.StartAsync(f, "pc-b", "Patio Speaker"); await a.WaitConnected(); await b.WaitConnected();
        await Until(async () => { var x = await Devices(admin); return x.Count == 2 && x.Values.All(v => v.Dev != ""); }, 8000, "2 devices with their active output"); var d = await Devices(admin);
        long k = await MakeZone(admin, "Kitchen", d["pc-a"].Id), p = await MakeZone(admin, "Patio", d["pc-b"].Id);
        await admin.PostAsJsonAsync($"/api/v1/groups/{k}/split", new { }); await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { });   // 409 when it already has its own group (0.4.1+)
        (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/link", new { with = k })).EnsureSuccessStatusCode();      // linked zones: one group, two speakers
        (await admin.PostAsJsonAsync($"/api/v1/stream/play?zoneId=g:{k}", new { kind = "tracks", ids = new[] { tid } })).EnsureSuccessStatusCode();
        try { await Until(() => Task.FromResult(a.RmsDb() > -70 && b.RmsDb() > -70), 8000, "both speakers play the tone"); }
        catch (Exception) { Assert.Fail($"both speakers play the tone: A {a.RmsDb():F1} dB peak {a.MaxPeak} / B {b.RmsDb():F1} peak {b.MaxPeak}; groups {string.Join(",", f.Server.S.Registry.Groups().Select(g => g.Id + "=" + g.State + "[" + string.Join("+", g.PlayerIds) + "]"))}; zones {(await admin.GetJson("/api/v1/zones")).ToString()[..400]}"); }
        await Task.Delay(800); double a0 = a.RmsDb(), b0 = b.RmsDb();
        // speaker page: a saved preset (1 kHz -12 dB) on speaker A only
        var pid = await CutPreset(admin);
        (await admin.PutAsJsonAsync($"/api/v1/dsp/assignments/{Uri.EscapeDataString(d["pc-a"].Dev)}", new { presetId = pid, enabled = true, bypass = false })).EnsureSuccessStatusCode();
        await Until(() => Task.FromResult(a.RmsDb() < a0 - 6), 6000, $"EQ on A lowers its 1 kHz tone (was {a0:F1} dB, now {a.RmsDb():F1})");
        Assert.True(Math.Abs(b.RmsDb() - b0) < 2, $"B (no EQ) is unchanged: {b0:F1} -> {b.RmsDb():F1}");
        Assert.Equal(-12, a.Client.Dsp.Preset.GraphicDb[5], 1);
        // EQ view: a live preview on B (not saved), then revert
        (await admin.PostAsJsonAsync("/api/v1/dsp/preview", new { deviceId = d["pc-b"].Dev, preset = new { graphicDb = new double[] { 0, 0, 0, 0, 0, -12, 0, 0, 0, 0 } }, bypass = false })).EnsureSuccessStatusCode();
        await Until(() => Task.FromResult(b.RmsDb() < b0 - 6), 6000, $"a live EQ preview lowers B (was {b0:F1}, now {b.RmsDb():F1})");
        (await admin.PostAsJsonAsync("/api/v1/dsp/revert", new { deviceId = d["pc-b"].Dev })).EnsureSuccessStatusCode();
        await Until(() => Task.FromResult(Math.Abs(b.RmsDb() - b0) < 2), 6000, "revert brings B back");
        // EQ off (bypass) on A brings it back
        (await admin.PutAsJsonAsync($"/api/v1/dsp/assignments/{Uri.EscapeDataString(d["pc-a"].Dev)}", new { presetId = pid, enabled = true, bypass = true })).EnsureSuccessStatusCode();
        await Until(() => Task.FromResult(Math.Abs(a.RmsDb() - a0) < 2), 6000, "bypass brings A back");
        // split again: the EQ still applies in A's own zone group
        (await admin.PostAsJsonAsync($"/api/v1/groups/{p}/split", new { })).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync($"/api/v1/dsp/assignments/{Uri.EscapeDataString(d["pc-a"].Dev)}", new { presetId = pid, enabled = true, bypass = false })).EnsureSuccessStatusCode();
        Assert.Equal(-12, a.Client.Dsp.Preset.GraphicDb[5], 1);
    }
}
