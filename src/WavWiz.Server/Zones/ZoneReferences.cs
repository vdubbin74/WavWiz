namespace WavWiz.Server.Zones;

/// <summary>
/// 0.6.8-#15: one reference speaker per zone (the zone's timing clock for calibration). Pure rules, unit-tested:
/// <list type="bullet">
/// <item>every zone with speakers has exactly one reference, one of its own speakers; a one-speaker zone uses that speaker;</item>
/// <item>a speaker that moves into a zone joins as a regular speaker (the zone keeps its reference; the UI may offer a swap);</item>
/// <item>the zone it left picks a new reference: wired first, then online, then the steadiest (fewest underruns / resyncs, smallest sync error), then the lowest id;</item>
/// <item>first run (no per-zone setting yet): the old house reference becomes the reference of its zone, the other zones auto-pick.</item>
/// </list>
/// Delays are absolute against the house clock, so re-basing on a new reference keeps every applied delay and only rewrites the stored
/// offsets (<see cref="Rebase"/>): nothing has to be recalibrated.
/// </summary>
public static class ZoneRefs
{
    public const string MapKey = "calibration.referenceByZone", NoteKey = "calibration.referenceNotes";
    public sealed record Cand(long Id, bool Wired, bool Connected, double Instability);
    public sealed record Change(long Group, long Old, long New);

    public static bool IsWiredKind(string? kind) => kind is "analog" or "wired" or "hdmi" or "spdif" or "usb";

    public static long Pick(IEnumerable<Cand> c) =>
        c.OrderBy(x => x.Wired ? 0 : 1).ThenBy(x => x.Connected ? 0 : 1).ThenBy(x => x.Instability).ThenBy(x => x.Id).First().Id;

    /// <summary>Valid per-zone references for the current membership. <paramref name="stored"/> null = first run (migration from <paramref name="houseRef"/>).
    /// Changes lists the zones whose stored reference was no longer one of their speakers (moved away / removed) and got a new one.</summary>
    public static (Dictionary<long, long> Map, List<Change> Changes) Normalize(IReadOnlyDictionary<long, long>? stored, IReadOnlyDictionary<long, List<long>> members, Func<long, Cand> cand, long houseRef)
    {
        var map = new Dictionary<long, long>(); var ch = new List<Change>();
        foreach (var (g, ms) in members.OrderBy(kv => kv.Key))
        {
            if (ms.Count == 0) continue;
            if (stored != null && stored.TryGetValue(g, out var r) && ms.Contains(r)) { map[g] = r; continue; }
            long pick = stored == null && houseRef != 0 && ms.Contains(houseRef) ? houseRef : ms.Count == 1 ? ms[0] : Pick(ms.Select(cand));
            map[g] = pick;
            if (stored != null && stored.TryGetValue(g, out var old)) ch.Add(new Change(g, old, pick));
        }
        return (map, ch);
    }

    /// <summary>Offsets of each speaker against the new reference (applied delay minus the reference's); empty when the new reference has no delay yet.</summary>
    public static Dictionary<long, double> Rebase(IReadOnlyDictionary<long, double> latency, long newRef) =>
        latency.TryGetValue(newRef, out var lr) ? latency.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value - lr, 1)) : new();

    public static Dictionary<long, long>? ParseMap(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, long>>(json)?.Where(kv => long.TryParse(kv.Key, out _)).ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value) ?? new(); }
        catch { return new(); }
    }
    public static string MapJson(IReadOnlyDictionary<long, long> m) => System.Text.Json.JsonSerializer.Serialize(m.ToDictionary(kv => kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv => kv.Value));
}
