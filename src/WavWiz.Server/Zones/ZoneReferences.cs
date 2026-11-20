namespace WavWiz.Server.Zones;

/// <summary>
/// 0.6.8-#15: one reference speaker per zone (the zone's timing clock for calibration). Pure rules, unit-tested:
/// <list type="bullet">
/// <item>a zone has at most one reference, one of its own speakers. 0.6.8 zone fix: no speaker is the reference until the user picks one - a new zone,
/// or a one-speaker zone, has none (its speakers show NO DELAY until they are measured);</item>
/// <item>a speaker that moves into a zone joins as a regular speaker (the zone keeps its reference; the UI may offer a swap);</item>
/// <item>0.7.1: the zone it left gets NO automatic new reference - it is flagged (<see cref="Change"/> with New = 0) and the UI shows the
/// recommended replacement (<see cref="Rank"/>) for a one-tap switch. A user-chosen reference never changes silently;</item>
/// <item>0.7.1 recommendation (<see cref="Rank"/>): wired on the server / a WavWiz player > wired on a PC > browser or built-in > AirPlay / Cast >
/// Bluetooth; ties by the lowest measured (else reported) delay, then the steadiest, then online, then the lowest id;</item>
/// <item>first run (no per-zone setting yet): the old house reference becomes the reference of its zone; the other zones get none.</item>
/// </list>
/// Delays are absolute against the house clock, so re-basing on a new reference keeps every applied delay and only rewrites the stored
/// offsets (<see cref="Rebase"/>): nothing has to be recalibrated.
/// </summary>
public static class ZoneRefs
{
    public const string MapKey = "calibration.referenceByZone", NoteKey = "calibration.referenceNotes";
    /// <summary>A reference candidate. <paramref name="TierHint"/> (0.7.1): 0 wired on the server / a WavWiz player, 1 wired on a PC, 2 browser or
    /// built-in output, 3 AirPlay / Cast, 4 Bluetooth (null = 1 when wired, else 3). <paramref name="DelayMs"/>: measured delay, else the delay the
    /// output reports, else null (unknown sorts last).</summary>
    public sealed record Cand(long Id, bool Wired, bool Connected, double Instability, int? TierHint = null, double? DelayMs = null, bool OnServer = false)
    {
        public int Tier => TierHint ?? (Wired ? 1 : 3);
    }
    /// <summary>A zone whose stored reference is no longer one of its speakers. 0.7.1: New is always 0 (flagged, never re-picked).</summary>
    public sealed record Change(long Group, long Old, long New);
    public const int TierServerWired = 0, TierPcWired = 1, TierBrowser = 2, TierNetwork = 3, TierBluetooth = 4;

    public static bool IsWiredKind(string? kind) => kind is "analog" or "wired" or "hdmi" or "spdif" or "usb";

    /// <summary>0.7.1: the tier of an output for the recommendation (see <see cref="Cand"/>).</summary>
    public static int TierOf(string playerId, string? kind, bool isWeb, bool onServer, bool hasBtAddress = false)
    {
        if (kind == "bluetooth" || hasBtAddress) return TierBluetooth;
        if (playerId.StartsWith("airplay:", StringComparison.Ordinal) || playerId.StartsWith("cast:", StringComparison.Ordinal)) return TierNetwork;
        if (isWeb || playerId.StartsWith("web-", StringComparison.Ordinal)) return TierBrowser;
        if (!IsWiredKind(kind)) return TierBrowser;   // built-in / unknown output of a player: not a wired line out
        return onServer || playerId.StartsWith("local-", StringComparison.Ordinal) ? TierServerWired : TierPcWired;
    }
    /// <summary>0.7.1: best reference first (see the class notes). Pure.</summary>
    public static List<Cand> Rank(IEnumerable<Cand> c) =>
        c.OrderBy(x => x.Tier).ThenBy(x => x.DelayMs ?? double.MaxValue).ThenBy(x => x.Instability).ThenBy(x => x.Connected ? 0 : 1).ThenBy(x => x.Id).ToList();
    /// <summary>0.7.1: the recommended reference = the best-ranked ONLINE speaker (null when none is online). Pure.</summary>
    public static Cand? Recommend(IEnumerable<Cand> c, long? except = null) => Rank(c.Where(x => x.Connected && x.Id != except)).FirstOrDefault();
    /// <summary>0.7.1: Bluetooth / AirPlay / Cast may be a reference, but always with a warning.</summary>
    public static bool Warn(Cand c) => c.Tier >= TierNetwork;
    /// <summary>0.7.1: the one-line reason shown next to RECOMMENDED. Pure.</summary>
    public static string Reason(Cand c)
    {
        string what = c.Tier switch
        {
            TierServerWired => c.OnServer ? "Wired output on the server" : "Wired output on a WavWiz player",
            TierPcWired => "Wired output on a PC",
            TierBrowser => "Browser or built-in speaker",
            TierNetwork => "AirPlay / Cast: network delay can drift",
            _ => "Bluetooth: its delay can change when it reconnects",
        };
        return c.DelayMs is double d && double.IsFinite(d) ? $"{what}, lowest delay ({d:0} ms)" : what;
    }

    /// <summary>Legacy pick (0.6.8): wired, online, steadiest, lowest id. Kept for callers that only know Wired; 0.7.1 code uses <see cref="Rank"/>.</summary>
    public static long Pick(IEnumerable<Cand> c) =>
        c.OrderBy(x => x.Wired ? 0 : 1).ThenBy(x => x.Connected ? 0 : 1).ThenBy(x => x.Instability).ThenBy(x => x.Id).First().Id;

    /// <summary>Valid per-zone references for the current membership. <paramref name="stored"/> null = first run (migration from <paramref name="houseRef"/>).
    /// Changes lists the zones whose stored reference was no longer one of their speakers (moved away / removed); 0.7.1: they get none (flagged).</summary>
    public static (Dictionary<long, long> Map, List<Change> Changes) Normalize(IReadOnlyDictionary<long, long>? stored, IReadOnlyDictionary<long, List<long>> members, Func<long, Cand> cand, long houseRef)
    {
        var map = new Dictionary<long, long>(); var ch = new List<Change>();
        foreach (var (g, ms) in members.OrderBy(kv => kv.Key))
        {
            if (ms.Count == 0) continue;
            if (stored != null && stored.TryGetValue(g, out var r) && ms.Contains(r)) { map[g] = r; continue; }
            bool hadRef = stored != null && stored.ContainsKey(g);   // the user's reference left this zone
            if (hadRef) { ch.Add(new Change(g, stored![g], 0)); continue; }   // 0.7.1: flag it (the UI offers the recommended one), never re-pick
            long pick = stored == null && houseRef != 0 && ms.Contains(houseRef) ? houseRef : 0;   // first run: migrate the house reference
            if (pick == 0) continue;   // 0.6.8 zone fix: never auto-REF a new zone or a lone speaker
            map[g] = pick;
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
