using System.Text.Json;
using WavWiz.Server;
using WavWiz.Server.Features;
namespace WavWiz.Server.Tests;

public class CdRip068Tests
{
    [Fact]
    public void MusicBrainz_disc_id_matches_the_official_six_track_example()
    {
        // https://musicbrainz.org/doc/Disc_ID_Calculation — offsets are LBA; FromLba adds the 150-frame pregap.
        int[] lba = new int[7];
        lba[1] = 0; lba[2] = 15213; lba[3] = 32164; lba[4] = 46442; lba[5] = 63264; lba[6] = 80339;
        Assert.Equal("49HHV7Eb8UKF3aQiNmu1GR8vKTY-", MusicBrainzDiscId.FromLba(1, 6, 95312, lba));
        Assert.Equal("1+6+95462+150+15363+32314+46592+63414+80489", MusicBrainzDiscId.TocQuery(1, 6, 95312, lba));
    }

    [Fact]
    public void NormalizeFormat_accepts_mp3_quality_and_rejects_bad_values()
    {
        var flac = CdRipService.NormalizeFormat("FLAC", "v0");
        Assert.Equal("flac", flac.Format); Assert.Null(flac.Quality); Assert.Null(flac.Err);
        var mp3 = CdRipService.NormalizeFormat("mp3", null);
        Assert.Equal("mp3", mp3.Format); Assert.Equal("v0", mp3.Quality); Assert.Null(mp3.Err);
        Assert.Equal("v2", CdRipService.NormalizeFormat("mp3", "v2").Quality);
        Assert.Equal("cbr320", CdRipService.NormalizeFormat("mp3", "cbr320").Quality);
        Assert.NotNull(CdRipService.NormalizeFormat("mp3", "v9").Err);
        Assert.NotNull(CdRipService.NormalizeFormat("wma", null).Err);
        Assert.Equal("-c:a libmp3lame -q:a 0 -id3v2_version 3", CdRipService.CodecArgs("mp3", "v0"));
        Assert.Equal("-c:a libmp3lame -q:a 2 -id3v2_version 3", CdRipService.CodecArgs("mp3", "v2"));
        Assert.Equal("-c:a libmp3lame -b:a 320k -id3v2_version 3", CdRipService.CodecArgs("mp3", "cbr320"));
        Assert.Equal("mp3", CdRipService.Extension("mp3"));
    }

    [Fact]
    public void ParseToc_and_mixed_mode_leadout_are_used_for_track_length()
    {
        var toc = CdRipService.ParseToc("""
            FIRST 1
            LAST 6
            TRACK 1 0 AUDIO
            TRACK 2 15213 AUDIO
            TRACK 3 32164 AUDIO
            TRACK 4 46442 AUDIO
            TRACK 5 63264 AUDIO
            TRACK 6 80339 AUDIO
            LEADOUT 95312
            AUDIO_FIRST 1
            AUDIO_LAST 6
            """);
        Assert.NotNull(toc);
        Assert.Equal(6, toc!.AudioCount);
        Assert.Equal(15213, CdRipService.TrackSectors(toc, 1));
        Assert.Equal("49HHV7Eb8UKF3aQiNmu1GR8vKTY-", MusicBrainzDiscId.FromLba(toc.AudioFirst, toc.AudioLast, toc.LeadoutLba, toc.LbaByNumber));
    }

    [Fact]
    public void DiscChange_reports_insert_eject_and_ignores_identical_snapshots()
    {
        Assert.Null(CdRipService.DiscChange("E:|0", "E:|0"));
        Assert.Equal("inserted", CdRipService.DiscChange("E:|0", "E:|1|Best Of|12"));
        Assert.Equal("ejected", CdRipService.DiscChange("E:|1|Best Of|12", "E:|0"));
        Assert.Equal("changed", CdRipService.DiscChange("E:|1|A|10", "E:|1|B|10"));
    }

    [Fact]
    public void ParseTrackPicks_and_ffmpeg_args_write_tags_and_cover()
    {
        using var doc = JsonDocument.Parse("""{"tracks":[1,{"n":2,"title":"That's the Way","artist":"KC"}]}""");
        var picks = CdRipService.ParseTrackPicks(doc.RootElement);
        Assert.Equal(2, picks.Count);
        Assert.Equal("That's the Way", picks[1].Title);
        var args = CdRipService.FfmpegEncodeArgs("in.wav", "out.mp3", CdRipService.CodecArgs("mp3", "v0"), "The Best Of", "KC", "KC", "That's the Way", "1990", 2, 12, "/tmp/cover.jpg");
        Assert.Contains("-metadata title=\"That's the Way\"", args);
        Assert.Contains("-metadata album=\"The Best Of\"", args);
        Assert.Contains("-metadata date=\"1990\"", args);
        Assert.Contains("-metadata track=\"2/12\"", args);
        Assert.Contains("-i \"/tmp/cover.jpg\"", args);
        Assert.Contains("attached_pic", args);
        Assert.Contains("-nostats", args);
        Assert.Contains("libmp3lame", args);
        var tocQ = MusicBrainzDiscId.DurationMs(0, 15213);
        Assert.True(tocQ > 200_000 && tocQ < 210_000);
    }

