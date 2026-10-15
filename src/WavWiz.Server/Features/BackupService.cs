using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
namespace WavWiz.Server.Features;

/// <summary>0.3.0 §7.1: Settings > General > Backup. One .wavwizbackup file (a zip holding backup.json) with settings, playlists, scenes,
/// schedules/alarms, EQ presets and device names/delays. NEVER certificates, private keys, passwords, API tokens or share credentials
/// (the Jukebox PIN is stored hashed only). Import shows a preview of what changes, then replaces those tables in one transaction.</summary>
public sealed class BackupService
{
    public const int Format = 1;
    /// <summary>Table, label, and the key columns written (all columns when null).</summary>
    public static readonly (string Table, string Label)[] Tables =
    {
        ("setting", "Settings"), ("playlist", "Playlists"), ("playlist_item", "Playlist songs"), ("radio_station", "Radio stations"), ("favorite", "Favorites"),
        ("scene", "Scenes"), ("scene_member", "Scene speakers"), ("device_profile", "Speaker profiles"), ("schedule", "Schedules & alarms"),
        ("dsp_preset", "EQ presets"), ("output_device_dsp", "EQ per speaker"),
        ("zone", "Device names & volumes"), ("output_device", "Speaker outputs"), ("calibration", "Device delays"), ("zone_group", "Speaker groups"), ("zone_group_member", "Speaker group members"),
    };
    private static readonly Regex Secret = new(@"(pass(word)?|secret|token|apikey|api_key|private|cert|\.key$|^admin\.|^nas\.|^tls\.(?!redirect$))", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    public static bool IsSecretSetting(string key) => Secret.IsMatch(key) && !key.EndsWith("pinHash", StringComparison.Ordinal);

    private readonly Db _db; private readonly EventHub _ev;
    private readonly string? _dir;
    public BackupService(Db db, EventHub ev, string? snapshotDir = null) { _db = db; _ev = ev; _dir = snapshotDir; }

    // ---- 0.3.6 K20: "Back up now" saves a snapshot on the server; Restore picks one; every restore first saves a "before restore" snapshot so Undo is one click.
    public sealed record Snapshot(string Name, string CreatedAt, long Size, string Kind);
    public const int KeepManual = 10, KeepUndo = 3;
    private static readonly Regex SnapName = new(@"^WavWiz-\d{8}-\d{6}(-before-restore)?\.wavwizbackup$", RegexOptions.Compiled);
    public static bool ValidSnapshotName(string? n) => n != null && SnapName.IsMatch(n);
    public Snapshot SaveSnapshot(string appVersion, bool beforeRestore = false, DateTime? at = null)
    {
        if (_dir == null) throw new InvalidOperationException("No backup folder.");
        Directory.CreateDirectory(_dir);
        var t = at ?? DateTime.Now; var name = $"WavWiz-{t:yyyyMMdd-HHmmss}{(beforeRestore ? "-before-restore" : "")}.wavwizbackup"; var path = Path.Combine(_dir, name);
        for (var i = 1; File.Exists(path); i++) { t = t.AddSeconds(1); name = $"WavWiz-{t:yyyyMMdd-HHmmss}{(beforeRestore ? "-before-restore" : "")}.wavwizbackup"; path = Path.Combine(_dir, name); if (i > 600) break; }
        File.WriteAllBytes(path, Export(appVersion));
        Prune();
        var fi = new FileInfo(path); return new Snapshot(name, fi.LastWriteTime.ToString("O"), fi.Length, beforeRestore ? "before-restore" : "manual");
    }
    public List<Snapshot> ListSnapshots()
    {
        if (_dir == null || !Directory.Exists(_dir)) return new();
        return new DirectoryInfo(_dir).GetFiles("WavWiz-*.wavwizbackup").Where(f => ValidSnapshotName(f.Name)).OrderByDescending(f => f.Name)
            .Select(f => new Snapshot(f.Name, f.LastWriteTime.ToString("O"), f.Length, f.Name.Contains("-before-restore") ? "before-restore" : "manual")).ToList();
    }
    public byte[]? ReadSnapshot(string name) => _dir != null && ValidSnapshotName(name) && File.Exists(Path.Combine(_dir, name)) ? File.ReadAllBytes(Path.Combine(_dir, name)) : null;
    private void Prune()
    {
        var all = ListSnapshots();
        foreach (var f in all.Where(x => x.Kind == "manual").Skip(KeepManual).Concat(all.Where(x => x.Kind == "before-restore").Skip(KeepUndo))) { try { File.Delete(Path.Combine(_dir!, f.Name)); } catch { /* in use */ } }
    }

    public byte[] Export(string appVersion)
    {
        using var c = _db.Open();
        var doc = new Dictionary<string, object?> { ["format"] = Format, ["app"] = "wavwiz", ["appVersion"] = appVersion, ["createdAt"] = DateTimeOffset.UtcNow.ToString("O") };
        var tables = new Dictionary<string, List<Dictionary<string, object?>>>();
        foreach (var (t, _) in Tables)
        {
            var rows = Rows(c, t);
            if (t == "setting") rows = rows.Where(r => !IsSecretSetting(Convert.ToString(r["key"]) ?? "")).ToList();
            if (t == "playlist_item")   // songs travel by file path (track ids differ on another install)
                foreach (var r in rows) r["track_path"] = r["track_id"] is null ? null : Db.Scalar(c, "SELECT path FROM track WHERE id=$i", ("$i", r["track_id"]));
            tables[t] = rows;
        }
        doc["tables"] = tables;
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            var e = zip.CreateEntry("backup.json", CompressionLevel.Optimal);
            using var w = e.Open(); JsonSerializer.Serialize(w, doc, new JsonSerializerOptions { WriteIndented = true });
        }
        return ms.ToArray();
    }

