namespace WavWiz.Server.Zones;

/// <summary>
/// 0.7.2 D: acoustic zone-to-zone timing check. Stand where you hear two zones at once (a doorway, an open-plan room) with a phone; the
/// other zone's speaker plays the calibration chirps, then this zone's speaker, each scheduled exactly like music (with its saved delay
/// and its zone's "vs house" offset). The phone records both in one take, so its own microphone delay cancels out. The result is how much
/// later this zone sounds than the other one at that spot, and the "Timing vs house" value that would line them up. Nothing is saved
/// until an administrator presses Apply.
/// </summary>
public static class ZoneCheck
{
    public const int Runs = 3;
    /// <summary>Results further apart than this between runs are reported as unsteady (echo, someone talking).</summary>
    public const double SpreadWarnMs = 4;

    /// <summary>The "Timing vs house" value that makes this zone line up with the other one: it sounded <paramref name="laterMs"/> late, so it plays that much earlier.</summary>
    public static double Suggest(double currentMs, double laterMs) => Math.Round(Math.Clamp(currentMs - laterMs, -ZoneManager.HouseOffMaxMs, ZoneManager.HouseOffMaxMs), 1);

    /// <summary>True when the needed change is larger than the offset can hold: the speakers need calibrating first.</summary>
    public static bool OutOfRange(double currentMs, double laterMs) => Math.Abs(currentMs - laterMs) > ZoneManager.HouseOffMaxMs;

    public static double Median(IReadOnlyList<double> xs)
    {
        if (xs.Count == 0) throw new ArgumentException("no values");
        var o = xs.OrderBy(x => x).ToList(); int n = o.Count;
        return n % 2 == 1 ? o[n / 2] : (o[n / 2 - 1] + o[n / 2]) / 2;
    }

    /// <summary>The speaker that represents a zone: its reference when it can play, else the first member that can (in the zone's order).</summary>
    public static long? PickSpeaker(long? referenceId, IEnumerable<long> members, Func<long, bool> canPlay)
    {
        if (referenceId is long r && canPlay(r)) return r;
        foreach (var m in members) if (canPlay(m)) return m;
        return null;
    }

    /// <summary>Which zone to compare with when the person did not pick one: the zone holding the house reference speaker, else the first other zone that can play.</summary>
    public static long? DefaultAgainst(long zoneId, long? houseRefGroup, IEnumerable<long> groupsThatCanPlay)
    {
        var can = groupsThatCanPlay.ToList();
        if (houseRefGroup is long h && h != zoneId && can.Contains(h)) return h;
        foreach (var g in can) if (g != zoneId) return g;
        return null;
    }
}
