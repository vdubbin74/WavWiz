using System.Net;
using System.Text.Json;
using WavWiz.Server.Features;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.3.0: alarms/schedules maths, sleep timer, crossfade, scene delete 409, new endpoints and roles.</summary>
public class Release030Tests
{
    static readonly DateTime Mon2350 = new(2026, 10, 12, 23, 50, 0);   // Monday

    [Fact] public void NextRun_across_midnight() => Assert.Equal(new DateTime(2026, 10, 13, 0, 10, 0), ScheduleMath.NextRun(true, "0123456", "00:10", null, null, Mon2350));
    [Fact] public void NextRun_weekend_only_from_monday_is_saturday() => Assert.Equal(new DateTime(2026, 10, 17, 8, 0, 0), ScheduleMath.NextRun(true, "06", "08:00", null, null, Mon2350));
    [Fact] public void NextRun_once_only()
    {
        Assert.Equal(new DateTime(2026, 10, 20, 7, 0, 0), ScheduleMath.NextRun(true, "", "07:00", "2026-10-20", null, Mon2350));
        Assert.Null(ScheduleMath.NextRun(true, "", "07:00", "2026-10-01", null, Mon2350));
    }
    [Fact] public void NextRun_skip_next_moves_to_following()
    {
        var first = ScheduleMath.NextRun(true, "12345", "07:00", null, null, Mon2350)!.Value;   // Tue 07:00
        Assert.Equal(new DateTime(2026, 10, 13, 7, 0, 0), first);
        Assert.Equal(new DateTime(2026, 10, 14, 7, 0, 0), ScheduleMath.NextRun(true, "12345", "07:00", null, first, Mon2350));
    }
    [Fact] public void NextRun_disabled_is_null() => Assert.Null(ScheduleMath.NextRun(false, "0123456", "07:00", null, null, Mon2350));
    [Fact] public void DueAt_weekend_and_once()
    {
        Assert.True(ScheduleMath.DueAt("06", "08:00", null, new DateTime(2026, 10, 17, 8, 0, 0)));
        Assert.False(ScheduleMath.DueAt("06", "08:00", null, new DateTime(2026, 10, 16, 8, 0, 0)));
        Assert.True(ScheduleMath.DueAt("", "07:00", "2026-10-20", new DateTime(2026, 10, 20, 7, 0, 0)));
        Assert.False(ScheduleMath.DueAt("", "07:00", "2026-10-20", new DateTime(2026, 10, 21, 7, 0, 0)));
    }
    [Fact] public void Fade_ramp_reaches_end_volume_on_time()
    {
        Assert.Equal(10, ScheduleMath.Ramp(10, 40, 600, 0));
        Assert.Equal(25, ScheduleMath.Ramp(10, 40, 600, 300), 3);
        Assert.Equal(40, ScheduleMath.Ramp(10, 40, 600, 600));
        Assert.Equal(40, ScheduleMath.Ramp(10, 40, 600, 900));
    }
    [Fact] public void Plain_labels() { Assert.Equal("All off", ScheduleMath.Label("all_off")); Assert.Equal("Play radio", ScheduleMath.Label("play_radio")); }

    [Fact] public void Sleep_remaining_song_and_album()
    {
        QueueItem T(string album, long d) => new(0, "track", "x", "t", "a", album, d, null);
        var q = new List<QueueItem> { T("A", 100_000), T("A", 200_000), T("A", 50_000), T("B", 999_000) };
        var (song, alb) = SleepService.Remaining(q, 0, 40_000, 100_000);
        Assert.Equal(60_000, song); Assert.Equal(310_000, alb);
    }

    // ---- crossfade on synthetic decoders: item value = constant per item ----
    sealed class Const : IPcmDecoder { readonly float _v; long _left; public Const(float v, long frames) { _v = v; _left = frames; }
        public int Read(Span<float> d, int f) { int n = (int)Math.Min(f, _left); for (int i = 0; i < n * 2; i++) d[i] = _v; _left -= n; return n; }
        public bool Finished => _left <= 0; public string? Error => null; public void Dispose() { } }
    static float[] Run(List<QueueItem> items, int xfMs)
    {
        int k = 0; var vals = new[] { 1f, -1f, 0.5f };
        using var q = new QueueSource(items, 0, 0, RepeatMode.Off, (it, ms) => new Const(vals[items.IndexOf(it) % 3], it.DurationMs * 48)) { CrossfadeMs = () => xfMs };
        var all = new List<float>(); var buf = new float[960 * 2];
        while (!q.Ended && k++ < 10_000) { int n = q.Read(buf, 960); for (int i = 0; i < n * 2; i++) all.Add(buf[i]); if (n == 0) break; }
        return all.ToArray();
    }
    static QueueItem It(string album, long ms, string artist = "a") => new(0, "track", Guid.NewGuid().ToString(), "t", artist, album, ms, null);