    private static List<Dictionary<string, object?>> Rows(SqliteConnection c, string table)
    {
        using var cmd = c.CreateCommand(); cmd.CommandText = $"SELECT * FROM {table}";
        using var r = cmd.ExecuteReader(); var res = new List<Dictionary<string, object?>>();
        while (r.Read()) { var d = new Dictionary<string, object?>(); for (int i = 0; i < r.FieldCount; i++) d[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i); res.Add(d); }
        return res;
    }

    public sealed record Parsed(JsonElement Root, string? Error);
    public static Parsed Read(byte[] file)
    {
        try
        {
            using var ms = new MemoryStream(file); using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            var e = zip.GetEntry("backup.json"); if (e == null) return new(default, "This isn't a WavWiz backup file.");
            using var s = e.Open(); var root = JsonDocument.Parse(s).RootElement.Clone();
            if (!root.TryGetProperty("app", out var a) || a.GetString() != "wavwiz") return new(default, "This isn't a WavWiz backup file.");
            if (root.TryGetProperty("format", out var f) && f.GetInt32() > Format) return new(default, "This backup was made by a newer WavWiz. Update WavWiz first.");
            return new(root, null);
        }
        catch (Exception) { return new(default, "This file can't be read as a WavWiz backup."); }
    }

    /// <summary>What an import would change: per section current vs incoming counts, and songs not found in this library.</summary>
    public object Preview(JsonElement root)
    {
        using var c = _db.Open(); var tbl = root.GetProperty("tables"); int missing = 0;
        var list = new List<object>();
        foreach (var (t, label) in Tables)
        {
            if (t is "playlist_item" or "scene_member" or "zone_group_member" or "output_device_dsp") continue;
            var cur = Convert.ToInt32(Db.Scalar(c, t == "setting" ? "SELECT COUNT(*) FROM setting WHERE key NOT LIKE 'admin.%'" : $"SELECT COUNT(*) FROM {t}"));
            var inc = tbl.TryGetProperty(t, out var a) ? a.GetArrayLength() : 0;
            list.Add(new { table = t, label, current = cur, incoming = inc });
        }
        if (tbl.TryGetProperty("playlist_item", out var pi))
            foreach (var r in pi.EnumerateArray()) if (r.TryGetProperty("track_path", out var p) && p.ValueKind == JsonValueKind.String && Db.Scalar(c, "SELECT id FROM track WHERE path=$p", ("$p", p.GetString())) == null) missing++;
        return new { appVersion = root.TryGetProperty("appVersion", out var v) ? v.GetString() : null, createdAt = root.TryGetProperty("createdAt", out var ca) ? ca.GetString() : null, sections = list, songsNotInLibrary = missing };
    }

    /// <summary>Replaces the backed-up tables in one transaction. Secrets in the file (if someone edited it) are ignored.</summary>
    public (int Rows, int Missing) Import(JsonElement root)
    {
        using var c = _db.Open(); using var tx = c.BeginTransaction(); int n = 0, missing = 0;
        var tbl = root.GetProperty("tables");
        foreach (var (t, _) in Tables)
        {
            if (!tbl.TryGetProperty(t, out var arr) || arr.ValueKind != JsonValueKind.Array) continue;
            var cols = Db.Query(c, $"PRAGMA table_info({t})", r => r.GetString(1)).ToHashSet();
            if (t == "setting") Db.Exec(c, "DELETE FROM setting WHERE key NOT LIKE 'admin.%' AND key NOT LIKE 'tls.%' AND key NOT LIKE 'nas.%'", tx);
            else Db.Exec(c, $"DELETE FROM {t}", tx);
            foreach (var row in arr.EnumerateArray())
            {
                var vals = new Dictionary<string, object?>();
                foreach (var p in row.EnumerateObject()) if (cols.Contains(p.Name)) vals[p.Name] = p.Value.ValueKind switch
                {
                    JsonValueKind.Null => null, JsonValueKind.Number => p.Value.TryGetInt64(out var l) ? l : p.Value.GetDouble(), JsonValueKind.String => p.Value.GetString(),
                    JsonValueKind.True => 1L, JsonValueKind.False => 0L, _ => p.Value.GetRawText()
                };
                if (t == "setting" && IsSecretSetting(Convert.ToString(vals.GetValueOrDefault("key")) ?? "")) continue;
                if (t == "playlist_item" && row.TryGetProperty("track_path", out var tp) && tp.ValueKind == JsonValueKind.String)
                {
                    var id = Db.Scalar(c, "SELECT id FROM track WHERE path=$p", ("$p", tp.GetString()));
                    if (id == null) { missing++; continue; }
                    vals["track_id"] = id;
                }
                var names = vals.Keys.ToList();
                Db.Exec(c, $"INSERT OR REPLACE INTO {t}({string.Join(",", names)}) VALUES({string.Join(",", names.Select((_, i) => "$p" + i))})", tx, names.Select((k, i) => ("$p" + i, vals[k])).ToArray());
                n++;
            }
        }
        tx.Commit();
        foreach (var e in new[] { "settings", "playlists", "scenes", "schedules", "zones", "dsp", "favorites" }) _ev.Publish(e);
        return (n, missing);
    }
}
