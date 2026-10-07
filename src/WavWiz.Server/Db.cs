using Microsoft.Data.Sqlite;
namespace WavWiz.Server;

/// <summary>SQLite access with numbered migrations (PRAGMA user_version) and an automatic backup before an upgrade (spec 14).</summary>
public sealed class Db
{
    private readonly string _path;
    public Db(string path) { _path = path; }
    public string Path => _path;

    public static readonly string[] Migrations =
    {
        // v1
        """
        CREATE TABLE library_root(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_scan_at TEXT, last_error TEXT);
        CREATE TABLE track(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, root_id INTEGER NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
            title TEXT NOT NULL, artist TEXT NOT NULL, album_artist TEXT NOT NULL, album TEXT NOT NULL, track_no INTEGER, disc_no INTEGER,
            duration_ms INTEGER NOT NULL DEFAULT 0, codec TEXT, sample_rate INTEGER, channels INTEGER, bitrate INTEGER, genre TEXT, year INTEGER,
            added_at TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0, search TEXT NOT NULL);
        CREATE INDEX ix_track_artist ON track(artist, album, disc_no, track_no);
        CREATE INDEX ix_track_album ON track(album, disc_no, track_no);
        CREATE INDEX ix_track_added ON track(added_at);
        CREATE TABLE playlist(id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE playlist_item(playlist_id INTEGER NOT NULL, position INTEGER NOT NULL, track_id INTEGER, radio_id INTEGER, PRIMARY KEY(playlist_id, position));
        CREATE TABLE radio_station(id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, logo_url TEXT, genre TEXT, favorite INTEGER NOT NULL DEFAULT 0, last_ok_at TEXT);
        CREATE TABLE player(id TEXT PRIMARY KEY, name TEXT NOT NULL, machine_name TEXT, app_version TEXT, last_seen_at TEXT, token_hash TEXT, revoked INTEGER NOT NULL DEFAULT 0,
            is_server_host INTEGER NOT NULL DEFAULT 0, link_type TEXT);
        CREATE TABLE output_device(id TEXT PRIMARY KEY, kind TEXT NOT NULL, bt_address TEXT, friendly_name TEXT NOT NULL, sink_tag TEXT, is_reference INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE output_endpoint(id INTEGER PRIMARY KEY, output_device_id TEXT NOT NULL, player_id TEXT NOT NULL, win_endpoint_id TEXT NOT NULL, last_seen_at TEXT,
            connected INTEGER NOT NULL DEFAULT 0, UNIQUE(player_id, win_endpoint_id));
        CREATE TABLE zone(id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT, player_id TEXT UNIQUE NOT NULL, active_output_device_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
            volume REAL NOT NULL DEFAULT 60, muted INTEGER NOT NULL DEFAULT 0, buffer_ms INTEGER, sort INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE calibration(id INTEGER PRIMARY KEY, output_device_id TEXT NOT NULL, player_id TEXT, latency_ms REAL NOT NULL, raw_latency_ms REAL, reference_device_id TEXT,
            method TEXT NOT NULL, mic_source TEXT, mic_processing TEXT, same_recording INTEGER NOT NULL DEFAULT 0, confidence REAL, win_reported_latency_ms REAL, codec TEXT,
            dsp_latency_ms REAL NOT NULL DEFAULT 0, measured_at TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1, notes TEXT);
        CREATE INDEX ix_cal_dev ON calibration(output_device_id, is_current);
        CREATE TABLE dsp_preset(id INTEGER PRIMARY KEY, name TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'user',
            json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE output_device_dsp(output_device_id TEXT PRIMARY KEY, dsp_preset_id INTEGER, enabled INTEGER NOT NULL DEFAULT 1, bypass INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
        CREATE TABLE api_token(id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0, player_id TEXT);
        CREATE TABLE setting(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
        """,
        // v2 (0.0.2): tag-based browsing, art, cleanup. raw_* keep the file's own tags so a cleanup "alias" is reversible and never touches the files.
        """
        ALTER TABLE track ADD COLUMN raw_artist TEXT;
        ALTER TABLE track ADD COLUMN raw_album_artist TEXT;
        ALTER TABLE track ADD COLUMN folder TEXT NOT NULL DEFAULT '';
        ALTER TABLE track ADD COLUMN has_art INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE track ADD COLUMN tag_flags INTEGER NOT NULL DEFAULT 0;
        UPDATE track SET raw_artist=artist, raw_album_artist=album_artist;
        CREATE INDEX ix_track_year ON track(year);
        CREATE INDEX ix_track_genre ON track(genre);
        CREATE INDEX ix_track_folder ON track(folder);
        CREATE INDEX ix_track_albumkey ON track(album_artist, album);
        CREATE TABLE artist_alias(name TEXT PRIMARY KEY, canonical TEXT NOT NULL);
        """,
        // v3 (0.0.3): ZONES are optional named groups of devices. A device (one player = one `zone` row, kept as is) can sit in any number of zones or in none (= Unassigned).
        """
        CREATE TABLE zone_group(id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE zone_group_member(group_id INTEGER NOT NULL, device_id INTEGER NOT NULL, PRIMARY KEY(group_id, device_id));
        CREATE INDEX ix_zgm_device ON zone_group_member(device_id);
        """,
        // v4 (0.0.4): follow-speaker, speaker profiles, scenes, schedules, radio finder favs, tag fix jobs, CD rip jobs, remote/Tailscale notes.
        """
        CREATE TABLE speaker_profile(id INTEGER PRIMARY KEY, name TEXT NOT NULL, bt_address TEXT, output_device_id TEXT,
            volume REAL NOT NULL DEFAULT 60, delay_ms REAL, dsp_preset_id INTEGER, follow INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX ix_sp_bt ON speaker_profile(bt_address);
        CREATE INDEX ix_sp_dev ON speaker_profile(output_device_id);
        CREATE TABLE scene(id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE scene_member(scene_id INTEGER NOT NULL, device_id INTEGER NOT NULL, volume REAL NOT NULL DEFAULT 60, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(scene_id, device_id));
        CREATE TABLE schedule(id INTEGER PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
            days TEXT NOT NULL DEFAULT '0123456', time_hm TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
            last_run_at TEXT, created_at TEXT NOT NULL);
        CREATE TABLE radio_finder_fav(stationuuid TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, favicon TEXT, tags TEXT, country TEXT, added_at TEXT NOT NULL);
        CREATE TABLE podcast_feed(id INTEGER PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, added_at TEXT NOT NULL);
        CREATE TABLE tag_fix_job(id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', write_files INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, applied_at TEXT, undone_at TEXT, summary TEXT);
        CREATE TABLE tag_fix_item(id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, track_id INTEGER NOT NULL,
            field TEXT NOT NULL, old_value TEXT, new_value TEXT, art_url TEXT, approved INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX ix_tfi_job ON tag_fix_item(job_id);
        CREATE TABLE rip_job(id INTEGER PRIMARY KEY, drive TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', format TEXT NOT NULL DEFAULT 'flac',
            dest_folder TEXT, album TEXT, artist TEXT, progress REAL NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
        """,
    };

