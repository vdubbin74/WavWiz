using System.Globalization;
using System.Text;
using Microsoft.Data.Sqlite;
namespace WavWiz.Server.Library;

public static class TagFlags { public const int Title = 1, Artist = 2, Album = 4, Genre = 8, Year = 16, TrackNo = 32;
    public static List<string> Names(int f) { var l = new List<string>(); if ((f & Title) != 0) l.Add("title"); if ((f & Artist) != 0) l.Add("artist"); if ((f & Album) != 0) l.Add("album"); if ((f & Genre) != 0) l.Add("genre"); if ((f & Year) != 0) l.Add("year"); if ((f & TrackNo) != 0) l.Add("track number"); return l; } }

public sealed record ArtistRow(string Name, int Albums, int Tracks, long ArtTrackId, string? AddedAt = null);   // 0.2.0 item 13: AddedAt for "recently added" sorting
public sealed record AlbumRow(string Artist, string Album, int? Year, int Tracks, long DurationMs, long ArtTrackId, string AddedAt, string? Genre);
public sealed record NameCount(string Name, int Tracks, int Albums, long[]? ArtTrackIds = null);   // 0.2.1 F4/F13: up to 4 album covers for the genre / year tiles

/// <summary>Tag-based browsing (0.0.2): Artist / Album / Genre / Year / Recently added never depend on which folder the files are in. Folders are a separate view.</summary>
public sealed partial class LibraryService
{
    private static string Like(string t) => "%" + t.ToLowerInvariant().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    public List<ArtistRow> Artists(string? q = null, int limit = 5000)
    {
        var where = string.IsNullOrWhiteSpace(q) ? "" : " AND LOWER(album_artist) LIKE $q ESCAPE '\\'";
        return _db.Query($"SELECT album_artist, COUNT(DISTINCT album), COUNT(*), MIN(id), MAX(added_at) FROM track WHERE missing=0{where} GROUP BY album_artist ORDER BY album_artist COLLATE NOCASE LIMIT {Math.Clamp(limit, 1, 20000)}",
            r => new ArtistRow(r.GetString(0), r.GetInt32(1), r.GetInt32(2), r.GetInt64(3), r.IsDBNull(4) ? null : r.GetString(4)), string.IsNullOrWhiteSpace(q) ? Array.Empty<(string, object?)>() : new[] { ("$q", (object?)Like(q!)) });
    }

    /// <summary>Albums, optionally filtered. sort = name | year | recent | artist.</summary>
    public List<AlbumRow> Albums(string? artist = null, string? genre = null, int? year = null, string? q = null, string sort = "artist", int limit = 3000, int offset = 0)
    {
        var w = new List<string> { "missing=0" }; var ps = new List<(string, object?)>();
        if (!string.IsNullOrEmpty(artist)) { w.Add("album_artist=$ar"); ps.Add(("$ar", artist)); }
        if (!string.IsNullOrEmpty(genre)) { w.Add("genre=$ge"); ps.Add(("$ge", genre)); }
        if (year != null) { w.Add("year=$ye"); ps.Add(("$ye", year)); }
        if (!string.IsNullOrWhiteSpace(q)) { w.Add("(LOWER(album) LIKE $q ESCAPE '\\' OR LOWER(album_artist) LIKE $q ESCAPE '\\')"); ps.Add(("$q", Like(q!))); }
        var order = sort switch { "name" => "album COLLATE NOCASE", "year" => "MAX(year) DESC, album COLLATE NOCASE", "recent" => "MAX(added_at) DESC", _ => "album_artist COLLATE NOCASE, MAX(year), album COLLATE NOCASE" };
        return _db.Query($"SELECT album_artist, album, MAX(year), COUNT(*), SUM(duration_ms), MIN(id), MAX(added_at), MIN(NULLIF(genre,'')) FROM track WHERE {string.Join(" AND ", w)} GROUP BY album_artist, album ORDER BY {order} LIMIT {Math.Clamp(limit, 1, 20000)} OFFSET {Math.Max(0, offset)}",
            r => new AlbumRow(r.GetString(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetInt32(2), r.GetInt32(3), r.IsDBNull(4) ? 0 : r.GetInt64(4), r.GetInt64(5), r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7)), ps.ToArray());
    }

