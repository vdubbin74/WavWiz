using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>Queue undo (one level) + Recent queues (10 per playback group, saved).</summary>
public class QueueHistoryTests
{
    [Fact]
    public async Task Clear_then_undo_puts_the_queue_back_and_play_now_too_and_recent_restores()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var admin = f.As(f.Token(Role.Admin)); var view = f.As(f.Token(Role.View));
        long a = KeepPlayingTests.Track(S.Db, "A", "X", "G"), b = KeepPlayingTests.Track(S.Db, "B", "X", "G"), c = KeepPlayingTests.Track(S.Db, "C", "Y", "G");
        S.Conductor.Add(S.Conductor.TracksToItems(new[] { a, b }), false);
        var r = await (await admin.PostAsJsonAsync("/api/v1/queue/clear", new { })).Json(); var tok = r.GetProperty("queueUndo").GetString();
        Assert.Empty(S.Conductor.Queue());
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync("/api/v1/queue/undo", new { token = tok })).StatusCode);   // Control role only
        var u = await (await admin.PostAsJsonAsync("/api/v1/queue/undo", new { token = tok })).Json(); Assert.Equal(2, u.GetProperty("restored").GetInt32());
        Assert.Equal(new long?[] { a, b }, S.Conductor.Queue().Select(x => x.RefId).ToArray());
        Assert.Equal("paused", S.Conductor.Now().State);
        // Play now replaces -> Undo brings the old list back
        var p = await (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { c } })).Json();
        S.Conductor.Stop(); Assert.Single(S.Conductor.Queue());
        await admin.PostAsJsonAsync("/api/v1/queue/undo", new { token = p.GetProperty("queueUndo").GetString() });
        Assert.Equal(new long?[] { a, b }, S.Conductor.Queue().Select(x => x.RefId).ToArray());
        // a stale token is refused (the newest change wins)
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/v1/queue/undo", new { token = tok })).StatusCode);
        var rec = await admin.GetJson("/api/v1/queue/recent"); Assert.True(rec.GetArrayLength() >= 2);
        var one = rec.EnumerateArray().First(x => x.GetProperty("count").GetInt32() == 1);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/recent/restore", new { id = one.GetProperty("id").GetString() })).StatusCode);
        Assert.Equal(new long?[] { c }, S.Conductor.Queue().Select(x => x.RefId).ToArray());
    }

    [Fact]
    public async Task Recent_keeps_ten_and_survives_restart_of_the_service()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        for (int i = 0; i < 13; i++) { var t = KeepPlayingTests.Track(S.Db, "T" + i, "X", "G"); S.Conductor.Add(S.Conductor.TracksToItems(new[] { t }), false); S.QHistory.Snapshot(S.Conductor, "Before Clear"); S.Conductor.Clear(); }
        var fresh = new Features.QueueHistoryService(S.Db, S.Events);
        var l = fresh.Recent(Conductor.DefaultGroupId); Assert.Equal(10, l.Count); Assert.Equal("T12 - X", l[0].Titles[0]);
        Assert.Null(S.QHistory.Snapshot(S.Conductor, "empty"));   // an empty queue is not kept
    }
}
