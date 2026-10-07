using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>B9 / 0.0.5: MusicBrainz + Cover Art Archive + optional AcoustID/Chromaprint tag/cover fills; approve before write; undoable.</summary>
public sealed class TagFixService
{
    private readonly Db _db;
    private readonly Library.LibraryService _lib;
    private readonly Library.ArtService _art;
    private readonly EventHub _ev;
    private readonly string _ffmpeg;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    public TagFixService(Db db, Library.LibraryService lib, Library.ArtService art, EventHub ev, string ffmpeg)
    {
        _db = db; _lib = lib; _art = art; _ev = ev; _ffmpeg = ffmpeg; _ = _art; _ = _lib;
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("WavWiz/0.0.5 (home LAN tag fixer; +https://github.com/vdubbin74/wavwiz)");
    }

    public object Status()
    {
        var key = ApiKey();
        return new
        {
            acoustIdConfigured = !string.IsNullOrWhiteSpace(key),
            chromaprintAvailable = FindFpcalc() != null,
            note = string.IsNullOrWhiteSpace(key)
                ? "Set acoustid.apiKey in Settings > Library to enable fingerprint lookup. MusicBrainz text search still works without it."
                : FindFpcalc() == null
                    ? "AcoustID key is set, but Chromaprint fpcalc was not found next to FFmpeg. Text search still works; install fpcalc for fingerprint lookup."
                    : "AcoustID + Chromaprint ready.",
        };
    }

    public object Jobs() => _db.Query("SELECT id,status,write_files,created_at,applied_at,undone_at,summary FROM tag_fix_job ORDER BY id DESC LIMIT 50",
        r => new { id = r.GetInt64(0), status = r.GetString(1), writeFiles = r.GetInt32(2) != 0, createdAt = r.GetString(3), appliedAt = r.IsDBNull(4) ? null : r.GetString(4), undoneAt = r.IsDBNull(5) ? null : r.GetString(5), summary = r.IsDBNull(6) ? null : r.GetString(6) });

    public object? Job(long id)
    {
        var j = _db.Query("SELECT id,status,write_files,created_at,applied_at,undone_at,summary FROM tag_fix_job WHERE id=$i",
            r => new { id = r.GetInt64(0), status = r.GetString(1), writeFiles = r.GetInt32(2) != 0, createdAt = r.GetString(3), appliedAt = r.IsDBNull(4) ? null : r.GetString(4), undoneAt = r.IsDBNull(5) ? null : r.GetString(5), summary = r.IsDBNull(6) ? null : r.GetString(6) }, ("$i", id)).FirstOrDefault();
        if (j == null) return null;
        var items = _db.Query("SELECT id,track_id,field,old_value,new_value,art_url,approved,applied FROM tag_fix_item WHERE job_id=$j ORDER BY id",
            r => new { id = r.GetInt64(0), trackId = r.GetInt64(1), field = r.GetString(2), oldValue = r.IsDBNull(3) ? null : r.GetString(3), newValue = r.IsDBNull(4) ? null : r.GetString(4), artUrl = r.IsDBNull(5) ? null : r.GetString(5), approved = r.GetInt32(6) != 0, applied = r.GetInt32(7) != 0 }, ("$j", id));
        return new { j.id, j.status, j.writeFiles, j.createdAt, j.appliedAt, j.undoneAt, j.summary, items };
    }

