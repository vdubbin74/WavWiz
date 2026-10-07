using System.Diagnostics;
using Microsoft.Data.Sqlite;
namespace WavWiz.Server.Library;

public sealed record TrackRow(long Id, string Path, string Title, string Artist, string AlbumArtist, string Album, int? TrackNo, int? DiscNo, long DurationMs, string? Codec,
    int? SampleRate, string? Genre, int? Year, bool Missing);

public sealed record ScanResult(int Added, int Updated, int Unchanged, int Missing, int Errors, TimeSpan Elapsed, List<string> Messages);

/// <summary>
/// Library scanner + queries (spec 10.1). Roots are LOCAL or UNC paths on the server PC (never a mapped drive letter: those exist only per signed-in user and the
/// service cannot see them - see <see cref="RootProblem"/>). Strictly READ-ONLY: files are opened for reading only. Incremental by path+size+mtime.
/// </summary>
public sealed partial class LibraryService
{
    public static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase)
        { ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff", ".wma", ".alac", ".ape", ".wv" };
    private readonly Db _db;
    public LibraryService(Db db) { _db = db; }
    public object? Scalar(string sql, params (string, object?)[] p) => _db.Scalar(sql, p);
    public bool Scanning { get; private set; }
    public (int Done, int Total, string Root)? Progress { get; private set; }
    public event Action<object>? ScanProgress;

    /// <summary>null = fine. A mapped drive letter (Y:\) is refused with an explanation (spec 10.1).</summary>
    public static string? RootProblem(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "Enter a folder path.";
        if (OperatingSystem.IsWindows() && path.Length >= 2 && char.IsLetter(path[0]) && path[1] == ':')
        {
            try
            {
                var di = new DriveInfo(path[..1]);
                if (di.DriveType == DriveType.Network)
                    return $"{path[..2]} is a mapped network drive. Mapped drive letters belong to one signed-in user, so the WavWiz service cannot see them. Use the folder's real path on the server PC (e.g. D:\\Music) or a UNC path (\\\\SERVER\\Music).";
            }
            catch { }
        }
        if (!Directory.Exists(path)) return "That folder does not exist (or the WavWiz service account cannot read it).";
        try { using var e = Directory.EnumerateFileSystemEntries(path).GetEnumerator(); e.MoveNext(); }
        catch (UnauthorizedAccessException) { return "The WavWiz service account (LocalService) is not allowed to read that folder. Give it read access, or choose another folder."; }
        catch (Exception ex) { return "Cannot read that folder: " + ex.Message; }
        return null;
    }

    public long AddRoot(string path)
    {
        var p = path.Length > 3 ? path.TrimEnd('\\', '/') : path;
        var err = RootProblem(p); if (err != null) throw new InvalidOperationException(err);
        _db.Exec("INSERT OR IGNORE INTO library_root(path) VALUES($p)", ("$p", p));
        return Convert.ToInt64(_db.Scalar("SELECT id FROM library_root WHERE path=$p", ("$p", p)));
    }

    public void RemoveRoot(long id)
    {
        _db.Exec("DELETE FROM track WHERE root_id=$i", ("$i", id));
        _db.Exec("DELETE FROM library_root WHERE id=$i", ("$i", id));
    }

    public List<object> Roots() => _db.Query("SELECT id,path,enabled,last_scan_at,last_error,(SELECT COUNT(*) FROM track WHERE root_id=library_root.id AND missing=0) FROM library_root ORDER BY path",
        r => (object)new { id = r.GetInt64(0), path = r.GetString(1), enabled = r.GetInt32(2) != 0, lastScanAt = r.IsDBNull(3) ? null : r.GetString(3), lastError = r.IsDBNull(4) ? null : r.GetString(4), tracks = r.GetInt32(5) });

    public ScanResult Scan(CancellationToken ct = default)
    {
        if (Scanning) return new ScanResult(0, 0, 0, 0, 0, TimeSpan.Zero, new List<string> { "A scan is already running." });
        Scanning = true;
        var sw = Stopwatch.StartNew(); var msgs = new List<string>(); int added = 0, updated = 0, same = 0, missing = 0, errors = 0;
        var oldPriority = Thread.CurrentThread.Priority;
        var aliases = Aliases();
        try
        {
            Thread.CurrentThread.Priority = ThreadPriority.BelowNormal;       // a rescan must never cause underruns in the server PC's own room (spec 9.4)
            var roots = _db.Query("SELECT id,path FROM library_root WHERE enabled=1", r => (Id: r.GetInt64(0), Path: r.GetString(1)));
            foreach (var root in roots)
            {
                if (ct.IsCancellationRequested) break;
                var problem = RootProblem(root.Path);
                if (problem != null)
                {
                    msgs.Add($"{root.Path}: {problem}"); errors++;
                    _db.Exec("UPDATE library_root SET last_error=$e WHERE id=$i", ("$e", problem), ("$i", root.Id));
                    continue;        // an unreachable root is NOT treated as "all files deleted"
                }
                var existing = _db.Query("SELECT path,size,mtime FROM track WHERE root_id=$r", r => (Path: r.GetString(0), Size: r.GetInt64(1), Mtime: r.GetInt64(2)), ("$r", root.Id))
                    .ToDictionary(x => x.Path, x => (x.Size, x.Mtime), StringComparer.Ordinal);
                var upgrade = _db.Query("SELECT path FROM track WHERE root_id=$r AND folder=''", r => r.GetString(0), ("$r", root.Id)).ToHashSet(StringComparer.Ordinal);   // rows from a 0.0.1 database: re-read once so tags, art and folder fill in
                var seen = new HashSet<string>(StringComparer.Ordinal);
                var files = new List<FileInfo>();
                try
                {
                    foreach (var f in new DirectoryInfo(root.Path).EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System }))
                        if (Extensions.Contains(f.Extension)) files.Add(f);
                }
                catch (Exception e) { msgs.Add($"{root.Path}: {e.Message}"); errors++; continue; }
                using var c = _db.Open();
                int n = 0;
                foreach (var f in files)
                {
                    if (ct.IsCancellationRequested) break;
                    seen.Add(f.FullName);
                    long mtime = f.LastWriteTimeUtc.Ticks / TimeSpan.TicksPerSecond;
                    if (existing.TryGetValue(f.FullName, out var ex) && ex.Size == f.Length && ex.Mtime == mtime && !upgrade.Contains(f.FullName)) { same++; }
                    else
                    {
                        try { Upsert(c, root.Id, f, mtime, existing.ContainsKey(f.FullName), aliases); if (existing.ContainsKey(f.FullName)) updated++; else added++; }
                        catch (Exception e) { errors++; if (msgs.Count < 20) msgs.Add($"{f.FullName}: {e.Message}"); }
                    }
                    if (++n % 200 == 0) { Progress = (n, files.Count, root.Path); ScanProgress?.Invoke(new { done = n, total = files.Count, root = root.Path }); }
                }
                if (!ct.IsCancellationRequested)
                    foreach (var gone in existing.Keys.Where(k => !seen.Contains(k)))
                    {
                        Db.Exec(c, "UPDATE track SET missing=1 WHERE path=$p", null, ("$p", gone)); missing++;
                    }
                Db.Exec(c, "UPDATE library_root SET last_scan_at=$t, last_error=NULL WHERE id=$i", null, ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", root.Id));
            }
        }
        finally { Thread.CurrentThread.Priority = oldPriority; Scanning = false; Progress = null; }
        ScanProgress?.Invoke(new { done = 0, total = 0, root = "", finished = true });
        return new ScanResult(added, updated, same, missing, errors, sw.Elapsed, msgs);
    }

    private static void Upsert(SqliteConnection c, long rootId, FileInfo f, long mtime, bool exists, Dictionary<string, string> aliases)
    {
        string title = Path.GetFileNameWithoutExtension(f.Name), artist = "Unknown Artist", album = "Unknown Album", albumArtist = "", genre = "", codec = f.Extension.TrimStart('.').ToLowerInvariant();
        int? trackNo = null, disc = null, year = null, sr = null, ch = null, br = null; long dur = 0; int flags = 0, art = 0;
        using (var tf = TagLib.File.Create(f.FullName, TagLib.ReadStyle.Average))      // read-only open
        {
            var t = tf.Tag;
            if (!string.IsNullOrWhiteSpace(t.Title)) title = t.Title.Trim(); else flags |= TagFlags.Title;
            if (t.Performers.Length > 0 && !string.IsNullOrWhiteSpace(t.Performers[0])) artist = t.Performers[0].Trim(); else flags |= TagFlags.Artist;
            if (!string.IsNullOrWhiteSpace(t.Album)) album = t.Album.Trim(); else flags |= TagFlags.Album;
            albumArtist = t.AlbumArtists.Length > 0 && !string.IsNullOrWhiteSpace(t.AlbumArtists[0]) ? t.AlbumArtists[0].Trim() : artist;
            if (t.Genres.Length > 0 && !string.IsNullOrWhiteSpace(t.Genres[0])) genre = t.Genres[0].Trim(); else flags |= TagFlags.Genre;
            if (t.Track > 0) trackNo = (int)t.Track; else flags |= TagFlags.TrackNo;
            if (t.Disc > 0) disc = (int)t.Disc; if (t.Year > 0) year = (int)t.Year; else flags |= TagFlags.Year;
            try { if (t.Pictures.Length > 0) art = 1; } catch { }
            dur = (long)tf.Properties.Duration.TotalMilliseconds; sr = tf.Properties.AudioSampleRate; ch = tf.Properties.AudioChannels; br = tf.Properties.AudioBitrate;
            if (!string.IsNullOrWhiteSpace(tf.Properties.Description)) codec = tf.Properties.Description;
        }
        string rawArtist = artist, rawAlbumArtist = albumArtist;
        if (aliases.TryGetValue(artist, out var ca)) artist = ca; if (aliases.TryGetValue(albumArtist, out var cb)) albumArtist = cb;
        var search = string.Join(' ', title, artist, albumArtist, album, genre).ToLowerInvariant();
        Db.Exec(c, """
            INSERT INTO track(path,root_id,size,mtime,title,artist,album_artist,album,track_no,disc_no,duration_ms,codec,sample_rate,channels,bitrate,genre,year,added_at,missing,search,raw_artist,raw_album_artist,folder,has_art,tag_flags)
            VALUES($p,$r,$s,$m,$ti,$ar,$aa,$al,$tn,$dn,$du,$co,$sr,$ch,$br,$ge,$ye,$ad,0,$se,$ra,$rb,$fo,$hx,$tg)
            ON CONFLICT(path) DO UPDATE SET root_id=$r,size=$s,mtime=$m,title=$ti,artist=$ar,album_artist=$aa,album=$al,track_no=$tn,disc_no=$dn,duration_ms=$du,codec=$co,
              sample_rate=$sr,channels=$ch,bitrate=$br,genre=$ge,year=$ye,missing=0,search=$se,raw_artist=$ra,raw_album_artist=$rb,folder=$fo,has_art=$hx,tag_flags=$tg
            """, null, ("$p", f.FullName), ("$r", rootId), ("$s", f.Length), ("$m", mtime), ("$ti", title), ("$ar", artist), ("$aa", albumArtist), ("$al", album), ("$tn", trackNo), ("$dn", disc),
            ("$du", dur), ("$co", codec), ("$sr", sr), ("$ch", ch), ("$br", br), ("$ge", genre), ("$ye", year), ("$ad", DateTimeOffset.UtcNow.ToString("O")), ("$se", search), ("$ra", rawArtist), ("$rb", rawAlbumArtist), ("$fo", f.DirectoryName ?? ""), ("$hx", art), ("$tg", flags));
    }

    // ---------- queries ----------
    private const string Cols = "id,path,title,artist,album_artist,album,track_no,disc_no,duration_ms,codec,sample_rate,genre,year,missing";
    private static TrackRow Map(SqliteDataReader r) => new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetString(5),
        r.IsDBNull(6) ? null : r.GetInt32(6), r.IsDBNull(7) ? null : r.GetInt32(7), r.GetInt64(8), r.IsDBNull(9) ? null : r.GetString(9), r.IsDBNull(10) ? null : r.GetInt32(10),
        r.IsDBNull(11) ? null : r.GetString(11), r.IsDBNull(12) ? null : r.GetInt32(12), r.GetInt32(13) != 0);

    public TrackRow? Track(long id) => _db.Query($"SELECT {Cols} FROM track WHERE id=$i", Map, ("$i", id)).FirstOrDefault();
    public bool NeedsUpgradeScan() => Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM track WHERE folder='' AND missing=0")) > 0;
    public int TrackCount() => Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM track WHERE missing=0"));

    public List<TrackRow> Search(string q, int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 500);
        var terms = q.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToArray();
        if (terms.Length == 0) return new();
        var where = string.Join(" AND ", terms.Select((_, i) => $"search LIKE $t{i} ESCAPE '\\'"));
        var ps = terms.Select((t, i) => ($"$t{i}", (object?)("%" + t.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%"))).ToArray();
        return _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND {where} ORDER BY artist, album, disc_no, track_no LIMIT {limit}", Map, ps);
    }

    public List<TrackRow> Recent(int limit = 50) => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 ORDER BY added_at DESC, id DESC LIMIT {Math.Clamp(limit, 1, 500)}", Map);
    public List<TrackRow> ByAlbum(string artist, string album) => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND album=$al AND (album_artist=$ar OR artist=$ar) ORDER BY disc_no, track_no, title", Map, ("$al", album), ("$ar", artist));
    public List<TrackRow> ByArtist(string artist) => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND (artist=$ar OR album_artist=$ar) ORDER BY album, disc_no, track_no", Map, ("$ar", artist));
    public List<TrackRow> ByGenre(string genre) => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND genre=$g ORDER BY artist, album, disc_no, track_no", Map, ("$g", genre));

    /// <summary>WMP-style tree (spec 10.1): Artists > Albums > Tracks, Albums, Genres, Recently added.</summary>
    public object Tree(string? node)
    {
        switch (node)
        {
            case null or "" or "root":
                return new { nodes = new object[] {
                    new { id = "artists", title = "Artists", count = Convert.ToInt32(_db.Scalar("SELECT COUNT(DISTINCT album_artist) FROM track WHERE missing=0")) },
                    new { id = "albums", title = "Albums", count = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM (SELECT DISTINCT album_artist,album FROM track WHERE missing=0)")) },
                    new { id = "genres", title = "Genres", count = Convert.ToInt32(_db.Scalar("SELECT COUNT(DISTINCT genre) FROM track WHERE missing=0 AND genre<>''")) },
                    new { id = "recent", title = "Recently added", count = Math.Min(50, TrackCount()) } }, tracks = Array.Empty<TrackRow>() };
            case "artists":
                return new { nodes = _db.Query("SELECT album_artist,COUNT(*) FROM track WHERE missing=0 GROUP BY album_artist ORDER BY album_artist COLLATE NOCASE", r => (object)new { id = "artist:" + r.GetString(0), title = r.GetString(0), count = r.GetInt32(1) }), tracks = Array.Empty<TrackRow>() };
            case "albums":
                return new { nodes = _db.Query("SELECT album_artist,album,COUNT(*) FROM track WHERE missing=0 GROUP BY album_artist,album ORDER BY album COLLATE NOCASE", r => (object)new { id = "album:" + r.GetString(0) + "\u001f" + r.GetString(1), title = r.GetString(1), subtitle = r.GetString(0), count = r.GetInt32(2) }), tracks = Array.Empty<TrackRow>() };
            case "genres":
                return new { nodes = _db.Query("SELECT genre,COUNT(*) FROM track WHERE missing=0 AND genre<>'' GROUP BY genre ORDER BY genre COLLATE NOCASE", r => (object)new { id = "genre:" + r.GetString(0), title = r.GetString(0), count = r.GetInt32(1) }), tracks = Array.Empty<TrackRow>() };
            case "recent": return new { nodes = Array.Empty<object>(), tracks = Recent() };
        }
        if (node.StartsWith("artist:"))
        {
            var a = node[7..];
            return new { nodes = _db.Query("SELECT album,COUNT(*) FROM track WHERE missing=0 AND (album_artist=$a OR artist=$a) GROUP BY album ORDER BY album COLLATE NOCASE", r => (object)new { id = "album:" + a + "\u001f" + r.GetString(0), title = r.GetString(0), count = r.GetInt32(1) }, ("$a", a)), tracks = Array.Empty<TrackRow>() };
        }
        if (node.StartsWith("album:")) { var p = node[6..].Split('\u001f'); return new { nodes = Array.Empty<object>(), tracks = p.Length == 2 ? ByAlbum(p[0], p[1]) : new List<TrackRow>() }; }
        if (node.StartsWith("genre:")) return new { nodes = Array.Empty<object>(), tracks = ByGenre(node[6..]) };
        return new { nodes = Array.Empty<object>(), tracks = Array.Empty<TrackRow>() };
    }
}
