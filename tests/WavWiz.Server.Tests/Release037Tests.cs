using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using WavWiz.Core.Protocol;
using WavWiz.Measure;
using WavWiz.PlayerCore;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.3.7: L15 queue restore after an unexpected exit, L24 a silent speaker is retried and NAMED, L25/L26 confidence is always 0..100 and the raw numbers are logged.</summary>
public class Release037Tests
{
    private static async Task WaitUntil(Func<bool> cond, int ms = 15000, string what = "condition") { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!cond() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(cond(), "timed out: " + what); }

    // ---------------------------------------------------------------- L26 / L25 pure
    [Theory]
    [InlineData(68.0, 1.0)]          // a clear recording: ratio 68 used to be shown as 6800%
    [InlineData(40.0, 1.0)]
    [InlineData(4.0, 0.0)]           // just found
    [InlineData(0.0, 0.0)]
    [InlineData(double.NaN, 0.0)]
    [InlineData(double.PositiveInfinity, 0.0)]
    public void L26_ratio_maps_to_a_quality_between_0_and_1(double ratio, double want)
    {
        var q = CalQuality.FromRatio(ratio); Assert.InRange(q, 0, 1); Assert.Equal(want, q, 1);
        Assert.InRange(CalQuality.Pct(q), 0, 100); Assert.InRange(CalQuality.Pct(6800), 0, 100); Assert.InRange(CalQuality.Pct(-3), 0, 100); Assert.Equal(0, CalQuality.Pct(double.NaN));
    }
    [Fact]
    public void L26_quality_grows_with_snr_and_ratings_use_peak_and_quality()
    {
        Assert.True(CalQuality.FromRatio(8) < CalQuality.FromRatio(16)); Assert.Equal(20 * Math.Log10(10), CalQuality.SnrDb(10), 6);
        Assert.Equal("good", CalQuality.Rate(-20, 0.8)); Assert.Equal("weak", CalQuality.Rate(-20, 0.2)); Assert.Equal("quiet", CalQuality.Rate(-60, 0.9)); Assert.Equal("quiet", CalQuality.Rate(-20, 0));
    }
    [Fact]
    public void L25_detector_reports_ratio_quality_and_raw_levels_for_a_real_recording()
    {
        var pat = new ChirpPattern(-12); var rec = new float[48000 * 6]; var rnd = new Random(5);
        for (int i = 0; i < rec.Length; i++) rec[i] = (float)(rnd.NextDouble() - 0.5) * 0.02f;
        for (int i = 0; i < pat.Signal.Length; i++) rec[48000 + i] += pat.Signal[i];
        var hit = new ChirpDetector().Find(rec);
        Assert.True(hit.Found); Assert.True(hit.Confidence > 4, "raw ratio " + hit.Confidence); Assert.InRange(hit.Quality, 0.01, 1);
        Assert.InRange(hit.PeakDb, -30, 0); Assert.InRange(hit.RmsDb, -80, -10);
        // a quieter recording of the same pattern rates lower
        var quiet = rec.Select(v => v * 0.05f).ToArray(); var h2 = new ChirpDetector().Find(quiet);
        Assert.True(h2.PeakDb < hit.PeakDb - 20);
    }

    [Fact]
    public void L25_distance_target_next_to_the_speaker_rates_good_far_away_rates_weak_and_louder_test_sound_recovers_it()
    {
        // the same room noise; the pattern reaches the mic 25x quieter at normal distance than with the mic next to the speaker (about -28 dB)
        (double q, double peak, double snr) Run(double level)
        {
            var pat = new ChirpPattern(-12); var rec = new float[48000 * 6]; var rnd = new Random(9);
            for (int i = 0; i < rec.Length; i++) rec[i] = (float)(rnd.NextDouble() - 0.5) * 0.03f;
            for (int i = 0; i < pat.Signal.Length; i++) rec[48000 + i] += pat.Signal[i] * (float)level;
            var h = new ChirpDetector().Find(rec); return (h.Quality, h.PeakDb, h.SnrDb);
        }
        var near = Run(1.0); var far = Run(0.04); var farLouder = Run(0.04 * 5);   // +14 dB test volume
        Assert.True(near.q >= 0.9, $"near {near}"); Assert.True(far.q < near.q - 0.3, $"far {far} near {near}"); Assert.True(farLouder.q > far.q, $"louder {farLouder} far {far}");
        Assert.True(near.snr > far.snr + 10); Assert.NotEqual("good", CalQuality.Rate(far.peak, far.q));
    }

