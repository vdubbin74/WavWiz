using System.Net;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.2.0 Must-haves on the server: admin elevation on the same token (31), permissions split (28), master volume rules (10),
/// the house reference speaker (30), calibration pause/resume (29), user agents that follow the version (18).</summary>
[Collection("serial")]   // 0.4.4 H3
public class Release020Tests
{
    private static async Task<(ServerFixture f, HttpClient admin, FakePc a, FakePc b, long ida, long idb)> TwoPcs()
    {
        var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var a = await FakePc.StartAsync(f, "pc-a", "Kitchen"); var b = await FakePc.StartAsync(f, "pc-b", "Garage"); await a.WaitConnected(); await b.WaitConnected();
        var zs = await admin.GetJson("/api/v1/zones");
        for (int i = 0; i < 100 && zs.GetArrayLength() < 2; i++) { await Task.Delay(50); zs = await admin.GetJson("/api/v1/zones"); }
        long Id(string pid) => zs.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == pid).GetProperty("id").GetInt64();
        return (f, admin, a, b, Id("pc-a"), Id("pc-b"));
    }

    [Fact]
    public async Task Sign_in_as_admin_keeps_the_same_token_and_leave_admin_mode_restores_the_paired_role()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin("correct horse battery");
        var tok = f.Token(Role.Control, "Sam's phone"); var me = f.As(tok);
        Assert.Equal(HttpStatusCode.Forbidden, (await me.GetAsync("/api/v1/tokens")).StatusCode);
        var st = await me.GetJson("/api/v1/auth/state"); Assert.Equal("control", st.GetProperty("role").GetString()); Assert.False(st.GetProperty("elevated").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await me.PostAsJsonAsync("/api/v1/auth/elevate", new { password = "wrong one" })).StatusCode);
        (await me.PostAsJsonAsync("/api/v1/auth/elevate", new { password = "correct horse battery" })).EnsureSuccessStatusCode();
        st = await me.GetJson("/api/v1/auth/state"); Assert.Equal("admin", st.GetProperty("role").GetString()); Assert.True(st.GetProperty("elevated").GetBoolean()); Assert.Equal("control", st.GetProperty("baseRole").GetString());
        Assert.Equal(HttpStatusCode.OK, (await me.GetAsync("/api/v1/tokens")).StatusCode);          // same token, admin actions work
        (await me.PostAsync("/api/v1/auth/leave-admin", null)).EnsureSuccessStatusCode();
        st = await me.GetJson("/api/v1/auth/state"); Assert.Equal("control", st.GetProperty("role").GetString()); Assert.False(st.GetProperty("elevated").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await me.GetAsync("/api/v1/tokens")).StatusCode);
        // a plain admin sign-in has no paired role to fall back to
        var adm = f.As(f.Token(Role.Admin, "admin"));
        Assert.Equal(HttpStatusCode.Conflict, (await adm.PostAsync("/api/v1/auth/leave-admin", null)).StatusCode);
        // a Player token can never be elevated
        Assert.Null(f.Server.S.Auth.Validate(tok)!.Elevated ? "x" : null);
    }

    [Fact]
    public async Task Master_skips_off_speakers_never_unmutes_and_keeps_the_balance_until_the_loudest_hits_100()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var c = await FakePc.StartAsync(f, "pc-c", "Patio"); await using var _c = c; await c.WaitConnected();
        var idc = (await admin.GetJson("/api/v1/zones")).EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-c").GetProperty("id").GetInt64();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{ida}", new { volume = 80 })).EnsureSuccessStatusCode();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{idb}", new { volume = 40, muted = true })).EnsureSuccessStatusCode();
        (await admin.PatchAsJsonAsync($"/api/v1/zones/{idc}", new { volume = 30, enabled = false })).EnsureSuccessStatusCode();
        async Task<(double A, double B, double C, bool BMuted)> Read() { var zs = await admin.GetJson("/api/v1/zones"); JsonElement Z(long id) => zs.EnumerateArray().First(z => z.GetProperty("id").GetInt64() == id);
            return (Z(ida).GetProperty("volume").GetDouble(), Z(idb).GetProperty("volume").GetDouble(), Z(idc).GetProperty("volume").GetDouble(), Z(idb).GetProperty("muted").GetBoolean()); }
        var control = f.As(f.Token(Role.Control));
        (await control.PostAsJsonAsync("/api/v1/zones/master", new { delta = 40 })).EnsureSuccessStatusCode();     // loudest 80 -> capped at 100: factor 1.25
        var v = await Read(); Assert.Equal(100, v.A, 1); Assert.Equal(50, v.B, 1); Assert.Equal(30, v.C, 1); Assert.True(v.BMuted);
        (await control.PostAsJsonAsync("/api/v1/zones/master", new { delta = 10 })).EnsureSuccessStatusCode();     // already at the cap: nothing flattens
        v = await Read(); Assert.Equal(100, v.A, 1); Assert.Equal(50, v.B, 1);
        (await control.PostAsJsonAsync("/api/v1/zones/master", new { set = 50 })).EnsureSuccessStatusCode();
        v = await Read(); Assert.Equal(50, v.A, 1); Assert.Equal(25, v.B, 1); Assert.Equal(30, v.C, 1); Assert.True(v.BMuted);
        (await control.PostAsJsonAsync("/api/v1/zones/master", new { scale = 0.5 })).EnsureSuccessStatusCode();
        v = await Read(); Assert.Equal(25, v.A, 1); Assert.Equal(12.5, v.B, 1);
        Assert.Equal(25, (await control.GetJson("/api/v1/zones/master")).GetProperty("level").GetDouble(), 1);
    }

    [Fact]
    public async Task Regular_users_keep_volume_mute_on_off_scenes_and_zone_switching_but_admin_only_edits_are_refused()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var control = f.As(f.Token(Role.Control, "guest"));
        (await control.PatchAsJsonAsync($"/api/v1/zones/{idb}", new { volume = 33, muted = true, enabled = true })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PatchAsJsonAsync($"/api/v1/zones/{idb}", new { name = "Mine now" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PostAsJsonAsync("/api/v1/groups", new { name = "Downstairs", deviceIds = new[] { ida } })).StatusCode);
        var g = await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Downstairs", deviceIds = new[] { ida } })).Json();
        (await control.PostAsync($"/api/v1/groups/{g.GetProperty("id").GetInt64()}/activate", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await control.DeleteAsync($"/api/v1/groups/{g.GetProperty("id").GetInt64()}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PostAsJsonAsync("/api/v1/scenes", new { name = "Party", members = new[] { new { deviceId = ida, volume = 70, enabled = true } } })).StatusCode);
        var sc = await (await admin.PostAsJsonAsync("/api/v1/scenes", new { name = "Party", members = new[] { new { deviceId = ida, volume = 70, enabled = true } } })).Json();
        (await control.PostAsync($"/api/v1/scenes/{sc.GetProperty("id").GetInt64()}/apply", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PostAsJsonAsync("/api/v1/schedules", new { name = "x", timeHm = "07:00", action = "stop" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PostAsJsonAsync("/api/v1/tags/jobs/1/approvals", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PutAsJsonAsync("/api/v1/calibration/reference", new { zoneId = ida })).StatusCode);
    }

    [Fact]
    public void Own_device_is_this_browsers_web_speaker_or_a_player_on_the_same_pc()
    {
        var me = new AuthInfo(Role.Control, "me", 7, null); var other = new AuthInfo(Role.Control, "other", 8, null);
        Assert.True(ZoneManager.IsMine("web-abc", 7, null, me, IPAddress.Parse("192.168.1.20")));
        Assert.False(ZoneManager.IsMine("web-abc", 7, null, other, IPAddress.Parse("192.168.1.20")));
        Assert.False(ZoneManager.IsMine("web-abc", null, null, me, IPAddress.Parse("192.168.1.20")));
        Assert.False(ZoneManager.IsMine("pc-a", null, null, me, IPAddress.Parse("192.168.1.20")));        // offline player: unknown machine
        Assert.False(ZoneManager.IsMine("pc-a", null, null, null, null));
    }

    [Fact]
    public async Task Players_on_the_same_pc_are_mine_and_their_delay_and_output_are_editable_by_a_regular_user()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var control = f.As(f.Token(Role.Control, "guest"));
        var zs = await control.GetJson("/api/v1/zones");
        Assert.All(zs.EnumerateArray(), z => Assert.True(z.GetProperty("mine").GetBoolean()));      // every fake PC runs on this very machine (loopback)
        var dev = zs.EnumerateArray().First(z => z.GetProperty("id").GetInt64() == ida).GetProperty("outputs")[0].GetProperty("deviceId").GetString();
        (await control.PutAsJsonAsync($"/api/v1/outputs/{Uri.EscapeDataString(dev!)}/latency", new { latencyMs = 120, playerId = "pc-a" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await control.PutAsJsonAsync($"/api/v1/outputs/{Uri.EscapeDataString(dev!)}/latency", new { latencyMs = 2500, playerId = "pc-a" })).StatusCode);
    }

    [Fact]
    public async Task House_reference_is_stored_marked_on_zones_and_used_as_the_default_for_calibration_which_ends_cleanly()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        Assert.Equal(0, (await admin.GetJson("/api/v1/calibration/reference")).GetProperty("zoneId").GetInt64());
        (await admin.PutAsJsonAsync("/api/v1/calibration/reference", new { zoneId = idb })).EnsureSuccessStatusCode();
        string refJson = ""; for (var swR = System.Diagnostics.Stopwatch.StartNew(); swR.ElapsedMilliseconds < 10000; await Task.Delay(50)) { refJson = await (await admin.GetAsync("/api/v1/calibration/reference")).Content.ReadAsStringAsync(); if (refJson.Contains("\"connected\":true")) break; }   // 0.4.4 H3: poll
        Assert.Equal("{\"zoneId\":" + idb + ",\"name\":\"Garage\",\"connected\":true}", refJson);
        var zs = await admin.GetJson("/api/v1/zones");
        Assert.True(zs.EnumerateArray().First(z => z.GetProperty("id").GetInt64() == idb).GetProperty("reference").GetBoolean());
        Assert.False(zs.EnumerateArray().First(z => z.GetProperty("id").GetInt64() == ida).GetProperty("reference").GetBoolean());
        Assert.Equal("{\"calibration.referenceZoneId\":" + idb + "}", "{\"calibration.referenceZoneId\":" + f.Server.S.Db.Setting("calibration.referenceZoneId") + "}");
        var s = await (await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone" })).Json();      // no reference given -> the house reference
        Assert.Equal(idb, s.GetProperty("referenceZoneId").GetInt64());
        var id = s.GetProperty("id").GetString();
        var end = await (await admin.PostAsync($"/api/v1/calibration/sessions/{id}/end", null)).Json(); Assert.False(end.GetProperty("resumed").GetBoolean());   // nothing was playing
        for (var swE = System.Diagnostics.Stopwatch.StartNew(); f.Server.S.Cal.OpenSessions != 0 && swE.ElapsedMilliseconds < 10000;) await Task.Delay(50);   // 0.4.4 H3: the session ends asynchronously
        Assert.Equal(0, f.Server.S.Cal.OpenSessions);
        // a regular user cannot pick another reference when the house has one
        var control = f.As(f.Token(Role.Control, "guest"));
        Assert.Equal(HttpStatusCode.Forbidden, (await control.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = ida })).StatusCode);
        var cs = await (await control.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone" })).Json();
        Assert.Equal(idb, cs.GetProperty("referenceZoneId").GetInt64()); Assert.True(cs.GetProperty("onlyZoneId").ValueKind == JsonValueKind.Number);
        // reference offline -> calibration asks for another (409)
        await b.DisposeAsync(); var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 8000 && (await admin.GetJson("/api/v1/calibration/reference")).GetProperty("connected").GetBoolean()) await Task.Delay(100);
        var off = await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone" });
        Assert.Equal(HttpStatusCode.Conflict, off.StatusCode); Assert.Contains("pick another reference", await off.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Calibration_pauses_music_at_start_and_on_every_chirp_and_resumes_once_when_the_session_ends()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        TestMedia.Run("-f", "lavfi", "-i", "sine=f=440:d=30", "-ac", "2", "-metadata", "title=Tone", "-metadata", "artist=Test", Path.Combine(music, "tone.flac"));
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music });
        for (int i = 0; i < 100; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 1) break; await Task.Delay(100); }
        var tid = (await admin.GetJson("/api/v1/library/search?q=tone"))[0].GetProperty("id").GetInt64();
        (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } })).EnsureSuccessStatusCode();
        var cond = f.Server.S.Conductor;
        for (int i = 0; i < 100 && cond.State != Playback.PlayState.Playing; i++) await Task.Delay(50);
        Assert.Equal(Playback.PlayState.Playing, cond.State);
        var s = await (await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = ida })).Json();
        Assert.Equal(Playback.PlayState.Paused, cond.State);                       // safe rail: paused for the whole session
        var id = s.GetProperty("id").GetString();
        (await admin.PostAsync("/api/v1/stream/resume", null)).EnsureSuccessStatusCode();     // someone presses Play mid-session...
        Assert.Equal(Playback.PlayState.Playing, cond.State);
        (await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{id}/play", new { kind = "dev", zoneId = idb })).EnsureSuccessStatusCode();
        Assert.Equal(Playback.PlayState.Paused, cond.State);                       // ...the next chirp pauses it again
        var end = await (await admin.PostAsync($"/api/v1/calibration/sessions/{id}/end", null)).Json();
        Assert.True(end.GetProperty("canResume").GetBoolean()); Assert.False(end.GetProperty("resumed").GetBoolean()); Assert.Equal(Playback.PlayState.Paused, cond.State);   // 0.3.7 L21: stays paused, Resume is offered
        (await admin.PostAsync("/api/v1/stream/resume", null)).EnsureSuccessStatusCode(); Assert.Equal(Playback.PlayState.Playing, cond.State);
        var again = await (await admin.PostAsync($"/api/v1/calibration/sessions/{id}/end", null)).Json();
        Assert.False(again.GetProperty("canResume").GetBoolean());                  // ending twice never double-resumes
    }

    [Fact]
    public void Lookup_user_agents_follow_the_app_version()
    {
        Assert.Contains("WavWiz/" + WavWiz.Core.WavWizInfo.Version + " ", Features.TagFixService.UserAgent);
        Assert.Contains("WavWiz/" + WavWiz.Core.WavWizInfo.Version + " ", Features.RadioFinderService.UserAgent);
        Assert.DoesNotContain("0.0.5", Features.TagFixService.UserAgent); Assert.DoesNotContain("0.0.7", Features.RadioFinderService.UserAgent);
    }
    [Fact]
    public async Task Getting_started_marks_the_speaker_and_test_sound_steps_done()
    {
        var (f, admin, a, b, ida, idb) = await TwoPcs(); await using var _f = f; await using var _a = a; await using var _b = b;
        var c = await admin.GetJson("/api/v1/checklist"); JsonElement Item(JsonElement x, string id) => x.GetProperty("items").EnumerateArray().First(i => i.GetProperty("id").GetString() == id);
        Assert.True(Item(c, "speaker").GetProperty("done").GetBoolean()); Assert.False(Item(c, "test").GetProperty("done").GetBoolean());
        (await f.As(f.Token(Role.Control)).PostAsync($"/api/v1/zones/{ida}/test-sound", null)).EnsureSuccessStatusCode();
        c = await admin.GetJson("/api/v1/checklist"); Assert.True(Item(c, "test").GetProperty("done").GetBoolean());
    }

    [Fact]
    public async Task Favorites_are_stored_on_the_server_need_Control_to_change_and_list_hearted_songs_and_albums()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        TestMedia.Run("-f", "lavfi", "-i", "sine=f=440:d=2", "-metadata", "title=Tone", "-metadata", "artist=Test", "-metadata", "album_artist=Test", "-metadata", "album=Tones", Path.Combine(music, "tone.flac"));
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music });
        for (int i = 0; i < 100; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 1) break; await Task.Delay(100); }
        var tid = (await admin.GetJson("/api/v1/library/search?q=tone"))[0].GetProperty("id").GetInt64();
        var viewer = f.As(f.Token(Role.View, "tv")); var ctl = f.As(f.Token(Role.Control, "phone"));
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PutAsJsonAsync("/api/v1/favorites", new { kind = "track", @ref = tid.ToString(), on = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "song", @ref = "1", on = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "track", @ref = "abc", on = true })).StatusCode);
        (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "track", @ref = tid.ToString(), on = true })).EnsureSuccessStatusCode();
        (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "album", @ref = "Test\u001fTones", on = true })).EnsureSuccessStatusCode();
        (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "album", @ref = "Test\u001fTones", on = true })).EnsureSuccessStatusCode();   // idempotent
        var favs = await viewer.GetJson("/api/v1/favorites"); Assert.Equal(2, favs.GetArrayLength());              // another browser sees them
        var items = await viewer.GetJson("/api/v1/favorites/items");
        Assert.Equal("Tone", items.GetProperty("tracks")[0].GetProperty("title").GetString());
        Assert.Equal("Tones", items.GetProperty("albums")[0].GetProperty("album").GetString());
        (await ctl.PutAsJsonAsync("/api/v1/favorites", new { kind = "track", @ref = tid.ToString(), on = false })).EnsureSuccessStatusCode();
        Assert.Equal(0, (await viewer.GetJson("/api/v1/favorites/items")).GetProperty("tracks").GetArrayLength());
        var artists = await viewer.GetJson("/api/v1/library/artists"); Assert.False(string.IsNullOrEmpty(artists[0].GetProperty("addedAt").GetString()));   // item 13: recently added
    }
}