    /// <summary>Scan tracks missing artist/album/title/art. Prefers AcoustID fingerprint when key + fpcalc exist; else MusicBrainz text query.</summary>
    public async Task<object> ScanAsync(int limit = 40, bool writeFilesDefault = false)
    {
        limit = Math.Clamp(limit, 1, 200);
        var tracks = _db.Query(@"SELECT id,path,title,artist,album,album_artist,genre,year,has_art,duration_ms FROM track WHERE missing=0
            AND (title='' OR title='Unknown' OR artist='' OR artist='Unknown Artist' OR album='' OR album='Unknown Album' OR has_art=0)
            ORDER BY id LIMIT $n",
            r => new { Id = r.GetInt64(0), Path = r.GetString(1), Title = r.GetString(2), Artist = r.GetString(3), Album = r.GetString(4), AlbumArtist = r.GetString(5), Genre = r.IsDBNull(6) ? null : r.GetString(6), Year = r.IsDBNull(7) ? (int?)null : r.GetInt32(7), HasArt = r.GetInt32(8) != 0, Dur = r.GetInt64(9) }, ("$n", limit));
        var now = DateTimeOffset.UtcNow.ToString("O");
        var jobId = _db.Insert("INSERT INTO tag_fix_job(status,write_files,created_at,summary) VALUES('pending',$w,$t,$s)",
            ("$w", writeFilesDefault ? 1 : 0), ("$t", now), ("$s", $"Scanning {tracks.Count} tracks…"));
        int proposals = 0, acoustHits = 0;
        var apiKey = ApiKey();
        var fpcalc = FindFpcalc();
        foreach (var tr in tracks)
        {
            try
            {
                JsonElement? recording = null;
                string? releaseId = null;
                if (!string.IsNullOrWhiteSpace(apiKey) && fpcalc != null && File.Exists(tr.Path))
                {
                    var fp = await FingerprintAsync(fpcalc, tr.Path);
                    if (fp != null)
                    {
                        var hit = await AcoustIdLookupAsync(apiKey, fp.Value.Fingerprint, fp.Value.DurationSec);
                        if (hit != null) { recording = hit.Value.Rec; releaseId = hit.Value.ReleaseId; acoustHits++; }
                    }
                }
                if (recording == null)
                {
                    var q = BuildQuery(tr.Artist, tr.Album, tr.Title);
                    if (q == null)
                    {
                        // filename stem fallback for AcoustID-less blank tags
                        var stem = Path.GetFileNameWithoutExtension(tr.Path);
                        if (!string.IsNullOrWhiteSpace(stem)) q = $"recording:\"{Escape(stem)}\"";
                    }
                    if (q != null)
                    {
                        using var resp = await _http.GetAsync("https://musicbrainz.org/ws/2/recording/?query=" + Uri.EscapeDataString(q) + "&fmt=json&limit=1");
                        if (resp.IsSuccessStatusCode)
                        {
                            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
                            if (doc.RootElement.TryGetProperty("recordings", out var recs) && recs.GetArrayLength() > 0)
                            {
                                recording = recs[0].Clone();
                                if (recording.Value.TryGetProperty("releases", out var rels) && rels.GetArrayLength() > 0)
                                    releaseId = rels[0].Str("id");
                            }
                        }
                        await Task.Delay(1100); // MusicBrainz rate limit ~1 req/s
                    }
                }
                else await Task.Delay(350); // AcoustID is more permissive; still be polite

                if (recording == null) continue;
                var rec = recording.Value;
                var title = rec.Str("title");
                var artist = rec.TryGetProperty("artist-credit", out var ac) && ac.GetArrayLength() > 0 ? ac[0].GetProperty("name").GetString() : null;
                string? album = null;
                if (releaseId == null && rec.TryGetProperty("releases", out var rels2) && rels2.GetArrayLength() > 0)
                { album = rels2[0].Str("title"); releaseId = rels2[0].Str("id"); }
                else if (rec.TryGetProperty("releases", out var rels3) && rels3.GetArrayLength() > 0)
                    album = rels3[0].Str("title");

                void Prop(string field, string? oldV, string? newV)
                {
                    if (string.IsNullOrWhiteSpace(newV)) return;
                    if (string.Equals(oldV?.Trim(), newV.Trim(), StringComparison.OrdinalIgnoreCase)) return;
                    if (!string.IsNullOrWhiteSpace(oldV) && oldV is not ("Unknown" or "Unknown Artist" or "Unknown Album" or "")) return;
                    _db.Exec("INSERT INTO tag_fix_item(job_id,track_id,field,old_value,new_value,approved) VALUES($j,$t,$f,$o,$n,1)",
                        ("$j", jobId), ("$t", tr.Id), ("$f", field), ("$o", oldV), ("$n", newV));
                    proposals++;
                }
                Prop("title", tr.Title, title); Prop("artist", tr.Artist, artist); Prop("album", tr.Album, album);
                if (!tr.HasArt && releaseId != null)
                {
                    var artUrl = $"https://coverartarchive.org/release/{releaseId}/front-250";
                    _db.Exec("INSERT INTO tag_fix_item(job_id,track_id,field,old_value,new_value,art_url,approved) VALUES($j,$t,'cover',NULL,'cover',$a,1)",
                        ("$j", jobId), ("$t", tr.Id), ("$a", artUrl));
                    proposals++;
                }
            }
            catch { /* skip track */ }
        }
        var summary = $"{proposals} proposed change(s) for {tracks.Count} track(s)" + (acoustHits > 0 ? $" ({acoustHits} via AcoustID)." : ".") + " Approve, then Apply.";
        _db.Exec("UPDATE tag_fix_job SET status='ready',summary=$s WHERE id=$i", ("$s", summary), ("$i", jobId));
        return Job(jobId)!;
    }

