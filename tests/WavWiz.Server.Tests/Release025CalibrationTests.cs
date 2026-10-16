using System.Net;
using System.Text.Json;
using WavWiz.Core.Calibration;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
using WavWiz.Server.Api;
namespace WavWiz.Server.Tests;

/// <summary>0.2.5: calibration that just works - PC-mic (native WASAPI capture on a Player, here a fake capture device), Bluetooth/wired mic logic,
/// and the phone's mic-only page (one-time link code instead of a sign-in, never a speaker).</summary>
public class Release025CalibrationTests
{
    private static async Task WaitUntil(Func<bool> cond, int ms = 15000, string what = "condition") { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!cond() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(cond(), "timed out waiting for " + what); }

    // ---------------------------------------------------------------- wired / Bluetooth mic logic (pure)
    [Theory]
    [InlineData("Microphone (USB Audio Device)", @"USB\VID_0D8C&PID_0014\5&1", "USB", 4, "usb", false)]
    [InlineData("Headset (Jabra Evolve 65 Hands-Free AG Audio)", @"BTHHFENUM\{0000111e-0000-1000-8000-00805f9b34fb}_LOCALMFG&0002\7&2&0&50C2ED6A1F3B_C00000000", "BTHHFENUM", 5, "bluetooth", true)]
    [InlineData("Headset Microphone (AirPods Pro)", null, null, 5, "bluetooth", true)]
    [InlineData("Microphone (Realtek(R) Audio)", @"HDAUDIO\FUNC_01&VEN_10EC", "HDAUDIO", 4, "analog", false)]
    [InlineData("Microphone Array (Intel Smart Sound Technology)", @"INTELAUDIO\FUNC_01", "INTELAUDIO", 4, "builtin", false)]
    [InlineData("Analogue 1 + 2 (Focusrite USB Audio)", @"USB\VID_1235", "USB", 2, "interface", false)]
    [InlineData("Line In (High Definition Audio)", @"HDAUDIO\FUNC_01", "HDAUDIO", 2, "analog", false)]
    [InlineData("Stereo Mix (Some Driver)", null, "SWD", 10, "other", false)]
    public void Mic_kinds_wired_mics_are_supported_and_Bluetooth_is_detected(string name, string? ctl, string? en, int ff, string kind, bool bt)
    {
        Assert.Equal(kind, MicKinds.Classify(name, ctl, en, ff));
        Assert.Equal(bt, MicKinds.IsBluetooth(name, ctl, en));
    }

    [Fact]
    public void Mic_choice_prefers_the_remembered_mic_then_a_wired_one_over_a_Bluetooth_default()
    {
        var bt = new MicInfo("b", "Headset (Hands-Free)", "bluetooth", true, Default: true); var usb = new MicInfo("u", "USB mic", "usb", false); var lap = new MicInfo("l", "Microphone Array", "builtin", false);
        Assert.Equal("u", MicKinds.Choose(new[] { bt, lap, usb }, null)!.Id);          // a Bluetooth default never wins over a wired mic; USB first
        Assert.Equal("b", MicKinds.Choose(new[] { bt, lap, usb }, "b")!.Id);           // ...but the person's own choice is remembered (allowed, only flagged)
        Assert.Equal("l", MicKinds.Choose(new[] { lap }, "gone")!.Id);
        Assert.Equal("b", MicKinds.Choose(new[] { bt }, null)!.Id);                    // only Bluetooth: allowed, never blocked
        Assert.Null(MicKinds.Choose(Array.Empty<MicInfo>(), null));
        Assert.Contains("Bluetooth mics add their own delay", MicKinds.BluetoothWarning);
    }

    [Fact]
    public void Mic_recordings_go_over_the_wire_in_parts_under_the_payload_limit_and_come_back_intact()
    {
        var x = new float[48000 * 6 + 123]; for (int i = 0; i < x.Length; i++) x[i] = (float)Math.Sin(i * 0.01) * 0.5f;
        var parts = MicPcm.Encode("s1", "r1", "mic", x, 48000, 123456789);
        Assert.Equal(4, parts.Count); Assert.All(parts, p => Assert.Equal(4, p.Parts));
        Assert.All(parts, p => Assert.True(Wire.EncodeJson(MsgType.CalResult, 0, p).Length < Wire.MaxPayload, "part too large"));
        var back = MicPcm.Decode(parts.AsEnumerable().Reverse());
        Assert.Equal(x.Length, back.Length); Assert.True(x.Zip(back).Max(t => Math.Abs(t.First - t.Second)) < 1e-4);
        Assert.Equal(-100, MicPcm.PeakDb(new float[10])); Assert.InRange(MicPcm.PeakDb(new[] { 0.5f }), -6.1, -5.9);
    }

