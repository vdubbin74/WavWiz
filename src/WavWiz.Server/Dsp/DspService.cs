using System.Text.Json;
using WavWiz.Dsp;
namespace WavWiz.Server.Dsp;

public sealed record PresetRow(long Id, string Name, int Revision, string Source, JsonElement Json, string UpdatedAt);
public sealed record Assignment(string OutputDeviceId, long? PresetId, bool Enabled, bool Bypass, long Revision);

/// <summary>Per-speaker EQ presets (global across PCs, D14) and their assignment to output devices (spec 11).</summary>
public sealed class DspService
{
    public static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    private readonly Db _db;
    public event Action<string>? DeviceChanged;          // output device key whose effective DSP changed

    public DspService(Db db) { _db = db; Seed(); }

    /// <summary>0.3.7 L7: purpose-based built-in presets, grouped by situation / speaker type / music. Graphic bands: 31 62 125 250 500 1k 2k 4k 8k 16k Hz.</summary>
    public static readonly (string Group, string Name, DspPreset P)[] PurposePresets =
    {
        ("", "Flat", DspPreset.Flat),
        ("Situation", "Late Night", new DspPreset { GraphicDb = new double[] { -6, -4, -1, 0, 0, 1, 2, 1, 0, -2 }, Loudness = new LoudnessSettings(true, 70), Limiter = new LimiterSettings(true, -3, 120, 0) }),
        ("Situation", "Party Loud", new DspPreset { GraphicDb = new double[] { 4, 4, 2, 0, -1, 0, 1, 3, 3, 2 }, Bass = new ShelfSettings(3, 100), TrimDb = -2 }),
        ("Situation", "Background", new DspPreset { GraphicDb = new double[] { -3, -2, -1, 0, 0, 0, 0, -1, -2, -3 }, TrimDb = -3 }),
        ("Situation", "Vocals / Podcasts", new DspPreset { GraphicDb = new double[] { -6, -5, -3, -1, 1, 3, 4, 3, 0, -2 } }),
        ("Situation", "Movie Night", new DspPreset { GraphicDb = new double[] { 4, 3, 1, 0, 0, 2, 3, 1, 1, 2 }, Bass = new ShelfSettings(2, 80) }),
        ("Speaker type", "Bluetooth Speaker", new DspPreset { GraphicDb = new double[] { -3, -2, 0, 0, 0, 1, 1, 2, 1, 0 }, Bass = new ShelfSettings(-2, 150) }),
        ("Speaker type", "Bookshelf", new DspPreset { GraphicDb = new double[] { 2, 3, 2, 0, 0, 0, 0, 0, 1, 1 }, Bass = new ShelfSettings(2, 90) }),
        ("Speaker type", "Tower", new DspPreset { GraphicDb = new double[] { -1, -1, -1, 0, 0, 0, 0, 1, 1, 1 } }),
        ("Speaker type", "Subwoofer Zone", new DspPreset { GraphicDb = new double[] { 3, 3, 1, -3, -6, -8, -8, -8, -8, -8 }, Bass = new ShelfSettings(3, 80) }),
        ("Speaker type", "Headphones", new DspPreset { GraphicDb = new double[] { 2, 1, 0, -1, 0, 0, 1, 2, 1, 0 }, TrimDb = -2 }),
        ("Speaker type", "Outdoor", new DspPreset { GraphicDb = new double[] { 5, 4, 2, 0, 0, 1, 2, 3, 3, 2 }, Bass = new ShelfSettings(4, 100) }),
        ("Music", "Hip-Hop", new DspPreset { GraphicDb = new double[] { 5, 4, 2, 1, 0, -1, 0, 1, 2, 1 }, Bass = new ShelfSettings(3, 90) }),
        ("Music", "Rock / Metal", new DspPreset { GraphicDb = new double[] { 3, 2, 1, -1, -2, 0, 2, 3, 3, 2 } }),
        ("Music", "Acoustic / Jazz", new DspPreset { GraphicDb = new double[] { 0, 1, 2, 1, 0, 0, 1, 2, 2, 1 } }),
        ("Music", "Electronic", new DspPreset { GraphicDb = new double[] { 4, 4, 1, 0, -2, 0, 1, 2, 3, 3 }, Bass = new ShelfSettings(2, 100) }),
        ("Music", "Classical", new DspPreset { GraphicDb = new double[] { 0, 0, 0, 0, 0, 0, -1, -1, 0, 1 } }),
    };
    private static readonly string[] OldGenericPresets = { "Bass boost", "Vocal / speech", "Small speaker (tame bass)", "Bright room (softer treble)" };

