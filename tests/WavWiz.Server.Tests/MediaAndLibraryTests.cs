using System.Net;
using WavWiz.Server;
using WavWiz.Server.Library;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

public class MediaAndLibraryTests
{
    private static Db NewDb(TempDir t) { var db = new Db(t.File("u.db")); db.Migrate(); return db; }

    [Fact]
    public void Migration_is_idempotent_and_creates_the_spec_tables()
    {
        using var t = new TempDir(); var db = NewDb(t); db.Migrate();
        Assert.Equal(Db.Migrations.Length, db.Version());
        foreach (var tbl in new[] { "track", "playlist", "radio_station", "player", "output_device", "output_endpoint", "zone", "calibration", "dsp_preset", "output_device_dsp", "api_token", "setting", "library_root" })
            Assert.Equal(1L, db.Scalar("SELECT COUNT(*) FROM sqlite_master WHERE name=$n", ("$n", tbl)));
    }

    [Fact]
    public void Scanner_reads_tags_is_incremental_marks_deleted_files_missing_and_never_writes_to_the_music()
    {
        using var t = new TempDir(); var db = NewDb(t); var lib = new LibraryService(db);
        var music = Directory.CreateDirectory(t.File("music")).FullName; Directory.CreateDirectory(Path.Combine(music, "Album One"));
        TestMedia.Tone(Path.Combine(music, "Album One", "01 first.flac"), 1, 440, "First Song", "Alpha", "Album One", 1, "Rock");
        TestMedia.Tone(Path.Combine(music, "Album One", "02 second.mp3"), 1, 550, "Second Song", "Alpha", "Album One", 2, "Rock");
        TestMedia.Tone(Path.Combine(music, "loose.ogg"), 1, 660, "Loose", "Beta", "Singles", 1, "Jazz");
        var before = Directory.GetFiles(music, "*", SearchOption.AllDirectories).ToDictionary(f => f, f => File.GetLastWriteTimeUtc(f));
        lib.AddRoot(music);
        var r1 = lib.Scan();
        Assert.Equal(3, r1.Added); Assert.Equal(0, r1.Errors); Assert.Equal(3, lib.TrackCount());
        var first = lib.Search("first song").Single();
        Assert.Equal("Alpha", first.Artist); Assert.Equal("Album One", first.Album); Assert.Equal(1, first.TrackNo); Assert.InRange(first.DurationMs, 900, 1100);
        Assert.Equal(2, lib.Search("alpha").Count); Assert.Single(lib.Search("jazz"));
        var r2 = lib.Scan(); Assert.Equal(0, r2.Added + r2.Updated); Assert.Equal(3, r2.Unchanged);               // incremental
        File.Delete(Path.Combine(music, "loose.ogg"));
        var r3 = lib.Scan(); Assert.Equal(1, r3.Missing); Assert.Equal(2, lib.TrackCount());
        foreach (var kv in before) if (File.Exists(kv.Key)) Assert.Equal(kv.Value, File.GetLastWriteTimeUtc(kv.Key));   // read-only: untouched
    }

    [Fact]
    public void An_unreachable_root_is_reported_and_does_not_make_the_whole_library_vanish()
    {
        using var t = new TempDir(); var db = NewDb(t); var lib = new LibraryService(db);
        var music = Directory.CreateDirectory(t.File("music")).FullName;
        TestMedia.Tone(Path.Combine(music, "a.flac"), 1);
        lib.AddRoot(music); lib.Scan(); Assert.Equal(1, lib.TrackCount());
        Directory.Delete(music, true);                                    // the share went away
        var r = lib.Scan();
        Assert.Equal(1, r.Errors); Assert.Equal(0, r.Missing); Assert.Equal(1, lib.TrackCount());
        Assert.Contains("does not exist", string.Join(' ', r.Messages));
    }

    [Fact]
    public void Root_validation_gives_plain_advice()
    {
        Assert.NotNull(LibraryService.RootProblem(""));
        Assert.Contains("does not exist", LibraryService.RootProblem("/definitely/not/here")!);
        using var t = new TempDir(); Assert.Null(LibraryService.RootProblem(t.Path));
    }