    // ---- 0.2.0 item 14: favorites (hearts) stored on the server, so they follow you to every browser. kind = track | album.
    // A track's ref is its id; an album's ref is "<album artist>\u001f<album>" (the same key the album pages use).
    public static readonly string[] FavoriteKinds = { "track", "album" };
    public List<(string Kind, string Ref)> Favorites() => _db.Query("SELECT kind, ref FROM favorite ORDER BY created_at DESC", r => (r.GetString(0), r.GetString(1)));
    public string? SetFavorite(string? kind, string? reference, bool on)
    {
        if (kind == null || !FavoriteKinds.Contains(kind)) return "kind must be track or album";
        if (string.IsNullOrWhiteSpace(reference) || reference.Length > 1000) return "ref is required";
        if (kind == "track" && !long.TryParse(reference, NumberStyles.None, CultureInfo.InvariantCulture, out _)) return "a track ref is its id";
        if (on) _db.Exec("INSERT OR IGNORE INTO favorite(kind, ref, created_at) VALUES($k, $r, $t)", ("$k", kind), ("$r", reference), ("$t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)));
        else _db.Exec("DELETE FROM favorite WHERE kind=$k AND ref=$r", ("$k", kind), ("$r", reference));
        return null;
    }
    /// <summary>Hearted songs and albums that are still in the library (newest heart first).</summary>
    public (List<TrackRow> Tracks, List<AlbumRow> Albums) FavoriteItems()
    {
        var tracks = _db.Query($"SELECT {Cols} FROM track JOIN favorite f ON f.kind='track' AND f.ref=CAST(track.id AS TEXT) WHERE missing=0 ORDER BY f.created_at DESC", Map);
        var albums = new List<AlbumRow>();
        foreach (var (_, r) in Favorites().Where(f => f.Kind == "album"))
        {
            var i = r.IndexOf('\u001f'); if (i < 0) continue;
            var ar = r[..i]; var al = r[(i + 1)..];
            var row = _db.Query("SELECT album_artist, album, MAX(year), COUNT(*), SUM(duration_ms), MIN(id), MAX(added_at), MIN(NULLIF(genre,'')) FROM track WHERE missing=0 AND album_artist=$ar AND album=$al GROUP BY album_artist, album",
                x => new AlbumRow(x.GetString(0), x.GetString(1), x.IsDBNull(2) ? null : x.GetInt32(2), x.GetInt32(3), x.IsDBNull(4) ? 0 : x.GetInt64(4), x.GetInt64(5), x.GetString(6), x.IsDBNull(7) ? null : x.GetString(7)), ("$ar", ar), ("$al", al));
            albums.AddRange(row);
        }
        return (tracks, albums);
    }

    public List<NameCount> Genres()
    {
        var art = CoverSamples("genre", "genre<>''");
        return _db.Query("SELECT genre, COUNT(*), COUNT(DISTINCT album_artist||char(31)||album) FROM track WHERE missing=0 AND genre<>'' GROUP BY genre ORDER BY genre COLLATE NOCASE", r => new NameCount(r.GetString(0), r.GetInt32(1), r.GetInt32(2), art.GetValueOrDefault(r.GetString(0))));
    }
    public List<NameCount> Years()
    {
        var art = CoverSamples("CAST(year AS TEXT)", "year IS NOT NULL");
        return _db.Query("SELECT year, COUNT(*), COUNT(DISTINCT album_artist||char(31)||album) FROM track WHERE missing=0 AND year IS NOT NULL GROUP BY year ORDER BY year DESC", r => { var y = r.GetInt32(0).ToString(CultureInfo.InvariantCulture); return new NameCount(y, r.GetInt32(1), r.GetInt32(2), art.GetValueOrDefault(y)); });
    }
    /// <summary>0.2.1 F4/F13: for each group key, the first track of up to <paramref name="max"/> albums (albums with a cover first) - the covers a
    /// genre / year / folder tile shows as a collage or mosaic.</summary>
    private Dictionary<string, long[]> CoverSamples(string keyExpr, string where, int max = 4)
    {
        var rows = _db.Query($"SELECT {keyExpr}, MIN(id), MAX(has_art) FROM track WHERE missing=0 AND {where} GROUP BY {keyExpr}, album_artist, album ORDER BY MAX(has_art) DESC, MAX(added_at) DESC",
            r => (K: r.IsDBNull(0) ? "" : r.GetString(0), Id: r.GetInt64(1)));
        var d = new Dictionary<string, List<long>>(StringComparer.Ordinal);
        foreach (var (k, id) in rows) { if (!d.TryGetValue(k, out var l)) d[k] = l = new List<long>(); if (l.Count < max) l.Add(id); }
        return d.ToDictionary(x => x.Key, x => x.Value.ToArray(), StringComparer.Ordinal);
    }
    /// <summary>Album covers under a folder tree, grouped by the child folder name right below <paramref name="prefix"/> (or by root when prefix is null).</summary>
    private Dictionary<string, long[]> FolderCovers(string? prefix, IEnumerable<string>? roots = null, int max = 4)
    {
        var d = new Dictionary<string, List<long>>(StringComparer.OrdinalIgnoreCase);
        void add(string k, long id) { if (!d.TryGetValue(k, out var l)) d[k] = l = new List<long>(); if (l.Count < max) l.Add(id); }
        if (prefix == null)
        {
            foreach (var r in roots ?? Array.Empty<string>())
                foreach (var id in _db.Query("SELECT MIN(id) FROM track WHERE missing=0 AND (folder=$p OR folder LIKE $l ESCAPE '\\') GROUP BY album_artist, album ORDER BY MAX(has_art) DESC, MAX(added_at) DESC LIMIT $m", x => x.GetInt64(0), ("$p", r), ("$l", EscapeLike(r) + "%"), ("$m", max))) add(r, id);
        }
        else
        {
            var rows = _db.Query("SELECT folder, MIN(id) FROM track WHERE missing=0 AND folder LIKE $l ESCAPE '\\' GROUP BY folder, album_artist, album ORDER BY MAX(has_art) DESC, MAX(added_at) DESC", x => (F: x.GetString(0), Id: x.GetInt64(1)), ("$l", EscapeLike(prefix) + "%"));
            foreach (var (f, id) in rows) { var seg = f[prefix.Length..].Split('\\', '/')[0]; if (seg.Length > 0) add(seg, id); }
        }
        return d.ToDictionary(x => x.Key, x => x.Value.ToArray(), StringComparer.OrdinalIgnoreCase);
    }

    public List<TrackRow> ByAlbumKey(string albumArtist, string album) => ByAlbum(albumArtist, album);
    public List<TrackRow> ByYear(int year) => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND year=$y ORDER BY album_artist, album, disc_no, track_no", Map, ("$y", year));

    public List<TrackRow> Tracks(string? artist, string? album, string? genre, int? year, int limit = 5000)
    {
        var w = new List<string> { "missing=0" }; var ps = new List<(string, object?)>();
        if (!string.IsNullOrEmpty(artist)) { w.Add("(album_artist=$ar OR artist=$ar)"); ps.Add(("$ar", artist)); }
        if (!string.IsNullOrEmpty(album)) { w.Add("album=$al"); ps.Add(("$al", album)); }
        if (!string.IsNullOrEmpty(genre)) { w.Add("genre=$ge"); ps.Add(("$ge", genre)); }
        if (year != null) { w.Add("year=$ye"); ps.Add(("$ye", year)); }
        return _db.Query($"SELECT {Cols} FROM track WHERE {string.Join(" AND ", w)} ORDER BY album_artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, title COLLATE NOCASE LIMIT {Math.Clamp(limit, 1, 20000)}", Map, ps.ToArray());
    }

    /// <summary>Search across songs, albums and artists.</summary>
    public (List<TrackRow> Tracks, List<AlbumRow> Albums, List<ArtistRow> Artists) Find(string q)
    {
        q = (q ?? "").Trim(); if (q.Length == 0) return (new(), new(), new());
        return (Search(q, 40), Albums(q: q, sort: "name", limit: 30), Artists(q, 30));
    }

    public TrackRow? FirstTrackOfAlbum(string albumArtist, string album)
        => _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND album_artist=$ar AND album=$al ORDER BY has_art DESC, disc_no, track_no LIMIT 1", Map, ("$ar", albumArtist), ("$al", album)).FirstOrDefault();

    // ---------------- folders (an extra view; everything else ignores the folder) ----------------
    public object Folders(string? path)
    {
        var roots = _db.Query("SELECT path FROM library_root WHERE enabled=1 ORDER BY path", r => r.GetString(0));
        if (string.IsNullOrEmpty(path)) { var rc = FolderCovers(null, roots); return new { path = "", parent = (string?)null, folders = roots.Select(r => new { name = r, path = r, tracks = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM track WHERE missing=0 AND (folder=$p OR folder LIKE $l ESCAPE '\\')", ("$p", r), ("$l", EscapeLike(r) + "%"))), artTrackIds = rc.GetValueOrDefault(r) ?? Array.Empty<long>() }).ToList(), tracks = new List<TrackRow>() }; }
        char sep = path.Contains('\\') && !path.Contains('/') ? '\\' : (path.Contains('/') ? '/' : System.IO.Path.DirectorySeparatorChar);
        string prefix = path.TrimEnd('\\', '/') + sep;
        var rows = _db.Query("SELECT folder, COUNT(*) FROM track WHERE missing=0 AND folder LIKE $l ESCAPE '\\' GROUP BY folder", r => (F: r.GetString(0), N: r.GetInt32(1)), ("$l", EscapeLike(prefix) + "%"));
        var kids = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var (f, n) in rows) { var rest = f[prefix.Length..]; var seg = rest.Split('\\', '/')[0]; if (seg.Length == 0) continue; kids[seg] = kids.GetValueOrDefault(seg) + n; }
        var tracks = _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND folder=$p ORDER BY disc_no, track_no, title COLLATE NOCASE", Map, ("$p", path.TrimEnd('\\', '/')));
        string? parent = null;
        if (!roots.Contains(path.TrimEnd('\\', '/'), StringComparer.OrdinalIgnoreCase)) { var pr = System.IO.Path.GetDirectoryName(path.TrimEnd('\\', '/')); parent = string.IsNullOrEmpty(pr) ? "" : pr; } else parent = "";
        var covers = FolderCovers(prefix);
        return new { path, parent, folders = kids.Select(k => new { name = k.Key, path = prefix + k.Key, tracks = k.Value, artTrackIds = covers.GetValueOrDefault(k.Key) ?? Array.Empty<long>() }).ToList(), tracks };
    }
    private static string EscapeLike(string x) => x.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
    public List<TrackRow> TracksInFolderTree(string path)
    {
        var p = path.TrimEnd('\\', '/'); char sep = p.Contains('\\') && !p.Contains('/') ? '\\' : '/';
        return _db.Query($"SELECT {Cols} FROM track WHERE missing=0 AND (folder=$p OR folder LIKE $l ESCAPE '\\') ORDER BY folder, disc_no, track_no, title COLLATE NOCASE LIMIT 20000", Map, ("$p", p), ("$l", EscapeLike(p + sep) + "%"));
    }

    // ---------------- cleanup ----------------
    public Dictionary<string, string> Aliases() => _db.Query("SELECT name, canonical FROM artist_alias", r => (r.GetString(0), r.GetString(1))).ToDictionary(x => x.Item1, x => x.Item2, StringComparer.Ordinal);

    public static string NormalizeName(string name)
    {
        var s = name.Normalize(NormalizationForm.FormD); var sb = new StringBuilder();
        foreach (var ch in s) { var cat = CharUnicodeInfo.GetUnicodeCategory(ch); if (cat == UnicodeCategory.NonSpacingMark) continue; sb.Append(char.ToLowerInvariant(ch)); }
        var t = sb.ToString().Replace("&", " and ").Replace("+", " and ");
        t = new string(t.Select(c => char.IsLetterOrDigit(c) ? c : ' ').ToArray());
        var words = t.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (words.Count > 1 && words[0] is "the" or "a" or "an" && words.Count > 1) words.RemoveAt(0);
        return string.Join(' ', words);
    }

    public sealed record CleanupVariant(string Name, int Tracks, bool IsAlias);
    public sealed record CleanupGroup(string Key, string Suggested, List<CleanupVariant> Variants);

    public object Cleanup(int sample = 200)
    {
        var raw = _db.Query("SELECT COALESCE(raw_album_artist,album_artist), COUNT(*) FROM track WHERE missing=0 GROUP BY COALESCE(raw_album_artist,album_artist)", r => (N: r.GetString(0), C: r.GetInt32(1)));
        raw.AddRange(_db.Query("SELECT COALESCE(raw_artist,artist), COUNT(*) FROM track WHERE missing=0 GROUP BY COALESCE(raw_artist,artist)", r => (N: r.GetString(0), C: r.GetInt32(1))));
        var aliases = Aliases();
        var perName = raw.GroupBy(x => x.N, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Max(x => x.C), StringComparer.Ordinal);
        var groups = new List<CleanupGroup>();
        foreach (var g in perName.GroupBy(kv => NormalizeName(kv.Key)).Where(g => g.Key.Length > 0 && g.Select(kv => aliases.GetValueOrDefault(kv.Key, kv.Key)).Distinct(StringComparer.Ordinal).Count() > 1))
        {
            var best = g.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key.StartsWith("The ", StringComparison.Ordinal) ? 0 : 1).First().Key;
            groups.Add(new CleanupGroup(g.Key, best, g.OrderByDescending(kv => kv.Value).Select(kv => new CleanupVariant(kv.Key, kv.Value, aliases.ContainsKey(kv.Key))).ToList()));
        }
        int Count(string flagCol) => Convert.ToInt32(_db.Scalar($"SELECT COUNT(*) FROM track WHERE missing=0 AND (tag_flags & {flagCol}) <> 0"));
        var missingCounts = new { title = Count("1"), artist = Count("2"), album = Count("4"), genre = Count("8"), year = Count("16"), trackNo = Count("32") };
        var missing = _db.Query($"SELECT id,path,title,artist,album,tag_flags FROM track WHERE missing=0 AND (tag_flags & 31) <> 0 ORDER BY (tag_flags & 6) DESC, path LIMIT {Math.Clamp(sample, 1, 2000)}",
            r => new { id = r.GetInt64(0), path = r.GetString(1), title = r.GetString(2), artist = r.GetString(3), album = r.GetString(4), missing = TagFlags.Names(r.GetInt32(5) & 31) });
        var withFlags = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM track WHERE missing=0 AND (tag_flags & 31) <> 0"));
        var unscanned = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM track WHERE missing=0 AND raw_artist IS NULL"));
        return new { duplicateArtists = groups.OrderByDescending(g => g.Variants.Sum(v => v.Tracks)).Take(300).ToList(), missingCounts, missingSample = missing, tracksWithProblems = withFlags, aliases = aliases.Select(a => new { from = a.Key, to = a.Value }).OrderBy(a => a.from, StringComparer.OrdinalIgnoreCase).ToList(), unscanned };
    }

    /// <summary>Show every spelling in <paramref name="from"/> as <paramref name="to"/>. The files are never changed; remove the alias to undo.</summary>
    public string? AddAlias(string from, string to)
    {
        from = (from ?? "").Trim(); to = (to ?? "").Trim();
        if (from.Length is 0 or > 200 || to.Length is 0 or > 200) return "names must be 1-200 characters";
        if (from == to) return "that is already the name";
        // chain protection: 'to' must not itself be an alias source
        if (Aliases().ContainsKey(to)) return $"\"{to}\" is already merged into another name - pick that final name instead.";
        _db.Exec("INSERT INTO artist_alias(name,canonical) VALUES($f,$t) ON CONFLICT(name) DO UPDATE SET canonical=$t", ("$f", from), ("$t", to));
        _db.Exec("UPDATE artist_alias SET canonical=$t WHERE canonical=$f", ("$f", from), ("$t", to));
        ReapplyAliases(); return null;
    }

    public void RemoveAlias(string from) { _db.Exec("DELETE FROM artist_alias WHERE name=$f", ("$f", from)); ReapplyAliases(); }

    private void ReapplyAliases()
    {
        using var c = _db.Open(); using var tx = c.BeginTransaction();
        Db.Exec(c, "UPDATE track SET artist=COALESCE(raw_artist,artist), album_artist=COALESCE(raw_album_artist,album_artist) WHERE raw_artist IS NOT NULL", tx);
        Db.Exec(c, "UPDATE track SET artist=(SELECT canonical FROM artist_alias WHERE name=track.artist) WHERE artist IN (SELECT name FROM artist_alias)", tx);
        Db.Exec(c, "UPDATE track SET album_artist=(SELECT canonical FROM artist_alias WHERE name=track.album_artist) WHERE album_artist IN (SELECT name FROM artist_alias)", tx);
        var rows = Db.Query(c, "SELECT id,title,artist,album_artist,album,COALESCE(genre,'') FROM track", r => (Id: r.GetInt64(0), S: string.Join(' ', r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetString(5)).ToLowerInvariant()));
        foreach (var (id, search) in rows) Db.Exec(c, "UPDATE track SET search=$s WHERE id=$i", tx, ("$s", search), ("$i", id));
        tx.Commit();
    }
}
