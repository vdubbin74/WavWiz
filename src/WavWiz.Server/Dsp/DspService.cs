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

    private void Seed()
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM dsp_preset WHERE source='builtin'")) > 0) return;
        void Add(string name, DspPreset p) => _db.Insert("INSERT INTO dsp_preset(name,source,json,created_at,updated_at) VALUES($n,'builtin',$j,$t,$t)",
            ("$n", name), ("$j", JsonSerializer.Serialize(p.Normalize() with { Name = name }, J)), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        Add("Flat", DspPreset.Flat);
        Add("Bass boost", new DspPreset { Bass = new ShelfSettings(5, 120) });
        Add("Vocal / speech", new DspPreset { GraphicDb = new double[] { -4, -3, -2, 0, 1, 2, 3, 2, 0, -1 } });
        Add("Small speaker (tame bass)", new DspPreset { Bass = new ShelfSettings(-4, 150), TrimDb = -1 });
        Add("Bright room (softer treble)", new DspPreset { Treble = new ShelfSettings(-4, 8000) });
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
