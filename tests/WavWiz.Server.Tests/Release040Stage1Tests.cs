using System.Net;
using System.Text.Json;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.0 Stage 1: ConductorRegistry, playback groups, link/unlink, optional zoneId, per-group last queue, lazy idle groups.</summary>
public class Release040Stage1Tests
{
    private sealed class Rec : IStreamSubscriber
    {
        public Rec(string id) { Id = id; } public string Id { get; } public int BufferDepthMs => 2000;
        private readonly List<byte[]> _m = new(); private readonly object _l = new();
        public void Send(byte[] m) { lock (_l) _m.Add(m); }
        public int Count(MsgType t) { lock (_l) return _m.Count(x => x.Length >= 6 && (MsgType)x[5] == t); }
    }
    private static (ConductorRegistry R, Db Db, TempDir T, EventHub Ev) Make(Db? db = null, TempDir? t = null)
    {
        t ??= new TempDir(); if (db == null) { db = new Db(t.File("u.db")); db.Migrate(); }
        var ev = new EventHub(); var d = new Conductor(db, ev, TestMedia.Ffmpeg) { LeadMs = 300 };
        return (new ConductorRegistry(d, id => new Conductor(db, ev, TestMedia.Ffmpeg, d.Clock, id) { LeadMs = 300 }, db, ev), db, t, ev);
    }
    private static QueueItem Item(string path, string title, long ms = 8000) => new(0, "track", path, title, "x", "y", ms, 1);

    [Fact]
    public void Default_group_is_the_old_single_conductor_and_unknown_groups_are_refused()
    {
        var (r, _, t, _) = Make(); using var _t = t; using var _r = r;
        Assert.Same(r.Default, r.Get(null)); Assert.Same(r.Default, r.Get("")); Assert.Same(r.Default, r.Get("default"));
        Assert.Null(r.Get("nope")); Assert.False(r.Exists("nope")); Assert.Equal("default", r.Default.GroupId);
        Assert.Single(r.Groups()); Assert.Equal("default", r.GroupOf("anyone"));
        Assert.Same(r.Default, r.ForPlayer("anyone"));
    }

    [Fact]
    public async Task Idle_conductors_have_no_timer_and_wake_only_for_playback()
    {
        var (r, db, t, _) = Make(); using var _t = t; using var _r = r;
        TestMedia.Tone(t.File("a.flac"), 3, 440, "A");
        await Task.Delay(300); Assert.False(r.Default.PumpArmed);                         // nothing playing: no timer
        r.Split("d1"); var g = r.Get("p:d1")!; await Task.Delay(300); Assert.False(g.PumpArmed); Assert.True(g.IsIdle);
        g.PlayItems(new[] { Item(t.File("a.flac"), "A", 3000) }); Assert.True(g.PumpArmed); Assert.False(r.Default.PumpArmed);
        await Task.Delay(5000);                                                           // played to the end, then goes quiet again
        Assert.Equal("stopped", g.Now().State); Assert.False(g.PumpArmed);
        g.Pause(); Assert.False(r.Default.PumpArmed);
    }

