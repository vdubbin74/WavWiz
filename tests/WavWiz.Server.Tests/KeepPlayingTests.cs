using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Features;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>Keep playing: everyday queue autofill (setting per playback group, pick rules, no-repeat, Jukebox defer, source pill, persistence).</summary>
public class KeepPlayingTests
{
    internal static long Track(Db db, string title, string artist, string genre, int? year = null, DateTimeOffset? added = null)
        => db.Insert("INSERT INTO track(path,root_id,size,mtime,title,artist,album_artist,album,duration_ms,genre,year,added_at,search) VALUES($p,1,1,1,$t,$a,$a,'Al',200000,$g,$y,$d,$t)",
            ("$p", "/m/" + Guid.NewGuid() + ".flac"), ("$t", title), ("$a", artist), ("$g", genre), ("$y", year), ("$d", (added ?? DateTimeOffset.UtcNow).ToString("O")));

    [Fact]
    public void Dry_only_when_playing_last_song_near_its_end()
    {
        var it = new QueueItem(1, "track", "x", "t", "a", "", 200_000, 1);
        NowPlaying N(string st, long pos, int next = -1) => new(st, 0, pos, 200_000, it, null, null, false, "off", 1, next);
        Assert.True(KeepPlayingService.Dry(N("playing", 190_000), 1));
        Assert.False(KeepPlayingService.Dry(N("playing", 10_000), 1));
        Assert.False(KeepPlayingService.Dry(N("playing", 190_000, 1), 2));
        Assert.False(KeepPlayingService.Dry(N("stopped", 190_000), 1));
        Assert.False(KeepPlayingService.Dry(N("playing", 190_000), 0));
    }

