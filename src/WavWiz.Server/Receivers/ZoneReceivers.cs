using System.Text.Json;
using System.Security.Cryptography;
using WavWiz.Core.Discovery;
using WavWiz.Server.Api;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Receivers;

/// <summary>Where one zone's receiver plays: its name, ports and the playback group it feeds RIGHT NOW (the zone's group changes when it is linked or split).</summary>
public sealed record ZoneReceiverTarget(long Id, string Key, string Name, int Port, string? HwAddr, Func<Conductor> Cond, Func<bool> Enabled);

/// <summary>
/// 0.4.0 Stage 4: ONE name per zone. A zone that has "AirPlay" and/or "Spotify Connect" switched on shows up on phones as "WavWiz – &lt;zone name&gt;" (the same
/// name for both), and what a phone sends plays in THAT zone's playback group (its linked zones too), never in another zone. Off by default per zone: an
/// idle zone with no receiver costs nothing, an enabled one costs one small child process per protocol (shairplay = AirPlay 1 / RAOP, librespot).
/// The "WavWiz – Everywhere" receivers of 0.3.9 stay exactly as they were (house group).
/// Settings: receivers.zones = { "&lt;zone id&gt;": { airplay, spotify } }, receivers.ports and receivers.hw (stable per-zone ports and AirPlay hardware addresses).
/// </summary>
public sealed class ZoneReceivers : IDisposable
{
    public const string CfgKey = "receivers.zones", PortsKey = "receivers.ports", HwKey = "receivers.hw";
    public const string Prefix = "WavWiz – ";
    private readonly Services _s; private readonly Action<string>? _log; private readonly object _l = new();
    private readonly Dictionary<long, AirPlayReceiver> _ap = new(); private readonly Dictionary<long, SpotifyReceiver> _sp = new();
    private bool _disposed;
    public ZoneReceivers(Services s, Action<string>? log) { _s = s; _log = log; }

    public sealed record ZoneCfg(bool AirPlay, bool Spotify);
    public static string NameOf(string zoneName) => Prefix + zoneName.Trim();

    public Dictionary<long, ZoneCfg> Config()
    {
        try
        {
            var raw = _s.Db.Setting(CfgKey); if (string.IsNullOrWhiteSpace(raw)) return new();
            var d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(raw) ?? new(); var r = new Dictionary<long, ZoneCfg>();
            foreach (var (k, v) in d) if (long.TryParse(k, out var id))
                r[id] = new ZoneCfg(v.TryGetProperty("airplay", out var a) && a.ValueKind == JsonValueKind.True, v.TryGetProperty("spotify", out var sp) && sp.ValueKind == JsonValueKind.True);
            return r;
        }
        catch { return new(); }
    }
    private void SaveConfig(Dictionary<long, ZoneCfg> c) => _s.Db.SetSetting(CfgKey, JsonSerializer.Serialize(c.Where(kv => kv.Value.AirPlay || kv.Value.Spotify).ToDictionary(kv => kv.Key.ToString(), kv => new { airplay = kv.Value.AirPlay, spotify = kv.Value.Spotify })));

    private Dictionary<string, int> Ports() { try { var raw = _s.Db.Setting(PortsKey); return string.IsNullOrWhiteSpace(raw) ? new() : JsonSerializer.Deserialize<Dictionary<string, int>>(raw) ?? new(); } catch { return new(); } }
    /// <summary>A port per (protocol, zone), kept for good so phones that remember the speaker still find it. Starts above the house receivers' ports.</summary>
    public int PortFor(string kind, long zoneId)
    {
        lock (_l)
        {
            var m = Ports(); var key = kind + ":" + zoneId; if (m.TryGetValue(key, out var p)) return p;
            int next = Math.Max(Math.Max(_s.Cfg.AirPlayPort, _s.Cfg.SpotifyPort), m.Values.DefaultIfEmpty(0).Max()) + 1; if (next < _s.Cfg.AirPlayPort + 6) next = _s.Cfg.AirPlayPort + 6;
            m[key] = next; _s.Db.SetSetting(PortsKey, JsonSerializer.Serialize(m)); return next;
        }
    }
    private string HwFor(long zoneId)
    {
        lock (_l)
        {
            Dictionary<string, string> m; try { var raw = _s.Db.Setting(HwKey); m = string.IsNullOrWhiteSpace(raw) ? new() : JsonSerializer.Deserialize<Dictionary<string, string>>(raw) ?? new(); } catch { m = new(); }
            if (m.TryGetValue(zoneId.ToString(), out var h)) return h;
            var b = RandomNumberGenerator.GetBytes(6); b[0] = (byte)((b[0] & 0xFC) | 0x02);
            h = string.Join(":", b.Select(x => x.ToString("X2"))); m[zoneId.ToString()] = h; _s.Db.SetSetting(HwKey, JsonSerializer.Serialize(m)); return h;
        }
    }

    /// <summary>Switch a zone's AirPlay and/or Spotify Connect name on or off. Null = leave as is. Error text or null.</summary>
    public string? Set(long zoneId, bool? airplay, bool? spotify)
    {
        var zone = _s.Links.ZoneList().FirstOrDefault(z => z.Id == zoneId); if (zone.Id == 0) return "zone not found";
        lock (_l)
        {
            var c = Config(); c.TryGetValue(zoneId, out var cur); cur ??= new ZoneCfg(false, false);
            c[zoneId] = new ZoneCfg(airplay ?? cur.AirPlay, spotify ?? cur.Spotify); SaveConfig(c);
        }
        Sync(); _s.Events.Publish("receivers"); return null;
    }