    // ---------------------------------------------------------------- PC-mic end to end (real server + Players, fake capture device)
    [Fact]
    public async Task B3_guided_run_waits_for_Ready_skip_keeps_delay_retry_measures_one_speaker()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room", hiddenMs: 15);
        await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen", hiddenMs: 52);
        var micDev = new SynthMicProvider();
        const double micInputDelayMs = 9;    // the mic's own input delay: unknown, must cancel out
        micDev.Synth = (_, startUs, n) => { var rec = new float[n]; a.MixInto(rec, startUs, micInputDelayMs); b.MixInto(rec, startUs, micInputDelayMs); var rnd = new Random(3); for (int i = 0; i < n; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f; return rec; };
        await using var m = await FakePc.StartAsync(f, "pc-mic", "Office PC", mics: micDev);
        await a.WaitConnected(); await b.WaitConnected(); await m.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 3 && f.Server.S.Audio.Get("pc-mic")?.Mics.Length == 1, what: "zones + mic list");
        var zones = f.Server.S.Zones.Zones(); long refId = zones.First(z => z.PlayerId == "pc-ref").Id, devId = zones.First(z => z.PlayerId == "pc-dev").Id;

        var pcs = await admin.GetJson("/api/v1/calibration/pc-mics");
        var pc = pcs.GetProperty("pcs").EnumerateArray().Single(p => p.GetProperty("playerId").GetString() == "pc-mic");
        Assert.Equal("mic-usb-1", pc.GetProperty("selected").GetString()); Assert.False(pc.GetProperty("mics")[0].GetProperty("bluetooth").GetBoolean());
        Assert.Equal("USB mic", pc.GetProperty("mics")[0].GetProperty("label").GetString());

