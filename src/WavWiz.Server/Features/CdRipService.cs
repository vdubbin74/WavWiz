using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>B8 / 0.0.5: rip audio CDs via standalone LGPL wavwiz-cdda (libcdio) into WAV, then encode with LGPL FFmpeg (FLAC default / AAC / WAV). MP3 not bundled. FFmpeg itself stays LGPL — its libcdio demuxer is GPL-gated so we do not enable it.</summary>
public sealed class CdRipService
{
    private readonly Db _db;
    private readonly ServerConfig _cfg;
    private readonly Library.LibraryService _lib;
    private readonly EventHub _ev;
    private readonly string _ffmpeg;
    private readonly object _l = new();
    private Process? _running;
    public CdRipService(Db db, ServerConfig cfg, Library.LibraryService lib, EventHub ev, string ffmpeg)
    { _db = db; _cfg = cfg; _lib = lib; _ev = ev; _ffmpeg = ffmpeg; }

    public object Jobs() => _db.Query("SELECT id,drive,status,format,dest_folder,album,artist,progress,error,created_at,finished_at FROM rip_job ORDER BY id DESC LIMIT 30",
        r => new { id = r.GetInt64(0), drive = r.GetString(1), status = r.GetString(2), format = r.GetString(3), dest = r.IsDBNull(4) ? null : r.GetString(4),
            album = r.IsDBNull(5) ? null : r.GetString(5), artist = r.IsDBNull(6) ? null : r.GetString(6), progress = r.GetDouble(7),
            error = r.IsDBNull(8) ? null : r.GetString(8), createdAt = r.GetString(9), finishedAt = r.IsDBNull(10) ? null : r.GetString(10) });

    public object Formats() => new
    {
        defaultFormat = "flac",
        libcdio = FindCddaHelper() != null,
        formats = new object[] {
            new { id = "flac", name = "FLAC (lossless)", available = EncoderOk("flac"), note = "Default. LGPL native encoder in WavWiz's FFmpeg." },
            new { id = "wav", name = "WAV (PCM)", available = true, note = "Always available." },
            new { id = "aac", name = "AAC", available = EncoderOk("aac"), note = "LGPL native AAC encoder (no FDK)." },
            new { id = "mp3", name = "MP3", available = false, note = "Not bundled: LAME not shipped (keeps the FFmpeg build LGPL decode/rip focused). Use FLAC or AAC." },
        }
    };

    public object Drives()
    {
        var helper = FindCddaHelper();
        if (!OperatingSystem.IsWindows())
            return new { drives = Array.Empty<object>(), libcdio = helper != null, note = "Optical-drive detection runs on the Windows server PC. This build host is Linux, so the list is empty here." };
        var list = new List<object>();
        foreach (var d in DriveInfo.GetDrives().Where(x => x.DriveType == DriveType.CDRom))
        {
            string? label = null; bool ready = false;
            try { ready = d.IsReady; label = ready ? d.VolumeLabel : null; } catch { }
            list.Add(new { letter = d.Name.TrimEnd('\\'), ready, label });
        }
        return new
        {
            drives = list,
            libcdio = helper != null,
            note = list.Count == 0 ? "No optical drive found on this PC." : helper == null ? "wavwiz-cdda (libcdio helper) is missing next to FFmpeg — reinstall WavWiz 0.0.5+." : null,
        };
    }

    public (long Id, string? Err) Start(JsonElement b)
    {
        var drive = (b.Str("drive") ?? "").Trim();
        var format = (b.Str("format") ?? "flac").Trim().ToLowerInvariant();
        if (format is "mp3") return (0, "MP3 ripping is not available: WavWiz does not ship LAME. Choose FLAC (default), AAC, or WAV.");
        if (format is not ("flac" or "wav" or "aac")) return (0, "format must be flac, wav or aac");
        if ((format is "flac" or "aac") && !EncoderOk(format)) return (0, $"{format} encoder is not in this FFmpeg build");
        if (string.IsNullOrWhiteSpace(drive)) return (0, "drive is required (e.g. D:)");
        if (!drive.EndsWith(':')) drive += ":";
        if (FindCddaHelper() == null) return (0, "wavwiz-cdda helper not found next to FFmpeg (needed for CDDA via libcdio).");
        lock (_l) if (_running is { HasExited: false }) return (0, "a rip is already running");

        var root = _db.Query("SELECT path FROM library_root WHERE enabled=1 ORDER BY id LIMIT 1", r => r.GetString(0)).FirstOrDefault()
            ?? Path.Combine(_cfg.DataDir, "ripped");
        var album = (b.Str("album") ?? "Unknown Album").Trim();
        var artist = (b.Str("artist") ?? "Unknown Artist").Trim();
        var dest = Path.Combine(root, Sanitize(artist), Sanitize(album));
        Directory.CreateDirectory(dest);
        var now = DateTimeOffset.UtcNow.ToString("O");
        var id = _db.Insert("INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at) VALUES($d,'queued',$f,$p,$a,$r,0,$t)",
            ("$d", drive), ("$f", format), ("$p", dest), ("$a", album), ("$r", artist), ("$t", now));
        _ = Task.Run(() => RunJob(id, drive, format, dest, album, artist));
        return (id, null);
    }