    [Fact]
    public void Search_is_safe_against_wildcards_and_the_tree_walks_artists_albums_tracks()
    {
        using var t = new TempDir(); var db = NewDb(t); var lib = new LibraryService(db);
        var m = Directory.CreateDirectory(t.File("m")).FullName;
        TestMedia.Tone(Path.Combine(m, "1.flac"), 1, 440, "100% Pure", "A_B", "Alb", 1);
        TestMedia.Tone(Path.Combine(m, "2.flac"), 1, 440, "Other", "Zed", "Alb2", 1);
        lib.AddRoot(m); lib.Scan();
        Assert.Single(lib.Search("100%")); Assert.Single(lib.Search("%"));  /* literal % only matches the title that contains it */ Assert.Empty(lib.Search("a.b")); Assert.Single(lib.Search("a_b"));
        System.Text.Json.JsonElement J(object o) => System.Text.Json.JsonSerializer.SerializeToElement(o);
        Assert.Equal(4, J(lib.Tree(null)).GetProperty("nodes").GetArrayLength());
        Assert.Equal(2, J(lib.Tree("artists")).GetProperty("nodes").GetArrayLength());
        Assert.Equal(1, J(lib.Tree("album:A_B\u001fAlb")).GetProperty("tracks").GetArrayLength());
    }

