using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

public sealed class Recorder : IStreamSubscriber
{
    public string Id => "rec"; public int BufferDepthMs => 3000;
    public readonly List<byte[]> Messages = new(); private readonly object _l = new();
    public void Send(byte[] m) { lock (_l) Messages.Add(m); }
    public int Count(MsgType t) { lock (_l) return Messages.Count(m => m.Length >= 6 && (MsgType)m[5] == t); }
}

public class ConductorTests
{
    private static (Conductor C, Db Db, TempDir T) Make()
    {
        var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        return (new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 }, db, t);
    }

    [Fact]
    public async Task Play_streams_audio_frames_tracks_position_pause_resume_and_ends_cleanly()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 6, 440, "A"); var rec = new Recorder(); c.Subscribe(rec);
        var item = new QueueItem(0, "track", t.File("a.flac"), "A", "x", "y", 6000, 1);
        c.PlayItems(new[] { item }, 0);
        await Task.Delay(1500);
        Assert.Equal("playing", c.Now().State); Assert.True(rec.Count(MsgType.Audio) > 50, $"audio frames: {rec.Count(MsgType.Audio)}"); Assert.Equal(1, rec.Count(MsgType.Epoch));
        Assert.InRange(c.Now().PositionMs, 500, 1600);
        c.Pause(); await Task.Delay(400);
        var np = c.Now(); Assert.Equal("paused", np.State); Assert.InRange(np.PositionMs, 800, 1900); Assert.Equal(1, rec.Count(MsgType.StopAt));
        int audioAtPause = rec.Count(MsgType.Audio); await Task.Delay(500); Assert.Equal(audioAtPause, rec.Count(MsgType.Audio));      // nothing more is produced while paused
        c.Resume(); await Task.Delay(600); Assert.Equal("playing", c.Now().State); Assert.Equal(2, rec.Count(MsgType.Epoch)); Assert.True(c.Now().PositionMs >= np.PositionMs - 100);
        await Task.Delay(6500); Assert.Equal("stopped", c.Now().State);                                                                 // played to the end
    }

    [Fact]
    public async Task Queue_editing_while_playing_next_prev_seek_and_failed_items_are_skipped_with_a_notice()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 4, 440, "A"); TestMedia.Tone(t.File("b.flac"), 4, 550, "B"); File.WriteAllText(t.File("bad.flac"), "x");
        QueueItem I(string n, string title) => new(0, "track", t.File(n), title, "", "", 4000, null);
        c.PlayItems(new[] { I("a.flac", "A"), I("bad.flac", "BAD"), I("b.flac", "B") }, 0); await Task.Delay(800);
        Assert.Equal(0, c.Now().Index); c.Next(); await Task.Delay(1200);
        var n = c.Now(); Assert.Equal("playing", n.State); Assert.Equal(2, n.Index); Assert.Contains("BAD", n.Notice ?? "");        // the broken file is skipped, not turned into silence, and the user is told
        Assert.True(c.Seek(3100)); await Task.Delay(600); Assert.InRange(c.Now().PositionMs, 3100, 3900);
        c.Prev(); await Task.Delay(600); Assert.Equal(2, c.Now().Index); Assert.InRange(c.Now().PositionMs, 0, 1500);   // >3 s into B: Prev restarts the track
        c.Add(new[] { I("a.flac", "A2") }, next: false); Assert.Equal(4, c.Queue().Count);
        Assert.True(c.Remove(3)); Assert.Equal(3, c.Queue().Count); Assert.False(c.Remove(99));
        Assert.True(c.Move(0, 2)); Assert.Equal("A", c.Queue()[2].Title);
        c.Stop(); await Task.Delay(300); Assert.Equal("stopped", c.Now().State);
    }

    [Fact]
    public async Task Shuffle_keeps_the_current_item_first_and_restores_the_order()
    {
        var (c, db, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 4); var items = Enumerable.Range(0, 8).Select(i => new QueueItem(0, "track", t.File("a.flac"), "T" + i, "", "", 4000, null)).ToArray();
        c.PlayItems(items, 3); await Task.Delay(500);
        c.SetShuffle(true); var q = c.Queue(); Assert.Equal("T3", q[0].Title); Assert.Equal(8, q.Select(x => x.Title).Distinct().Count()); Assert.Equal(0, c.Now().Index);
        c.SetShuffle(false); Assert.Equal(Enumerable.Range(0, 8).Select(i => "T" + i), c.Queue().Select(x => x.Title)); Assert.Equal(3, c.Now().Index);
    }
}

public class ClickTrackTests
{
    [Fact]
    public async Task Click_track_decodes_and_streams()
    {
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); using var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        TestMedia.Run("-f", "lavfi", "-i", "aevalsrc=if(lt(mod(t\\,0.5)\\,0.002)\\,0.8\\,0):s=48000:d=12", "-ac", "2", t.File("clicks.flac"));
        var rec = new Recorder(); c.Subscribe(rec);
        c.PlayItems(new[] { new QueueItem(0, "track", t.File("clicks.flac"), "C", "", "", 12000, 1) }, 0); await Task.Delay(2000);
        Assert.True(c.Now().State == "playing", c.Now().ToString() + " audio=" + rec.Count(MsgType.Audio));
    }
}