    [Fact] public void Crossfade_off_is_sample_exact_join()
    {
        var s = Run(new() { It("A", 2000), It("B", 2000) }, 0);
        Assert.Equal(4000 * 48 * 2, s.Length);
        Assert.All(s.Take(2000 * 96), v => Assert.Equal(1f, v)); Assert.All(s.Skip(2000 * 96), v => Assert.Equal(-1f, v));
    }
    [Fact] public void Crossfade_mixes_different_albums_and_is_shorter()
    {
        var s = Run(new() { It("A", 4000), It("B", 4000) }, 1000);
        Assert.True(s.Length < 8000 * 96 && s.Length >= 7000 * 96 - 960 * 2, $"len {s.Length / 96} ms");
        Assert.Contains(s, v => v > -0.99f && v < 0.99f);    // a mixed region exists
        Assert.Equal(-1f, s[^1]);
    }
    [Fact] public void Crossfade_never_between_same_album_tracks()
    {
        var s = Run(new() { It("A", 2000), It("A", 2000) }, 12000);
        Assert.Equal(4000 * 96, s.Length);
        Assert.All(s, v => Assert.True(v == 1f || v == -1f));
    }

    // ---- API ----
    [Fact]
    public async Task Api_schedule_alarm_skip_and_scene_409()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin)); var ctl = f.As(f.Token(Role.Control)); var view = f.As(f.Token(Role.View));
        var sc = await (await admin.PostAsJsonAsync("/api/v1/scenes", new { name = "Night", members = Array.Empty<object>() })).Json();
        var sid = sc.GetProperty("id").GetInt64();
        var r = await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "Wake", time = "07:00", days = "12345", action = "play", payload = new { source = "radio", id = 1, sceneId = sid, startVol = 5, endVol = 40, fadeMin = 10 } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode); var id = (await r.Json()).GetProperty("id").GetInt64();
        var bad = await admin.PostAsJsonAsync("/api/v1/schedules", new { name = "None", time = "07:00", days = "", action = "stop" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var list = await view.GetJson("/api/v1/schedules"); var row = list.EnumerateArray().First(x => x.GetProperty("id").GetInt64() == id);
        Assert.True(row.GetProperty("alarm").GetBoolean()); Assert.False(string.IsNullOrEmpty(row.GetProperty("nextRunAt").GetString())); Assert.Equal("Play something", row.GetProperty("actionLabel").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync($"/api/v1/schedules/{id}/skip", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ctl.PostAsJsonAsync($"/api/v1/schedules/{id}/skip", new { })).StatusCode);
        row = (await view.GetJson("/api/v1/schedules")).EnumerateArray().First(x => x.GetProperty("id").GetInt64() == id);
        Assert.NotEqual(row.GetProperty("nextRunAt").GetString(), row.GetProperty("skippedRunAt").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await ctl.PostAsJsonAsync("/api/v1/schedules", new { name = "x", time = "07:00", action = "stop" })).StatusCode);
        var del = await admin.DeleteAsync($"/api/v1/scenes/{sid}");
        Assert.Equal((HttpStatusCode)409, del.StatusCode); Assert.Contains("Wake", await del.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/scenes/{sid}?force=true")).StatusCode);
        Assert.Equal((HttpStatusCode)409, (await ctl.PostAsJsonAsync("/api/v1/alarm/snooze", new { })).StatusCode);
        var sl = await ctl.PostAsJsonAsync("/api/v1/sleep", new { minutes = 15 }); Assert.Equal(HttpStatusCode.OK, sl.StatusCode);
        Assert.Equal("minutes", (await sl.Json()).GetProperty("mode").GetString());
        Assert.Equal("off", (await (await ctl.PostAsJsonAsync("/api/v1/sleep", new { mode = "off" })).Json()).GetProperty("mode").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await ctl.PostAsJsonAsync("/api/v1/sleep", new { mode = "song" })).StatusCode);   // nothing playing
        _ = (await view.GetJson("/api/v1/scenes/active"));
    }

    [Fact]
    public async Task Tick_runs_once_per_minute_and_once_only_turns_off()
    {
        await using var f = await ServerFixture.StartAsync();
        var svc = f.Server.S.Schedules; var db = f.Server.S.Db;
        var b = JsonDocument.Parse("{\"name\":\"Once\",\"time\":\"07:00\",\"onceDate\":\"2099-10-20\",\"days\":\"\",\"action\":\"stop\"}").RootElement;
        var (id, err) = svc.Create(b); Assert.Null(err);
        svc.Tick(new DateTimeOffset(new DateTime(2099, 10, 20, 7, 0, 5)));
        db.Exec("UPDATE schedule SET last_result='again?' WHERE id=$i", ("$i", id));
        svc.Tick(new DateTimeOffset(new DateTime(2099, 10, 20, 7, 0, 30)));    // same minute: not run twice
        Assert.Equal("again?", db.Scalar("SELECT last_result FROM schedule WHERE id=$i", ("$i", id)));
        Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT enabled FROM schedule WHERE id=$i", ("$i", id))));
    }

    [Fact]
    public async Task Backup_round_trip_on_a_clean_install_and_no_secrets()
    {
        byte[] file;
        await using (var a = await ServerFixture.StartAsync())
        {
            var adm = a.As(a.Token(Role.Admin));
            await adm.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["playback.crossfadeSec"] = 6, ["acoustid.apiKey"] = "SECRET-KEY-123", ["server.name"] = "Den" });
            await adm.PostAsJsonAsync("/api/v1/scenes", new { name = "Party", icon = "🎉", members = Array.Empty<object>() });
            await adm.PostAsJsonAsync("/api/v1/schedules", new { name = "Wake", time = "06:30", days = "12345", action = "stop" });
            await adm.PostAsJsonAsync("/api/v1/radio", new { name = "KEXP", url = "https://kexp.example/stream" });
            Assert.Equal(HttpStatusCode.Forbidden, (await a.As(a.Token(Role.Control)).GetAsync("/api/v1/backup")).StatusCode);
            var r = await adm.GetAsync("/api/v1/backup"); Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            file = await r.Content.ReadAsByteArrayAsync();
        }
        using (var zip = new System.IO.Compression.ZipArchive(new MemoryStream(file)))
        {
            var json = new StreamReader(zip.GetEntry("backup.json")!.Open()).ReadToEnd();
            Assert.DoesNotContain("SECRET-KEY-123", json); Assert.DoesNotContain("token_hash", json); Assert.DoesNotContain("BEGIN", json); Assert.DoesNotContain("admin.", json);
            Assert.Contains("Party", json);
        }
        await using var b = await ServerFixture.StartAsync();
        var badm = b.As(b.Token(Role.Admin));
        var pv = await (await badm.PostAsync("/api/v1/backup/preview", new ByteArrayContent(file))).Json();
        Assert.Contains(pv.GetProperty("sections").EnumerateArray(), x => x.GetProperty("table").GetString() == "scene" && x.GetProperty("incoming").GetInt32() == 1 && x.GetProperty("current").GetInt32() == 0);
        Assert.Equal(HttpStatusCode.BadRequest, (await badm.PostAsync("/api/v1/backup/import", new ByteArrayContent(new byte[] { 1, 2, 3 }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await badm.PostAsync("/api/v1/backup/import", new ByteArrayContent(file))).StatusCode);
        var scenes = await badm.GetJson("/api/v1/scenes"); Assert.Contains(scenes.EnumerateArray(), x => x.GetProperty("name").GetString() == "Party");
        var sch = await badm.GetJson("/api/v1/schedules"); Assert.Contains(sch.EnumerateArray(), x => x.GetProperty("name").GetString() == "Wake");
        var st = await badm.GetJson("/api/v1/settings"); Assert.Equal(6, st.GetProperty("playback.crossfadeSec").GetDouble()); Assert.False(st.TryGetProperty("acoustid.apiKey", out _));
        var radio = await badm.GetJson("/api/v1/radio"); Assert.Contains(radio.EnumerateArray(), x => x.GetProperty("name").GetString() == "KEXP");
    }
    [Fact] public void Secret_settings_are_never_backed_up()
    {
        foreach (var k in new[] { "acoustid.apiKey", "nas.share1", "admin.passwordHash", "tls.rootKey", "spotify.token", "x.password" }) Assert.True(BackupService.IsSecretSetting(k), k);
        foreach (var k in new[] { "tls.redirect", "playback.crossfadeSec", "server.name", "jukebox.pinHash", "ui.checklistDismissed" }) Assert.False(BackupService.IsSecretSetting(k), k);
    }
}