    [Fact]
    public async Task Similar_prefers_artist_then_genre_and_choose_avoids_repeats_then_allows_them()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var db = S.Db;
        long a1 = Track(db, "A1", "Ann", "Jazz"), a2 = Track(db, "A2", "Ann", "Jazz"), b1 = Track(db, "B1", "Bob", "Jazz"), c1 = Track(db, "C1", "Cy", "Rock");
        Assert.Equal(new[] { a2 }, S.Keep.Similar(S.Conductor.TracksToItems(new[] { a1 }).Single()));
        var solo = Track(db, "S1", "Solo", "Rock");
        Assert.Equal(new[] { c1 }, S.Keep.Similar(S.Conductor.TracksToItems(new[] { solo }).Single()));   // no other song by Solo -> same genre
        var pool = new long[] { a1, a2 }; var none = new List<QueueItem>();
        var p1 = S.Keep.Choose("g", pool, none)!.Value; var p2 = S.Keep.Choose("g", pool, none)!.Value;
        Assert.NotEqual(p1, p2);                                     // no repeat inside 6 h
        Assert.Contains(S.Keep.Choose("g", pool, none)!.Value, pool);   // pool used up -> repeat rather than stop
        _ = b1;
    }

    [Fact]
    public async Task Setting_persists_and_validates_and_keep_rows_get_the_pill()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var admin = f.As(f.Token(Role.Admin));
        long t = Track(S.Db, "K", "Kay", "Pop");
        var pid = (await (await admin.PostAsJsonAsync("/api/v1/playlists", new { name = "Mix", trackIds = new[] { t } })).Json()).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "playlist", id = 9999 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "playlist", id = pid })).StatusCode);
        S.Keep.Forget(Conductor.DefaultGroupId);   // as after a restart: read back from the database
        var k = await admin.GetJson("/api/v1/queue/keep"); Assert.Equal("playlist", k.GetProperty("mode").GetString()); Assert.Equal(pid, k.GetProperty("id").GetInt64());
        var item = S.Keep.Pick(Conductor.DefaultGroupId, S.Keep.Get(Conductor.DefaultGroupId), null, new List<QueueItem>()); Assert.NotNull(item); Assert.Equal(t, item!.RefId);
        S.Conductor.Add(new[] { item with { Origin = KeepPlayingService.Origin } }, false);
        var row = (await admin.GetJson("/api/v1/queue")).GetProperty("items")[0];
        Assert.Equal("keep", row.GetProperty("source").GetString()); Assert.Equal("Keep playing", row.GetProperty("sourceLabel").GetString());
        Assert.Contains("\"o\":\"keep\"", S.Conductor.BuildLastJson());   // the pill survives a restart
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "off" })).StatusCode);
        Assert.Single(S.Conductor.Queue());   // Off never clears rows already added
        var rid = S.Db.Insert("INSERT INTO radio_station(name,url) VALUES('R','http://127.0.0.1:1/r')");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "radio", id = rid })).StatusCode);
        Assert.Equal("radio", S.Keep.Pick(Conductor.DefaultGroupId, S.Keep.Get(Conductor.DefaultGroupId), null, new List<QueueItem>())!.Kind);
    }

    [Fact]
    public async Task Jukebox_queue_is_skipped()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        Assert.Null(S.Keep.Set(Conductor.DefaultGroupId, "similar", null));
        S.Keep.JukeboxOwns = () => S.Conductor; int before = S.Conductor.Queue().Count; S.Keep.Tick();
        Assert.Equal(before, S.Conductor.Queue().Count);
    }

    [Fact]
    public async Task Skip_on_the_last_song_adds_the_next_auto_pick_first()   // 0.6.8-#3
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var db = S.Db;
        long a1 = Track(db, "A1", "Ann", "Jazz"), a2 = Track(db, "A2", "Ann", "Jazz");
        S.Conductor.Add(S.Conductor.TracksToItems(new[] { a1 }), false);
        Assert.False(S.Keep.FillForSkip(S.Conductor));                       // Keep playing off: Next behaves as before
        Assert.Null(S.Keep.Set(Conductor.DefaultGroupId, "similar", null));
        Assert.True(S.Keep.FillForSkip(S.Conductor));
        var q = S.Conductor.Queue(); Assert.Equal(2, q.Count); Assert.Equal(a2, q[1].RefId); Assert.Equal(KeepPlayingService.Origin, q[1].Origin);
        Assert.False(S.Keep.FillForSkip(S.Conductor));                       // something is up next now: no second fill
        S.Keep.JukeboxOwns = () => S.Conductor; S.Conductor.Clear(); S.Conductor.Add(S.Conductor.TracksToItems(new[] { a1 }), false);
        Assert.False(S.Keep.FillForSkip(S.Conductor));                       // the Jukebox's zone keeps its own autofill
    }

    static QueueItem Remote(string artist, string? genre = null, int? year = null) => new(0, "remote", "subsonic:nd:" + Guid.NewGuid(), "R", artist, "Al", 200_000, null, genre, year);

    [Fact]
    public async Task F228_remote_similar_artist_genre_year_fallbacks()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var db = S.Db;
        long ann = Track(db, "A1", "Ann", "Jazz", 1990), air = Track(db, "Air1", "Airbourne", "Metal", 1970), bowie = Track(db, "B1", "Bowie & Co", "Glam", 2001);
        Assert.Equal(new[] { ann }, S.Keep.Similar(Remote("Ann")));                       // exact
        Assert.Equal(new[] { ann }, S.Keep.Similar(Remote("  Ann  feat. Zed")));           // feat.-stripped
        Assert.Equal(new[] { ann }, S.Keep.Similar(Remote("ANN")));
        Assert.Equal(new[] { air }, S.Keep.Similar(Remote("Nobody", "metal")));           // genre fallback
        Assert.Equal(new[] { bowie }, S.Keep.Similar(Remote("Nobody", "Polka", 2003)));   // year +/-2
        Assert.Empty(S.Keep.Similar(Remote("Nobody", "Polka", 1950)));                     // no any-local last resort
        Assert.DoesNotContain(air, S.Keep.Similar(Remote("Air")));                         // Air != Airbourne
        Assert.Contains(bowie, S.Keep.Similar(Remote("Bowie")));                           // delimiter-bounded prefix
    }

    [Fact]
    public async Task F228_remote_genre_year_survive_save_restore()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S;
        S.Conductor.Add(new[] { Remote("Ann", "Jazz", 1991) }, false);
        var json = S.Conductor.BuildLastJson();
        Assert.Contains("\"g\":\"Jazz\"", json); Assert.Contains("\"y\":1991", json);
        S.Db.SetSetting(Conductor.LastQueueKey, json);
        var c2 = new Conductor(S.Db, new EventHub(), TestMedia.Ffmpeg); Assert.Equal(1, c2.RestoreLast());
        var back = c2.Queue().Single(); Assert.Equal("Jazz", back.Genre); Assert.Equal(1991, back.Year);
    }

    [Fact]
    public async Task Similar_pick_widens_to_the_genre_and_avoids_repeating_artists()   // 0.6.8-#13
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var db = S.Db;
        long a1 = Track(db, "A1", "Ann", "Jazz"), a2 = Track(db, "A2", "Ann", "Jazz"), a3 = Track(db, "A3", "Ann", "Jazz");
        long b1 = Track(db, "B1", "Bob", "Jazz"), c1 = Track(db, "C1", "Cy", "Jazz"), r1 = Track(db, "R1", "Rex", "Rock");
        var none = new List<QueueItem>(); var last = S.Conductor.TracksToItems(new[] { a1 }).Single();
        S.Keep.Roll = () => 0.99;   // roam the wider pool
        var p1 = S.Keep.SimilarPick("g", last, none)!.Value; var p2 = S.Keep.SimilarPick("g", last, none)!.Value;
        Assert.Equal(new[] { b1, c1 }.OrderBy(x => x), new[] { p1, p2 }.OrderBy(x => x));   // other Jazz artists first, never Ann right after Ann
        var p3 = S.Keep.SimilarPick("g", last, none)!.Value;
        Assert.Contains(p3, new[] { a2, a3 });                    // only Ann left fresh: still plays (no silence), never off-genre Rock
        S.Keep.Roll = () => 0.0;    // stay close: the classic same-artist match
        Assert.Contains(S.Keep.SimilarPick("h", last, none)!.Value, new[] { a2, a3 });
        Assert.DoesNotContain(r1, new[] { p1, p2, p3 });
    }
}