    /// <summary>Make the running receivers match the settings and the current zones: start, stop, rename, and move each one to its zone's CURRENT playback group.</summary>
    public void Sync()
    {
        if (_disposed) return;
        lock (_l)
        {
            var cfg = Config(); var zones = _s.Links.ZoneList().ToDictionary(z => z.Id, z => z.Name); bool announce = false;
            foreach (var id in _ap.Keys.Where(k => !zones.ContainsKey(k) || !cfg.TryGetValue(k, out var c) || !c.AirPlay).ToList()) { _ap[id].Stop(); _ap[id].Dispose(); _ap.Remove(id); announce = true; }
            foreach (var id in _sp.Keys.Where(k => !zones.ContainsKey(k) || !cfg.TryGetValue(k, out var c) || !c.Spotify).ToList()) { _sp[id].Apply(); _sp[id].Dispose(); _sp.Remove(id); announce = true; }
            foreach (var (id, c) in cfg)
            {
                if (!zones.TryGetValue(id, out var zn)) continue; var name = NameOf(zn);
                Func<Conductor> cond = () => _s.Links.CondFor("g:" + id);
                if (c.AirPlay)
                {
                    if (!_ap.TryGetValue(id, out var ap))
                    {
                        ap = new AirPlayReceiver(_s, _log, new ZoneReceiverTarget(id, "airplay:" + id, name, PortFor("airplay", id), HwFor(id), cond, () => true)); _ap[id] = ap;
                        if (!IsLoopbackOnly()) ap.Start(); announce = true;
                    }
                    else { if (ap.DisplayName != name) { ap.DisplayName = name; announce = true; } ap.Bind(); }
                }
                if (c.Spotify)
                {
                    if (!_sp.TryGetValue(id, out var sp))
                    {
                        sp = new SpotifyReceiver(_s, _log, new ZoneReceiverTarget(id, "spotify:" + id, name, PortFor("spotify", id), null, cond, () => Config().TryGetValue(id, out var cc) && cc.Spotify)); _sp[id] = sp;
                        if (!IsLoopbackOnly()) sp.Apply(); announce = true;
                    }
                    else { sp.Rename(name); sp.Bind(); }
                }
            }
            if (announce) _s.Discovery?.AnnounceSoon();
        }
    }
    private bool IsLoopbackOnly() => System.Net.IPAddress.TryParse(_s.Cfg.BindAddress.Trim('[', ']'), out var ip) && System.Net.IPAddress.IsLoopback(ip) && !_s.Cfg.TestTreatAllClientsAsRemote;

    public IEnumerable<IEnumerable<DnsWire.Record>> MdnsGroups(string host, System.Net.IPAddress ip)
    {
        List<AirPlayReceiver> aps; List<SpotifyReceiver> sps; lock (_l) { aps = _ap.Values.ToList(); sps = _sp.Values.ToList(); }
        foreach (var a in aps) if (a.Running) yield return a.MdnsRecords(host, ip);
        foreach (var p in sps) if (p.MdnsRecords(host, ip) is { } g) yield return g;
    }

    public AirPlayReceiver? AirPlayOf(long zoneId) { lock (_l) return _ap.GetValueOrDefault(zoneId); }
    public SpotifyReceiver? SpotifyOf(long zoneId) { lock (_l) return _sp.GetValueOrDefault(zoneId); }
    /// <summary>Artwork of a zone receiver ("airplay:3" / "spotify:3").</summary>
    public (byte[] Bytes, string Type)? ArtOf(string key)
    {
        var p = key.Split(':'); if (p.Length != 2 || !long.TryParse(p[1], out var id)) return null;
        return p[0] == "airplay" ? AirPlayOf(id)?.Art : p[0] == "spotify" ? SpotifyOf(id)?.Art : null;
    }

    /// <summary>One row per zone for the UI.</summary>
    public object View()
    {
        var cfg = Config();
        return _s.Links.ZoneList().Select(z =>
        {
            cfg.TryGetValue(z.Id, out var c); var ap = AirPlayOf(z.Id); var sp = SpotifyOf(z.Id);
            return new
            {
                zoneId = z.Id, key = "g:" + z.Id, zone = z.Name, name = NameOf(z.Name),
                airplay = new { enabled = c?.AirPlay ?? false, running = ap?.Running ?? false, ready = ap?.Ready ?? false, inSession = ap?.InSession ?? false, port = ap?.Port, installed = ap?.Installed ?? _s.AirPlay?.Installed ?? false, error = ap?.LastError },
                spotify = new { enabled = c?.Spotify ?? false, running = sp?.Running ?? false, inSession = sp?.SessionActive ?? false, port = sp?.Port, installed = sp?.Installed ?? _s.Spotify?.Installed ?? false, error = sp?.LastError },
            };
        }).ToList();
    }

    public void Dispose()
    {
        _disposed = true;
        lock (_l) { foreach (var a in _ap.Values) a.Dispose(); foreach (var p in _sp.Values) p.Dispose(); _ap.Clear(); _sp.Clear(); }
    }
}