    [Fact]
    public async Task Split_and_link_move_a_device_between_streams_without_touching_the_others()
    {
        var (r, db, t, _) = Make(); using var _t = t; using var _r = r;
        TestMedia.Tone(t.File("a.flac"), 8, 440, "A"); TestMedia.Tone(t.File("b.flac"), 8, 660, "B");
        var d1 = new Rec("d1"); var d2 = new Rec("d2"); r.Subscribe(d1); r.Subscribe(d2);
        Assert.Equal(2, r.Default.Subscribers().Count);
        r.Default.PlayItems(new[] { Item(t.File("a.flac"), "A") }); await Task.Delay(1200);
        Assert.Equal(1, d1.Count(MsgType.Epoch)); Assert.Equal(1, d2.Count(MsgType.Epoch)); Assert.True(d2.Count(MsgType.Audio) > 10);

        var gid = r.Split("d2"); Assert.Equal("p:d2", gid); Assert.Equal(gid, r.GroupOf("d2"));
        Assert.Equal(1, d2.Count(MsgType.StopAt));                                        // d2 fades out of the house stream
        Assert.Equal(0, d1.Count(MsgType.StopAt)); Assert.Equal("playing", r.Default.Now().State);   // the house keeps its song
        Assert.Single(r.Default.Subscribers()); var own = r.Get(gid)!; Assert.Single(own.Subscribers()); Assert.Equal("stopped", own.Now().State);
        Assert.Same(r.Default.Clock, own.Clock);                                          // one shared clock

        int audioBefore = d2.Count(MsgType.Audio); own.PlayItems(new[] { Item(t.File("b.flac"), "B") }); await Task.Delay(1200);
        Assert.True(d2.Count(MsgType.Audio) > audioBefore + 10); Assert.Equal("A", r.Default.Now().Item!.Title); Assert.Equal("B", own.Now().Item!.Title);
        Assert.Equal(1, d1.Count(MsgType.Epoch));                                         // d1 never saw the other group's epoch

        int audioAtLink = d2.Count(MsgType.Audio);
        r.Link("d2"); Assert.Equal("default", r.GroupOf("d2")); Assert.Equal(2, r.Default.Subscribers().Count); Assert.Empty(own.Subscribers());
        await Task.Delay(800); Assert.Equal("stopped", own.Now().State);                  // an empty group goes quiet, queue kept
        Assert.Single(own.Queue()); Assert.Equal("B", own.Queue()[0].Title);
        Assert.True(d2.Count(MsgType.Epoch) >= 3);                                        // d2 joined the house stream's epoch
        Assert.True(d2.Count(MsgType.Audio) > audioAtLink + 10, "F12: mid-song link must deliver audio frames without a track change");
        Assert.Equal("A", r.Default.Now().Item!.Title);                                   // house song unchanged
        Assert.True(own.IsIdle);
        // unlink again: it resumes ITS queue (stopped, nothing auto-plays)
        r.Split("d2"); Assert.Equal("stopped", r.Get("p:d2")!.Now().State); Assert.Equal("B", r.Get("p:d2")!.Queue()[0].Title);
    }

    [Fact]
    public void Link_group_merges_everyone_and_layout_survives_a_restart()
    {
        var (r, db, t, _) = Make(); using var _t = t;
        var a = new Rec("a"); var b = new Rec("b"); var c = new Rec("c"); r.Subscribe(a); r.Subscribe(b); r.Subscribe(c);
        r.Split("a"); r.Split("b"); Assert.Equal(3, r.Groups().Count);
        Assert.Equal(new[] { "c" }, r.Groups().First(g => g.IsDefault).PlayerIds);
        var r2dbPath = t.File("u.db"); r.Dispose();
        var (r2, _, _, _) = Make(db, t); using var _r2 = r2;
        Assert.Equal("p:a", r2.GroupOf("a")); Assert.Equal("p:b", r2.GroupOf("b")); Assert.Equal("default", r2.GroupOf("c")); Assert.Equal(3, r2.Groups().Count);
        r2.LinkGroup("p:a", "p:b"); Assert.Equal("p:b", r2.GroupOf("a")); r2.LinkGroup("p:b"); Assert.Equal("default", r2.GroupOf("a")); Assert.Equal("default", r2.GroupOf("b"));
        Assert.Throws<ArgumentException>(() => r2.Link("a", "nope")); Assert.Throws<ArgumentException>(() => r2.LinkGroup("default", "p:a"));
        r2.Forget("a"); Assert.Equal("default", r2.GroupOf("a"));
        using var rr3 = Make(db, t).R; Assert.Equal("default", rr3.GroupOf("a"));         // forgotten devices stay linked
    }

