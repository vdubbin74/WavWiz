using System.Diagnostics;
using WavWiz.Server.Features;

namespace WavWiz.Server.Tests;

public class RipProcessCleanupTests
{
    [Fact]
    public void ToolsDirectory_and_IsUnderToolsDir_respect_path_boundaries()
    {
        var tools = Path.Combine(Path.GetTempPath(), "wavwiz-tools-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tools);
        try
        {
            var ffmpeg = Path.Combine(tools, "ffmpeg");
            File.WriteAllText(ffmpeg, "x");
            Assert.Equal(Path.GetFullPath(tools), RipProcessCleanup.ToolsDirectory(ffmpeg));
            Assert.True(RipProcessCleanup.IsUnderToolsDir(Path.Combine(tools, "wavwiz-cdda"), tools));
            Assert.True(RipProcessCleanup.IsUnderToolsDir(Path.Combine(tools, "ffmpeg"), tools));
            Assert.False(RipProcessCleanup.IsUnderToolsDir(tools + "-evil" + Path.DirectorySeparatorChar + "ffmpeg", tools));
            Assert.False(RipProcessCleanup.IsUnderToolsDir("/usr/bin/ffmpeg", tools));
            Assert.False(RipProcessCleanup.IsUnderToolsDir(null, tools));
            Assert.False(RipProcessCleanup.IsUnderToolsDir(ffmpeg, null));
        }
        finally { try { Directory.Delete(tools, true); } catch { } }
    }

    [Fact]
    public void IsRipToolProcessName_accepts_ffmpeg_and_cdda_only()
    {
        Assert.True(RipProcessCleanup.IsRipToolProcessName("ffmpeg"));
        Assert.True(RipProcessCleanup.IsRipToolProcessName("ffmpeg.exe"));
        Assert.True(RipProcessCleanup.IsRipToolProcessName("wavwiz-cdda"));
        Assert.True(RipProcessCleanup.IsRipToolProcessName("WAVWIZ-CDDA.EXE"));
        Assert.False(RipProcessCleanup.IsRipToolProcessName("wavwiz-server"));
        Assert.False(RipProcessCleanup.IsRipToolProcessName("chrome"));
        Assert.False(RipProcessCleanup.IsRipToolProcessName(null));
    }

    [Fact]
    public void LooksLikeRipFfmpeg_matches_encode_args_not_playback_or_airplay()
    {
        Assert.True(RipProcessCleanup.LooksLikeRipFfmpeg(@"-hide_banner -y -i C:\Temp\wavwiz-rip-12\track01.wav -c:a flac out.flac"));
        Assert.True(RipProcessCleanup.LooksLikeRipFfmpeg("-i /tmp/a.wav -c:a libmp3lame -q:a 0 out.mp3"));
        Assert.True(RipProcessCleanup.LooksLikeRipFfmpeg("-i in.wav -i cover.jpg -c:a aac attached_pic out.m4a"));
        Assert.False(RipProcessCleanup.LooksLikeRipFfmpeg("-nostdin -i song.flac -f f32le -ac 2 -ar 48000 pipe:1"));
        Assert.False(RipProcessCleanup.LooksLikeRipFfmpeg("-f s16le -i pipe:0 -c:a aac -f adts pipe:1"));
        Assert.False(RipProcessCleanup.LooksLikeRipFfmpeg(null));
        Assert.False(RipProcessCleanup.LooksLikeRipFfmpeg(""));
    }

    [Fact]
    public void ShouldReap_requires_tools_dir_and_parent_rules()
    {
        var tools = Path.Combine(Path.GetTempPath(), "ww-ffmpeg");
        var exe = Path.Combine(tools, "ffmpeg");
        var cdda = Path.Combine(tools, "wavwiz-cdda");
        const int us = 1000;

        Assert.False(RipProcessCleanup.ShouldReap("ffmpeg", "/usr/bin/ffmpeg", tools, us, us, true, "wavwiz-server", "wavwiz-rip-1"));
        Assert.True(RipProcessCleanup.ShouldReap("wavwiz-cdda", cdda, tools, us, us, true, "wavwiz-server", null));
        Assert.False(RipProcessCleanup.ShouldReap("ffmpeg", exe, tools, us, us, true, "wavwiz-server",
            "-i song.flac -f f32le pipe:1"));
        Assert.True(RipProcessCleanup.ShouldReap("ffmpeg", exe, tools, us, us, true, "wavwiz-server",
            "-i C:\\Temp\\wavwiz-rip-9\\track01.wav -c:a flac out.flac"));
        Assert.True(RipProcessCleanup.ShouldReap("ffmpeg", exe, tools, 42, us, false, null, null));
        Assert.False(RipProcessCleanup.ShouldReap("ffmpeg", exe, tools, 2000, us, true, "wavwiz-server",
            "wavwiz-rip-1 -i a.wav -c:a flac out.flac"));
    }

    [Fact]
    public void ReapOrphans_accepts_a_keep_set_and_is_a_no_op_without_helpers()
    {
        var n = RipProcessCleanup.ReapOrphans(
            Path.Combine(Path.GetTempPath(), "ww-no-tools-" + Guid.NewGuid().ToString("N")),
            Environment.ProcessId, _ => { }, "unit-test-keep", new HashSet<int> { 1, 2 });
        Assert.Equal(0, n);
    }

    [Fact]
    public async Task ChildProcess_onStarted_reports_the_live_pid()
    {
        int seen = 0;
        var r = await ChildProcess.RunAsync("python3", "-c \"import time; time.sleep(0.05)\"", CancellationToken.None,
            totalTimeout: TimeSpan.FromSeconds(10), stallTimeout: TimeSpan.FromSeconds(5),
            onStarted: p => seen = p.Id);
        Assert.True(seen > 0);
        Assert.Equal(0, r.ExitCode);
        Assert.False(r.TimedOut);
    }

    [Fact]
    public void Reconcile_logs_and_Cancel_reaps_when_no_live_rip()
    {
        using var tmp = new TempDir();
        var db = new Db(tmp.File("u.db")); db.Migrate();
        var tools = Path.Combine(tmp.Path, "ffmpeg");
        Directory.CreateDirectory(tools);
        var fakeFf = Path.Combine(tools, "ffmpeg");
        File.WriteAllText(fakeFf, "x");
        var logs = new List<string>();

        db.Insert(
            "INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,detail) VALUES($d,'ripping',$f,$p,$a,$r,0.05,$t,$z)",
            ("$d", "E:"), ("$f", "flac"), ("$p", Path.Combine(tmp.Path, "out")),
            ("$a", "A"), ("$r", "B"), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$z", "Ripping"));
        var rip = new CdRipService(db, new ServerConfig { DataDir = tmp.Path }, new Library.LibraryService(db), new EventHub(), fakeFf, log: s => logs.Add(s));
        var afterStart = System.Text.Json.JsonSerializer.Serialize(rip.Jobs());
        Assert.Contains("interrupted", afterStart);
        Assert.Contains(logs, l => l.Contains("reconciled", StringComparison.OrdinalIgnoreCase));

        var id2 = db.Insert(
            "INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,detail) VALUES($d,'ripping',$f,$p,$a,$r,0.05,$t,$z)",
            ("$d", "E:"), ("$f", "flac"), ("$p", Path.Combine(tmp.Path, "out2")), ("$a", "A"), ("$r", "B"),
            ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$z", "Ripping"));
        var (ok, err) = rip.Cancel(id2);
        Assert.True(ok);
        Assert.Null(err);
        Assert.Contains(logs, l => l.Contains("cancel", StringComparison.OrdinalIgnoreCase));
        rip.Shutdown();
    }

    [Fact]
    public void KillTrackedChildren_kills_a_sleeping_tracked_pid()
    {
        using var tmp = new TempDir();
        var db = new Db(tmp.File("u.db")); db.Migrate();
        var tools = Path.Combine(tmp.Path, "ffmpeg");
        Directory.CreateDirectory(tools);
        var fakeFf = Path.Combine(tools, "ffmpeg");
        File.WriteAllText(fakeFf, "x");
        var logs = new List<string>();
        var rip = new CdRipService(db, new ServerConfig { DataDir = tmp.Path }, new Library.LibraryService(db), new EventHub(), fakeFf, log: s => logs.Add(s));

        var psi = new ProcessStartInfo("python3", "-c \"import time; time.sleep(60)\"")
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        using var child = Process.Start(psi)!;
        try
        {
            rip.TrackPidForTests(child.Id);
            var n = rip.KillTrackedChildren("unit-test");
            Assert.True(n >= 1);
            Assert.True(child.WaitForExit(5000));
            Assert.Contains(logs, l => l.Contains($"pid={child.Id}") && l.Contains("killed"));
        }
        finally
        {
            try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
        }
    }
}