    [Fact]
    public void Ffmpeg_decodes_to_48k_stereo_float_with_the_right_length_and_signal()
    {
        using var t = new TempDir(); var f = TestMedia.Tone(t.File("a.flac"), 2, 1000);
        using var d = new FfmpegDecoder(TestMedia.Ffmpeg, f);
        var all = new List<float>(); var buf = new float[960 * 2]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!d.Finished && sw.Elapsed.TotalSeconds < 10) { int n = d.Read(buf, 960); all.AddRange(buf.Take(n * 2)); if (n == 0) Thread.Sleep(5); }
        Assert.Null(d.Error);
        Assert.InRange(all.Count / 2, 96000 - 100, 96000 + 100);
        Assert.InRange(all.Max(), 0.05, 1.0);                            // sine default amplitude 1/8..; just proves non-silence
    }

    [Fact]
    public void Missing_or_corrupt_files_report_an_error_instead_of_hanging()
    {
        using var t = new TempDir(); File.WriteAllText(t.File("bad.flac"), "not audio");
        using var d = new FfmpegDecoder(TestMedia.Ffmpeg, t.File("bad.flac"));
        var sw = System.Diagnostics.Stopwatch.StartNew(); var b = new float[1920];
        while (!d.Finished && sw.Elapsed.TotalSeconds < 10) { d.Read(b, 960); Thread.Sleep(10); }
        Assert.True(d.Finished); Assert.NotNull(d.Error);
        using var none = new FfmpegDecoder("/nonexistent/ffmpeg", t.File("x"));
        Assert.True(none.Finished); Assert.Contains("ffmpeg", none.Error);
    }

    private static float[] ReadAll(QueueSource q, int max = 48000 * 20)
    {
        var all = new List<float>(); var buf = new float[960 * 2]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!q.Ended && all.Count / 2 < max && sw.Elapsed.TotalSeconds < 15) { int n = q.Read(buf, 960); all.AddRange(buf.Take(n * 2)); if (n == 0) Thread.Sleep(2); }
        return all.ToArray();
    }

    [Fact]
    public void Gapless_two_halves_of_one_sine_join_sample_exact_so_the_result_nulls_against_the_original()
    {
        using var t = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=2", "-ac", "2", t.File("whole.wav"));
        TestMedia.Run("-i", t.File("whole.wav"), "-t", "1", t.File("a.flac"));
        TestMedia.Run("-i", t.File("whole.wav"), "-ss", "1", "-t", "1", t.File("b.flac"));
        var items = new[] { new QueueItem(1, "track", t.File("a.flac"), "a", "", "", 1000, 1), new QueueItem(2, "track", t.File("b.flac"), "b", "", "", 1000, 2) };
        using var q = new QueueSource(items, 0, 0, RepeatMode.Off, (it, ms) => new FfmpegDecoder(TestMedia.Ffmpeg, it.Location, ms));
        var got = ReadAll(q);
        using var whole = new FfmpegDecoder(TestMedia.Ffmpeg, t.File("whole.wav"));
        var w = new List<float>(); var b = new float[1920]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!whole.Finished && sw.Elapsed.TotalSeconds < 10) { int n = whole.Read(b, 960); w.AddRange(b.Take(n * 2)); if (n == 0) Thread.Sleep(2); }
        Assert.Equal(w.Count, got.Length);                                  // no extra silence, no lost samples at the join
        double err = 0; for (int i = 0; i < got.Length; i++) err = Math.Max(err, Math.Abs(got[i] - w[i]));
        Assert.True(err < 1e-4, $"max diff {err}");
        Assert.Equal(2, q.Boundaries.Count); Assert.Equal(48000, q.Boundaries[1].StartFrame); Assert.Equal(1, q.Boundaries[1].Index);
        var loc = q.Locate(60000); Assert.Equal(1, loc.Index); Assert.InRange(loc.OffsetMs, 240, 260);
    }

    [Fact]
    public void A_broken_file_in_the_middle_is_skipped_and_reported_and_playback_continues()
    {
        using var t = new TempDir(); TestMedia.Tone(t.File("a.flac"), 1); TestMedia.Tone(t.File("c.flac"), 1); File.WriteAllText(t.File("b.flac"), "junk");
        var items = new[] { "a", "b", "c" }.Select((n, i) => new QueueItem(i, "track", t.File(n + ".flac"), n, "", "", 1000, i)).ToArray();
        var failed = new List<string>();
        using var q = new QueueSource(items, 0, 0, RepeatMode.Off, (it, ms) => new FfmpegDecoder(TestMedia.Ffmpeg, it.Location, ms));
        q.ItemFailed += (it, e) => failed.Add(it.Title);
        var got = ReadAll(q);
        Assert.Equal(new[] { "b" }, failed); Assert.InRange(got.Length / 2, 96000 - 200, 96000 + 200);
    }

    [Fact]
    public void Repeat_all_loops_and_repeat_one_stays()
    {
        using var t = new TempDir(); TestMedia.Tone(t.File("a.flac"), 0.5);
        var items = new[] { new QueueItem(1, "track", t.File("a.flac"), "a", "", "", 500, 1) };
        using var q = new QueueSource(items, 0, 0, RepeatMode.All, (it, ms) => new FfmpegDecoder(TestMedia.Ffmpeg, it.Location, ms));
        var got = ReadAll(q, 48000 * 3);
        Assert.True(got.Length / 2 >= 48000 * 3); Assert.False(q.Ended); Assert.True(q.Boundaries.Count >= 4);
    }

    [Fact]
    public void Start_offset_seeks_into_a_track()
    {
        using var t = new TempDir(); TestMedia.Tone(t.File("a.flac"), 3);
        var items = new[] { new QueueItem(1, "track", t.File("a.flac"), "a", "", "", 3000, 1) };
        using var q = new QueueSource(items, 0, 2000, RepeatMode.Off, (it, ms) => new FfmpegDecoder(TestMedia.Ffmpeg, it.Location, ms));
        var got = ReadAll(q); Assert.InRange(got.Length / 2, 48000 - 200, 48000 + 200);
        Assert.Equal(2000, q.Locate(0).OffsetMs);
    }

    [Fact]
    public void Playlist_parser_reads_m3u_and_pls_and_extracts_the_first_stream_url()
    {
        var m3u = "#EXTM3U\n#EXTINF:123,Artist - Song\nsong.flac\nhttp://radio.example/stream\n";
        var l = PlaylistParser.Parse(m3u, "/music"); Assert.Equal(2, l.Count); Assert.Equal("Artist - Song", l[0].Title); Assert.EndsWith("song.flac", l[0].Location); Assert.Equal("http://radio.example/stream", l[1].Location);
        var pls = "[playlist]\nFile1=http://a.example/1\nTitle1=One\nFile2=http://a.example/2\nNumberOfEntries=2\n";
        Assert.Equal("http://a.example/1", PlaylistParser.FirstUrl(pls)); Assert.Equal(2, PlaylistParser.Parse(pls, null).Count);
        Assert.Equal("Fade Into You", RadioDecoder.ParseStreamTitle("StreamTitle='Fade Into You';StreamUrl='';"));
        Assert.Null(RadioDecoder.ParseStreamTitle("StreamTitle='';"));
    }
}
