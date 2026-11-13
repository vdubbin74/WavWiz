using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Features;

/// <summary>0.6.9 #19 (t1846-t1849): the Jukebox zone's OFF / ON is a saved setting (Jukebox config "zoneOn", off on a fresh setup and on
/// installs that never set it). It used to be worked out from the zone's speakers, and the Jukebox only holds speakers while it runs (0.4.9 F76),
/// so with no speakers the switch flipped nothing and sprang back. Now: ON = the Jukebox zone plays - while the Jukebox runs its speakers are
/// on. OFF = the Jukebox zone is silent - while the Jukebox runs, the speakers it borrowed are switched off (guests can still add songs).
/// Speakers switched off this way are remembered (setting "jukebox.zoneOffIds") and switched back on when the zone is turned on, when they
/// leave the Jukebox zone, when the Jukebox stops, or at the next server start - a speaker never stays off in its own zone because of this.</summary>
public static class JukeboxPower
{
    public const string OffKey = "jukebox.zoneOffIds";
    private static readonly object L = new();

    public static List<long> OffIds(Db db) { try { var j = db.Setting(OffKey); return j == null ? new() : JsonSerializer.Deserialize<List<long>>(j) ?? new(); } catch { return new(); } }

    /// <summary>Brings the Jukebox zone's speakers in line with the saved switch. Safe to call any time (start, speaker change, Save, stop, server start).</summary>
    public static void Apply(Services s)
    {
        lock (L)
        {
            var off = OffIds(s.Db); var before = off.Count; var on = s.Jukebox.Cfg().ZoneOn;
            var jb = s.Jukebox.Active ? s.Links.JukeboxDeviceIds().ToHashSet() : new HashSet<long>();
            var changed = false;
            foreach (var id in off.ToList()) if (on || !jb.Contains(id)) { try { s.Zones.Patch(id, null, null, null, true); } catch { /* removed device */ } off.Remove(id); changed = true; }
            if (!on && jb.Count > 0)
                foreach (var z in s.Zones.Zones().Where(z => jb.Contains(z.Id) && z.Enabled)) { if (s.Zones.Patch(z.Id, null, null, null, false) == null) { off.Add(z.Id); changed = true; } }
            if (changed || before != off.Count) s.Db.SetSetting(OffKey, JsonSerializer.Serialize(off.Distinct().ToList()));
        }
    }
}