    private void Seed()
    {
        void Add(string name, DspPreset p) => _db.Insert("INSERT INTO dsp_preset(name,source,json,created_at,updated_at) VALUES($n,'builtin',$j,$t,$t)",
            ("$n", name), ("$j", JsonSerializer.Serialize(p.Normalize() with { Name = name }, J)), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        var have = new HashSet<string>(_db.Query("SELECT name FROM dsp_preset WHERE source='builtin'", r => r.GetString(0)));
        foreach (var (_, name, p) in PurposePresets) if (!have.Contains(name)) Add(name, p);
        // 0.3.7 L7: the four generic presets are replaced - except where a speaker still uses one (then it stays, so nothing changes under it)
        foreach (var old in OldGenericPresets)
            _db.Exec("DELETE FROM dsp_preset WHERE source='builtin' AND name=$n AND id NOT IN (SELECT dsp_preset_id FROM output_device_dsp WHERE dsp_preset_id IS NOT NULL) AND id NOT IN (SELECT dsp_preset_id FROM speaker_profile WHERE dsp_preset_id IS NOT NULL)", ("$n", old));
    }

    private static PresetRow Map(Microsoft.Data.Sqlite.SqliteDataReader r) =>
        new(r.GetInt64(0), r.GetString(1), r.GetInt32(2), r.GetString(3), JsonDocument.Parse(r.GetString(4)).RootElement.Clone(), r.GetString(5));

    private const string Cols = "id,name,revision,source,json,updated_at";
    public List<PresetRow> Presets() => _db.Query($"SELECT {Cols} FROM dsp_preset ORDER BY source DESC, name COLLATE NOCASE", Map);
    public PresetRow? Get(long id) => _db.Query($"SELECT {Cols} FROM dsp_preset WHERE id=$i", Map, ("$i", id)).FirstOrDefault();

    public static (DspPreset? Preset, string? Error) Parse(JsonElement e)
    {
        try
        {
            if (e.ValueKind != JsonValueKind.Object) return (null, "preset must be a JSON object");
            if (e.GetRawText().Length > 8192) return (null, "preset is too large");
            var p = JsonSerializer.Deserialize<DspPreset>(e.GetRawText(), J);
            return p == null ? (null, "empty preset") : (p.Normalize(), null);
        }
        catch (Exception ex) { return (null, "invalid preset: " + ex.Message); }
    }

    public (long? Id, string? Error) Create(string name, JsonElement json)
    {
        name = (name ?? "").Trim(); if (name.Length is 0 or > 60) return (null, "name must be 1-60 characters");
        var (p, err) = Parse(json); if (p == null) return (null, err);
        var now = DateTimeOffset.UtcNow.ToString("O");
        return (_db.Insert("INSERT INTO dsp_preset(name,source,json,created_at,updated_at) VALUES($n,'user',$j,$t,$t)", ("$n", name), ("$j", JsonSerializer.Serialize(p with { Name = name }, J)), ("$t", now)), null);
    }

    public string? Update(long id, string? name, JsonElement? json)
    {
        var row = Get(id); if (row == null) return "not found";
        if (row.Source == "builtin") return "built-in presets cannot be edited - duplicate it first";
        DspPreset? p = null;
        if (json is JsonElement je) { var (pp, err) = Parse(je); if (pp == null) return err; p = pp; }
        var nm = string.IsNullOrWhiteSpace(name) ? row.Name : name.Trim(); if (nm.Length > 60) return "name too long";
        var final = (p ?? JsonSerializer.Deserialize<DspPreset>(row.Json.GetRawText(), J)!) with { Name = nm };
        _db.Exec("UPDATE dsp_preset SET name=$n,json=$j,revision=revision+1,updated_at=$t WHERE id=$i", ("$n", nm), ("$j", JsonSerializer.Serialize(final, J)), ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        foreach (var dev in DevicesUsing(id)) DeviceChanged?.Invoke(dev);
        return null;
    }

    public string? Delete(long id)
    {
        var row = Get(id); if (row == null) return "not found"; if (row.Source == "builtin") return "built-in presets cannot be deleted";
        var devs = DevicesUsing(id);
        _db.Exec("UPDATE output_device_dsp SET dsp_preset_id=NULL, updated_at=$t WHERE dsp_preset_id=$i", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$i", id));
        _db.Exec("DELETE FROM dsp_preset WHERE id=$i", ("$i", id));
        foreach (var d in devs) DeviceChanged?.Invoke(d);
        return null;
    }

    private List<string> DevicesUsing(long presetId) => _db.Query("SELECT output_device_id FROM output_device_dsp WHERE dsp_preset_id=$i", r => r.GetString(0), ("$i", presetId));

    public Assignment? AssignmentFor(string deviceKey) => _db.Query("SELECT output_device_id,dsp_preset_id,enabled,bypass,updated_at FROM output_device_dsp WHERE output_device_id=$d",
        r => new Assignment(r.GetString(0), r.IsDBNull(1) ? null : r.GetInt64(1), r.GetInt32(2) != 0, r.GetInt32(3) != 0, DateTimeOffset.Parse(r.GetString(4)).UtcTicks / 10_000), ("$d", deviceKey)).FirstOrDefault();

    public string? Assign(string deviceKey, long? presetId, bool enabled, bool bypass)
    {
        if (presetId != null && Get(presetId.Value) == null) return "preset not found";
        _db.Exec("INSERT INTO output_device_dsp(output_device_id,dsp_preset_id,enabled,bypass,updated_at) VALUES($d,$p,$e,$b,$t) ON CONFLICT(output_device_id) DO UPDATE SET dsp_preset_id=$p,enabled=$e,bypass=$b,updated_at=$t",
            ("$d", deviceKey), ("$p", presetId), ("$e", enabled ? 1 : 0), ("$b", bypass ? 1 : 0), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        DeviceChanged?.Invoke(deviceKey); return null;
    }

    /// <summary>What a player should apply for this device (null preset = flat).</summary>
    public (long Revision, bool Bypass, JsonElement? Preset) Effective(string deviceKey)
    {
        var a = AssignmentFor(deviceKey);
        if (a == null || !a.Enabled || a.PresetId == null) return (a?.Revision ?? 0, a?.Bypass ?? false, null);
        var row = Get(a.PresetId.Value); if (row == null) return (a.Revision, a.Bypass, null);
        return (Math.Max(a.Revision, row.Revision) * 1000 + row.Revision, a.Bypass, row.Json);
    }

    public static object Response(DspPreset p, int points = 96, int rate = 48000)
    {
        var hz = Enumerable.Range(0, points).Select(i => 20 * Math.Pow(1000, i / (double)(points - 1))).ToArray();
        var db = DspChain.Response(p.Normalize(), rate, hz);
        return new { hz = hz.Select(x => Math.Round(x, 1)), db = db.Select(x => Math.Round(double.IsFinite(x) ? x : 0, 2)), preGainDb = Math.Round(new DspProgram(p.Normalize(), rate, 100).PreGainDb, 2) };
    }
}
