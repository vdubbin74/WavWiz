using WavWiz.PlayerCore;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.3.3 G12 (insert at the drop position, current song kept) and G4b (mini player window opacity range).</summary>
public class Release033Tests
{
    [Fact]
    public async Task Insert_puts_library_items_at_the_drop_position_and_keeps_the_playing_song()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); using var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        TestMedia.Tone(t.File("a.flac"), 6, 440, "A");
        QueueItem I(string title) => new(0, "track", t.File("a.flac"), title, "", "", 6000, null);
        c.PlayItems(new[] { I("A"), I("B"), I("C") }, 1); await Task.Delay(500);
        c.Insert(new[] { I("X"), I("Y") }, 0);
        Assert.Equal(new[] { "X", "Y", "A", "B", "C" }, c.Queue().Select(q => q.Title));
        Assert.Equal(3, c.Now().Index);   // still B
        c.Insert(new[] { I("Z") }, 99); Assert.Equal("Z", c.Queue()[^1].Title);
        c.Insert(new[] { I("M") }, 4); Assert.Equal("M", c.Queue()[4].Title);
        // multi-row block reorder as sequential moves (what the playlist sends)
        Assert.True(c.Move(0, 6)); Assert.True(c.Move(0, 6)); Assert.Equal(new[] { "A", "B", "M", "C", "Z", "X", "Y" }, c.Queue().Select(q => q.Title));
        Assert.Equal("B", c.Queue()[c.Now().Index].Title);
        c.Stop();
    }

    [Fact]
    public void Mini_player_opacity_is_kept_between_30_percent_and_opaque()
    {
        Assert.Equal(1.0, MiniPlayer.ClampOpacity(1.0)); Assert.Equal(0.3, MiniPlayer.ClampOpacity(0.1)); Assert.Equal(0.55, MiniPlayer.ClampOpacity(0.55));
        Assert.Equal(1.0, MiniPlayer.ClampOpacity(double.NaN)); Assert.Equal(1.0, MiniPlayer.ClampOpacity(0)); Assert.Equal(1.0, MiniPlayer.ClampOpacity(4));
    }
}
