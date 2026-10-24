using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F73: with shuffle on, the now-playing state advertises the song that really plays next (nextIndex / nextTrack), and every way of
/// advancing (Next, the end of a song) goes to exactly that song - also after queue edits, with the repeat modes, at the end of the cycle and after a restart.</summary>
public class Release049ShuffleNextTests
{
    private static (Conductor C, Db Db, TempDir T) Make(int n = 8, int secs = 30)
    {
        var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        TestMedia.Tone(t.File("a.flac"), secs); c.PlayItems(Enumerable.Range(0, n).Select(i => new QueueItem(0, "track", t.File("a.flac"), "T" + i, "", "", secs * 1000L, null)).ToArray(), 3); return (c, db, t);
    }
    private static string? NextTitle(Conductor c) => c.Now().NextTrack?.Title;

    [Fact]
    public async Task Shuffle_next_goes_to_the_advertised_track_every_time()
    {
        var (c, _, t) = Make(); using var __t = t; using var __c = c; await Task.Delay(400);
        c.SetRepeat(RepeatMode.All); c.SetShuffle(true);
        for (int i = 0; i < 12; i++)
        {
            var np = c.Now(); Assert.True(np.NextIndex >= 0); Assert.NotNull(np.NextTrack);
            Assert.Equal(np.NextTrack!.Title, c.Queue()[np.NextIndex].Title);
            Assert.Equal(NextTitle(c), np.NextTrack.Title);                                   // stable: asking again does not re-roll
            c.Next(); Assert.Equal(np.NextTrack.Title, c.Now().Item!.Title);
        }
    }

    [Fact]
    public async Task Shuffle_auto_advance_at_the_end_of_a_song_plays_the_advertised_track()
    {
        var (c, _, t) = Make(6, 2); using var __t = t; using var __c = c; await Task.Delay(300);
        c.SetShuffle(true);
        for (int k = 0; k < 3; k++)
        {
            var np = c.Now(); var want = np.NextTrack!.Title; var from = np.Index;
            var until = DateTime.UtcNow.AddSeconds(8); while (c.Now().Index == from && DateTime.UtcNow < until) await Task.Delay(50);
            Assert.Equal(want, c.Now().Item!.Title);
        }
    }

    [Fact]
    public async Task Queue_edits_keep_the_advertised_next_in_sync_with_what_plays()
    {
        var (c, _, t) = Make(); using var __t = t; using var __c = c; await Task.Delay(400);
        c.SetShuffle(true);
        var want = NextTitle(c)!;
        c.Insert(new[] { new QueueItem(0, "track", c.Queue()[0].Location, "NEW", "", "", 30000, null) }, 0);   // shifts every index
        Assert.Equal(want, NextTitle(c)); Assert.Equal(want, c.Queue()[c.Now().NextIndex].Title);
        int cur = c.Now().Index, other = Enumerable.Range(0, c.Queue().Count).First(i => i != cur && c.Queue()[i].Title != want);
        c.Move(other, other == 0 ? 1 : 0); Assert.Equal(want, NextTitle(c));
        // removing the advertised song re-picks; the new pick is what plays
        Assert.True(c.Remove(c.Now().NextIndex)); var re = c.Now(); Assert.NotNull(re.NextTrack); Assert.NotEqual(want, re.NextTrack!.Title);
        c.Next(); Assert.Equal(re.NextTrack.Title, c.Now().Item!.Title);
        // toggling shuffle off advertises the list neighbour, and Next goes there
        c.SetShuffle(false); var off = c.Now(); Assert.Equal(off.Index + 1 < c.Queue().Count ? off.Index + 1 : -1, off.NextIndex);
    }

    [Fact]
    public async Task Repeat_modes_and_the_end_of_the_cycle()
    {
        var (c, _, t) = Make(3); using var __t = t; using var __c = c; await Task.Delay(400);
        c.SetShuffle(true); c.SetRepeat(RepeatMode.One); Assert.Equal(c.Now().Index, c.Now().NextIndex);   // the song repeats
        c.SetRepeat(RepeatMode.Off); c.Next(); c.Next(); Assert.Equal(-1, c.Now().NextIndex); Assert.Null(c.Now().NextTrack);   // all three played: nothing follows
        c.SetRepeat(RepeatMode.All); var np = c.Now(); Assert.True(np.NextIndex >= 0);                     // a new cycle
        c.Next(); Assert.Equal(np.NextTrack!.Title, c.Now().Item!.Title);
    }

    [Fact]
    public async Task The_advertised_next_survives_a_restart()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        var items = string.Join(",", Enumerable.Range(0, 6).Select(i => $"{{\"k\":\"radio\",\"id\":null,\"u\":\"http://127.0.0.1:1/{i}\",\"t\":\"R{i}\"}}"));
        db.SetSetting(Conductor.LastQueueKey, "{\"v\":2,\"index\":1,\"posMs\":0,\"shuffle\":true,\"played\":[1],\"hist\":[1],\"pick\":4,\"items\":[" + items + "]}");
        using var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 }; Assert.Equal(6, c.RestoreLast());
        Assert.Equal("R4", NextTitle(c)); Assert.Equal(4, c.Now().NextIndex);
        // and it is saved again as the same pick
        Assert.Contains("\"pick\":4", c.BuildLastJson());
        c.Next(); Assert.Equal("R4", c.Now().Item!.Title);
        await Task.CompletedTask;
    }
}
