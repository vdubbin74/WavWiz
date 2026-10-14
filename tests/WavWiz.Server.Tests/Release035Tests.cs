using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.3.5 J13 (Jukebox starts empty, keeps and restores the host playlist, random filler, guest picks before filler) and
/// J18 (the guest page's "N available plays" comes from the same count as the per-guest limit).</summary>
public class Release035Tests
{
    static async Task<(ServerFixture f, HttpClient admin, List<long> ids)> Setup(int songs = 6, int sec = 30)
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var dir = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        for (int i = 1; i <= songs; i++) TestMedia.Tone(Path.Combine(dir, $"{i}.flac"), sec, 440, $"Song {i}", "Band " + i, "Album", i);
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = dir });
        for (int i = 0; i < 200; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == songs) break; await Task.Delay(100); }
        var all = await admin.GetJson("/api/v1/library/search?q=song");
        var ids = all.EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).OrderBy(x => x).ToList();
        return (f, admin, ids);
    }

    [Fact]
    public async Task J13_jukebox_starts_empty_restores_the_playlist_and_guest_picks_beat_filler()
    {
        var (f, admin, ids) = await Setup(); await using var _ = f;
        var c = f.Server.S.Conductor; var jb = f.Server.S.Jukebox;
        c.PlayItems(c.TracksToItems(ids.Take(4)), 2);
        var before = c.Queue().Select(x => x.RefId).ToList();
        var code = (await (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).Json()).GetProperty("code").GetString()!;
        Assert.Empty(c.Queue()); Assert.Equal(4, jb.SavedCount);
        jb.Tick();                                         // empty queue -> one random filler song plays
        Assert.Single(c.Queue()); Assert.Equal("Playing", c.State.ToString());
        var filler = c.Queue()[0].Id;
        jb.Tick(); Assert.Single(c.Queue());               // never piles up filler
        var anon = new HttpClient { BaseAddress = new Uri(f.Base) }; anon.DefaultRequestHeaders.Add("X-WavWiz-Guest", code);
        // a filler song queued after the playing one: the guest pick goes in front of it
        c.Add(c.TracksToItems(new[] { ids[5] }), false); var queuedFillerRef = ids[5];
        typeof(WavWiz.Server.Features.JukeboxService).GetField("_filler", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(jb)!
            .GetType().GetMethod("Add")!.Invoke(typeof(WavWiz.Server.Features.JukeboxService).GetField("_filler", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(jb), new object[] { c.Queue()[1].Id });
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "Sam", trackId = ids[0] })).StatusCode);
        var q = c.Queue(); Assert.Equal(ids[0], q[1].RefId); Assert.Equal(queuedFillerRef, q[2].RefId);
        var board = await anon.GetJson("/api/v1/jukebox/guest/board?g=guest-aaaa-1"); Assert.True(board.GetProperty("filler").GetBoolean());
        // stop: the playing song keeps playing, the host playlist comes back in its order and carries on from the song that was playing (Song 3)
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { })).StatusCode);
        q = c.Queue(); var now = c.Now();
        Assert.Equal(filler, now.Item!.Id); Assert.Equal("Playing", c.State.ToString());
        Assert.Equal(before, q.Where(x => x.Id != filler).Select(x => x.RefId).ToList());
        Assert.Equal(before[2], q[now.Index + 1].RefId);
        Assert.Equal(0, jb.SavedCount);
    }

    [Fact]
    public async Task J13_stop_with_nothing_playing_puts_the_playlist_back_stopped()
    {
        var (f, admin, ids) = await Setup(3); await using var _ = f;
        var c = f.Server.S.Conductor; var jb = f.Server.S.Jukebox;
        c.Add(c.TracksToItems(ids), false);
        await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { }); Assert.Empty(c.Queue());
        c.Clear(); await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { });
        Assert.Equal(ids.Select(x => (long?)x).ToList(), c.Queue().Select(x => x.RefId).ToList()); Assert.Equal("Stopped", c.State.ToString());
    }

    [Fact]
    public async Task J18_available_plays_count_down_per_add_and_per_guest()
    {
        var (f, admin, ids) = await Setup(6, 60); await using var _ = f;
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { perGuest = 3 });
        var code = (await (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).Json()).GetProperty("code").GetString()!;
        var anon = new HttpClient { BaseAddress = new Uri(f.Base) }; anon.DefaultRequestHeaders.Add("X-WavWiz-Guest", code);
        async Task<int> Left(string g) => (await anon.GetJson("/api/v1/jukebox/guest/board?g=" + g)).GetProperty("playsLeft").GetInt32();
        Assert.Equal(3, await Left("guest-aaaa-1")); Assert.Equal(3, await Left("guest-bbbb-2"));
        for (int i = 0; i < 3; i++) { Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", trackId = ids[i] })).StatusCode); Assert.Equal(2 - i, await Left("guest-aaaa-1")); }
        Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", trackId = ids[3] })).StatusCode);   // 4th pick blocked
        Assert.Equal(3, await Left("guest-bbbb-2"));      // independent per guest
        await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-bbbb-2", name = "B", trackId = ids[4] }); Assert.Equal(2, await Left("guest-bbbb-2"));
        var c = f.Server.S.Conductor;
        c.Next(); Assert.Equal(1, await Left("guest-aaaa-1"));       // the first pick has played -> one back
        var q = c.Queue(); var idx = q.ToList().FindIndex(x => x.RefId == ids[2]); c.Remove(idx);
        Assert.Equal(2, await Left("guest-aaaa-1"));                 // removed -> one back
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", trackId = ids[5] })).StatusCode);
        Assert.Equal(1, await Left("guest-aaaa-1"));
        var host = await admin.GetJson("/api/v1/jukebox/board"); Assert.Equal(JsonValueKind.Null, host.GetProperty("playsLeft").ValueKind);
    }

    [Fact]
    public async Task J10_decade_node_holds_every_song_of_that_decade_only()
    {
        var f = await ServerFixture.StartAsync(); await using var _ = f; var admin = f.As(f.Token(Role.Admin));
        var dir = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        int[] years = { 1989, 1990, 1995, 1999, 2000 };
        for (int i = 0; i < years.Length; i++) TestMedia.Tone(Path.Combine(dir, $"{i}.flac"), 5, 440, $"Song {i}", "Band", "Album " + i, 1, "Rock", years[i]);
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = dir });
        for (int i = 0; i < 200; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == years.Length) break; await Task.Delay(100); }
        var rows = f.Server.S.Library.ByDecade(1990);
        Assert.Equal(3, rows.Count);
        Assert.Equal(f.Server.S.Library.ByDecade(1995).Count, rows.Count);   // any year inside the decade means the decade
        Assert.Single(f.Server.S.Library.ByDecade(1980)); Assert.Single(f.Server.S.Library.ByDecade(2000));
        var id = (await (await admin.PostAsJsonAsync("/api/v1/playlists", new { name = "90s" })).Json()).GetProperty("id").GetInt64();
        (await admin.PostAsJsonAsync($"/api/v1/playlists/{id}/items", new { kind = "node", node = "decade:1990s" })).EnsureSuccessStatusCode();
        Assert.Equal(3, (await admin.GetJson($"/api/v1/playlists/{id}")).GetProperty("items").GetArrayLength());
    }
}
