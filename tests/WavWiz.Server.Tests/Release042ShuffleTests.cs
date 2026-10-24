using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.2: Shuffle is a play mode of the zone's queue. It never reorders or rewrites the stored list.</summary>
public class Release042ShuffleTests
{
    private static (Conductor C, Db Db, TempDir T) Make(int n = 8)
    {
        var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        TestMedia.Tone(t.File("a.flac"), 30); c.PlayItems(Enumerable.Range(0, n).Select(i => new QueueItem(0, "track", t.File("a.flac"), "T" + i, "", "", 30000, null)).ToArray(), 3); return (c, db, t);
    }
    private static string[] Titles(Conductor c) => c.Queue().Select(q => q.Title).ToArray();
    private static readonly string[] Order = Enumerable.Range(0, 8).Select(i => "T" + i).ToArray();

    [Fact]
    public async Task Shuffle_on_and_off_never_reorders_the_stored_queue()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c; await Task.Delay(400);
        c.SetShuffle(true); Assert.Equal(Order, Titles(c)); Assert.Equal(3, c.Now().Index); Assert.True(c.Now().Shuffle);
        for (int i = 0; i < 4; i++) { c.Next(); Assert.Equal(Order, Titles(c)); }
        c.SetShuffle(false); Assert.Equal(Order, Titles(c)); Assert.False(c.Now().Shuffle);
        c.Jump(3); await Task.Delay(100); c.Next(); Assert.Equal(4, c.Now().Index);                 // off: normal order continues from the current song
        c.SetShuffle(true); c.SaveLast(); var json = db.Setting(Conductor.LastQueueKey)!; Assert.Contains("\"shuffle\":true", json);
        Assert.Equal(Order.Length, c.BuildLastJson().Split("\"k\":").Length - 1);                 // the saved list is the real list, in order (ids/titles are not permuted)
    }

    [Fact]
    public async Task Shuffle_next_plays_every_song_once_before_any_repeats_then_stops_or_starts_a_new_cycle()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c; await Task.Delay(400);
        c.SetShuffle(true); var seen = new List<int> { c.Now().Index };
        for (int i = 0; i < 7; i++) { c.Next(); seen.Add(c.Now().Index); }
        Assert.Equal(8, seen.Distinct().Count());                                                   // no repeats until all have played
        c.Next(); await Task.Delay(200); Assert.Equal("stopped", c.Now().State);                    // repeat off: the cycle is done
        // repeat all: a new random cycle starts, again with no repeats inside it
        var (c2, db2, t2) = Make(); using var _2 = t2; using var __2 = c2; await Task.Delay(400); c2.SetRepeat(RepeatMode.All); c2.SetShuffle(true);
        var s2 = new List<int> { c2.Now().Index }; for (int i = 0; i < 15; i++) { c2.Next(); s2.Add(c2.Now().Index); }
        Assert.Equal(8, s2.Take(8).Distinct().Count()); Assert.Equal(8, s2.Skip(7).Take(8).Distinct().Count());   // the new cycle starts with the song that was playing
        Assert.Equal(Order, Titles(c2));
    }

    [Fact]
    public async Task Shuffle_previous_walks_back_through_what_actually_played()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c; await Task.Delay(400);
        c.SetShuffle(true); var played = new List<int> { c.Now().Index }; for (int i = 0; i < 4; i++) { c.Next(); played.Add(c.Now().Index); }
        for (int i = 3; i >= 0; i--) { c.Prev(); Assert.Equal(played[i], c.Now().Index); }
        Assert.Equal(Order, Titles(c));
    }

    [Fact]
    public async Task A_queue_that_was_shuffled_in_place_by_0_4_1_is_restored_exactly_as_saved_with_shuffle_off()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        db.SetSetting(Conductor.LastQueueKey, "{\"v\":1,\"index\":0,\"posMs\":0,\"items\":[{\"k\":\"radio\",\"id\":null,\"u\":\"http://127.0.0.1:1/c\",\"t\":\"Gamma\"},{\"k\":\"radio\",\"id\":null,\"u\":\"http://127.0.0.1:1/a\",\"t\":\"Alpha\"}]}");
        var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg); Assert.Equal(2, c.RestoreLast()); Assert.Equal(new[] { "Gamma", "Alpha" }, Titles(c)); Assert.False(c.Now().Shuffle);
        c.SetShuffle(true); c.SaveLast(); var c2 = new Conductor(db, new EventHub(), TestMedia.Ffmpeg); Assert.Equal(2, c2.RestoreLast()); Assert.True(c2.Now().Shuffle); Assert.Equal(new[] { "Gamma", "Alpha" }, Titles(c2));
        await Task.CompletedTask;
    }
}