    public string? SetApprovals(long jobId, JsonElement b)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM tag_fix_job WHERE id=$i", ("$i", jobId))) == 0) return "job not found";
        if (b.Bool("all") is bool all) _db.Exec("UPDATE tag_fix_item SET approved=$a WHERE job_id=$j AND applied=0", ("$a", all ? 1 : 0), ("$j", jobId));
        if (b.Prop("items") is JsonElement arr && arr.ValueKind == JsonValueKind.Array)
            foreach (var e in arr.EnumerateArray())
            {
                var id = e.Long("id"); if (id == null) continue;
                _db.Exec("UPDATE tag_fix_item SET approved=$a WHERE id=$i AND job_id=$j AND applied=0", ("$a", e.Bool("approved") == true ? 1 : 0), ("$i", id), ("$j", jobId));
            }
        if (b.Bool("writeFiles") is bool wf) _db.Exec("UPDATE tag_fix_job SET write_files=$w WHERE id=$i", ("$w", wf ? 1 : 0), ("$i", jobId));
        return null;
    }

    public string? Apply(long jobId)
    {
        var job = _db.Query("SELECT write_files,status FROM tag_fix_job WHERE id=$i", r => (Wf: r.GetInt32(0) != 0, St: r.GetString(1)), ("$i", jobId)).FirstOrDefault();
        if (job.St == null) return "job not found";
        if (job.St is "applied") return "already applied - use Undo first";
        var items = _db.Query("SELECT id,track_id,field,new_value,art_url FROM tag_fix_item WHERE job_id=$j AND approved=1 AND applied=0",
            r => (Id: r.GetInt64(0), Track: r.GetInt64(1), Field: r.GetString(2), New: r.IsDBNull(3) ? null : r.GetString(3), Art: r.IsDBNull(4) ? null : r.GetString(4)), ("$j", jobId));
        int n = 0;
        foreach (var it in items.GroupBy(x => x.Track))
        {
            var trackId = it.Key;
            string? title = null, artist = null, album = null;
            foreach (var x in it)
            {
                if (x.Field == "title") title = x.New;
                else if (x.Field == "artist") artist = x.New;
                else if (x.Field == "album") album = x.New;
                else if (x.Field == "cover" && x.Art != null) { try { _ = x.Art; } catch { } }
                _db.Exec("UPDATE tag_fix_item SET applied=1 WHERE id=$i", ("$i", x.Id));
                n++;
            }
            if (title != null) _db.Exec("UPDATE track SET title=$v WHERE id=$i", ("$v", title), ("$i", trackId));
            if (artist != null) _db.Exec("UPDATE track SET artist=$v, raw_artist=COALESCE(raw_artist,artist) WHERE id=$i", ("$v", artist), ("$i", trackId));
            if (album != null) _db.Exec("UPDATE track SET album=$v WHERE id=$i", ("$v", album), ("$i", trackId));
            if (job.Wf)
            {
                var path = _db.Scalar("SELECT path FROM track WHERE id=$i", ("$i", trackId)) as string;
                if (path != null && File.Exists(path))
                    try { WriteTags(path, title, artist, album); } catch { }
            }
        }
        _db.Exec("UPDATE tag_fix_job SET status='applied',applied_at=$t,summary=$s WHERE id=$i",
            ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$s", $"Applied {n} change(s)" + (job.Wf ? " (files + database)" : " (database only)") + "."), ("$i", jobId));
        _ev.Publish("library"); return null;
    }

    public string? Undo(long jobId)
    {
        var items = _db.Query("SELECT id,track_id,field,old_value FROM tag_fix_item WHERE job_id=$j AND applied=1",
            r => (Id: r.GetInt64(0), Track: r.GetInt64(1), Field: r.GetString(2), Old: r.IsDBNull(3) ? null : r.GetString(3)), ("$j", jobId));
        if (items.Count == 0) return "nothing to undo";
        foreach (var it in items)
        {
            if (it.Field is "title" or "artist" or "album")
                _db.Exec($"UPDATE track SET {it.Field}=$v WHERE id=$i", ("$v", it.Old ?? ""), ("$i", it.Track));
            _db.Exec("UPDATE tag_fix_item SET applied=0 WHERE id=$i", ("$i", it.Id));
        }
        _db.Exec("UPDATE tag_fix_job SET status='undone',undone_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", jobId));
        _ev.Publish("library"); return null;
    }

    private string? ApiKey()
    {
        var raw = _db.Setting("acoustid.apiKey");
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind == JsonValueKind.String ? doc.RootElement.GetString()?.Trim() : raw.Trim().Trim('"');
        }
        catch { return raw.Trim().Trim('"'); }
    }

    private string? FindFpcalc()
    {
        var dir = Path.GetDirectoryName(_ffmpeg) ?? "";
        foreach (var name in new[] { "fpcalc.exe", "fpcalc", "chromaprint-fpcalc.exe" })
        {
            var p = Path.Combine(dir, name); if (File.Exists(p)) return p;
            p = Path.Combine(dir, "chromaprint", name); if (File.Exists(p)) return p;
        }
        // also next to server (ffmpeg/ folder layout)
        var beside = Path.Combine(AppContext.BaseDirectory, "ffmpeg", OperatingSystem.IsWindows() ? "fpcalc.exe" : "fpcalc");
        return File.Exists(beside) ? beside : null;
    }

    private static async Task<(string Fingerprint, int DurationSec)?> FingerprintAsync(string fpcalc, string path)
    {
        try
        {
            var psi = new ProcessStartInfo(fpcalc, $"-json \"{path}\"") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!;
            var stdout = await p.StandardOutput.ReadToEndAsync();
            await p.WaitForExitAsync();
            if (p.ExitCode != 0 || string.IsNullOrWhiteSpace(stdout)) return null;
            using var doc = JsonDocument.Parse(stdout);
            var fp = doc.RootElement.Str("fingerprint");
            var dur = doc.RootElement.TryGetProperty("duration", out var d) ? d.ValueKind == JsonValueKind.Number ? (int)Math.Round(d.GetDouble()) : int.TryParse(d.GetString(), out var i) ? i : 0 : 0;
            if (string.IsNullOrWhiteSpace(fp) || dur <= 0) return null;
            return (fp!, dur);
        }
        catch { return null; }
    }

    private async Task<(JsonElement Rec, string? ReleaseId)?> AcoustIdLookupAsync(string clientKey, string fingerprint, int durationSec)
    {
        try
        {
            var url = "https://api.acoustid.org/v2/lookup?client=" + Uri.EscapeDataString(clientKey)
                + "&meta=recordings+releases+compress&duration=" + durationSec.ToString(CultureInfo.InvariantCulture)
                + "&fingerprint=" + Uri.EscapeDataString(fingerprint);
            using var resp = await _http.GetAsync(url);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync());
            if (!doc.RootElement.TryGetProperty("results", out var results) || results.GetArrayLength() == 0) return null;
            var best = results[0];
            if (!best.TryGetProperty("recordings", out var recs) || recs.GetArrayLength() == 0) return null;
            var rec0 = recs[0];
            // AcoustID recording shape differs slightly; normalize into MusicBrainz-like fields for Prop()
            string? title = rec0.Str("title");
            string? artist = null;
            if (rec0.TryGetProperty("artists", out var artists) && artists.GetArrayLength() > 0)
                artist = artists[0].Str("name");
            string? album = null, releaseId = null;
            if (rec0.TryGetProperty("releases", out var rels) && rels.GetArrayLength() > 0)
            { album = rels[0].Str("title"); releaseId = rels[0].Str("id"); }
            // Build a MusicBrainz-shaped JSON blob (kebab names MusicBrainz uses)
            var sb = new StringBuilder();
            sb.Append("{\"title\":").Append(JsonSerializer.Serialize(title));
            sb.Append(",\"artist-credit\":");
            sb.Append(artist == null ? "[]" : "[{\"name\":" + JsonSerializer.Serialize(artist) + "}]");
            sb.Append(",\"releases\":");
            sb.Append(releaseId == null ? "[]" : "[{\"id\":" + JsonSerializer.Serialize(releaseId) + ",\"title\":" + JsonSerializer.Serialize(album) + "}]");
            sb.Append('}');
            using var synDoc = JsonDocument.Parse(sb.ToString());
            return (synDoc.RootElement.Clone(), releaseId);
        }
        catch { return null; }
    }

    private static string? BuildQuery(string artist, string album, string title)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(title) && title is not ("Unknown" or "")) parts.Add($"recording:\"{Escape(title)}\"");
        if (!string.IsNullOrWhiteSpace(artist) && artist is not ("Unknown Artist" or "Unknown" or "")) parts.Add($"artist:\"{Escape(artist)}\"");
        if (!string.IsNullOrWhiteSpace(album) && album is not ("Unknown Album" or "Unknown" or "")) parts.Add($"release:\"{Escape(album)}\"");
        return parts.Count == 0 ? null : string.Join(' ', parts);
    }
    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static void WriteTags(string path, string? title, string? artist, string? album)
    {
        var tfile = TagLib.File.Create(path);
        try
        {
            if (title != null) tfile.Tag.Title = title;
            if (artist != null) tfile.Tag.Performers = new[] { artist };
            if (album != null) tfile.Tag.Album = album;
            tfile.Save();
        }
        finally { tfile.Dispose(); }
    }
}
