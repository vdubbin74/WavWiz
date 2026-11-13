using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
namespace WavWiz.Server.Features;

/// <summary>0.3.0 §7.1: Settings > General > Backup. One .wavwizbackup file (a zip holding backup.json) with settings, playlists, scenes,
/// schedules/alarms, EQ presets and device names/delays. NEVER certificates, private keys, passwords, API tokens or share credentials
/// (the Jukebox PIN is stored hashed only). Import shows a preview of what changes, then replaces those tables in one transaction.
/// 0.7.0 (t1915u–t1917u): pairings and this server's identity (server id, AirPlay hardware address) stay on this install. Imported
/// speakers are remapped onto a player that is already paired when the computer name or the same speaker output matches; the rest
/// wait as placeholders and attach when that player pairs.</summary>
public sealed class BackupService
{
    public const int Format = 1;
    public const string PlayerMetaKey = "zones.playerMeta";
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
    /// <summary>This install's identity: a fresh CA / AirPlay address / server id must not be overwritten by a backup from another (or wiped) install.</summary>
    public static bool IsIdentitySetting(string key) => key.Equals("server.id", StringComparison.OrdinalIgnoreCase)
        || key.Equals("airplay.hwaddr", StringComparison.OrdinalIgnoreCase)
        || key.Equals("receivers.hw", StringComparison.OrdinalIgnoreCase);
    public static bool SkipSetting(string key) => IsSecretSetting(key) || IsIdentitySetting(key);