    public SqliteConnection Open()
    {
        var c = new SqliteConnection($"Data Source={_path};Cache=Shared;Pooling=True");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=5000;";
        cmd.ExecuteNonQuery();
        return c;
    }

    public int Version()
    {
        using var c = Open();
        return Convert.ToInt32(Scalar(c, "PRAGMA user_version"));
    }

    /// <summary>Applies pending migrations; copies the DB file to wavwiz.db.bak-vN first when upgrading an existing one.</summary>
    public void Migrate()
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(_path))!);
        int cur = File.Exists(_path) ? Version() : 0;
        if (cur >= Migrations.Length) return;
        if (cur > 0 && File.Exists(_path))
        {
            using (var c0 = Open()) Exec(c0, "PRAGMA wal_checkpoint(TRUNCATE)");
            File.Copy(_path, _path + $".bak-v{cur}", overwrite: true);
        }
        using var c = Open();
        for (int v = cur; v < Migrations.Length; v++)
        {
            using var tx = c.BeginTransaction();
            Exec(c, Migrations[v], tx);
            Exec(c, $"PRAGMA user_version={v + 1}", tx);
            tx.Commit();
        }
    }

    public static void Exec(SqliteConnection c, string sql, SqliteTransaction? tx = null, params (string, object?)[] p)
    {
        using var cmd = c.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = sql;
        foreach (var (n, v) in p) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public static object? Scalar(SqliteConnection c, string sql, params (string, object?)[] p)
    {
        using var cmd = c.CreateCommand(); cmd.CommandText = sql;
        foreach (var (n, v) in p) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        var r = cmd.ExecuteScalar();
        return r is DBNull ? null : r;
    }

    public static List<T> Query<T>(SqliteConnection c, string sql, Func<SqliteDataReader, T> map, params (string, object?)[] p)
    {
        using var cmd = c.CreateCommand(); cmd.CommandText = sql;
        foreach (var (n, v) in p) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        using var r = cmd.ExecuteReader();
        var list = new List<T>();
        while (r.Read()) list.Add(map(r));
        return list;
    }

    public List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params (string, object?)[] p) { using var c = Open(); return Query(c, sql, map, p); }
    public void Exec(string sql, params (string, object?)[] p) { using var c = Open(); Exec(c, sql, null, p); }
    public object? Scalar(string sql, params (string, object?)[] p) { using var c = Open(); return Scalar(c, sql, p); }
    public long Insert(string sql, params (string, object?)[] p) { using var c = Open(); Exec(c, sql, null, p); return Convert.ToInt64(Scalar(c, "SELECT last_insert_rowid()")); }

    public string? Setting(string key) => Scalar("SELECT value_json FROM setting WHERE key=$k", ("$k", key)) as string;
    public void SetSetting(string key, string json) => Exec("INSERT INTO setting(key,value_json) VALUES($k,$v) ON CONFLICT(key) DO UPDATE SET value_json=$v", ("$k", key), ("$v", json));
}
