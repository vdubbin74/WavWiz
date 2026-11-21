using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
using WavWiz.Server.Inputs;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.7.2 B: audio inputs of the Player on the server PC (Aux in / Turntable, S/PDIF in, microphones, this PC's sound).
/// The real WASAPI capture only runs on Windows; here the Player uses <see cref="SynthInputProvider"/> (a 440 Hz tone at a level the test sets).</summary>
public class Release072InputsTests
{
    // ---------------- wire ----------------
    [Fact]
    public void Input_audio_round_trips_and_carries_ids_with_colons()
    {
        var pcm = new float[] { 0f, 0.5f, -0.5f, 0.25f, 1f, -1f };
        var msg = Wire.EncodeInputAudio(7, InputIds.ProcessLoopback, 44100, 2, 123_456_789, pcm);
        Assert.True(Wire.TryReadHeader(msg, out var h, out var err), err);
        Assert.Equal(MsgType.InputAudio, h.Type);
        Assert.True(Wire.TryDecodeInputAudio(msg.AsSpan(Wire.HeaderSize), out var id, out var rate, out var ch, out var us, out var back, out err), err);
        Assert.Equal(InputIds.ProcessLoopback, id); Assert.Equal(44100, rate); Assert.Equal(2, ch); Assert.Equal(123_456_789, us);
        Assert.Equal(pcm.Length, back.Length);
        for (int i = 0; i < pcm.Length; i++) Assert.InRange(back[i], pcm[i] - 1e-5f, pcm[i] + 1e-5f);     // 24-bit
        Assert.False(Wire.TryDecodeInputAudio(new byte[] { 3, (byte)'a' }, out _, out _, out _, out _, out _, out _));   // truncated
    }

    [Fact]
    public void Player_error_reasons_survive_ids_with_colons()
    {
        var r = InputResponder.ErrorReason(InputIds.ProcessLoopback, "needs Windows 10 2004: or later");
        Assert.Equal("input-error:loopback:process\nneeds Windows 10 2004: or later", r);
    }

    // ---------------- Windows provider rules (pure; the WASAPI calls themselves only run on Windows) ----------------
    [Fact]
    public void Capture_endpoints_are_classified_and_stereo_mix_is_never_offered()
    {
        Assert.Equal("aux", InputRules.Classify("Line In (Realtek(R) Audio)", 2));
        Assert.Equal("aux", InputRules.Classify("Line (USB Audio CODEC)", 2));
        Assert.Equal("spdif", InputRules.Classify("Digital Audio Interface (S/PDIF)", 10));
        Assert.Equal("spdif", InputRules.Classify("Realtek Digital Input", 8));
        Assert.Equal("mic", InputRules.Classify("Headset Microphone (Jabra)", 5));
        Assert.Equal("mic", InputRules.Classify("Microphone Array (Intel)", 4));
        Assert.Null(InputRules.Classify("Stereo Mix (Realtek(R) Audio)", 2));        // would record WavWiz itself
        Assert.Null(InputRules.Classify("What U Hear (Sound Blaster)", 10));
    }

    [Fact]
    public void Process_loopback_needs_windows_10_2004_and_device_loopback_refuses_wavwiz_own_output()
    {
        Assert.True(InputRules.ProcessLoopbackSupported(new Version(10, 0, 19041)));
        Assert.True(InputRules.ProcessLoopbackSupported(new Version(10, 0, 26100)));
        Assert.False(InputRules.ProcessLoopbackSupported(new Version(10, 0, 18363)));
        Assert.False(InputRules.ProcessLoopbackSupported(new Version(6, 3, 9600)));
        Assert.Equal(InputRules.EchoRefused, InputRules.DeviceLoopbackRefusal("{0.0.0.00000000}.{ABC}", "{0.0.0.00000000}.{abc}"));
        Assert.Null(InputRules.DeviceLoopbackRefusal("{0.0.0.00000000}.{ABC}", "{0.0.0.00000000}.{DEF}"));   // WavWiz plays elsewhere: no echo
        Assert.Null(InputRules.DeviceLoopbackRefusal("{0.0.0.00000000}.{ABC}", null));                        // WavWiz plays nothing here
    }

    [Fact]
    public void Capture_formats_convert_to_float_and_surround_keeps_front_left_right()
    {
        var i16 = new byte[] { 0x00, 0x40, 0x00, 0xC0 };                                  // +0.5, -0.5
        Assert.Equal(new[] { 0.5f, -0.5f }, InputRules.ToFloat(i16, 16, false));
        var i24 = new byte[] { 0x00, 0x00, 0x40, 0x00, 0x00, 0xC0 };
        Assert.Equal(new[] { 0.5f, -0.5f }, InputRules.ToFloat(i24, 24, false));
        var f32 = new byte[8]; BitConverter.TryWriteBytes(f32.AsSpan(0, 4), 0.25f); BitConverter.TryWriteBytes(f32.AsSpan(4, 4), -1f);
        Assert.Equal(new[] { 0.25f, -1f }, InputRules.ToFloat(f32, 32, true));
        Assert.Throws<NotSupportedException>(() => InputRules.ToFloat(new byte[4], 8, false));
        var six = new float[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };                  // two 5.1 frames
        Assert.Equal(new float[] { 1, 2, 7, 8 }, InputRules.ToStereoOrMono(six, 6, out var oc)); Assert.Equal(2, oc);
        Assert.Equal(new float[] { 1, 2 }, InputRules.ToStereoOrMono(new float[] { 1, 2 }, 1, out oc)); Assert.Equal(1, oc);
    }

    // ---------------- needle drop / end of side / phono warning ----------------
    [Fact]
    public void Detector_starts_on_a_held_signal_ignores_track_gaps_and_ends_after_long_quiet()
    {
        var d = new InputSignalDetector();
        long t = 0; (bool S, bool E) r = default;
        for (; t < 1900; t += 20) { r = d.Update(-20, t); Assert.False(r.S); }    // a click / a short burst is not a needle drop
        for (; t <= 2100; t += 20) { r = d.Update(-20, t); if (r.S) break; }
        Assert.True(r.S); Assert.True(d.Signal);
        for (long e = t + 6000; t < e; t += 20) Assert.False(d.Update(-90, t).Ended);   // a 6 s gap between tracks
        for (long e = t + 2000; t < e; t += 20) d.Update(-20, t);
        bool ended = false; long q0 = t;
        for (; t < q0 + 26_000 && !ended; t += 20) ended = d.Update(-90, t).Ended;
        Assert.True(ended); Assert.InRange(t - q0, 25_000, 25_100); Assert.False(d.Signal);
    }

    [Fact]
    public void Detector_warns_when_a_turntable_has_no_phono_preamp_and_not_at_line_level()
    {
        var low = new InputSignalDetector();
        for (long t = 0; t < 12_000; t += 20) low.Update(-40, t);                   // a cartridge straight into line in: about -40 dBFS
        Assert.True(low.Signal); Assert.True(low.PhonoLow);
        var line = new InputSignalDetector();
        for (long t = 0; t < 12_000; t += 20) line.Update(t % 1000 < 100 ? -6 : -24, t);
        Assert.True(line.Signal); Assert.False(line.PhonoLow);
    }

    // ---------------- end to end ----------------
    private static async Task<(ServerFixture F, HttpClient Admin, HttpClient Control, FakePc Pc, SynthInputProvider In)> Setup(IInputProvider? provider = null, Func<InputSignalDetector>? detector = null)
    {
        var f = await ServerFixture.StartAsync();
        if (detector != null) f.Server.S.Inputs!.NewDetector = detector;     // before the player lists its inputs
        var admin = f.As(f.Token(Role.Admin, "a")); var control = f.As(f.Token(Role.Control, "c"));
        var syn = new SynthInputProvider();
        var pc = await FakePc.StartAsync(f, "pc-server", "Server PC", inputs: provider ?? syn);
        await pc.WaitConnected();
        await Until(async () => (await admin.GetJson("/api/v1/inputs")).GetProperty("inputs").GetArrayLength() == 4, "the inputs were not listed");
        return (f, admin, control, pc, syn);
    }

    private static async Task Until(Func<Task<bool>> ok, string what, int ms = 10_000)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < ms) { if (await ok()) return; await Task.Delay(50); }
        Assert.Fail(what);
    }
    private static async Task<JsonElement> Input(HttpClient c, string kind) => (await c.GetJson("/api/v1/inputs")).GetProperty("inputs").EnumerateArray().First(x => x.GetProperty("kind").GetString() == kind);

    [Fact]
    public async Task Inputs_are_listed_off_and_only_an_admin_can_turn_them_on()
    {
        var (f, admin, control, pc, _) = await Setup(); await using var _f = f; await using var _p = pc;
        var v = await admin.GetJson("/api/v1/inputs");
        Assert.True(v.GetProperty("available").GetBoolean());
        var kinds = v.GetProperty("inputs").EnumerateArray().Select(x => x.GetProperty("kind").GetString()).ToList();
        Assert.Equal(new[] { "loopback", "aux", "spdif", "mic" }, kinds);
        var aux = await Input(admin, "aux");
        Assert.False(aux.GetProperty("enabled").GetBoolean()); Assert.Equal("Aux in", aux.GetProperty("name").GetString()); Assert.Equal("This PC · Aux in", aux.GetProperty("source").GetString());
        Assert.True((await Input(admin, "mic")).GetProperty("muted").GetBoolean());          // a mic starts muted (Announce only)
        var id = aux.GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);   // off: can't play
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { gainDb = 9 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { liveSource = true })).StatusCode);   // not a mic
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/v1/inputs/{(await Input(admin, "spdif")).GetProperty("id").GetString()}", new { turntable = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true, name = "Record player", gainDb = -3.5 })).StatusCode);
        aux = await Input(admin, "aux");
        Assert.True(aux.GetProperty("enabled").GetBoolean()); Assert.Equal("Record player", aux.GetProperty("name").GetString()); Assert.Equal(-3.5, aux.GetProperty("gainDb").GetDouble());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync("/api/v1/inputs/inope", new { enabled = true })).StatusCode);
    }

    [Fact]
    public async Task Playing_an_input_replaces_the_queue_and_stop_brings_it_back_paused()
    {
        var (f, admin, control, pc, syn) = await Setup(); await using var _f = f; await using var _p = pc;
        var c = f.Server.S.Conductor;
        c.Add(new[] { new QueueItem(0, "track", "/nope/a.flac", "Song A", "X", "Y", 1000, 1), new QueueItem(0, "track", "/nope/b.flac", "Song B", "X", "Y", 1000, 2) }, false);
        var id = (await Input(admin, "aux")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true });
        syn.Level["in-aux-1"] = 0.3f;
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);   // Control may play
        var np = c.Now(); Assert.Equal("input", np.Item!.Kind); Assert.Equal("input:" + id, np.Item.Location); Assert.Equal("This PC · Aux in", np.Item.Artist);
        await Until(() => Task.FromResult(syn.Started == 1), "the player was not asked to capture");
        await Until(async () => (await Input(admin, "aux")).TryGetProperty("peakDb", out var pk) && pk.ValueKind == JsonValueKind.Number && pk.GetDouble() > -15, "no level from the input");
        Assert.True((await Input(admin, "aux")).GetProperty("playing").GetBoolean());
        c.Next(); Assert.Equal("input", c.Now().Item!.Kind);                  // skip does not end a live input (same as AirPlay)
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/stop", new { })).StatusCode);
        Assert.Equal(new[] { "Song A", "Song B" }, c.Queue().Select(q => q.Title)); Assert.NotEqual("playing", c.Now().State);
        await Until(() => Task.FromResult(syn.Stopped == 1), "capture did not stop");
        Assert.False((await Input(admin, "aux")).GetProperty("playing").GetBoolean());
    }

    [Fact]
    public async Task A_song_taking_over_the_zone_stops_the_capture()
    {
        var (f, admin, control, pc, syn) = await Setup(); await using var _f = f; await using var _p = pc;
        var id = (await Input(admin, "spdif")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true });
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { zoneId = "default" })).StatusCode);
        await Until(() => Task.FromResult(syn.Started == 1), "no capture");
        f.Server.S.Conductor.BeginLive("airplay", "Phone", "", "AirPlay");          // a phone takes over
        await Until(async () => !(await Input(admin, "spdif")).GetProperty("playing").GetBoolean() && syn.Stopped == 1, "the input kept capturing after AirPlay took over");
    }

    [Fact]
    public async Task A_microphone_plays_only_after_an_admin_makes_it_a_live_source()
    {
        var (f, admin, control, pc, syn) = await Setup(); await using var _f = f; await using var _p = pc;
        var id = (await Input(admin, "mic")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true });
        await Task.Delay(300); Assert.Equal(0, syn.Started);                      // enabled alone never opens a mic
        var r = await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Contains("Announce", (await r.Json()).GetProperty("error").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PutAsJsonAsync($"/api/v1/inputs/{id}", new { liveSource = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { liveSource = true })).StatusCode);
        Assert.False((await Input(admin, "mic")).GetProperty("muted").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);
        await Until(() => Task.FromResult(syn.Started == 1), "the live mic did not open");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { liveSource = false })).StatusCode);   // muted again: it stops
        Assert.False((await Input(admin, "mic")).GetProperty("playing").GetBoolean());
        await Until(() => Task.FromResult(syn.Stopped == 1), "the mic stayed open");
    }

    [Fact]
    public async Task Turntable_mode_starts_on_a_needle_drop_and_stops_at_the_end_of_the_side()
    {
        var (f, admin, _, pc, syn) = await Setup(detector: () => new InputSignalDetector { StartHoldMs = 300, StopHoldMs = 800 }); await using var _f = f; await using var _p = pc;
        var id = (await Input(admin, "aux")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true, turntable = true });
        Assert.True((await Input(admin, "aux")).GetProperty("autoStart").GetBoolean());       // on by default in Turntable mode
        await Until(() => Task.FromResult(syn.Started == 1), "a Turntable did not listen for the needle");
        Assert.NotEqual("input", f.Server.S.Conductor.Now().Item?.Kind);
        syn.Level["in-aux-1"] = 0.2f;                                                          // needle down
        await Until(() => Task.FromResult(f.Server.S.Conductor.Now().Item?.Kind == "input"), "the needle drop did not start it");
        Assert.Equal("everywhere", (await Input(admin, "aux")).GetProperty("zone").GetString());   // never played before: Everywhere
        syn.Level["in-aux-1"] = 0f;                                                            // run-out groove
        await Until(() => Task.FromResult(f.Server.S.Conductor.Now().Item?.Kind != "input"), "the end of the side did not stop it");
        Assert.Equal(1, syn.Started);                                                          // still listening for the next side (same capture)
    }

    [Fact]
    public async Task Settings_meters_capture_aux_and_spdif_but_never_a_mic_or_the_pc_sound()
    {
        var (f, admin, _, pc, syn) = await Setup(); await using var _f = f; await using var _p = pc;
        foreach (var k in new[] { "aux", "spdif", "mic", "loopback" }) await admin.PutAsJsonAsync($"/api/v1/inputs/{(await Input(admin, k)).GetProperty("id").GetString()}", new { enabled = true });
        Assert.Equal(0, syn.Started);
        await admin.PostAsJsonAsync("/api/v1/inputs/meter", new { on = true });
        await Until(() => Task.FromResult(syn.Started == 2), "meters did not open Aux in and S/PDIF in");
        await Task.Delay(300); Assert.Equal(2, syn.Started);
        await admin.PostAsJsonAsync("/api/v1/inputs/meter", new { on = false });
        await Until(() => Task.FromResult(syn.Stopped == 2), "meters did not close");
    }

    private sealed class FailingLoopback(SynthInputProvider inner) : IInputProvider
    {
        public IReadOnlyList<InputInfo> List() => inner.List();
        public IDisposable Start(string id, Action<float[], int, int> onBlock, Action<string> onError)
            => id == InputIds.ProcessLoopback ? throw new InvalidOperationException("process loopback needs Windows 10 version 2004 or later") : inner.Start(id, onBlock, onError);
    }

    [Fact]
    public async Task A_capture_the_player_cannot_open_shows_why()
    {
        var (f, admin, control, pc, _) = await Setup(new FailingLoopback(new SynthInputProvider())); await using var _f = f; await using var _p = pc;
        var id = (await Input(admin, "loopback")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true });
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);
        await Until(async () => (await Input(admin, "loopback")).GetProperty("error").ValueKind == JsonValueKind.String, "the error did not reach the server");
        Assert.Contains("2004", (await Input(admin, "loopback")).GetProperty("error").GetString());
        Assert.False((await Input(admin, "loopback")).GetProperty("capturing").GetBoolean());
    }

    [Fact]
    public async Task A_player_without_inputs_never_gets_input_messages_and_closing_the_player_stops_its_inputs()
    {
        var f = await ServerFixture.StartAsync(); await using var _f = f;
        var admin = f.As(f.Token(Role.Admin, "a"));
        await using (var old = await FakePc.StartAsync(f, "pc-old", "Old PC"))
        {
            await old.WaitConnected();
            var sess = f.Server.S.Audio.Sessions.Single(p => p.Id == "pc-old");
            Assert.False(sess.SpeaksInputs);                                                      // no "inputs" capability: INPUT_CMD is never sent to it
            var v = await admin.GetJson("/api/v1/inputs");
            Assert.False(v.GetProperty("available").GetBoolean()); Assert.Equal(0, v.GetProperty("inputs").GetArrayLength());
            Assert.Contains("WavWiz Player", v.GetProperty("note").GetString());
        }
        var syn = new SynthInputProvider();
        var pc = await FakePc.StartAsync(f, "pc-new", "New PC", inputs: syn); await pc.WaitConnected();
        await Until(async () => (await admin.GetJson("/api/v1/inputs")).GetProperty("inputs").GetArrayLength() == 4, "not listed");
        var id = (await Input(admin, "aux")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true });
        await admin.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { });
        Assert.Equal("input", f.Server.S.Conductor.Now().Item!.Kind);
        await pc.DisposeAsync();
        await Until(() => Task.FromResult(f.Server.S.Conductor.Now().Item?.Kind != "input"), "the input kept playing after its player closed");
        await Until(async () => (await admin.GetJson("/api/v1/inputs")).GetProperty("inputs").GetArrayLength() == 0, "the closed player's inputs stayed listed");
    }

    // ---------------- 0.7.2 t2170u: Windows' microphone privacy ----------------
    private sealed class DeniedMic(SynthInputProvider inner) : IInputProvider
    {
        public int Tries;
        public IReadOnlyList<InputInfo> List() => inner.List();
        public IDisposable Start(string id, Action<float[], int, int> onBlock, Action<string> onError)
        {
            if (inner.List().First(x => x.Id == id).Kind != "mic") return inner.Start(id, onBlock, onError);
            Interlocked.Increment(ref Tries); throw new System.Runtime.InteropServices.COMException("Core Audio error 0x80070005", unchecked((int)0x80070005));
        }
    }

    [Fact]
    public void Access_denied_becomes_the_plain_privacy_reason_and_other_errors_keep_their_text()
    {
        var r = InputRules.FailReason(new System.Runtime.InteropServices.COMException("x", unchecked((int)0x80070005)));
        Assert.StartsWith(InputRules.PrivacyTag, r); Assert.Contains("Let desktop apps access your microphone", r);
        Assert.StartsWith(InputRules.PrivacyTag, InputRules.FailReason(new Exception("Core Audio error 0x80070005")));
        Assert.Equal("device unplugged", InputRules.FailReason(new Exception("device unplugged")));
        Assert.True(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage("{\"open\":\"ms-settings:privacy-microphone\"}"));
        Assert.False(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage("{\"open\":\"ms-settings:privacy-webcam\"}"));
        Assert.False(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage("{\"open\":\"ms-settings:privacy-microphone\",\"x\":1}"));
        Assert.False(WavWiz.PlayerCore.UiUrl.IsMicSettingsMessage(null));
    }

    [Fact]
    public async Task A_mic_windows_refuses_stops_like_stop_keeps_the_reason_and_waits_for_play()
    {
        var den = new DeniedMic(new SynthInputProvider());
        var (f, admin, control, pc, _) = await Setup(den); await using var _f = f; await using var _p = pc;
        var c = f.Server.S.Conductor;
        c.Add(new[] { new QueueItem(0, "track", "/nope/a.flac", "Song A", "X", "Y", 1000, 1) }, false);
        var id = (await Input(admin, "mic")).GetProperty("id").GetString();
        await admin.PutAsJsonAsync($"/api/v1/inputs/{id}", new { enabled = true, liveSource = true });
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);
        await Until(async () => (await Input(admin, "mic")).GetProperty("error").ValueKind == JsonValueKind.String, "the refusal did not reach the server");
        var mic = await Input(admin, "mic");
        Assert.False(mic.GetProperty("playing").GetBoolean());                       // stopped like Stop: no "Playing" silence
        Assert.True(mic.GetProperty("privacy").GetBoolean());
        Assert.StartsWith("Windows is blocking the microphone", mic.GetProperty("error").GetString());
        Assert.Equal(new[] { "Song A" }, c.Queue().Select(q => q.Title)); Assert.NotEqual("input", c.Now().Item?.Kind);   // the zone's queue is back
        f.Server.S.Inputs!.NowMs = () => Environment.TickCount64 + 120_000;          // long past the retry pause: still no new attempt by itself
        await Task.Delay(1500); Assert.Equal(1, den.Tries);
        Assert.Equal(HttpStatusCode.OK, (await control.PostAsJsonAsync($"/api/v1/inputs/{id}/play", new { })).StatusCode);   // Play is the retry
        await Until(() => Task.FromResult(den.Tries == 2), "Play did not try again");
    }
}