    [Fact]
    public void ParseMbReleases_reads_artist_tracks_and_cover_flag()
    {
        using var doc = JsonDocument.Parse("""
            {"releases":[{"id":"11111111-1111-1111-1111-111111111111","title":"The Best Of","date":"1990-01-01","country":"US",
              "artist-credit":[{"name":"KC And The Sunshine Band","joinphrase":""}],
              "cover-art-archive":{"front":true},
              "media":[{"tracks":[{"position":1,"title":"That's the Way (I Like It)","length":191000}]}]}]}
            """);
        var list = CdRipService.ParseMbReleases(doc.RootElement);
        Assert.Single(list);
        var json = JsonSerializer.Serialize(list[0]);
        Assert.Contains("The Best Of", json);
        Assert.Contains("KC And The Sunshine Band", json);
        Assert.Contains("1990", json);
        Assert.Contains("I Like It", json);
        Assert.Contains("/api/v1/rip/cover/11111111-1111-1111-1111-111111111111", json);
    }

    [Fact]
    public void ParseCdText_fills_album_and_titles()
    {
        var ct = CdRipService.ParseCdText("ALBUM The Best Of\nALBUMARTIST KC\nTRACK 1 That's the Way\nTRACKARTIST 1 KC\n", 1);
        Assert.NotNull(ct);
        Assert.Equal("The Best Of", ct!.Album);
        Assert.Equal("KC", ct.AlbumArtist);
        Assert.Equal("That's the Way", ct.Tracks[0].Title);
    }

    [Fact]
    public async Task ChildProcess_drains_a_large_stderr_pipe_instead_of_deadlocking()
    {
        // python3 on many Windows boxes is the Microsoft Store stub (exit 9009), so use
        // ArgumentList + a real helper: python3 on Unix, PowerShell on Windows.
        var (file, args) = ChildStderrCommand(
            "import sys; sys.stderr.write('x'*200000); sys.stderr.flush(); sys.stdout.write('ok\\n')",
            "[Console]::Error.Write(('x'*200000)); [Console]::Out.WriteLine('ok')");
        var r = await ChildProcess.RunAsync(file, args, CancellationToken.None,
            totalTimeout: TimeSpan.FromSeconds(15), stallTimeout: TimeSpan.FromSeconds(10));
        Assert.False(r.TimedOut);
        Assert.False(r.Stalled);
        Assert.Equal(0, r.ExitCode);
        Assert.Contains("ok", r.Stdout);
        Assert.True(r.Stderr.Length >= 200000);
    }

    /// <summary>
    /// Job 2 on 2026-11-09 failed after ~5 minutes of wavwiz-cdda with
    /// ArgumentOutOfRangeException (parameter 'chunkLength'). That is StringBuilder.ToString()
    /// racing AppendLine from OutputDataReceived/ErrorDataReceived when the helper exits.
    /// </summary>
    [Fact]
    public async Task ChildProcess_collects_stderr_at_exit_without_chunkLength_race()
    {
        const string py = "import sys\nfor i in range(1, 3001):\n    sys.stderr.write(f'PROGRESS {i} 3000\\n')\n    if i % 40 == 0: sys.stderr.flush()\nsys.stderr.flush(); sys.stdout.write('ok\\n')";
        const string ps = "for ($i=1; $i -le 3000; $i++) { [Console]::Error.WriteLine(\"PROGRESS $i 3000\"); if ($i % 40 -eq 0) { [Console]::Error.Flush() } }; [Console]::Error.Flush(); [Console]::Out.WriteLine('ok')";
        var (file, args) = ChildStderrCommand(py, ps);
        for (int n = 0; n < 15; n++)
        {
            int lines = 0;
            var r = await ChildProcess.RunAsync(file, args, CancellationToken.None,
                totalTimeout: TimeSpan.FromSeconds(20), stallTimeout: TimeSpan.FromSeconds(15),
                onStderrLine: _ => Interlocked.Increment(ref lines));
            Assert.False(r.TimedOut);
            Assert.False(r.Stalled);
            Assert.Equal(0, r.ExitCode);
            Assert.Contains("ok", r.Stdout);
            Assert.Contains("PROGRESS 3000 3000", r.Stderr);
            Assert.True(lines >= 3000, $"iteration {n} saw {lines} stderr lines");
        }
    }

