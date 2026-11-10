using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using WavWiz.Server.Api;
using WavWiz.Server.Library;
namespace WavWiz.Server.Features;

/// <summary>Rip audio CDs via standalone LGPL wavwiz-cdda (libcdio) into WAV, then encode with the bundled LGPL FFmpeg
/// (FLAC default, AAC, WAV, or MP3 via LAME). FFmpeg itself stays LGPL — its libcdio demuxer is GPL-gated so we do not enable it.</summary>
public sealed class CdRipService
{
    public static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(90);
    public static readonly TimeSpan MinTrackTimeout = TimeSpan.FromMinutes(15);

    private readonly Db _db;
    private readonly ServerConfig _cfg;
    private readonly LibraryService _lib;
    private readonly EventHub _ev;
    private readonly string _ffmpeg;
    private readonly HttpClient _http;
    private readonly object _l = new();
    private readonly HashSet<int> _childPids = new();
    private CancellationTokenSource? _jobCts;
    private long _jobId;
    private bool _busy;
    private DateTime _lastPoll = DateTime.MinValue;
    private string? _discSig;
    private object? _discCache;
    private DateTime _discAt;
    private DateTime _mbLast;
    private readonly SemaphoreSlim _mbGate = new(1, 1);
    private readonly SemaphoreSlim _discGate = new(1, 1);

    /// <summary>Optional sink into the main server log (wavwiz-server.log).</summary>
    public Action<string>? Log;

