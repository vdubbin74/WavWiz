using System.Globalization;
namespace WavWiz.Server.Features;

/// <summary>0.3.0 sleep timer: Off / minutes / end of song / end of album, for one zone or all. Fades out over the last 30 s, then stops (all) or
/// switches the zone off, and puts the volumes back where they were. Broadcast as "sleep" over the ws.</summary>
public sealed class SleepService
{
    public const double FadeSec = 30;
    private readonly Zones.ZoneManager _zones; private readonly Playback.Conductor _cond; private readonly EventHub _ev; private readonly object _l = new();
    public Func<DateTime> Clock { get; set; } = () => DateTime.Now;
    public DateTime? EndsAt { get; private set; }
    public string Mode { get; private set; } = "off";
    public List<long>? ZoneIds { get; private set; }
    /// <summary>0.4.0: the zone this timer is for ("g:3" / "jukebox"); null = everything like before.</summary>
    public string? ZoneKey { get; private set; }
    public Func<string?, Playback.Conductor>? CondFor { get; set; }
    public Func<string?, List<long>?>? DevicesOf { get; set; }
    private Playback.Conductor Cond(string? key) => CondFor?.Invoke(key) ?? _cond;
    private Dictionary<long, double>? _saved;
    public SleepService(Zones.ZoneManager zones, Playback.Conductor cond, EventHub ev) { _zones = zones; _cond = cond; _ev = ev; }

    public object State() { lock (_l) return new { mode = Mode, endsAt = EndsAt?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture), remainingSec = EndsAt is DateTime e ? Math.Max(0, (int)(e - Clock()).TotalSeconds) : 0, zoneIds = ZoneIds, zoneKey = ZoneKey }; }

    /// <summary>Milliseconds left in the current song, and to the end of the current album (consecutive queue items with the same album).</summary>
    public static (long Song, long Album) Remaining(IReadOnlyList<Media.QueueItem> q, int index, long posMs, long durMs)
    {
        if (index < 0 || index >= q.Count) return (0, 0);
        long song = Math.Max(0, (durMs > 0 ? durMs : q[index].DurationMs) - posMs), album = song;
        var cur = q[index];
        for (int i = index + 1; i < q.Count; i++) { if (string.IsNullOrWhiteSpace(cur.Album) || !string.Equals(q[i].Album, cur.Album, StringComparison.OrdinalIgnoreCase)) break; album += q[i].DurationMs; }
        return (song, album);
    }

    public string? Set(string? mode, double? minutes, List<long>? zoneIds, string? zoneKey = null)
    {
        lock (_l)
        {
            Restore();
            var now = Clock();
            if (mode == "off" || (mode == null && (minutes ?? 0) <= 0)) { EndsAt = null; Mode = "off"; ZoneIds = null; ZoneKey = null; Publish(); return null; }
            double ms;
            if (mode is "song" or "album")
            {
                zoneKey = string.IsNullOrWhiteSpace(zoneKey) ? null : zoneKey; var tc = Cond(zoneKey); var np = tc.Now(); var q = tc.Queue();
                if (np.Item == null || np.State == "stopped") return "Nothing is playing.";
                if (Playback.Conductor.IsLive(np.Item.Kind)) return "End of song doesn't work for radio. Pick a time instead.";
                var (song, album) = Remaining(q, np.Index, np.PositionMs, np.DurationMs); ms = mode == "song" ? song : album;
            }
            else { if (minutes is not double m || m <= 0 || m > 24 * 60) return "Pick 1 minute to 24 hours."; ms = m * 60_000; mode = "minutes"; }
            EndsAt = now.AddMilliseconds(ms); Mode = mode!; ZoneIds = zoneIds is { Count: > 0 } ? zoneIds : null; ZoneKey = string.IsNullOrWhiteSpace(zoneKey) ? null : zoneKey; Publish(); return null;
        }
    }

    public void Tick()
    {
        lock (_l)
        {
            if (EndsAt is not DateTime e) return;
            var left = (e - Clock()).TotalSeconds;
            var targets = ZoneIds ?? (ZoneKey != null ? DevicesOf?.Invoke(ZoneKey) : null) ?? _zones.Zones().Where(z => z.Enabled).Select(z => z.Id).ToList();
            if (left <= 0)
            {
                if (ZoneKey != null) Cond(ZoneKey).Stop();      // a zone's timer stops that zone's music (its speakers keep their on / off state)
                else if (ZoneIds == null) _cond.Stop(); else foreach (var z in ZoneIds) _zones.Patch(z, null, null, null, false);
                Restore(); EndsAt = null; Mode = "off"; ZoneIds = null; ZoneKey = null; _ev.Publish("zones"); Publish(); return;
            }
            if (left <= FadeSec)
            {
                _saved ??= _zones.Zones().Where(z => targets.Contains(z.Id)).ToDictionary(z => z.Id, z => z.Volume);
                foreach (var (id, v) in _saved) _zones.Patch(id, null, v * Math.Clamp(left / FadeSec, 0, 1), null, null);
                _ev.Publish("zones");
            }
        }
    }

    private void Restore() { if (_saved == null) return; foreach (var (id, v) in _saved) _zones.Patch(id, null, v, null, null); _saved = null; }
    private void Publish() => _ev.Publish("sleep", State());
}