    static (string File, string[] Args) ChildStderrCommand(string pythonMinusC, string powershellCommand)
    {
        if (OperatingSystem.IsWindows())
            return ("powershell", new[] { "-NoProfile", "-NonInteractive", "-Command", powershellCommand });
        return ("python3", new[] { "-c", pythonMinusC });
    }


    [Fact]
    public void TrackProgress_is_visible_during_track_1_of_a_long_album()
    {
        // Start sentinel: overall = 0.02/16, bar should stay at 0 until the first sector.
        Assert.Equal(0, CdRipService.TrackProgress(1, 16, 0.02 / 16));
        // 5% of track 1 is packed as 0.05*0.85/16 ≈ 0.27% overall, which rounds to a 0% bar.
        var early = (0.05 * 0.85) / 16;
        Assert.True(early * 100 < 0.5, "overall would still round to 0%");
        Assert.Equal(0.05, CdRipService.TrackProgress(1, 16, early), 3);
        // 25% of track 1 is only ~1% overall, so the bar would barely move without TrackProgress.
        var mid = (0.25 * 0.85) / 16;
        Assert.Equal(1, (int)Math.Round(mid * 100));
        Assert.Equal(0.25, CdRipService.TrackProgress(1, 16, mid), 3);
        // 50% of track 2
        Assert.Equal(0.5, CdRipService.TrackProgress(2, 16, (1 + 0.5 * 0.85) / 16), 3);
        // encoding track 1
        Assert.Equal(0.99, CdRipService.TrackProgress(1, 16, (0 + 0.88) / 16), 3);
        // finished track 1
        Assert.Equal(1, CdRipService.TrackProgress(1, 16, 1.0 / 16));
        Assert.Equal(1, CdRipService.TrackProgress(16, 16, 1));
        Assert.Equal(0.4, CdRipService.TrackProgress(0, 0, 0.4), 3);
    }