    public CdRipService(Db db, ServerConfig cfg, LibraryService lib, EventHub ev, string ffmpeg, HttpMessageHandler? http = null, Action<string>? log = null)
    {
        _db = db; _cfg = cfg; _lib = lib; _ev = ev; _ffmpeg = ffmpeg; Log = log;
        _http = http != null ? new HttpClient(http, disposeHandler: false) : new HttpClient();
        _http.Timeout = TimeSpan.FromSeconds(20);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"WavWiz/{WavWiz.Core.WavWizInfo.Version} ( https://github.com/vdubbin74/wavwiz )");
        try { ReconcileStaleJobs(); } catch { /* table may not exist in a partial test fixture */ }
    }

    /// <summary>Test hook: record a child PID as if the ripper had started it.</summary>
    internal void TrackPidForTests(int pid) { if (pid > 0) lock (_l) _childPids.Add(pid); }

    string? ToolsDir() => RipProcessCleanup.ToolsDirectory(_ffmpeg);

    void RipLog(string msg)
    {
        try { Log?.Invoke(msg.StartsWith("rip:", StringComparison.Ordinal) ? msg : "rip: " + msg); } catch { }
    }

    void TrackChild(Process p)
    {
        try
        {
            int pid = p.Id;
            lock (_l) _childPids.Add(pid);
            RipLog($"child started pid={pid} name={SafeName(p)}");
        }
        catch { }
    }

    static string SafeName(Process p)
    {
        try { return p.ProcessName; } catch { return "?"; }
    }

    void UntrackChild(int pid)
    {
        if (pid <= 0) return;
        lock (_l) _childPids.Remove(pid);
    }

    /// <summary>Kill every ffmpeg / wavwiz-cdda PID this ripper started that is still alive.</summary>
    public int KillTrackedChildren(string reason)
    {
        int[] pids;
        lock (_l) pids = _childPids.ToArray();
        int killed = 0;
        foreach (var pid in pids)
        {
            if (RipProcessCleanup.TryKillPid(pid, out var err))
            {
                killed++;
                RipLog($"killed pid={pid} reason={reason}");
            }
            else if (err != null)
                RipLog($"could not kill pid={pid} reason={reason}: {err}");
            UntrackChild(pid);
        }
        return killed;
    }

    /// <summary>Find and kill orphan rip helpers under Server\ffmpeg whose parent is us or has no live WavWiz parent.</summary>
    public int ReapOrphanRipProcesses(string reason)
    {
        HashSet<int> keep;
        lock (_l) keep = new HashSet<int>(_childPids);
        return RipProcessCleanup.ReapOrphans(ToolsDir(), Environment.ProcessId, msg => RipLog(msg), reason, keep);
    }

    /// <summary>Server is stopping: cancel the live job (if any) and reap leftover rip helpers.</summary>
    public void Shutdown()
    {
        try
        {
            long id; bool busy;
            lock (_l) { id = _jobId; busy = _busy; }
            if (busy && id > 0)
            {
                try { Cancel(id); } catch { }
            }
            KillTrackedChildren("server shutdown");
            ReapOrphanRipProcesses("server shutdown");
        }
        catch (Exception ex) { RipLog("shutdown cleanup failed: " + ex.Message); }
    }

    /// <summary>Jobs left as ripping/queued after a crash or reinstall are not running. Mark them interrupted so the UI unlocks.</summary>
    public int ReconcileStaleJobs()
    {
        EnsureRipColumns();
        long live; bool busy;
        lock (_l) { live = _jobId; busy = _busy; }
        var now = DateTimeOffset.UtcNow.ToString("O");
        var msg = "Interrupted — the server stopped before this rip finished.";
        // Count first so tests can assert, then update.
        var ids = busy && live > 0
            ? _db.Query("SELECT id FROM rip_job WHERE status IN ('ripping','queued') AND id<>$x", r => r.GetInt64(0), ("$x", live))
            : _db.Query("SELECT id FROM rip_job WHERE status IN ('ripping','queued')", r => r.GetInt64(0));
        var n = ids.Count;
        if (n == 0) return 0;
        if (busy && live > 0)
            _db.Exec("UPDATE rip_job SET status='interrupted',error=$e,detail=$d,finished_at=$t WHERE status IN ('ripping','queued') AND id<>$x",
                ("$e", msg), ("$d", "Interrupted"), ("$t", now), ("$x", live));
        else
            _db.Exec("UPDATE rip_job SET status='interrupted',error=$e,detail=$d,finished_at=$t WHERE status IN ('ripping','queued')",
                ("$e", msg), ("$d", "Interrupted"), ("$t", now));
        _ev.Publish("rip", new { job = true, reconciled = n });
        if (n > 0)
        {
            RipLog($"reconciled {n} stale rip job(s)");
            foreach (var jobId in ids)
            {
                var dests = _db.Query("SELECT dest_folder FROM rip_job WHERE id=$i",
                    r => r.IsDBNull(0) ? null : r.GetString(0), ("$i", jobId));
                if (dests.Count > 0) TryCleanEmptyRipDest(dests[0]);
            }
        }
        // Leftover ffmpeg/wavwiz-cdda from a crash or reinstall may still hold the drive.
        try { ReapOrphanRipProcesses("startup reconcile"); } catch (Exception ex) { RipLog("orphan reap on reconcile failed: " + ex.Message); }
        return n;
    }

    void EnsureRipColumns()
    {
        // defensive: v10 migration adds these; older in-memory fixtures after a partial migrate still work
        foreach (var sql in new[] {
            "ALTER TABLE rip_job ADD COLUMN quality TEXT",
            "ALTER TABLE rip_job ADD COLUMN detail TEXT",
            "ALTER TABLE rip_job ADD COLUMN track_no INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE rip_job ADD COLUMN track_total INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE rip_job ADD COLUMN speed REAL",
            "ALTER TABLE rip_job ADD COLUMN year TEXT"
        })
        {
            try { _db.Exec(sql); } catch { /* already present */ }
        }
    }

    public object Jobs()
    {
        try
        {
            return _db.Query(@"SELECT id,drive,status,format,dest_folder,album,artist,progress,error,created_at,finished_at,
                quality,detail,track_no,track_total,speed,year FROM rip_job ORDER BY id DESC LIMIT 30",
                r => MapJob(r, true));
        }
        catch
        {
            return _db.Query("SELECT id,drive,status,format,dest_folder,album,artist,progress,error,created_at,finished_at FROM rip_job ORDER BY id DESC LIMIT 30",
                r => MapJob(r, false));
        }
    }

    static object MapJob(System.Data.Common.DbDataReader r, bool extra)
    {
        var progress = r.GetDouble(7);
        var track = extra && r.FieldCount > 13 && !r.IsDBNull(13) ? r.GetInt32(13) : 0;
        var trackTotal = extra && r.FieldCount > 14 && !r.IsDBNull(14) ? r.GetInt32(14) : 0;
        return new
        {
            id = r.GetInt64(0), drive = r.GetString(1), status = r.GetString(2), format = r.GetString(3),
            dest = r.IsDBNull(4) ? null : r.GetString(4),
            album = r.IsDBNull(5) ? null : r.GetString(5), artist = r.IsDBNull(6) ? null : r.GetString(6),
            progress, error = r.IsDBNull(8) ? null : r.GetString(8),
            createdAt = r.GetString(9), finishedAt = r.IsDBNull(10) ? null : r.GetString(10),
            quality = extra && r.FieldCount > 11 && !r.IsDBNull(11) ? r.GetString(11) : null,
            detail = extra && r.FieldCount > 12 && !r.IsDBNull(12) ? r.GetString(12) : null,
            track, trackTotal,
            speed = extra && r.FieldCount > 15 && !r.IsDBNull(15) ? r.GetDouble(15) : (double?)null,
            year = extra && r.FieldCount > 16 && !r.IsDBNull(16) ? r.GetString(16) : null,
            trackProgress = extra ? TrackProgress(track, trackTotal, progress) : (double?)null,
        };
    }

    public static readonly object[] QualityChoices = {
        new { id = "v0", name = "VBR V0 (best)", note = "LAME VBR highest quality. Default." },
        new { id = "v2", name = "VBR V2", note = "LAME VBR, a little smaller." },
        new { id = "cbr320", name = "CBR 320 kbps", note = "Constant 320 kbps." },
    };

    public object Formats()
    {
        bool lame = EncoderOk("libmp3lame");
        return new
        {
            defaultFormat = "flac",
            defaultQuality = "v0",
            libcdio = FindCddaHelper() != null,
            libmp3lame = lame,
            qualities = QualityChoices,
            formats = new object[] {
                new { id = "flac", name = "FLAC (lossless)", available = EncoderOk("flac"), note = "Default. Lossless, LGPL encoder in WavWiz's FFmpeg." },
                new { id = "wav", name = "WAV (PCM)", available = true, note = "Uncompressed. Always available." },
                new { id = "aac", name = "AAC", available = EncoderOk("aac"), note = "LGPL native AAC encoder (no FDK)." },
                new { id = "mp3", name = "MP3", available = lame, note = lame ? "LAME (LGPL) is bundled with WavWiz." : "MP3 needs the WavWiz FFmpeg build with LAME (libmp3lame). Rebuild from this version, or choose FLAC, AAC, or WAV." },
            }
        };
    }

    public object Drives()
    {
        var helper = FindCddaHelper();
        if (!OperatingSystem.IsWindows())
            return new { drives = Array.Empty<object>(), libcdio = helper != null, signature = (string?)null, note = "Optical-drive detection runs on the Windows server PC. This build host is Linux, so the list is empty here." };
        var list = ListDrives();
        return new
        {
            drives = list,
            libcdio = helper != null,
            signature = DiscSignature(list),
            note = list.Count == 0 ? "No optical drive found on this PC." : helper == null ? "wavwiz-cdda (libcdio helper) is missing next to FFmpeg — reinstall WavWiz 0.6.8+." : null,
        };
    }

    List<object> ListDrives()
    {
        var list = new List<object>();
        if (!OperatingSystem.IsWindows()) return list;
        foreach (var d in DriveInfo.GetDrives().Where(x => x.DriveType == DriveType.CDRom))
        {
            string? label = null; bool ready = false; int tracks = 0;
            try { ready = d.IsReady; label = ready ? d.VolumeLabel : null; if (ready) tracks = DetectTrackCount(d.Name.TrimEnd('\\')); } catch { }
            list.Add(new { letter = d.Name.TrimEnd('\\'), ready, label, tracks });
        }
        return list;
    }

    /// <summary>Stable snapshot of inserted media (letter, ready, label, track count). Used to detect insert/eject without rereading the TOC every second.</summary>
    public static string DiscSignature(IEnumerable<object> drives)
    {
        var parts = new List<string>();
        foreach (var d in drives)
        {
            var t = d.GetType();
            string letter = t.GetProperty("letter")?.GetValue(d)?.ToString() ?? "";
            bool ready = t.GetProperty("ready")?.GetValue(d) is true;
            string? label = t.GetProperty("label")?.GetValue(d)?.ToString();
            int tracks = t.GetProperty("tracks")?.GetValue(d) is int n ? n : 0;
            parts.Add(ready ? $"{letter}|1|{label}|{tracks}" : $"{letter}|0");
        }
        return string.Join(";", parts);
    }

    public static string? DiscChange(string? prev, string next)
    {
        if (string.Equals(prev, next, StringComparison.Ordinal)) return null;
        bool WasReady(string? s) => !string.IsNullOrEmpty(s) && s.Contains("|1|", StringComparison.Ordinal);
        bool prevReady = WasReady(prev), nextReady = WasReady(next);
        if (!prevReady && nextReady) return "inserted";
        if (prevReady && !nextReady) return "ejected";
        return "changed";
    }

    public void Tick()
    {
        try
        {
            bool busy;
            lock (_l) busy = _busy;
            // Never touch the drive while a rip is reading it.
            if (busy) { if (DateTime.UtcNow - _lastPoll > TimeSpan.FromSeconds(1)) { _lastPoll = DateTime.UtcNow; _ev.Publish("rip", new { job = true }); } return; }
            if (DateTime.UtcNow - _lastPoll < TimeSpan.FromSeconds(2)) return;
            _lastPoll = DateTime.UtcNow;
            if (!OperatingSystem.IsWindows()) return;
            var list = ListDrives();
            var sig = DiscSignature(list);
            var change = DiscChange(_discSig, sig);
            if (change == null) return;
            _discSig = sig;
            if (change is "ejected" or "changed") { _discCache = null; }
            _ev.Publish("rip", new { disc = change, signature = sig });
        }
        catch { /* never break the server tick */ }
    }

    public (bool Ok, string? Err) Cancel(long id)
    {
        bool running = false;
        lock (_l)
        {
            if (_jobId == id && _busy)
            {
                running = true;
                try { _jobCts?.Cancel(); } catch { }
            }
        }
        if (running)
        {
            RipLog($"cancel requested for live job {id}");
            KillTrackedChildren($"cancel job {id}");
            return (true, null);
        }
        // Process is gone (reinstall, crash, already exited): still clear the leftover job so the page unlocks.
        var rows = _db.Query("SELECT status, dest_folder FROM rip_job WHERE id=$i",
            r => (r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1)), ("$i", id));
        if (rows.Count == 0) return (false, "That rip was not found.");
        var (st, dest) = rows[0];
        if (st is "done" or "cancelled" or "interrupted" or "error")
        {
            // No live rip — still reap orphans that may be holding the drive.
            try { ReapOrphanRipProcesses($"cancel idle job {id}"); } catch { }
            if (st is "cancelled" or "interrupted" or "error") TryCleanEmptyRipDest(dest);
            return (true, null);
        }
        var now = DateTimeOffset.UtcNow.ToString("O");
        _db.Exec("UPDATE rip_job SET status='cancelled',error=$e,detail=$d,finished_at=$t WHERE id=$i AND status IN ('ripping','queued')",
            ("$e", "Cancelled."), ("$d", "Cancelled"), ("$t", now), ("$i", id));
        RipLog($"cancelled leftover job {id} (was {st})");
        try { ReapOrphanRipProcesses($"cancel leftover job {id}"); } catch { }
        TryCleanEmptyRipDest(dest);
        _ev.Publish("rip", new { job = true, id, status = "cancelled" });
        return (true, null);
    }

    /// <summary>Forms of a Windows drive letter that libcdio / the filesystem will accept.</summary>
    public static string[] DriveCandidates(string drive)
    {
        var letter = NormalizeDrive(drive);
        if (letter.Length == 0) return Array.Empty<string>();
        return new[] { letter, letter + "\\", @"\\.\" + letter };
    }

    /// <summary>Pause between TOC rounds so a USB drive can spin up. The helper also waits internally.</summary>
    public static readonly int[] TocRetryDelaysMs = { 0, 2000, 4000, 8000 };
    /// <summary>Must cover the helper’s spin-up wait (~10s) plus a TOC read.</summary>
    public static readonly TimeSpan TocHelperTimeout = TimeSpan.FromSeconds(25);
    public static readonly TimeSpan TocHelperStall = TimeSpan.FromSeconds(22);

    public static string NormalizeDrive(string? drive)
    {
        var d = (drive ?? "").Trim().TrimEnd('\\', '/');
        if (string.IsNullOrEmpty(d)) return "";
        if (char.IsLetter(d[0])) return char.ToUpperInvariant(d[0]) + ":";
        return d.EndsWith(':') ? d : d + ":";
    }

    /// <summary>ASP.NET Core rejects <c>refresh=1</c> on a bool query parameter with HTTP 400.
    /// Accept 1/true/yes/on (any case), so Retry and other clients do not break.</summary>
    public static bool ParseQueryFlag(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var v = value.Trim();
        return v.Equals("1", StringComparison.OrdinalIgnoreCase)
            || v.Equals("true", StringComparison.OrdinalIgnoreCase)
            || v.Equals("yes", StringComparison.OrdinalIgnoreCase)
            || v.Equals("on", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Kept for compatibility. wavwiz-cdda now uses GENERIC_READ CD-ROM IOCTLs, so Local Service no longer needs a Local System hint.</summary>
    public static string WindowsServiceAccountHint() => "";

    public (long Id, string? Err) Start(JsonElement b)
    {
        var drive = (b.Str("drive") ?? "").Trim();
        var (format, quality, err) = NormalizeFormat(b.Str("format") ?? "flac", b.Str("quality"));
        if (err != null) return (0, err);
        if ((format is "flac" or "aac") && !EncoderOk(format)) return (0, $"{format} encoder is not in this FFmpeg build");
        if (format == "mp3" && !EncoderOk("libmp3lame")) return (0, "MP3 encoder (LAME) is not in this FFmpeg build. Rebuild FFmpeg with libmp3lame, or choose FLAC, AAC, or WAV.");
        if (string.IsNullOrWhiteSpace(drive)) return (0, "drive is required (e.g. E:)");
        if (!drive.EndsWith(':')) drive += ":";
        if (FindCddaHelper() == null) return (0, "wavwiz-cdda helper not found next to FFmpeg (needed for CDDA via libcdio).");
        lock (_l) if (_busy) return (0, "a rip is already running");

        var root = _db.Query("SELECT path FROM library_root WHERE enabled=1 ORDER BY id LIMIT 1", r => r.GetString(0)).FirstOrDefault()
            ?? Path.Combine(_cfg.DataDir, "ripped");
        var album = (b.Str("album") ?? "Unknown Album").Trim();
        var artist = (b.Str("artist") ?? "Unknown Artist").Trim();
        var year = (b.Str("year") ?? "").Trim();
        var dest = Path.Combine(root, Sanitize(artist), Sanitize(album));
        Directory.CreateDirectory(dest);
        var tracks = ParseTrackPicks(b);
        var coverMbid = (b.Str("coverMbid") ?? "").Trim();
        var now = DateTimeOffset.UtcNow.ToString("O");
        EnsureRipColumns();
        var id = _db.Insert("INSERT INTO rip_job(drive,status,format,dest_folder,album,artist,progress,created_at,quality,year,detail) VALUES($d,'queued',$f,$p,$a,$r,0,$t,$q,$y,$z)",
            ("$d", drive), ("$f", format), ("$p", dest), ("$a", album), ("$r", artist), ("$t", now), ("$q", quality), ("$y", string.IsNullOrEmpty(year) ? null : year), ("$z", "Waiting to start"));
        var cts = new CancellationTokenSource();
        lock (_l) { _busy = true; _jobId = id; _jobCts = cts; }
        RipLog($"start job {id} drive={drive} format={format}" + (quality != null ? $" quality={quality}" : "") + $" album=\"{album}\" artist=\"{artist}\" tracks={(tracks.Count > 0 ? tracks.Count : -1)}");
        _ev.Publish("rip", new { job = true, id, status = "queued" });
        _ = Task.Run(() => RunJob(id, drive, format, quality, dest, album, artist, year, tracks, coverMbid, cts.Token));
        return (id, null);
    }

    public static (string Format, string? Quality, string? Err) NormalizeFormat(string? format, string? quality)
    {
        var f = (format ?? "flac").Trim().ToLowerInvariant();
        if (f is not ("flac" or "wav" or "aac" or "mp3")) return ("", null, "format must be flac, wav, aac or mp3");
        if (f != "mp3") return (f, null, null);
        var q = (quality ?? "v0").Trim().ToLowerInvariant();
        if (q is "v0" or "v2" or "cbr320") return (f, q, null);
        return ("", null, "MP3 quality must be v0, v2 or cbr320");
    }

    public static string CodecArgs(string format, string? quality) => format switch
    {
        "flac" => "-c:a flac",
        "aac" => "-c:a aac -b:a 256k",
        "mp3" => quality switch
        {
            "v2" => "-c:a libmp3lame -q:a 2 -id3v2_version 3",
            "cbr320" => "-c:a libmp3lame -b:a 320k -id3v2_version 3",
            _ => "-c:a libmp3lame -q:a 0 -id3v2_version 3",
        },
        _ => "-c:a pcm_s16le"
    };

    public static string Extension(string format) => format switch { "flac" => "flac", "aac" => "m4a", "mp3" => "mp3", _ => "wav" };

    public static List<(int N, string Title, string? Artist)> ParseTrackPicks(JsonElement b)
    {
        var list = new List<(int, string, string?)>();
        if (b.ValueKind != JsonValueKind.Object || !b.TryGetProperty("tracks", out var arr) || arr.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var x in arr.EnumerateArray())
        {
            if (x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var n) && n > 0) list.Add((n, $"Track {n}", null));
            else if (x.ValueKind == JsonValueKind.Object)
            {
                int num = (int)(x.TryGetProperty("n", out var nn) && nn.TryGetInt32(out var ni) ? ni : x.TryGetProperty("track", out var tt) && tt.TryGetInt32(out var ti) ? ti : 0);
                if (num <= 0) continue;
                var title = x.TryGetProperty("title", out var t) ? t.GetString() : null;
                var artist = x.TryGetProperty("artist", out var a) ? a.GetString() : null;
                list.Add((num, string.IsNullOrWhiteSpace(title) ? $"Track {num}" : title!.Trim(), string.IsNullOrWhiteSpace(artist) ? null : artist!.Trim()));
            }
        }
        return list;
    }

    async Task RunJob(long id, string drive, string format, string? quality, string dest, string album, string artist, string year, List<(int N, string Title, string? Artist)> picks, string coverMbid, CancellationToken ct)
    {
        var helper = FindCddaHelper() ?? throw new InvalidOperationException("wavwiz-cdda missing");
        try
        {
            UpdateJob(id, "ripping", 0.02, "Reading the disc…", 0, 0, null);
            // A leftover helper from a prior rip can block TOC — clear it first.
            try { ReapOrphanRipProcesses($"before TOC job {id}"); } catch { }
            var ext = Extension(format);
            var codecArgs = CodecArgs(format, quality);
            var tocRead = await ReadTocAsync(helper, drive, ct, retries: 4).ConfigureAwait(false);
            var toc = tocRead.Toc;
            if (toc != null) RipLog($"job {id} TOC ok audio={toc.AudioCount} first={toc.AudioFirst} last={toc.AudioLast} leadout={toc.LeadoutLba}");
            else RipLog($"job {id} TOC failed: {tocRead.Error ?? "unknown"}");
            int trackCount = toc?.AudioCount ?? await CountTracksAsync(helper, drive, ct).ConfigureAwait(false);
            if (trackCount <= 0) trackCount = DetectTrackCount(drive);
            if (trackCount <= 0) throw new InvalidOperationException("No audio tracks found. Is an audio CD in the drive?");
            var chosen = picks.Count > 0 ? picks : Enumerable.Range(1, trackCount).Select(n => (N: n, Title: $"Track {n}", Artist: (string?)null)).ToList();
            foreach (var c in chosen)
                if (c.N < 1 || c.N > trackCount) throw new InvalidOperationException($"Track {c.N} is not on this disc.");
            string? cover = null;
            if (!string.IsNullOrWhiteSpace(coverMbid))
                cover = await EnsureCoverAsync(coverMbid, ct).ConfigureAwait(false);
            var tmpDir = Path.Combine(Path.GetTempPath(), "wavwiz-rip-" + id);
            Directory.CreateDirectory(tmpDir);
            try
            {
                int done = 0;
                foreach (var c in chosen)
                {
                    ct.ThrowIfCancellationRequested();
                    done++;
                    var wav = Path.Combine(tmpDir, $"track{c.N:00}.wav");
                    UpdateJob(id, "ripping", (done - 1 + 0.02) / chosen.Count, $"Ripping track {done} of {chosen.Count}: {c.Title}", done, chosen.Count, null);
                    int sectors = TrackSectors(toc, c.N);
                    var started = DateTime.UtcNow;
                    int lastSec = 0;
                    void OnProg(string line)
                    {
                        var m = Regex.Match(line, @"^PROGRESS\s+(\d+)\s+(\d+)");
                        if (!m.Success) return;
                        int cur = int.Parse(m.Groups[1].Value), tot = Math.Max(1, int.Parse(m.Groups[2].Value));
                        lastSec = cur;
                        double frac = Math.Clamp(cur / (double)tot, 0, 0.98);
                        double speed = (DateTime.UtcNow - started).TotalSeconds > 0.4 ? (cur / 75.0) / (DateTime.UtcNow - started).TotalSeconds : 0;
                        UpdateJob(id, "ripping", (done - 1 + frac * 0.85) / chosen.Count, $"Track {done} of {chosen.Count}: {c.Title} · {frac:P0}", done, chosen.Count, speed > 0 ? speed : null);
                    }
                    var timeout = TrackTimeout(sectors);
                    if (!await RunHelperAsync(helper, new[] { drive, c.N.ToString(), wav }, timeout, ct, OnProg, wav).ConfigureAwait(false))
                    {
                        if (ct.IsCancellationRequested) throw new OperationCanceledException();
                        throw new InvalidOperationException($"Could not read track {c.N} from {drive}. The disc may be scratched, or the drive stalled.");
                    }
                    var outName = $"{c.N:00} - {Sanitize(c.Title)}.{ext}";
                    var outFile = Path.Combine(dest, outName);
                    UpdateJob(id, "ripping", (done - 1 + 0.88) / chosen.Count, $"Encoding track {done} of {chosen.Count} to {format.ToUpperInvariant()}", done, chosen.Count, null);
                    if (format == "wav" && string.IsNullOrEmpty(year) && cover == null)
                    {
                        File.Copy(wav, outFile, true);
                    }
                    else
                    {
                        var args = FfmpegEncodeArgs(wav, outFile, codecArgs, album, c.Artist ?? artist, artist, c.Title, year, c.N, trackCount, cover);
                        if (!await RunFfmpegAsync(args, TimeSpan.FromMinutes(10), ct).ConfigureAwait(false))
                            throw new InvalidOperationException($"FFmpeg could not encode track {c.N} to {format}.");
                    }
                    try { File.Delete(wav); } catch { }
                    RipLog($"job {id} track {c.N} done ({done}/{chosen.Count}) -> {outName}");
                    UpdateJob(id, "ripping", (double)done / chosen.Count, $"Finished track {done} of {chosen.Count}", done, chosen.Count, null);
                }
            }
            finally { try { Directory.Delete(tmpDir, true); } catch { } }
            _db.Exec("UPDATE rip_job SET status='done',progress=1,detail=$d,finished_at=$t WHERE id=$i",
                ("$d", "Done"), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
            RipLog($"job {id} done");
            _ev.Publish("rip", new { job = true, id, status = "done" });
            _ev.Publish("library");
            _ = _lib.TrackCount();
        }
        catch (OperationCanceledException)
        {
            RipLog($"job {id} cancelled");
            KillTrackedChildren($"job {id} cancelled");
            _db.Exec("UPDATE rip_job SET status='cancelled',error=$e,detail=$d,finished_at=$t WHERE id=$i",
                ("$e", "Cancelled."), ("$d", "Cancelled"), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
            _ev.Publish("rip", new { job = true, id, status = "cancelled" });
            TryCleanEmptyRipDest(dest);
        }
        catch (Exception e)
        {
            var msg = e.Message;
            if (msg.Contains("stalled", StringComparison.OrdinalIgnoreCase) || msg.Contains("timed out", StringComparison.OrdinalIgnoreCase))
                msg = e.Message;
            // chunkLength / other framework exceptions are meaningless on the rip page — keep a
            // short message for the UI and put the stack in the server log.
            if (e is ArgumentOutOfRangeException)
                msg = "The disc track was read, but the server hit an internal error collecting the helper’s output. Please try the rip again.";
            RipLog($"job {id} failed: {msg}");
            RipLog($"job {id} exception: {e}");
            KillTrackedChildren($"job {id} failed");
            _db.Exec("UPDATE rip_job SET status='error',error=$e,detail=$d,finished_at=$t WHERE id=$i",
                ("$e", msg), ("$d", msg), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
            _ev.Publish("rip", new { job = true, id, status = "error", error = msg });
            TryCleanEmptyRipDest(dest);
        }
        finally
        {
            // Belt-and-suspenders: any child that survived cancel/fail/timeout is reaped here.
            KillTrackedChildren($"job {id} finished");
            lock (_l) { _busy = false; if (_jobId == id) { _jobId = 0; _jobCts = null; } }
        }
    }

    public static TimeSpan TrackTimeout(int sectors)
    {
        // CD 1× is 75 sectors/s; allow up to 4× slower plus a floor, so a long album track is not cut off.
        var sec = sectors > 0 ? Math.Max(MinTrackTimeout.TotalSeconds, sectors / 75.0 * 4 + 60) : MinTrackTimeout.TotalSeconds;
        return TimeSpan.FromSeconds(Math.Min(sec, TimeSpan.FromHours(2).TotalSeconds));
    }

    /// <summary>
    /// Intra-track fraction (0–1) packed into overall job progress.
    /// Overall is (track-1 + packed) / trackTotal, where packed is 0.02 at the start of a track,
    /// frac×0.85 while reading, 0.88 while encoding, and 1 after the track finishes.
    /// A 16-track rip is only ~6% overall at the end of track 1, so the UI uses this for the bar
    /// or it would sit at 0% for most of the first track.
    /// </summary>
    public static double TrackProgress(int track, int trackTotal, double overall)
    {
        if (trackTotal <= 0) return Math.Clamp(overall, 0, 1);
        if (track < 1) return 0;
        var packed = overall * trackTotal - (track - 1);
        if (packed <= 0.03) return 0;          // start sentinel (0.02), no sectors yet
        if (packed >= 0.995) return 1;
        if (packed >= 0.86) return 0.99;       // encoding
        return Math.Clamp(packed / 0.85, 0, 0.98);
    }

    public static string FfmpegEncodeArgs(string wav, string outFile, string codecArgs, string album, string artist, string albumArtist, string title, string year, int track, int total, string? cover)
    {
        var meta = $"-metadata title=\"{Escape(title)}\" -metadata artist=\"{Escape(artist)}\" -metadata album_artist=\"{Escape(albumArtist)}\" -metadata album=\"{Escape(album)}\" -metadata track=\"{track}/{total}\"";
        if (!string.IsNullOrWhiteSpace(year)) meta += $" -metadata date=\"{Escape(year)}\"";
        if (string.IsNullOrEmpty(cover))
            return $"-hide_banner -nostats -y -i \"{wav}\" {codecArgs} {meta} \"{outFile}\"";
        return $"-hide_banner -nostats -y -i \"{wav}\" -i \"{cover}\" -map 0:a -map 1:v -c:v mjpeg -disposition:v attached_pic {codecArgs} {meta} \"{outFile}\"";
    }

    void UpdateJob(long id, string status, double progress, string detail, int track, int total, double? speed)
    {
        try
        {
            _db.Exec("UPDATE rip_job SET status=$s,progress=$p,detail=$d,track_no=$n,track_total=$t,speed=$v WHERE id=$i",
                ("$s", status), ("$p", Math.Clamp(progress, 0, 1)), ("$d", detail), ("$n", track), ("$t", total),
                ("$v", speed.HasValue ? speed.Value : (object?)null), ("$i", id));
        }
        catch
        {
            _db.Exec("UPDATE rip_job SET status=$s,progress=$p WHERE id=$i", ("$s", status), ("$p", Math.Clamp(progress, 0, 1)), ("$i", id));
        }
        _ev.Publish("rip", new { job = true, id, status, progress, detail, track, trackTotal = total, speed, trackProgress = TrackProgress(track, total, progress) });
    }

    async Task<bool> RunHelperAsync(string helper, IEnumerable<string> args, TimeSpan timeout, CancellationToken ct, Action<string>? onLine, string? watchFile)
    {
        long lastSize = -1;
        Action? activity = null;
        if (watchFile != null)
            activity = () => { try { if (File.Exists(watchFile)) { var n = new FileInfo(watchFile).Length; if (n != lastSize) { lastSize = n; } } } catch { } };
        int pid = 0;
        try
        {
            var r = await ChildProcess.RunAsync(helper, args, ct, timeout, StallTimeout, onLine, activity, onStarted: p => { pid = p.Id; TrackChild(p); }).ConfigureAwait(false);
            if (r.Stalled)
            {
                RipLog($"wavwiz-cdda stalled pid={pid}; killing");
                if (pid > 0) RipProcessCleanup.TryKillPid(pid, out _);
                throw new InvalidOperationException("The CD drive stalled (no progress for 90 seconds). Check the disc and try again, or Cancel.");
            }
            if (r.TimedOut)
            {
                RipLog($"wavwiz-cdda timed out pid={pid}; killing");
                if (pid > 0) RipProcessCleanup.TryKillPid(pid, out _);
                throw new InvalidOperationException("Reading this track took too long and was stopped. The disc may be scratched.");
            }
            if (r.Cancelled) throw new OperationCanceledException();
            return r.ExitCode == 0;
        }
        finally
        {
            if (pid > 0)
            {
                // If the helper somehow survived RunAsync, kill it; then drop the track.
                try
                {
                    using var still = Process.GetProcessById(pid);
                    if (!still.HasExited) { RipProcessCleanup.TryKillPid(pid, out _); RipLog($"killed leftover wavwiz-cdda pid={pid} after run"); }
                }
                catch { /* gone */ }
                UntrackChild(pid);
            }
        }
    }

    async Task<bool> RunFfmpegAsync(string args, TimeSpan timeout, CancellationToken ct)
    {
        // -nostats keeps stderr small; we still drain it so a verbose build can never deadlock the pipe.
        int pid = 0;
        try
        {
            var r = await ChildProcess.RunAsync(_ffmpeg, args, ct, timeout, TimeSpan.FromMinutes(3), onStarted: p => { pid = p.Id; TrackChild(p); }).ConfigureAwait(false);
            if (r.Stalled)
            {
                RipLog($"ffmpeg stalled pid={pid}; killing");
                if (pid > 0) RipProcessCleanup.TryKillPid(pid, out _);
                throw new InvalidOperationException("Encoding stalled. The file was not written.");
            }
            if (r.TimedOut)
            {
                RipLog($"ffmpeg timed out pid={pid}; killing");
                if (pid > 0) RipProcessCleanup.TryKillPid(pid, out _);
                throw new InvalidOperationException("Encoding took too long and was stopped.");
            }
            if (r.Cancelled) throw new OperationCanceledException();
            return r.ExitCode == 0;
        }
        finally
        {
            if (pid > 0)
            {
                try
                {
                    using var still = Process.GetProcessById(pid);
                    if (!still.HasExited) { RipProcessCleanup.TryKillPid(pid, out _); RipLog($"killed leftover ffmpeg pid={pid} after run"); }
                }
                catch { }
                UntrackChild(pid);
            }
        }
    }

    public sealed record Toc(int First, int Last, int LeadoutLba, int AudioFirst, int AudioLast, List<(int N, int Lba, bool Audio)> Tracks)
    {
        public int AudioCount => Tracks.Count(t => t.Audio);
        public IReadOnlyList<int> LbaByNumber
        {
            get
            {
                var a = new int[Math.Max(Last + 1, 1)];
                foreach (var t in Tracks) if (t.N >= 0 && t.N < a.Length) a[t.N] = t.Lba;
                return a;
            }
        }
    }

    public static Toc? ParseToc(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        int first = 0, last = 0, lead = 0, af = 0, al = 0;
        var tracks = new List<(int, int, bool)>();
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith("FIRST ")) int.TryParse(line[6..], out first);
            else if (line.StartsWith("LAST ")) int.TryParse(line[5..], out last);
            else if (line.StartsWith("LEADOUT ")) int.TryParse(line[8..], out lead);
            else if (line.StartsWith("AUDIO_FIRST ")) int.TryParse(line[12..], out af);
            else if (line.StartsWith("AUDIO_LAST ")) int.TryParse(line[11..], out al);
            else if (line.StartsWith("TRACK "))
            {
                var p = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (p.Length >= 3 && int.TryParse(p[1], out var n) && int.TryParse(p[2], out var lba))
                    tracks.Add((n, lba, p.Length < 4 || p[3].Equals("AUDIO", StringComparison.OrdinalIgnoreCase)));
            }
        }
        if (lead <= 0 || tracks.Count == 0) return null;
        if (af == 0) af = tracks.FirstOrDefault(t => t.Item3).Item1;
        if (al == 0) al = tracks.LastOrDefault(t => t.Item3).Item1;
        if (first == 0) first = af;
        if (last == 0) last = al;
        return new Toc(first, last, lead, af, al, tracks);
    }

    public static int TrackSectors(Toc? toc, int audioIndex1)
    {
        if (toc == null) return 0;
        var audio = toc.Tracks.Where(t => t.Audio).ToList();
        if (audioIndex1 < 1 || audioIndex1 > audio.Count) return 0;
        var start = audio[audioIndex1 - 1].Lba;
        var end = audioIndex1 < audio.Count ? audio[audioIndex1].Lba : toc.LeadoutLba;
        return Math.Max(0, end - start);
    }

    public readonly record struct TocRead(Toc? Toc, string? Error);

    /// <summary>Read the TOC, trying alternate drive-letter forms and a short backoff after insert. Never leaves a hung helper behind.</summary>
    async Task<TocRead> ReadTocAsync(string helper, string drive, CancellationToken ct, int retries = 3)
    {
        // Job 2 on 2026-11-09 failed the TOC in ~3s with "no TOC on \\.\E:" because
        // four rounds × three drive forms hammered the USB drive before it had spun up.
        // Try E: first, give the helper time to wait, and only then try the other forms.
        string? lastErr = null;
        var rounds = Math.Max(1, retries);
        for (int i = 0; i < rounds; i++)
        {
            if (i > 0)
            {
                var ms = TocRetryDelaysMs[Math.Min(i, TocRetryDelaysMs.Length - 1)];
                try { await Task.Delay(ms, ct).ConfigureAwait(false); } catch (OperationCanceledException) { return new TocRead(null, lastErr ?? "Cancelled."); }
            }
            foreach (var candidate in DriveCandidates(drive))
            {
                int tocPid = 0;
                var r = await ChildProcess.RunAsync(helper, new[] { "--toc", candidate }, ct, TocHelperTimeout, TocHelperStall,
                    onStarted: p => { tocPid = p.Id; TrackChild(p); }).ConfigureAwait(false);
                try
                {
                    if (tocPid > 0 && (r.Stalled || r.TimedOut || r.Cancelled || r.ExitCode != 0))
                    {
                        try { using var still = Process.GetProcessById(tocPid); if (!still.HasExited) RipProcessCleanup.TryKillPid(tocPid, out _); } catch { }
                    }
                }
                finally { if (tocPid > 0) UntrackChild(tocPid); }
                if (r.Cancelled) return new TocRead(null, lastErr ?? "Cancelled.");
                if (r.Stalled || r.TimedOut)
                {
                    lastErr = "The drive did not respond in time. It may still be spinning up.";
                    RipLog($"TOC {candidate} timed out stalled={r.Stalled} timeout={r.TimedOut}");
                    continue;
                }
                if (r.ExitCode == 0)
                {
                    var toc = ParseToc(r.Stdout);
                    if (toc != null)
                    {
                        RipLog($"TOC ok via {candidate}");
                        return new TocRead(toc, null);
                    }
                    lastErr = "The disc table of contents was unreadable.";
                    RipLog($"TOC {candidate} exit=0 but unreadable stdout={(r.Stdout ?? "").Trim()}");
                    continue;
                }
                var err = (r.Stderr ?? "").Trim();
                lastErr = string.IsNullOrEmpty(err) ? $"Could not read the disc (exit {r.ExitCode})." : err.Split('\n')[0].Trim();
                RipLog($"TOC {candidate} exit={r.ExitCode} err={lastErr}");
                // "no TOC" on this form: let the helper wait again on the next form / round rather than immediately hammering.
            }
        }
        return new TocRead(null, lastErr);
    }

    async Task<int> CountTracksAsync(string helper, string drive, CancellationToken ct)
    {
        foreach (var candidate in DriveCandidates(drive))
        {
            int cPid = 0;
            var r = await ChildProcess.RunAsync(helper, new[] { "--count", candidate }, ct, TocHelperTimeout, TocHelperStall,
                onStarted: p => { cPid = p.Id; TrackChild(p); }).ConfigureAwait(false);
            try
            {
                if (cPid > 0 && (r.Stalled || r.TimedOut || r.Cancelled || r.ExitCode != 0))
                {
                    try { using var still = Process.GetProcessById(cPid); if (!still.HasExited) RipProcessCleanup.TryKillPid(cPid, out _); } catch { }
                }
            }
            finally { if (cPid > 0) UntrackChild(cPid); }
            if (r.ExitCode == 0 && int.TryParse((r.Stdout ?? "").Trim(), out var n) && n > 0) return n;
        }
        return 0;
    }

    public async Task<object> DiscAsync(string? drive, bool refresh = false, CancellationToken ct = default)
    {
        var drivesObj = Drives();
        drive = NormalizeDrive(drive);
        if (string.IsNullOrEmpty(drive))
        {
            if (OperatingSystem.IsWindows())
            {
                foreach (var d in DriveInfo.GetDrives().Where(x => x.DriveType == DriveType.CDRom))
                {
                    try { if (d.IsReady) { drive = NormalizeDrive(d.Name); break; } } catch { }
                }
            }
        }
        bool busy; lock (_l) busy = _busy;
        if (string.IsNullOrEmpty(drive))
            return new { ready = false, drive = (string?)null, source = "none", matches = Array.Empty<object>(), note = "Insert an audio CD to look up the artist, album and track names.", busy, canRetry = false };
        await _discGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
        var sig = DiscSignature(ListDrives());
        if (!refresh && _discCache != null && DateTime.UtcNow - _discAt < TimeSpan.FromMinutes(8) && string.Equals(_discSig, sig, StringComparison.Ordinal))
            return _discCache;

        var helper = FindCddaHelper();
        Toc? toc = null;
        string? tocError = null;
        if (helper != null)
        {
            try { ReapOrphanRipProcesses("before disc TOC"); } catch { }
            var read = await ReadTocAsync(helper, drive, ct, retries: refresh ? 2 : 4).ConfigureAwait(false);
            toc = read.Toc;
            tocError = read.Error;
        }
        string? discId = null, tocQuery = null;
        if (toc != null && toc.AudioLast >= toc.AudioFirst && toc.AudioFirst > 0)
        {
            discId = MusicBrainzDiscId.FromLba(toc.AudioFirst, toc.AudioLast, toc.LeadoutLba, toc.LbaByNumber);
            tocQuery = MusicBrainzDiscId.TocQuery(toc.AudioFirst, toc.AudioLast, toc.LeadoutLba, toc.LbaByNumber);
        }
        var cdtext = helper != null ? await ReadCdTextAsync(helper, drive, toc, ct).ConfigureAwait(false) : null;
        var tracks = new List<object>();
        if (toc != null)
        {
            int i = 0;
            foreach (var trk in toc.Tracks.Where(x => x.Audio))
            {
                i++;
                var next = toc.Tracks.Where(x => x.Audio && x.N > trk.N).Select(x => x.Lba).DefaultIfEmpty(toc.LeadoutLba).First();
                var ctTitle = cdtext?.Tracks.ElementAtOrDefault(i - 1).Title;
                var ctArtist = cdtext?.Tracks.ElementAtOrDefault(i - 1).Artist;
                tracks.Add(new { n = i, number = trk.N, title = ctTitle ?? $"Track {i}", artist = ctArtist ?? cdtext?.AlbumArtist, durationMs = MusicBrainzDiscId.DurationMs(trk.Lba, next), selected = true });
            }
        }
        if (tracks.Count == 0)
        {
            int n = helper != null ? await CountTracksAsync(helper, drive, ct).ConfigureAwait(false) : 0;
            if (n <= 0) n = DetectTrackCount(drive);
            for (int i = 1; i <= n; i++)
                tracks.Add(new { n = i, number = i, title = $"Track {i}", artist = (string?)null, durationMs = 0, selected = true });
        }
        var matches = new List<object>();
        string source = cdtext != null ? "cdtext" : "none";
        string? note = null;
        bool canRetry = toc == null;
        if (discId != null)
        {
            try
            {
                var mb = await LookupMusicBrainzAsync(discId, tocQuery, ct).ConfigureAwait(false);
                if (mb.Count > 0) { matches.AddRange(mb); source = "musicbrainz"; }
                else note = cdtext != null ? "No MusicBrainz match. Track names came from the disc itself (CD-Text)." : "No MusicBrainz match for this disc. You can type the artist, album and track names.";
            }
            catch (Exception ex)
            {
                note = "Could not reach MusicBrainz (" + ex.Message + "). " + (cdtext != null ? "Track names came from the disc itself." : "You can type the names.");
            }
        }
        else if (helper == null)
            note = "The CD helper is missing, so automatic album lookup is unavailable. Type the artist, album and track names.";
        else if (tracks.Count > 0)
            note = "Couldn't read the full disc index, but the drive shows " + tracks.Count + " audio track" + (tracks.Count == 1 ? "" : "s") + ". Type the artist, album and titles, or tap Retry — the disc may still be spinning up."
                + (string.IsNullOrEmpty(tocError) ? "" : " (" + tocError + ")")
                + WindowsServiceAccountHint();
        else
            note = "Couldn't read this disc yet. It may still be spinning up, or another program may have the drive open. Tap Retry, or type the artist and album if tracks appear."
                + (string.IsNullOrEmpty(tocError) ? "" : " (" + tocError + ")")
                + WindowsServiceAccountHint();
        var result = new
        {
            ready = true, drive, discId, tocQuery, source, note, busy, canRetry,
            artist = matches.Count > 0 ? GetStr(matches[0], "artist") : cdtext?.AlbumArtist,
            album = matches.Count > 0 ? GetStr(matches[0], "album") : cdtext?.Album,
            year = matches.Count > 0 ? GetStr(matches[0], "year") : null,
            tracks = matches.Count > 0 ? GetProp(matches[0], "tracks") ?? tracks : tracks,
            matches, cover = matches.Count > 0 ? GetStr(matches[0], "cover") : null
        };
        // Only cache a successful, complete read so a failed first try after insert does not stick for 8 minutes.
        if (toc != null)
        {
            _discCache = result; _discAt = DateTime.UtcNow; _discSig = sig;
        }
        else
        {
            _discCache = null;
        }
        RipLog($"disc {(toc != null ? "ok" : "failed")} drive={drive} refresh={refresh}" + (string.IsNullOrEmpty(tocError) ? "" : " err=" + tocError));
        return result;
        }
        finally { try { _discGate.Release(); } catch { } }
    }

    static string? GetStr(object o, string name) => o.GetType().GetProperty(name)?.GetValue(o)?.ToString();
    static object? GetProp(object o, string name) => o.GetType().GetProperty(name)?.GetValue(o);

    public sealed record CdTextInfo(string? Album, string? AlbumArtist, List<(string? Title, string? Artist)> Tracks);
    async Task<CdTextInfo?> ReadCdTextAsync(string helper, string drive, Toc? toc, CancellationToken ct)
    {
        foreach (var candidate in DriveCandidates(drive))
        {
            int tPid = 0;
            var r = await ChildProcess.RunAsync(helper, new[] { "--cdtext", candidate }, ct, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(12),
                onStarted: p => { tPid = p.Id; TrackChild(p); }).ConfigureAwait(false);
            try
            {
                if (tPid > 0 && (r.Stalled || r.TimedOut || r.Cancelled || r.ExitCode != 0))
                {
                    try { using var still = Process.GetProcessById(tPid); if (!still.HasExited) RipProcessCleanup.TryKillPid(tPid, out _); } catch { }
                }
            }
            finally { if (tPid > 0) UntrackChild(tPid); }
            if (r.ExitCode == 0 && !string.IsNullOrWhiteSpace(r.Stdout))
            {
                var parsed = ParseCdText(r.Stdout, toc?.AudioCount ?? 0);
                if (parsed != null) return parsed;
            }
        }
        return null;
    }

    public static CdTextInfo? ParseCdText(string text, int audioCount)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        string? album = null, albumArtist = null;
        var map = new Dictionary<int, (string? T, string? A)>();
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith("ALBUMARTIST ")) albumArtist = line[12..].Trim();
            else if (line.StartsWith("ALBUM ")) album = line[6..].Trim();
            else if (line.StartsWith("TRACKARTIST "))
            {
                var rest = line[12..].Trim(); var sp = rest.IndexOf(' ');
                if (sp > 0 && int.TryParse(rest[..sp], out var n)) map[n] = (map.GetValueOrDefault(n).T, rest[(sp + 1)..].Trim());
            }
            else if (line.StartsWith("TRACK "))
            {
                var rest = line[6..].Trim(); var sp = rest.IndexOf(' ');
                if (sp > 0 && int.TryParse(rest[..sp], out var n)) map[n] = (rest[(sp + 1)..].Trim(), map.GetValueOrDefault(n).A);
            }
        }
        if (album == null && albumArtist == null && map.Count == 0) return null;
        var tracks = new List<(string?, string?)>();
        var keys = map.Keys.OrderBy(k => k).ToList();
        if (keys.Count == 0 && audioCount > 0) for (int i = 0; i < audioCount; i++) tracks.Add((null, null));
        else foreach (var k in keys) tracks.Add(map[k]);
        return new CdTextInfo(album, albumArtist, tracks);
    }

    async Task<List<object>> LookupMusicBrainzAsync(string discId, string? tocQuery, CancellationToken ct)
    {
        await _mbGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var wait = TimeSpan.FromSeconds(1) - (DateTime.UtcNow - _mbLast);
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct).ConfigureAwait(false);
            var url = $"https://musicbrainz.org/ws/2/discid/{Uri.EscapeDataString(discId)}?inc=artists+recordings+artist-credits+release-groups&fmt=json&cdstubs=no";
            if (!string.IsNullOrEmpty(tocQuery)) url += "&toc=" + Uri.EscapeDataString(tocQuery);
            _mbLast = DateTime.UtcNow;
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if ((int)resp.StatusCode == 404) return new List<object>();
            resp.EnsureSuccessStatusCode();
            await using var stream = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            return ParseMbReleases(doc.RootElement);
        }
        finally { _mbGate.Release(); }
    }

    public static List<object> ParseMbReleases(JsonElement root)
    {
        var list = new List<object>();
        if (!root.TryGetProperty("releases", out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
        foreach (var rel in arr.EnumerateArray())
        {
            var id = rel.TryGetProperty("id", out var iid) ? iid.GetString() : null;
            if (string.IsNullOrEmpty(id)) continue;
            var album = rel.TryGetProperty("title", out var t) ? t.GetString() : null;
            string? artist = null;
            if (rel.TryGetProperty("artist-credit", out var ac) && ac.ValueKind == JsonValueKind.Array)
            {
                artist = string.Concat(ac.EnumerateArray().Select(a =>
                    (a.TryGetProperty("name", out var n) ? n.GetString() : null) + (a.TryGetProperty("joinphrase", out var j) ? j.GetString() : "")));
            }
            string? year = null;
            if (rel.TryGetProperty("date", out var d))
            {
                var ds = d.GetString();
                if (!string.IsNullOrEmpty(ds) && ds.Length >= 4) year = ds[..4];
            }
            var tracks = new List<object>();
            if (rel.TryGetProperty("media", out var media) && media.ValueKind == JsonValueKind.Array)
            {
                foreach (var m in media.EnumerateArray())
                {
                    if (!m.TryGetProperty("tracks", out var ts) || ts.ValueKind != JsonValueKind.Array) continue;
                    int n = 0;
                    foreach (var tr in ts.EnumerateArray())
                    {
                        n++;
                        var title = tr.TryGetProperty("title", out var tt) ? tt.GetString() : $"Track {n}";
                        string? tArtist = null;
                        if (tr.TryGetProperty("artist-credit", out var tac) && tac.ValueKind == JsonValueKind.Array)
                            tArtist = string.Concat(tac.EnumerateArray().Select(a => (a.TryGetProperty("name", out var n2) ? n2.GetString() : null) + (a.TryGetProperty("joinphrase", out var j2) ? j2.GetString() : "")));
                        int dur = tr.TryGetProperty("length", out var len) && len.TryGetInt32(out var ms) ? ms : 0;
                        int num = tr.TryGetProperty("position", out var pos) && pos.TryGetInt32(out var p) ? p : n;
                        tracks.Add(new { n = num, title, artist = tArtist ?? artist, durationMs = dur, selected = true });
                    }
                    break; // first medium (the audio disc)
                }
            }
            bool hasArt = rel.TryGetProperty("cover-art-archive", out var caa) && caa.TryGetProperty("front", out var front) && front.ValueKind == JsonValueKind.True;
            list.Add(new { id, artist, album, year, country = rel.TryGetProperty("country", out var c) ? c.GetString() : null, tracks, cover = hasArt ? "/api/v1/rip/cover/" + id : (string?)null, coverFront = hasArt });
        }
        return list;
    }

    public async Task<(byte[]? Bytes, string? Type, string? Err)> CoverAsync(string mbid, CancellationToken ct = default)
    {
        if (!Guid.TryParse(mbid, out _)) return (null, null, "bad id");
        var path = await EnsureCoverAsync(mbid, ct).ConfigureAwait(false);
        if (path == null || !File.Exists(path)) return (null, null, "no cover");
        return (await File.ReadAllBytesAsync(path, ct).ConfigureAwait(false), "image/jpeg", null);
    }

    async Task<string?> EnsureCoverAsync(string mbid, CancellationToken ct)
    {
        var dir = Path.Combine(_cfg.DataDir, "rip-cover");
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, mbid + ".jpg");
        if (File.Exists(dest) && new FileInfo(dest).Length > 100) return dest;
        try
        {
            using var resp = await _http.GetAsync($"https://coverartarchive.org/release/{mbid}/front-250", HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            await using var src = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            await using var dst = File.Create(dest);
            await src.CopyToAsync(dst, ct).ConfigureAwait(false);
            return dest;
        }
        catch { try { File.Delete(dest); } catch { } return null; }
    }

    private static int DetectTrackCount(string drive)
    {
        var root = NormalizeDrive(drive);
        if (root.Length == 0) return 0;
        int n = 0;
        for (int i = 1; i <= 99; i++)
        {
            var cda = Path.Combine(root + "\\", $"Track{i:00}.cda");
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
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            p.WaitForExit(5000);
            return Regex.IsMatch(o, @"\b" + Regex.Escape(name) + @"\b", RegexOptions.IgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>
    /// Deletes dest if it is an empty album folder, then the artist folder if that is also empty.
    /// Never deletes files, and never removes the library root itself.
    /// </summary>
    public static bool RemoveEmptyRipFolders(string? dest, string? libraryRoot)
    {
        if (string.IsNullOrWhiteSpace(dest)) return false;
        string destFull;
        try { destFull = Path.GetFullPath(dest); } catch { return false; }
        if (!Directory.Exists(destFull)) return false;
        string? rootFull = null;
        if (!string.IsNullOrWhiteSpace(libraryRoot))
        {
            try { if (Directory.Exists(libraryRoot)) rootFull = Path.GetFullPath(libraryRoot); } catch { }
        }
        if (rootFull != null && !IsUnderOrEqual(destFull, rootFull)) return false;
        if (Directory.EnumerateFileSystemEntries(destFull).Any()) return false;
        try { Directory.Delete(destFull); } catch { return false; }
        var parent = Directory.GetParent(destFull);
        if (parent == null) return true;
        var parentFull = parent.FullName;
        if (rootFull != null && (string.Equals(parentFull, rootFull, StringComparison.OrdinalIgnoreCase) || !IsUnderOrEqual(parentFull, rootFull)))
            return true;
        try
        {
            if (!Directory.EnumerateFileSystemEntries(parentFull).Any())
                Directory.Delete(parentFull);
        }
        catch { /* leave the artist folder */ }
        return true;
    }

    public static bool IsUnderOrEqual(string path, string root)
    {
        try
        {
            var rel = Path.GetRelativePath(root, path);
            return rel == "." || (!rel.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(rel));
        }
        catch { return false; }
    }

    string? LibraryRoot()
        => _db.Query("SELECT path FROM library_root WHERE enabled=1 ORDER BY id LIMIT 1", r => r.GetString(0)).FirstOrDefault()
           ?? Path.Combine(_cfg.DataDir, "ripped");

    void TryCleanEmptyRipDest(string? dest)
    {
        if (string.IsNullOrWhiteSpace(dest)) return;
        try
        {
            if (RemoveEmptyRipFolders(dest, LibraryRoot()))
                RipLog($"removed empty rip folder {dest}");
        }
        catch (Exception ex) { RipLog($"empty-folder cleanup failed: {ex.Message}"); }
    }

    private static string Sanitize(string s) { foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_'); return string.IsNullOrWhiteSpace(s) ? "Unknown" : s.Trim(); }
    private static string Escape(string s) => s.Replace("\"", "'");
}