    private void RunJob(long id, string drive, string format, string dest, string album, string artist)
    {
        var helper = FindCddaHelper() ?? throw new InvalidOperationException("wavwiz-cdda missing");
        try
        {
            _db.Exec("UPDATE rip_job SET status='ripping',progress=0.05 WHERE id=$i", ("$i", id));
            var ext = format switch { "flac" => "flac", "aac" => "m4a", _ => "wav" };
            var codecArgs = format switch
            {
                "flac" => "-c:a flac",
                "aac" => "-c:a aac -b:a 256k",
                _ => "-c:a pcm_s16le"
            };
            int trackCount = CountTracks(helper, drive);
            if (trackCount <= 0) trackCount = DetectTrackCount(drive);
            if (trackCount <= 0) throw new InvalidOperationException("No audio tracks found. Is an audio CD in the drive?");
            var tmpDir = Path.Combine(Path.GetTempPath(), "wavwiz-rip-" + id);
            Directory.CreateDirectory(tmpDir);
            try
            {
                for (int t = 1; t <= trackCount; t++)
                {
                    var wav = Path.Combine(tmpDir, $"track{t:00}.wav");
                    if (!RunHelper(helper, $"\"{drive}\" {t} \"{wav}\""))
                        throw new InvalidOperationException($"Could not read track {t} from {drive} via libcdio.");
                    var outFile = Path.Combine(dest, $"{t:00} - Track {t}.{ext}");
                    if (format == "wav")
                    {
                        File.Copy(wav, outFile, true);
                    }
                    else
                    {
                        var args = $"-hide_banner -y -i \"{wav}\" {codecArgs} -metadata album=\"{Escape(album)}\" -metadata artist=\"{Escape(artist)}\" -metadata track=\"{t}/{trackCount}\" \"{outFile}\"";
                        if (!RunFfmpeg(args)) throw new InvalidOperationException($"FFmpeg could not encode track {t} to {format}.");
                    }
                    try { File.Delete(wav); } catch { }
                    _db.Exec("UPDATE rip_job SET progress=$p WHERE id=$i", ("$p", (double)t / trackCount), ("$i", id));
                }
            }
            finally { try { Directory.Delete(tmpDir, true); } catch { } }
            _db.Exec("UPDATE rip_job SET status='done',progress=1,finished_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
            _ev.Publish("library");
            _ = _lib.TrackCount();
        }
        catch (Exception e)
        {
            _db.Exec("UPDATE rip_job SET status='error',error=$e,finished_at=$t WHERE id=$i", ("$e", e.Message), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        }
    }

    private int CountTracks(string helper, string drive)
    {
        try
        {
            var psi = new ProcessStartInfo(helper, $"--count \"{drive}\"") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(30000);
            return int.TryParse(o, out var n) ? n : 0;
        }
        catch { return 0; }
    }

    private bool RunHelper(string helper, string args)
    {
        try
        {
            var psi = new ProcessStartInfo(helper, args) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!; _running = p;
            p.WaitForExit(TimeSpan.FromHours(2));
            _running = null;
            return p.ExitCode == 0;
        }
        catch { _running = null; return false; }
    }

    private bool RunFfmpeg(string args)
    {
        try
        {
            var psi = new ProcessStartInfo(_ffmpeg, args) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!; _running = p;
            p.WaitForExit(TimeSpan.FromHours(2));
            _running = null;
            return p.ExitCode == 0;
        }
        catch { _running = null; return false; }
    }

    private static int DetectTrackCount(string drive)
    {
        int n = 0;
        for (int i = 1; i <= 99; i++)
        {
            var cda = Path.Combine(drive + "\\", $"Track{i:00}.cda");
            if (File.Exists(cda)) n = i; else if (n > 0) break; else if (i > 3 && n == 0) break;
        }
        return n;
    }

    private string? FindCddaHelper()
    {
        var dir = Path.GetDirectoryName(_ffmpeg) ?? "";
        foreach (var name in new[] { "wavwiz-cdda.exe", "wavwiz-cdda" })
        {
            var p = Path.Combine(dir, name); if (File.Exists(p)) return p;
        }
        var beside = Path.Combine(AppContext.BaseDirectory, "ffmpeg", OperatingSystem.IsWindows() ? "wavwiz-cdda.exe" : "wavwiz-cdda");
        return File.Exists(beside) ? beside : null;
    }

    private bool EncoderOk(string name)
    {
        try
        {
            var psi = new ProcessStartInfo(_ffmpeg, "-hide_banner -encoders") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!; var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit(5000);
            return Regex.IsMatch(o, @"\b" + Regex.Escape(name) + @"\b", RegexOptions.IgnoreCase);
        }
        catch { return false; }
    }

    private static string Sanitize(string s) { foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_'); return string.IsNullOrWhiteSpace(s) ? "Unknown" : s.Trim(); }
    private static string Escape(string s) => s.Replace("\"", "'");
}
