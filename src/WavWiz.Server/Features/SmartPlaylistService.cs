using System.Text.Json;
namespace WavWiz.Server.Features;

/// <summary>Smart playlists: a name + up to 5 AND'd rules over the local library (genre, year range, added lately, not played lately, artist).
/// The same resolver feeds Play / Add to queue and Keep playing → Smart. Saved in the database settings.</summary>
public sealed class SmartPlaylistService
{
    public const string HistoryTable = "play_history";
    private readonly Db _db; private readonly object _l = new();
    public Func<DateTimeOffset> Clock { get; set; } = () => DateTimeOffset.UtcNow;
    public SmartPlaylistService(Db db) { _db = db; }
    private const string Key = "smart.playlists";
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);

    public sealed class Rules
    {
        public string? Genre { get; set; } public string GenreMatch { get; set; } = "contains";
        public int? YearMin { get; set; } public int? YearMax { get; set; }
        public int? AddedDays { get; set; } public int? NotPlayedDays { get; set; }
        public string? Artist { get; set; }
    }
    public sealed class Smart { public long Id { get; set; } public string Name { get; set; } = ""; public Rules Rules { get; set; } = new(); public string UpdatedAt { get; set; } = ""; }

    public List<Smart> All() { try { if (_db.Setting(Key) is { } j) return JsonSerializer.Deserialize<List<Smart>>(j, J) ?? new(); } catch { } return new(); }
    private void SaveAll(List<Smart> l) => _db.SetSetting(Key, JsonSerializer.Serialize(l, J));
    public Smart? Get(long id) => All().FirstOrDefault(x => x.Id == id);

    /// <summary>Checks and tidies the rules; returns an error for the user, or null.</summary>
    public static string? Clean(Rules r)
    {
        r.Genre = string.IsNullOrWhiteSpace(r.Genre) ? null : r.Genre.Trim(); r.Artist = string.IsNullOrWhiteSpace(r.Artist) ? null : r.Artist.Trim();
        r.GenreMatch = r.GenreMatch == "equals" ? "equals" : "contains";
        if (r.YearMin is < 1000 or > 3000 || r.YearMax is < 1000 or > 3000) return "Years must look like 1995.";
        if (r.YearMin != null && r.YearMax != null && r.YearMin > r.YearMax) return "The first year must not be after the last year.";
        if (r.AddedDays is < 1 or > 36500 || r.NotPlayedDays is < 1 or > 36500) return "Days must be 1 or more.";
        if (Count(r) == 0) return "Add at least one rule.";
        return null;
    }
    /// <summary>The number of rules in use (year min/max is one rule): at most 5.</summary>
    public static int Count(Rules r) => (r.Genre != null ? 1 : 0) + (r.YearMin != null || r.YearMax != null ? 1 : 0) + (r.AddedDays != null ? 1 : 0) + (r.NotPlayedDays != null ? 1 : 0) + (r.Artist != null ? 1 : 0);

    /// <summary>True once the server keeps a play history (the "not played lately" rule needs it; without it that rule is skipped).</summary>
    public bool HasHistory => Convert.ToInt32(_db.Scalar($"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{HistoryTable}'")) > 0;

    private (string Where, (string, object?)[] P) Sql(Rules r)
    {
        var w = new List<string> { "missing=0" }; var p = new List<(string, object?)>();
        static string Esc(string x) => x.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        if (r.Genre != null) { if (r.GenreMatch == "equals") { w.Add("genre=$g COLLATE NOCASE"); p.Add(("$g", r.Genre)); } else { w.Add("genre LIKE $g ESCAPE '\\'"); p.Add(("$g", "%" + Esc(r.Genre) + "%")); } }
        if (r.YearMin != null) { w.Add("year>=$y0"); p.Add(("$y0", r.YearMin)); }
        if (r.YearMax != null) { w.Add("year<=$y1"); p.Add(("$y1", r.YearMax)); }
        if (r.AddedDays != null) { w.Add("added_at>=$ad"); p.Add(("$ad", Clock().AddDays(-r.AddedDays.Value).ToString("O"))); }
        if (r.NotPlayedDays != null && HasHistory) { w.Add($"id NOT IN (SELECT track_id FROM {HistoryTable} WHERE track_id IS NOT NULL AND started_at>=$np)"); p.Add(("$np", Clock().AddDays(-r.NotPlayedDays.Value).ToString("O"))); }
        if (r.Artist != null) { w.Add("(artist LIKE $ar ESCAPE '\\' OR album_artist LIKE $ar ESCAPE '\\')"); p.Add(("$ar", "%" + Esc(r.Artist) + "%")); }
        return (string.Join(" AND ", w), p.ToArray());
    }
    public List<long> Resolve(Rules r, int limit = 5000) { var (w, p) = Sql(r); return _db.Query($"SELECT id FROM track WHERE {w} ORDER BY album_artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no LIMIT {Math.Clamp(limit, 1, 5000)}", x => x.GetInt64(0), p); }
    public List<long> Resolve(long id) => Get(id) is { } s ? Resolve(s.Rules) : new();
    public object Preview(Rules r)
    {
        var (w, p) = Sql(r); var n = Convert.ToInt32(_db.Scalar($"SELECT COUNT(*) FROM track WHERE {w}", p));
        var sample = _db.Query($"SELECT title, artist FROM track WHERE {w} ORDER BY random() LIMIT 5", x => x.GetString(0) + " - " + x.GetString(1), p);
        return new { count = n, sample, localOnly = true, notPlayedSkipped = r.NotPlayedDays != null && !HasHistory };
    }

    public (Smart? S, string? Error) Save(long? id, string? name, Rules r)
    {
        name = (name ?? "").Trim(); if (name.Length is 0 or > 80) return (null, "The name must be 1-80 characters.");
        if (Clean(r) is { } err) return (null, err);
        lock (_l)
        {
            var l = All(); var s = id is long i ? l.FirstOrDefault(x => x.Id == i) : null;
            if (id != null && s == null) return (null, "That smart playlist is gone.");
            if (s == null) { s = new Smart { Id = l.Count == 0 ? 1 : l.Max(x => x.Id) + 1 }; l.Add(s); }
            s.Name = name; s.Rules = r; s.UpdatedAt = Clock().ToString("O"); SaveAll(l); return (s, null);
        }
    }
    public bool Delete(long id) { lock (_l) { var l = All(); var n = l.RemoveAll(x => x.Id == id); SaveAll(l); return n > 0; } }
}