    public readonly record struct PlayerMeta(string Id, string Name, string? MachineName);
    public const string PairingNote = "Passwords and this server's certificates stay here (they are never in a backup). Pairings are not in the backup: after a restore onto a fresh install, pair each player again. Zones, names, EQ and delays reconnect by computer name (or the same speaker output) when that player is paired.";

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
            if (t == "setting") rows = rows.Where(r => !SkipSetting(Convert.ToString(r["key"]) ?? "") && Convert.ToString(r["key"]) != PlayerMetaKey).ToList();
            if (t == "playlist_item")   // songs travel by file path (track ids differ on another install)
                foreach (var r in rows) r["track_path"] = r["track_id"] is null ? null : Db.Scalar(c, "SELECT path FROM track WHERE id=$i", ("$i", r["track_id"]));
            tables[t] = rows;
        }
        doc["tables"] = tables;
        doc["players"] = Db.Query(c, "SELECT id,name,machine_name FROM player", r => new Dictionary<string, object?> { ["id"] = r.GetString(0), ["name"] = r.GetString(1), ["machineName"] = r.IsDBNull(2) ? null : r.GetString(2) });
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

    public static List<PlayerMeta> PlayersOf(JsonElement root)
    {
        var list = new List<PlayerMeta>();
        if (root.TryGetProperty("players", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var p in arr.EnumerateArray())
            {
                var id = p.TryGetProperty("id", out var i) ? i.GetString() : null;
                var name = p.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
                list.Add(new(id, name, p.TryGetProperty("machineName", out var m) ? m.GetString() : null));
            }
        }
        if (list.Count == 0 && root.TryGetProperty("tables", out var tbl) && tbl.TryGetProperty("zone", out var zs) && zs.ValueKind == JsonValueKind.Array)
            foreach (var z in zs.EnumerateArray())
            {
                var id = z.TryGetProperty("player_id", out var p) ? p.GetString() : null;
                var name = z.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(name) && list.All(x => x.Id != id)) list.Add(new(id, name, null));
            }
        return list;
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
        var plan = MatchPlan(c, root);
        return new {
            appVersion = root.TryGetProperty("appVersion", out var v) ? v.GetString() : null,
            createdAt = root.TryGetProperty("createdAt", out var ca) ? ca.GetString() : null,
            sections = list, songsNotInLibrary = missing,
            pairingNote = PairingNote,
            willReattach = plan.Where(x => x.NewId != null).Select(x => x.Meta.Name).ToList(),
            needPairing = plan.Where(x => x.NewId == null).Select(x => x.Meta.Name).ToList()
        };
    }

    /// <summary>Replaces the backed-up tables in one transaction. Secrets and this install's identity in the file (if present) are ignored. Speakers are remapped onto already-paired players when the computer name or the same speaker output matches.</summary>
    public (int Rows, int Missing) Import(JsonElement root)
    {
        using var c = _db.Open(); using var tx = c.BeginTransaction(); int n = 0, missing = 0;
        var tbl = root.GetProperty("tables");
        foreach (var (t, _) in Tables)
        {
            if (!tbl.TryGetProperty(t, out var arr) || arr.ValueKind != JsonValueKind.Array) continue;
            var cols = Db.Query(c, $"PRAGMA table_info({t})", r => r.GetString(1)).ToHashSet();
            if (t == "setting") Db.Exec(c, "DELETE FROM setting WHERE key NOT LIKE 'admin.%' AND key NOT LIKE 'tls.%' AND key NOT LIKE 'nas.%' AND key NOT IN ('server.id','airplay.hwaddr','receivers.hw')", tx);
            else Db.Exec(c, $"DELETE FROM {t}", tx);
            foreach (var row in arr.EnumerateArray())
            {
                var vals = new Dictionary<string, object?>();
                foreach (var p in row.EnumerateObject()) if (cols.Contains(p.Name)) vals[p.Name] = p.Value.ValueKind switch
                {
                    JsonValueKind.Null => null, JsonValueKind.Number => p.Value.TryGetInt64(out var l) ? l : p.Value.GetDouble(), JsonValueKind.String => p.Value.GetString(),
                    JsonValueKind.True => 1L, JsonValueKind.False => 0L, _ => p.Value.GetRawText()
                };
                if (t == "setting" && SkipSetting(Convert.ToString(vals.GetValueOrDefault("key")) ?? "")) continue;
                if (t == "setting" && Convert.ToString(vals.GetValueOrDefault("key")) == PlayerMetaKey) continue;
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
        RemapImported(c, tx, root);
        tx.Commit();
        foreach (var e in new[] { "settings", "playlists", "scenes", "schedules", "zones", "dsp", "favorites" }) _ev.Publish(e);
        return (n, missing);
    }

    /// <summary>Pair a newly connected player with a restored placeholder (same computer name, or a unique matching device name).</summary>
    public static bool TryAdoptPlaceholder(Db db, string newId, string name, string? machineName)
    {
        if (string.IsNullOrWhiteSpace(newId)) return false;
        var meta = LoadMeta(db);
        var taken = db.Query("SELECT id FROM player", r => r.GetString(0)).ToHashSet(StringComparer.Ordinal);
        taken.Add(newId);
        var placeholders = db.Query("SELECT player_id,name FROM zone", r => (Id: r.GetString(0), Name: r.GetString(1)))
            .Where(z => !taken.Contains(z.Id)).ToList();
        if (placeholders.Count == 0) return false;
        string? Match(Func<(string Id, string Name), bool> ok)
        {
            var hit = placeholders.Where(ok).Select(z => z.Id).Distinct().ToList();
            return hit.Count == 1 ? hit[0] : null;
        }
        var old = !string.IsNullOrWhiteSpace(machineName)
            ? Match(z => meta.Any(m => m.Id == z.Id && !string.IsNullOrWhiteSpace(m.MachineName) && string.Equals(m.MachineName, machineName, StringComparison.OrdinalIgnoreCase)))
            : null;
        old ??= Match(z => string.Equals(z.Name, name, StringComparison.OrdinalIgnoreCase)
            || meta.Any(m => m.Id == z.Id && string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)));
        if (old == null) return false;
        RemapPlayer(db, old, newId);
        return true;
    }

    public static void RemapPlayer(Db db, string oldId, string newId)
    {
        using var c = db.Open(); using var tx = c.BeginTransaction();
        RemapPlayer(c, tx, oldId, newId); tx.Commit();
    }

    private sealed record Match(PlayerMeta Meta, string? NewId);
    private static List<Match> MatchPlan(SqliteConnection c, JsonElement root)
    {
        var incoming = PlayersOf(root);
        var live = Db.Query(c, "SELECT id,name,machine_name FROM player", r => (Id: r.GetString(0), Name: r.GetString(1), Machine: r.IsDBNull(2) ? null : r.GetString(2)));
        var liveEps = Db.Query(c, "SELECT player_id,win_endpoint_id FROM output_endpoint", r => (Player: r.GetString(0), Ep: r.GetString(1)));
        var importedDevs = new List<string>();
        if (root.TryGetProperty("tables", out var tbl) && tbl.TryGetProperty("output_device", out var od) && od.ValueKind == JsonValueKind.Array)
            foreach (var r in od.EnumerateArray()) if (r.TryGetProperty("id", out var id) && id.GetString() is { Length: > 0 } s) importedDevs.Add(s);
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        void TrySet(string old, string neu) { if (!map.ContainsKey(old) && !map.ContainsValue(neu)) map[old] = neu; }
        foreach (var dev in importedDevs)
        {
            var (pid, ep) = SplitDeviceId(dev); if (pid == null || ep == null) continue;
            var hits = liveEps.Where(x => x.Ep == ep).Select(x => x.Player).Distinct().ToList();
            if (hits.Count == 1) TrySet(pid, hits[0]);
        }
        foreach (var p in incoming)
        {
            if (string.IsNullOrWhiteSpace(p.MachineName)) continue;
            if (incoming.Count(x => string.Equals(x.MachineName, p.MachineName, StringComparison.OrdinalIgnoreCase)) != 1) continue; // two PCs on the same reported name: don't guess
            var hits = live.Where(l => string.Equals(l.Machine, p.MachineName, StringComparison.OrdinalIgnoreCase)).Select(l => l.Id).Distinct().ToList();
            if (hits.Count == 1) TrySet(p.Id, hits[0]);
        }
        foreach (var p in incoming)
        {
            var hits = live.Where(l => string.Equals(l.Name, p.Name, StringComparison.OrdinalIgnoreCase)).Select(l => l.Id).Distinct().ToList();
            if (hits.Count == 1) TrySet(p.Id, hits[0]);
        }
        return incoming.Select(p => new Match(p, map.TryGetValue(p.Id, out var n) ? n : null)).ToList();
    }

    private static void RemapImported(SqliteConnection c, SqliteTransaction tx, JsonElement root)
    {
        var plan = MatchPlan(c, root);
        foreach (var m in plan) if (m.NewId != null && m.NewId != m.Meta.Id) RemapPlayer(c, tx, m.Meta.Id, m.NewId);
        var json = JsonSerializer.Serialize(plan.Select(m => new { id = m.Meta.Id, name = m.Meta.Name, machineName = m.Meta.MachineName }));
        Db.Exec(c, "INSERT OR REPLACE INTO setting(key,value_json) VALUES($k,$v)", tx, ("$k", PlayerMetaKey), ("$v", json));
    }

    private static void RemapPlayer(SqliteConnection c, SqliteTransaction? tx, string oldId, string newId)
    {
        if (oldId == newId) return;
        var zrow = Db.Query(c, "SELECT active_output_device_id FROM zone WHERE player_id=$p", r => r.IsDBNull(0) ? null : r.GetString(0), ("$p", oldId)).FirstOrDefault();
        var newActive = RewriteDeviceId(zrow, oldId, newId);
        Db.Exec(c, "UPDATE zone SET player_id=$n, active_output_device_id=$a WHERE player_id=$o", tx, ("$n", newId), ("$a", newActive), ("$o", oldId));
        var devs = Db.Query(c, "SELECT id FROM output_device", r => r.GetString(0)).Where(id => SplitDeviceId(id).PlayerId == oldId).ToList();
        foreach (var id in devs)
        {
            var nid = RewriteDeviceId(id, oldId, newId);
            if (nid == id) continue;
            if (Db.Scalar(c, "SELECT id FROM output_device WHERE id=$i", ("$i", nid)) != null)
                Db.Exec(c, "DELETE FROM output_device WHERE id=$o", tx, ("$o", id));
            else
                Db.Exec(c, "UPDATE output_device SET id=$n WHERE id=$o", tx, ("$n", nid), ("$o", id));
        }
        foreach (var (table, col) in new[] { ("output_endpoint", "output_device_id"), ("calibration", "output_device_id"), ("calibration", "reference_device_id"), ("output_device_dsp", "output_device_id") })
        {
            var cols = Db.Query(c, $"PRAGMA table_info({table})", r => r.GetString(1)).ToHashSet();
            if (!cols.Contains(col)) continue;
            foreach (var old in Db.Query(c, $"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL", r => r.GetString(0)))
            {
                var nid = RewriteDeviceId(old, oldId, newId);
                if (nid != old) Db.Exec(c, $"UPDATE {table} SET {col}=$n WHERE {col}=$o", tx, ("$n", nid), ("$o", old));
            }
        }
        if (Db.Query(c, "PRAGMA table_info(output_endpoint)", r => r.GetString(1)).Contains("player_id"))
            Db.Exec(c, "UPDATE output_endpoint SET player_id=$n WHERE player_id=$o", tx, ("$n", newId), ("$o", oldId));
        if (Db.Query(c, "PRAGMA table_info(calibration)", r => r.GetString(1)).Contains("player_id"))
            Db.Exec(c, "UPDATE calibration SET player_id=$n WHERE player_id=$o", tx, ("$n", newId), ("$o", oldId));
        RewriteSettingPlayerIds(c, tx, oldId, newId);
    }

    private static void RewriteSettingPlayerIds(SqliteConnection c, SqliteTransaction? tx, string oldId, string newId)
    {
        foreach (var key in new[] { "playback.groups", "jukebox.devices" })
        {
            var raw = Db.Scalar(c, "SELECT value_json FROM setting WHERE key=$k", ("$k", key)) as string;
            if (string.IsNullOrEmpty(raw) || !raw.Contains(oldId, StringComparison.Ordinal)) continue;
            Db.Exec(c, "UPDATE setting SET value_json=$v WHERE key=$k", tx, ("$v", raw.Replace(oldId, newId, StringComparison.Ordinal)), ("$k", key));
        }
    }

    public static string RewriteDeviceId(string? id, string oldPid, string newPid)
    {
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(oldPid)) return id ?? "";
        var prefix = "ep:" + oldPid + ":";
        return id.StartsWith(prefix, StringComparison.Ordinal) ? "ep:" + newPid + ":" + id[prefix.Length..] : id;
    }
    public static (string? PlayerId, string? Endpoint) SplitDeviceId(string? id)
    {
        if (id == null || !id.StartsWith("ep:", StringComparison.Ordinal)) return (null, null);
        var rest = id[3..]; var i = rest.IndexOf(':');
        return i <= 0 ? (null, null) : (rest[..i], rest[(i + 1)..]);
    }

    public static List<PlayerMeta> LoadMeta(Db db)
    {
        try
        {
            var raw = db.Setting(PlayerMetaKey); if (string.IsNullOrWhiteSpace(raw)) return new();
            using var doc = JsonDocument.Parse(raw); var list = new List<PlayerMeta>();
            foreach (var p in doc.RootElement.EnumerateArray())
            {
                var id = p.TryGetProperty("id", out var i) ? i.GetString() : null;
                var name = p.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
                list.Add(new(id, name, p.TryGetProperty("machineName", out var m) ? m.GetString() : null));
            }
            return list;
        }
        catch { return new(); }
    }
}
