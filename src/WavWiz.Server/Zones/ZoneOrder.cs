using System.Text.Json;
using System.Text.RegularExpressions;
namespace WavWiz.Server.Zones;

/// <summary>0.6.9 #12: the Devices tree card order - zones ("g:{id}"), the Jukebox, the Unassigned speakers and the AirPlay card - kept on the
/// SERVER (setting "zones.cardOrder") so it survives restarts and every browser / Player shows the same order. Stored exactly as the user left it:
/// no rank split, no pinning. Cards the list does not name yet (a new zone) are added after the named ones by the client.</summary>
public static partial class ZoneOrder
{
    public const string SettingKey = "zones.cardOrder";
    public const int MaxEntries = 1000;
    [GeneratedRegex(@"^(g:\d{1,18}|jukebox|unassigned|airplay|cast)$")] private static partial Regex KeyRx();

    /// <summary>Valid, de-duplicated card keys in the given order, or null when the body is not a list of known card keys.</summary>
    public static List<string>? Normalize(JsonElement order)
    {
        if (order.ValueKind != JsonValueKind.Array || order.GetArrayLength() > MaxEntries) return null;
        var seen = new HashSet<string>(); var outp = new List<string>();
        foreach (var e in order.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.String) return null;
            var k = e.GetString()!;
            if (!KeyRx().IsMatch(k)) return null;
            if (seen.Add(k)) outp.Add(k);
        }
        return outp;
    }

    public static List<string> Load(Db db)
    {
        try
        {
            var raw = db.Setting(SettingKey); if (string.IsNullOrEmpty(raw)) return new();
            using var d = JsonDocument.Parse(raw); return Normalize(d.RootElement) ?? new();
        }
        catch { return new(); }
    }

    public static void Save(Db db, List<string> order) => db.SetSetting(SettingKey, JsonSerializer.Serialize(order));
}