    [Fact]
    public void L26_a_clear_close_recording_has_a_huge_raw_ratio_but_every_per_test_value_and_the_overall_stay_0_to_100()
    {
        var pat = new ChirpPattern(-6); var rec = new float[48000 * 6]; var rnd = new Random(2);
        for (int i = 0; i < rec.Length; i++) rec[i] = (float)(rnd.NextDouble() - 0.5) * 0.002f;       // mic right next to the speaker: very high signal to noise
        for (int i = 0; i < pat.Signal.Length; i++) rec[48000 + i] += pat.Signal[i];
        var h = new ChirpDetector().Find(rec);
        Assert.True(h.Confidence > 50, "raw ratio is " + h.Confidence);                              // this raw number x 100 was the 16000% on screen
        Assert.Equal(1.0, h.Quality, 3); Assert.Equal(100, CalQuality.Pct(h.Quality)); Assert.Equal(100, CalQuality.Pct(h.Confidence));
    }

    // ---------------------------------------------------------------- L15
    [Fact]
    public void L15_the_last_queue_track_and_state_come_back_paused_after_an_unexpected_exit()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        var items = new[] { Conductor.UrlItem("http://127.0.0.1:1/a", "Alpha"), Conductor.UrlItem("http://127.0.0.1:1/b", "Beta"), Conductor.UrlItem("http://127.0.0.1:1/c", "Gamma") };
        var c1 = new Conductor(db, new EventHub(), TestMedia.Ffmpeg); c1.Add(items, false); c1.SaveLast();
        Assert.Contains("Alpha", db.Setting(Conductor.LastQueueKey));       // written, with no clean shutdown ("crash": c1 is simply abandoned)
        var c2 = new Conductor(db, new EventHub(), TestMedia.Ffmpeg);
        Assert.Equal(3, c2.RestoreLast());
        var n = c2.Now(); Assert.Equal("paused", n.State); Assert.Equal(new[] { "Alpha", "Beta", "Gamma" }, c2.Queue().Select(q => q.Title).ToArray()); Assert.Contains("Restored", n.Notice ?? "");
        Assert.Equal(0, new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { }.Queue().Count);   // a plain Conductor restores nothing by itself
        c2.Clear(); c2.SaveLast(); Assert.Equal(0, new Conductor(db, new EventHub(), TestMedia.Ffmpeg).RestoreLast());   // Clear queue is respected after a restart
    }

    // ---------------------------------------------------------------- L24 + L25 (real server + Players, fake capture device)
    [Fact]
    public async Task L24_a_silent_speaker_is_retried_named_and_skipped_never_passed_over_and_confidence_stays_0_to_100()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room", hiddenMs: 15);
        await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen", hiddenMs: 52);
        var micDev = new SynthMicProvider();
        micDev.Synth = (_, startUs, n) => { var rec = new float[n]; a.MixInto(rec, startUs, 9); /* Kitchen never reaches the mic: it is silent */ var rnd = new Random(3); for (int i = 0; i < n; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f; return rec; };
        await using var m = await FakePc.StartAsync(f, "pc-mic", "Office PC", mics: micDev);
        await a.WaitConnected(); await b.WaitConnected(); await m.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 3 && f.Server.S.Audio.Get("pc-mic")?.Mics.Length == 1, what: "zones + mic list");
        var zones = f.Server.S.Zones.Zones(); long refId = zones.First(z => z.PlayerId == "pc-ref").Id, devId = zones.First(z => z.PlayerId == "pc-dev").Id;
        var r = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "pc-mic", referenceZoneId = refId, micPlayerId = "pc-mic", micId = "mic-usb-1", zoneIds = new[] { devId }, runs = 1 });
        var sess = await r.Json(); Assert.True(r.IsSuccessStatusCode, sess.ToString()); string sid = sess.GetProperty("id").GetString()!;
        JsonElement st = default; string Phase() { st = admin.GetJson($"/api/v1/calibration/sessions/{sid}").Result; return st.GetProperty("phase").GetString()!; }
        async Task Answer(string action) { var g = await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/guide", new { action }); Assert.Equal(200, (int)g.StatusCode); }
        await WaitUntil(() => Phase() == "waiting", 20000, "first prompt"); await Answer("ready");
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("zoneId").GetInt64() == devId, 40000, "Kitchen prompt"); await Answer("ready");
        // L22: the pre-check at the Kitchen hears nothing, rates it too quiet, and says what to do (never starts measuring on its own)
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("kind").GetString() == "quiet", 40000, "pre-check prompt");
        var qp = st.GetProperty("prompt"); Assert.Equal(devId, qp.GetProperty("zoneId").GetInt64()); Assert.Contains("closer", qp.GetProperty("text").GetString()); Assert.Contains("test volume", qp.GetProperty("text").GetString());
        Assert.Contains(st.GetProperty("attempts").EnumerateArray(), x => x.GetProperty("check").GetBoolean() && x.GetProperty("rating").GetString() == "quiet");
        await Answer("continue");
        // three tries, then the run STOPS and says which speaker was silent (a "silent" prompt) - it does not carry on
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("kind").GetString() == "silent", 90000, "silent prompt");
        var pr = st.GetProperty("prompt"); Assert.Equal(devId, pr.GetProperty("zoneId").GetInt64()); Assert.True(pr.GetProperty("canSkip").GetBoolean());
        Assert.Contains("Kitchen was silent", pr.GetProperty("text").GetString());
        Assert.Contains(st.GetProperty("silent").EnumerateArray(), x => x.GetString() == "Kitchen");
        var log = st.GetProperty("log").EnumerateArray().Select(x => x.GetString()!).ToList();
        Assert.True(log.Count(l => l.Contains("Kitchen (1/1): try")) >= 3, string.Join("\n", log));            // retried
        Assert.Contains(log, l => l.Contains("player ok;lead="));                                                // the Player acknowledged scheduling (L24)
        Assert.Contains(log, l => Regex.IsMatch(l, @"snr -?[\d.]+ dB, mic peak -?[\d.]+ dBFS, rms -?[\d.]+ dBFS"));   // raw numbers per attempt (L25)
        foreach (var l in log) foreach (Match mm in Regex.Matches(l, @"(\d+)% (sure|quality)")) Assert.InRange(int.Parse(mm.Groups[1].Value), 0, 100);   // L26
        Assert.All(st.GetProperty("attempts").EnumerateArray(), x => Assert.InRange(x.GetProperty("quality").GetDouble(), 0, 1));
        await Answer("skip");
        await WaitUntil(() => Phase() == "waiting" && st.GetProperty("prompt").GetProperty("step").GetInt32() == 3, 40000, "reference again"); await Answer("ready");
        await WaitUntil(() => Phase() is "done" or "failed", 40000, "done"); Assert.Equal("done", st.GetProperty("phase").GetString());
        Assert.Contains(st.GetProperty("messages").EnumerateArray(), x => x.GetString() == "Skipped Kitchen: its delay is unchanged");
        await admin.PostAsync($"/api/v1/calibration/sessions/{sid}/end", null);
    }

    [Fact]
    public async Task L24_an_unguided_run_with_a_silent_speaker_fails_naming_it()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Living Room", hiddenMs: 15);
        await using var b = await FakePc.StartAsync(f, "pc-dev", "Kitchen", hiddenMs: 52);
        var micDev = new SynthMicProvider();
        micDev.Synth = (_, startUs, n) => { var rec = new float[n]; a.MixInto(rec, startUs, 9); var rnd = new Random(3); for (int i = 0; i < n; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f; return rec; };
        await using var m = await FakePc.StartAsync(f, "pc-mic", "Office PC", mics: micDev);
        await a.WaitConnected(); await b.WaitConnected(); await m.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 3 && f.Server.S.Audio.Get("pc-mic")?.Mics.Length == 1, what: "zones + mic list");
        var zones = f.Server.S.Zones.Zones(); long refId = zones.First(z => z.PlayerId == "pc-ref").Id, devId = zones.First(z => z.PlayerId == "pc-dev").Id;
        var cs = f.Server.S.Cal; var (s, err) = cs.Start("pc-mic", refId, "pc", "raw"); Assert.Null(err); s!.Guided = false; s.MicPlayerId = "pc-mic"; s.MicId = "mic-usb-1"; s.MicName = "USB mic";
        _ = Task.Run(() => cs.RunPcMic(s, WavWiz.Server.Calibration.CalPlan.Build(refId, "Living Room", new[] { (devId, "Kitchen") }, 1), -20));
        await WaitUntil(() => s.Phase is "failed" or "done", 120000, "run ends");
        Assert.Equal("failed", s.Phase); Assert.Contains("Kitchen was silent", s.Error); Assert.Contains("Kitchen", s.Silent);
        cs.End(s);
    }

    [Fact]
    public async Task L28_the_pair_qr_carries_the_six_digit_code_to_the_phone_setup_page_and_nothing_else()
    {
        await using var f = await ServerFixture.StartAsync();
        var plain = await f.Http.GetStringAsync("/tls/qr.svg?to=setup");
        var pair = await f.Http.GetStringAsync("/tls/qr.svg?to=pair&code=123456");
        var other = await f.Http.GetStringAsync("/tls/qr.svg?to=pair&code=654321");
        Assert.Contains("<svg", pair); Assert.NotEqual(plain, pair); Assert.NotEqual(pair, other);   // the code is inside the QR
        Assert.Equal(plain, await f.Http.GetStringAsync("/tls/qr.svg?to=pair&code=12ab56"));          // junk is dropped, never carried
        Assert.Equal(plain, await f.Http.GetStringAsync("/tls/qr.svg?to=pair"));
        var setup = await f.Http.GetStringAsync("/tls/setup?pair=123456"); Assert.Contains("tls-setup.js", setup);
        var js = System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot", "js", "tls-setup.js"));
        Assert.Contains("?pair=${pairQ}", js);
        var st = System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot", "js", "settings.js")); Assert.Contains("to=pair&code=", st);
        var mn = System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot", "js", "main.js")); Assert.Contains("value: PAIR_PREFILL", mn);
    }

    [Fact]
    public async Task L28_the_phone_setup_page_has_add_to_home_screen_steps_and_links_the_existing_manifest()
    {
        await using var f = await ServerFixture.StartAsync();
        var page = await f.Http.GetStringAsync("/tls/setup");
        Assert.Contains("rel=manifest href='/manifest.webmanifest'", page); Assert.Contains("apple-touch-icon", page); Assert.Contains("apple-mobile-web-app-capable", page);
        Assert.Contains("Add to Home Screen", page); Assert.Contains("Share", page); Assert.Contains("Install app", page); Assert.Contains("a2hsInstall", page);
        var web = System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot"); var man = System.IO.File.ReadAllText(System.IO.Path.Combine(web, "manifest.webmanifest")); Assert.Contains("\"display\": \"standalone\"", man);
        foreach (var png in new[] { "/assets/logo-192.png", "/assets/logo-512.png", "/assets/logo-180.png", "/assets/logo-maskable-512.png" }) Assert.True(System.IO.File.Exists(System.IO.Path.Combine(web, png.TrimStart('/'))), png);
    }

    [Fact]
    public void L7_the_purpose_based_presets_replace_the_generic_ones_and_every_one_is_legal()
    {
        Assert.Equal(17, WavWiz.Server.Dsp.DspService.PurposePresets.Length);   // Flat + 16
        foreach (var (grp, name, p) in WavWiz.Server.Dsp.DspService.PurposePresets)
        {
            var n = p.Normalize(); Assert.Equal(p.GraphicDb.Select(x => x).ToArray(), n.GraphicDb);   // nothing needed clamping
            Assert.All(n.GraphicDb, x => Assert.InRange(x, -12, 12)); Assert.False(string.IsNullOrWhiteSpace(name));
        }
        using var t = new TempDir(); var db = new Db(t.File("w.db")); db.Migrate();
        var d = new WavWiz.Server.Dsp.DspService(db);
        var names = d.Presets().Where(x => x.Source == "builtin").Select(x => x.Name).ToList();
        Assert.Contains("Late Night", names); Assert.Contains("Subwoofer Zone", names); Assert.Contains("Classical", names);
        Assert.DoesNotContain("Bass boost", names); Assert.DoesNotContain("Vocal / speech", names);
    }

    [Fact]
    public void L31_mini_player_from_the_app_menu_is_always_on_top_and_minimizes_the_main_window_but_tray_open_does_not()
    {
        Assert.Equal((true, true), WavWiz.PlayerCore.MiniPlayer.OpenPlan(fromAppMenu: true, savedPinned: false));
        Assert.Equal((true, true), WavWiz.PlayerCore.MiniPlayer.OpenPlan(true, true));
        Assert.Equal((false, false), WavWiz.PlayerCore.MiniPlayer.OpenPlan(fromAppMenu: false, savedPinned: false));   // tray / other: nothing changes
        Assert.Equal((true, false), WavWiz.PlayerCore.MiniPlayer.OpenPlan(false, true));                            // the saved Keep on top still rules, main window stays
        var app = System.IO.File.ReadAllText(System.IO.Path.Combine(FindRepo(), "src", "WavWiz.Player", "PlayerApp.cs"));
        Assert.Contains("OpenMini(fromAppMenu: true)", app); Assert.Contains("_web.WindowState = FormWindowState.Minimized", app); Assert.Contains("MiniPlayer.OpenPlan(fromAppMenu", app);
    }
    private static string FindRepo() { var d = new System.IO.DirectoryInfo(AppContext.BaseDirectory); while (d != null && !System.IO.Directory.Exists(System.IO.Path.Combine(d.FullName, "src", "WavWiz.Player"))) d = d.Parent; return d!.FullName; }
}