        var r = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", referenceZoneId = refId, micPlayerId = "pc-mic", micId = "mic-usb-1", zoneIds = new[] { devId }, runs = 1 });
        var sess = await r.Json(); Assert.True(r.IsSuccessStatusCode, sess.ToString()); string sid = sess.GetProperty("id").GetString()!;
        JsonElement st = default; string Phase() { st = admin.GetJson($"/api/v1/calibration/sessions/{sid}").Result; return st.GetProperty("phase").GetString()!; }
        async Task Answer(string action, int code = 200) { var g = await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/guide", new { action }); Assert.Equal(code, (int)g.StatusCode); }
        await WaitUntil(() => Phase() == "waiting", 20000, "first prompt");
        var pr = st.GetProperty("prompt"); Assert.Equal(1, pr.GetProperty("step").GetInt32()); Assert.Equal(3, pr.GetProperty("steps").GetInt32());
        Assert.Equal(refId, pr.GetProperty("zoneId").GetInt64()); Assert.False(pr.GetProperty("canSkip").GetBoolean());
        Assert.Equal("Walk to Living Room, hold the mic about 3 ft in front of it, then tap Ready", pr.GetProperty("text").GetString());
        await Task.Delay(500); Assert.Equal(0, micDev.Recordings);                       // nothing plays or records until Ready
        await Answer("skip", 409);                                                       // the reference cannot be skipped
        await Answer("ready");
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("zoneId").GetInt64() == devId, 30000, "Kitchen prompt");
        Assert.True(st.GetProperty("prompt").GetProperty("canSkip").GetBoolean()); int before = micDev.Recordings;
        await Answer("skip");
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("step").GetInt32() == 3, 30000, "reference again");
        Assert.Equal(before, micDev.Recordings);                                         // skipped: Kitchen not measured
        await Answer("ready");
        await WaitUntil(() => Phase() is "done" or "failed", 30000, "done");
        Assert.Equal("done", st.GetProperty("phase").GetString());
        Assert.DoesNotContain(st.GetProperty("proposals").EnumerateArray(), p => p.GetProperty("zoneId").GetInt64() == devId);
        Assert.Contains(st.GetProperty("messages").EnumerateArray(), m => m.GetString() == "Skipped Kitchen: its delay is unchanged");
        Assert.Contains(st.GetProperty("skipped").EnumerateArray(), z => z.GetInt64() == devId);
        // Retry only Kitchen: one prompt, one recording, then a proposal for it
        var rt = await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/retry", new { zoneId = devId }); Assert.True(rt.IsSuccessStatusCode, await rt.Content.ReadAsStringAsync());
        Assert.Equal(409, (int)(await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/retry", new { zoneId = refId })).StatusCode);
        await WaitUntil(() => Phase() == "waiting", 20000, "retry prompt"); Assert.Equal(devId, st.GetProperty("prompt").GetProperty("zoneId").GetInt64());
        before = micDev.Recordings; await Answer("ready");
        await WaitUntil(() => Phase() is "done" or "failed" && st.GetProperty("proposals").ValueKind == JsonValueKind.Array, 30000, "retry done");
        Assert.Equal(before + 2, micDev.Recordings);                                    // 0.3.7 L22: the pre-check at that spot, then the measurement
        var prop = st.GetProperty("proposals").EnumerateArray().Single(p => p.GetProperty("zoneId").GetInt64() == devId);
        Assert.InRange(prop.GetProperty("proposedLatencyMs").GetDouble(), 52 - 15 - 2.5, 52 - 15 + 2.5);
        Assert.DoesNotContain(st.GetProperty("messages").EnumerateArray(), m => m.GetString()!.StartsWith("Skipped"));
        await admin.PostAsync($"/api/v1/calibration/sessions/{sid}/end", null);
    }

    [Fact]
    public async Task Pc_mic_calibration_end_to_end_measures_hidden_delays_with_a_USB_mic_and_saves_them()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room", hiddenMs: 15);
        await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen", hiddenMs: 52);
        var micDev = new SynthMicProvider();
        const double micInputDelayMs = 9;    // the mic's own input delay: unknown, must cancel out
        micDev.Synth = (_, startUs, n) => { var rec = new float[n]; a.MixInto(rec, startUs, micInputDelayMs); b.MixInto(rec, startUs, micInputDelayMs); var rnd = new Random(3); for (int i = 0; i < n; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f; return rec; };
        await using var m = await FakePc.StartAsync(f, "pc-mic", "Office PC", mics: micDev);
        await a.WaitConnected(); await b.WaitConnected(); await m.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 3 && f.Server.S.Audio.Get("pc-mic")?.Mics.Length == 1, what: "zones + mic list");
        var zones = f.Server.S.Zones.Zones(); long refId = zones.First(z => z.PlayerId == "pc-ref").Id, devId = zones.First(z => z.PlayerId == "pc-dev").Id;

        var pcs = await admin.GetJson("/api/v1/calibration/pc-mics");
        var pc = pcs.GetProperty("pcs").EnumerateArray().Single(p => p.GetProperty("playerId").GetString() == "pc-mic");
        Assert.Equal("mic-usb-1", pc.GetProperty("selected").GetString()); Assert.False(pc.GetProperty("mics")[0].GetProperty("bluetooth").GetBoolean());
        Assert.Equal("USB mic", pc.GetProperty("mics")[0].GetProperty("label").GetString());

        var r = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", referenceZoneId = refId, micPlayerId = "pc-mic", micId = "mic-usb-1", zoneIds = new[] { devId }, runs = 1 });
        var sess = await r.Json(); Assert.True(r.IsSuccessStatusCode, sess.ToString());
        string sid = sess.GetProperty("id").GetString()!; Assert.True(sess.GetProperty("bluetoothWarning").ValueKind == JsonValueKind.Null);
        var mics = await admin.GetJson("/api/v1/calibration/mics");      // the Devices "Calibration mic" line
        Assert.Contains(mics.EnumerateArray(), x => x.GetProperty("kind").GetString() == "pc" && x.GetProperty("device").GetString()!.Contains("USB Microphone"));
        JsonElement st = default;
        // 0.3.1 B3: the run is guided now - answer Ready at each speaker
        await WaitUntil(() => { st = admin.GetJson($"/api/v1/calibration/sessions/{sid}").Result; if (st.GetProperty("phase").GetString() == "waiting") admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/guide", new { action = "ready" }).Wait(); return st.GetProperty("phase").GetString() is "done" or "failed" or "canceled"; }, 60000, "PC-mic run");
        Assert.Equal("done", st.GetProperty("phase").GetString());
        Assert.Equal(6, micDev.Recordings);            // (0.3.7 L22: a pre-check before each) reference, Kitchen, reference again - recorded natively on the mic PC
        var prop = st.GetProperty("proposals").EnumerateArray().Single(p => p.GetProperty("zoneId").GetInt64() == devId);
        double lat = prop.GetProperty("proposedLatencyMs").GetDouble(); Assert.InRange(lat, 52 - 15 - 2.5, 52 - 15 + 2.5);       // measured vs injected: 37 ms
        Assert.True(prop.GetProperty("confidence").GetDouble() >= 0.6, prop.ToString());
        var c = await (await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/commit", new { })).Json(); Assert.Equal(1, c.GetProperty("saved").GetInt32());
        await WaitUntil(() => Math.Abs(b.Client.State.LatencyMs - lat) < 0.2 && b.Client.State.LatencySource == "measured", what: "saved delay at the player");
        var hist = await admin.GetJson($"/api/v1/outputs/{Uri.EscapeDataString(f.Server.S.Zones.Zone(devId)!.Outputs[0].DeviceId)}/calibrations");
        Assert.Equal("mic", hist[0].GetProperty("method").GetString());
        Assert.Equal(0, f.Server.S.Cal.OpenSessions);
        Assert.DoesNotContain((await admin.GetJson("/api/v1/calibration/mics")).EnumerateArray(), x => x.GetProperty("kind").GetString() == "pc");
    }

    [Fact]
    public async Task Pc_mic_with_no_microphone_gets_a_plain_message_and_a_Bluetooth_mic_is_flagged_not_blocked()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room");
        await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen", mics: new NoMicProvider());
        var bt = new SynthMicProvider(); bt.Mics.Clear(); bt.Mics.Add(new MicInfo("bt-1", "Headset (Jabra Hands-Free AG Audio)", "bluetooth", true, true)); bt.MeterDb = -18;
        await using var m = await FakePc.StartAsync(f, "pc-bt", "Den PC", mics: bt);
        await a.WaitConnected(); await b.WaitConnected(); await m.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 3 && f.Server.S.Audio.Get("pc-bt")?.Mics.Length == 1, what: "zones");
        long refId = f.Server.S.Zones.Zones().First(z => z.PlayerId == "pc-ref").Id;

        var none = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", referenceZoneId = refId, micPlayerId = "pc-dev" });
        Assert.Equal(HttpStatusCode.Conflict, none.StatusCode); Assert.Contains("No microphone found on this PC", (await none.Json()).GetProperty("error").GetString());
        var pcs = (await admin.GetJson("/api/v1/calibration/pc-mics")).GetProperty("pcs");
        Assert.Equal(0, pcs.EnumerateArray().Single(p => p.GetProperty("playerId").GetString() == "pc-dev").GetProperty("mics").GetArrayLength());
        var btPc = pcs.EnumerateArray().Single(p => p.GetProperty("playerId").GetString() == "pc-bt");
        Assert.True(btPc.GetProperty("mics")[0].GetProperty("bluetooth").GetBoolean()); Assert.Equal("Bluetooth (hands-free)", btPc.GetProperty("mics")[0].GetProperty("label").GetString());

        // live level meter: the Player meters its mic natively and the server relays it
        var got = new List<string>(); var (subId, reader) = f.Server.S.Events.Subscribe();
        (await admin.PostAsJsonAsync("/api/v1/calibration/pc-mics/level", new { playerId = "pc-bt", micId = "bt-1", on = true })).EnsureSuccessStatusCode();
        using (var cts = new CancellationTokenSource(5000)) { try { while (!got.Any(x => x.Contains("\"miclevel\""))) got.Add(await reader.ReadAsync(cts.Token)); } catch (OperationCanceledException) { } }
        Assert.Contains(got, x => x.Contains("\"miclevel\"") && x.Contains("-18"));
        await admin.PostAsJsonAsync("/api/v1/calibration/pc-mics/level", new { playerId = "pc-bt", micId = "bt-1", on = false }); f.Server.S.Events.Unsubscribe(subId);

        var r = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", referenceZoneId = refId, micPlayerId = "pc-bt", micId = "bt-1", runs = 1 });
        var s = await r.Json(); Assert.True(r.IsSuccessStatusCode, s.ToString());                         // allowed...
        Assert.Equal(MicKinds.BluetoothWarning, s.GetProperty("bluetoothWarning").GetString());          // ...but flagged
        await admin.PostAsync($"/api/v1/calibration/sessions/{s.GetProperty("id").GetString()}/end", null);
        Assert.Equal(0, f.Server.S.Cal.OpenSessions);
    }

    // ---------------------------------------------------------------- phone mic-only page: link code instead of sign-in, never a speaker
    [Fact]
    public async Task Phone_mic_page_link_code_authorizes_calibration_only_and_can_be_stopped()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room"); await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected(); await WaitUntil(() => f.Server.S.Zones.Zones().Count == 2, what: "zones");
        var link = await (await admin.PostAsJsonAsync("/api/v1/calibration/phone-link", new { })).Json(); var tok = link.GetProperty("token").GetString()!;
        Assert.True(link.GetProperty("allSpeakers").GetBoolean()); Assert.False(link.GetProperty("signsIn").GetBoolean());
        Assert.Equal("/calmic.html?cal=" + tok, link.GetProperty("micUrl").GetString());

        using var phone = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        // the short link no longer mints a pairing code; without HTTPS it opens the mic page (which explains that HTTPS is needed)
        var go = await phone.GetAsync($"/c/{tok}"); Assert.Equal(HttpStatusCode.Redirect, go.StatusCode);
        Assert.DoesNotContain("pair=", go.Headers.Location!.ToString()); Assert.EndsWith("/calmic.html?cal=" + tok, go.Headers.Location!.ToString());

        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync($"/api/v1/calibration/phone-link/{tok}/plan")).StatusCode);
        phone.DefaultRequestHeaders.Add(CalPhoneApi.Header, tok);
        var plan = await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan");
        Assert.Equal("Living Room", plan.GetProperty("reference").GetProperty("name").GetString());     // first wired-ish connected speaker is the reference
        Assert.Single(plan.GetProperty("speakers").EnumerateArray());
        // calibration only: the rest of the app stays closed to the code
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/zones")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.PostAsJsonAsync("/api/v1/stream/play", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.PutAsJsonAsync("/api/v1/calibration/reference", new { zoneId = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", micPlayerId = "pc-dev" })).StatusCode);

        var hi = await (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/hello", new { state = "opened", device = "iPhone" })).Json();
        Assert.False(hi.GetProperty("stop").GetBoolean());
        var sess = await (await phone.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = plan.GetProperty("reference").GetProperty("id").GetInt64(), micSource = "phone", micProcessing = "raw" })).Json();
        Assert.True(sess.TryGetProperty("id", out _), sess.ToString()); var sid = sess.GetProperty("id").GetString()!; Assert.Null(sess.GetProperty("onlyZoneId").GetString());
        (await phone.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/progress", new { step = 1, steps = 7, label = "Living Room (reference, 1/3)", phase = "running" })).EnsureSuccessStatusCode();
        var pr = await admin.GetJson($"/api/v1/calibration/sessions/{sid}"); Assert.Equal(1, pr.GetProperty("step").GetInt32()); Assert.Equal("running", pr.GetProperty("phase").GetString());
        Assert.Equal(sid, (await admin.GetJson($"/api/v1/calibration/phone-link/{tok}")).GetProperty("sessionId").GetString());

        // Devices: the phone is a "Calibration mic" line, never a speaker
        var mics = await admin.GetJson("/api/v1/calibration/mics");
        var line = mics.EnumerateArray().Single(); Assert.Equal("phone", line.GetProperty("kind").GetString()); Assert.Equal("iPhone", line.GetProperty("device").GetString());
        Assert.Equal(2, (await admin.GetJson("/api/v1/zones")).GetArrayLength());

        // Stop using as mic: the session ends, the phone is told to stop, the code stops working
        (await admin.PostAsync($"/api/v1/calibration/phone-link/{tok}/stop", null)).EnsureSuccessStatusCode();
        Assert.Equal(0, f.Server.S.Cal.OpenSessions); Assert.Equal(0, (await admin.GetJson("/api/v1/calibration/mics")).GetArrayLength());
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/hello", new { state = "measuring" })).StatusCode);
    }

    [Fact]
    public async Task A_regular_users_phone_link_measures_only_that_users_own_speaker()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var l = CalPhoneApi.Create(false, DateTimeOffset.UtcNow, ownerZoneId: null);
        using var phone = new HttpClient { BaseAddress = new Uri(f.Base) }; phone.DefaultRequestHeaders.Add(CalPhoneApi.Header, l.Token);
        var r = await phone.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Contains("without a speaker of their own", (await r.Json()).GetProperty("error").GetString());
        Assert.Equal("https://10.0.0.5:8443/calmic.html?cal=ABCDEF", CalPhoneApi.SecureUrl("10.0.0.5", 8443, "ABCDEF", "123456"));
    }
}