    [Fact]
    public void DriveCandidates_cover_letter_slash_and_device_path()
    {
        Assert.Equal("E:", CdRipService.NormalizeDrive("e"));
        Assert.Equal("E:", CdRipService.NormalizeDrive(@"E:\"));
        Assert.Equal("E:", CdRipService.NormalizeDrive("E:"));
        var c = CdRipService.DriveCandidates("e:");
        Assert.Contains("E:", c);
        Assert.Contains(@"E:\", c);
        Assert.Contains(@"\\.\E:", c);
    }

    [Fact]
    public void Reconcile_marks_restored_ripping_jobs_interrupted_and_Cancel_clears_them()
    {
        using var tmp = new TempDir();
        var db = new Db(tmp.File("u.db")); db.Migrate();
        var ev = new EventHub();
        var lib = new Library.LibraryService(db);
        var cfg = new ServerConfig { DataDir = tmp.Path };
        db.Insert(
            "INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,detail) VALUES($d,'ripping',$f,$p,$a,$r,0.05,$t,$z)",
            ("$d", "E:"), ("$f", "flac"), ("$p", @"D:\Music\KC And The Sunshine Band\The Best Of"),
            ("$a", "The Best Of"), ("$r", "KC"), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$z", "Ripping"));
        var rip = new CdRipService(db, cfg, lib, ev, "ffmpeg");
        var afterStart = System.Text.Json.JsonSerializer.Serialize(rip.Jobs());
        Assert.Contains("interrupted", afterStart);
        Assert.DoesNotContain("\"status\":\"ripping\"", afterStart);

        var id2 = db.Insert(
            "INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,detail) VALUES($d,'ripping',$f,$p,$a,$r,0.05,$t,$z)",
            ("$d", "E:"), ("$f", "flac"), ("$p", @"D:\Music\x"), ("$a", "A"), ("$r", "B"),
            ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$z", "Ripping"));
        var (ok, err) = rip.Cancel(id2);
        Assert.True(ok);
        Assert.Null(err);
        var afterCancel = System.Text.Json.JsonSerializer.Serialize(rip.Jobs());
        Assert.Contains("cancelled", afterCancel);
        Assert.DoesNotContain("\"status\":\"ripping\"", afterCancel);
    }


    [Fact]
    public void Toc_retry_policy_gives_a_USB_drive_time_to_spin_up()
    {
        var c = CdRipService.DriveCandidates("e");
        Assert.Equal("E:", c[0]);
        Assert.Equal(@"E:\", c[1]);
        Assert.Equal(@"\\.\E:", c[2]);
        Assert.Equal(0, CdRipService.TocRetryDelaysMs[0]);
        Assert.True(CdRipService.TocRetryDelaysMs[1] >= 2000);
        Assert.True(CdRipService.TocHelperTimeout.TotalSeconds >= 20);
        Assert.True(CdRipService.TocHelperStall < CdRipService.TocHelperTimeout);
        Assert.True(CdRipService.TocHelperStall.TotalSeconds >= 10);
    }

    [Fact]
    public void RemoveEmptyRipFolders_deletes_an_empty_album_and_artist_but_keeps_files()
    {
        using var tmp = new TempDir();
        var root = Directory.CreateDirectory(Path.Combine(tmp.Path, "Music")).FullName;
        var artist = Directory.CreateDirectory(Path.Combine(root, "KC & The Sunshine Band")).FullName;
        var album = Directory.CreateDirectory(Path.Combine(artist, "The Best Of")).FullName;
        Assert.True(CdRipService.RemoveEmptyRipFolders(album, root));
        Assert.False(Directory.Exists(album));
        Assert.False(Directory.Exists(artist));
        Assert.True(Directory.Exists(root));

        artist = Directory.CreateDirectory(Path.Combine(root, "KC & The Sunshine Band")).FullName;
        album = Directory.CreateDirectory(Path.Combine(artist, "The Best Of")).FullName;
        var other = Directory.CreateDirectory(Path.Combine(artist, "Do It Tonight")).FullName;
        File.WriteAllText(Path.Combine(other, "01.flac"), "x");
        Assert.True(CdRipService.RemoveEmptyRipFolders(album, root));
        Assert.False(Directory.Exists(album));
        Assert.True(Directory.Exists(other));
        Assert.True(Directory.Exists(artist));

        Assert.False(CdRipService.RemoveEmptyRipFolders(other, root));
        Assert.True(File.Exists(Path.Combine(other, "01.flac")));

        var outside = Directory.CreateDirectory(Path.Combine(tmp.Path, "outside", "album")).FullName;
        Assert.False(CdRipService.RemoveEmptyRipFolders(outside, root));
        Assert.True(Directory.Exists(outside));
    }

    [Fact]
    public void Cancel_leftover_job_removes_the_empty_album_folder()
    {
        using var tmp = new TempDir();
        var db = new Db(tmp.File("u.db")); db.Migrate();
        var ev = new EventHub();
        var lib = new Library.LibraryService(db);
        var cfg = new ServerConfig { DataDir = tmp.Path };
        var root = Directory.CreateDirectory(Path.Combine(tmp.Path, "Music")).FullName;
        db.Insert("INSERT INTO library_root(path,enabled) VALUES($p,1)", ("$p", root));
        var artist = Directory.CreateDirectory(Path.Combine(root, "KC & The Sunshine Band")).FullName;
        var album = Directory.CreateDirectory(Path.Combine(artist, "The Best Of")).FullName;
        var rip = new CdRipService(db, cfg, lib, ev, "ffmpeg");
        var id = db.Insert(
            "INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,detail) VALUES($d,'ripping',$f,$p,$a,$r,0.05,$t,$z)",
            ("$d", "E:"), ("$f", "flac"), ("$p", album),
            ("$a", "The Best Of"), ("$r", "KC & The Sunshine Band"),
            ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$z", "Ripping"));
        var (ok, err) = rip.Cancel(id);
        Assert.True(ok);
        Assert.Null(err);
        Assert.False(Directory.Exists(album));
        Assert.False(Directory.Exists(artist));
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void ParseQueryFlag_accepts_1_and_true_and_rejects_empty()
    {
        Assert.True(CdRipService.ParseQueryFlag("1"));
        Assert.True(CdRipService.ParseQueryFlag("true"));
        Assert.True(CdRipService.ParseQueryFlag("TRUE"));
        Assert.True(CdRipService.ParseQueryFlag("yes"));
        Assert.True(CdRipService.ParseQueryFlag("on"));
        Assert.True(CdRipService.ParseQueryFlag(" 1 "));
        Assert.False(CdRipService.ParseQueryFlag(null));
        Assert.False(CdRipService.ParseQueryFlag(""));
        Assert.False(CdRipService.ParseQueryFlag("0"));
        Assert.False(CdRipService.ParseQueryFlag("false"));
        Assert.False(CdRipService.ParseQueryFlag("refresh"));
    }

    [Fact]
    public void WindowsServiceAccountHint_is_empty()
    {
        Assert.Equal("", CdRipService.WindowsServiceAccountHint());
    }
}