    [Fact]
    public void A_damaged_layout_means_everything_linked()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); db.SetSetting(ConductorRegistry.LayoutKey, "{not json");
        var (r, _, _, _) = Make(db, t); using var _r = r; Assert.Single(r.Groups()); Assert.Equal("default", r.GroupOf("x"));
    }

    [Fact]
    public void The_old_single_last_queue_becomes_the_default_groups_and_each_group_saves_under_its_own_key()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        db.SetSetting(Conductor.LastQueueKey, JsonSerializer.Serialize(new { v = 1, index = 0, posMs = 0, items = new[] { new { k = "radio", id = (long?)null, u = "http://127.0.0.1:1/a", t = "Alpha" } } }));   // a 0.3.9 blob
        var (r, _, _, _) = Make(db, t);
        r.EnablePersistence();                                                             // the 0.3.9 blob is the default group's queue
        Assert.Equal("Alpha", r.Default.Queue()[0].Title); Assert.Equal("playback.lastQueue", r.Default.LastQueueSettingKey);
        r.Split("d1"); var g = r.Get("p:d1")!; g.Add(new[] { Conductor.UrlItem("http://127.0.0.1:1/b", "Beta") }, false); r.SaveAll();
        Assert.Equal("playback.lastQueue.p:d1", g.LastQueueSettingKey);
        Assert.Contains("Beta", db.Setting(g.LastQueueSettingKey)); Assert.DoesNotContain("Beta", db.Setting(Conductor.LastQueueKey)); Assert.Contains("Alpha", db.Setting(Conductor.LastQueueKey));
        r.Dispose();
        var (r2, _, _, _) = Make(db, t); using var _r2 = r2; r2.EnablePersistence();                 // restart: both queues come back, paused
        Assert.Equal("Alpha", r2.Default.Queue()[0].Title); Assert.Equal("Beta", r2.Get("p:d1")!.Queue()[0].Title); Assert.Equal("paused", r2.Get("p:d1")!.Now().State);
    }

    [Fact]
    public void Events_carry_the_zone_id()
    {
        var (r, _, t, ev) = Make(); using var _t = t; using var _r = r; var (sid, rd) = ev.Subscribe();
        r.Split("d1"); r.Get("p:d1")!.SetShuffle(true); r.Default.SetRepeat(RepeatMode.All);
        var msgs = new List<string>(); while (rd.TryRead(out var m)) msgs.Add(m);
        Assert.Contains(msgs, m => m.Contains("\"type\":\"now\"") && m.Contains("\"zoneId\":\"p:d1\""));
        Assert.Contains(msgs, m => m.Contains("\"type\":\"now\"") && m.Contains("\"zoneId\":\"default\""));
    }

    [Fact]
    public async Task Api_without_zoneId_behaves_as_before_and_zoneId_targets_one_group()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected();
        long tid = await E2ETests.AddClickTrack(f, admin, 20);
        // old clients: no zoneId anywhere
        var def = await admin.GetJson("/api/v1/stream"); Assert.Equal("default", def.GetProperty("zoneId").GetString());
        var zs = await admin.GetJson("/api/v1/stream/zones"); Assert.Equal(1, zs.GetProperty("zones").GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } })).StatusCode);
        Assert.Equal("playing", (await admin.GetJson("/api/v1/stream")).GetProperty("now").GetProperty("state").GetString());
        // unknown zone
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/stream?zoneId=nope")).StatusCode);   // 0.4.1: an unknown zone falls back to the house group
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/stream/pause", new { zoneId = "nope" })).StatusCode);
        Assert.Equal("playing", f.Server.S.Conductor.Now().State);                          // 0.4.2: pause/stop with an unknown zone never acts on the house group
        // split pc-b, give it its own music via zoneId (body and query forms)
        var sp = await admin.PostAsJsonAsync("/api/v1/stream/zones/split", new { deviceId = "pc-b" }); Assert.Equal(HttpStatusCode.OK, sp.StatusCode); var zid = (await sp.Json()).GetProperty("zoneId").GetString()!;
        Assert.Equal("p:pc-b", zid);
        await Task.Delay(500); long mark = f.Server.S.Registry.Clock.NowUs;
        Assert.Equal("stopped", (await admin.GetJson($"/api/v1/stream?zoneId={Uri.EscapeDataString(zid)}")).GetProperty("now").GetProperty("state").GetString());
        Assert.Empty(b.Clicks(mark)); Assert.Equal("playing", f.Server.S.Conductor.Now().State);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid }, zoneId = zid })).StatusCode);
        for (int i = 0; i < 100 && b.Clicks(mark).Count < 4; i++) await Task.Delay(100);
        Assert.True(b.Clicks(mark).Count >= 4, "the split device plays its own group");
        Assert.Single(f.Server.S.Conductor.Queue());                                        // the house queue was not replaced
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/stream/pause?zoneId={Uri.EscapeDataString(zid)}", new { })).StatusCode);
        Assert.Equal("paused", f.Server.S.Registry.Get(zid)!.Now().State); Assert.Equal("playing", f.Server.S.Conductor.Now().State);
        // link it back
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/zones/link", new { deviceId = "pc-b" })).StatusCode);
        Assert.Equal("default", f.Server.S.Registry.GroupOf("pc-b")); Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/stream/zones/link", new { })).StatusCode);
        // view role cannot split
        var viewer = f.As(f.Token(Role.View)); Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsJsonAsync("/api/v1/stream/zones/split", new { deviceId = "pc-a" })).StatusCode);
    }
}
