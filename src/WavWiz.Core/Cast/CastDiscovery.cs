using System.Net;
using WavWiz.Core.Discovery;
namespace WavWiz.Core.Cast;

/// <summary>One Google Cast device or Cast group from _googlecast._tcp (TXT: id, fn friendly name, md model, ca capability bits, st, rs, bs).</summary>
public sealed class CastDevice
{
    public string Id = "";                         // TXT "id" (UUID hex, dashes removed, lower case); "name:..." when missing
    public string Name = "", Instance = "";
    public string? Host, Model, Status;            // Status = TXT "rs" (what it is doing now, e.g. "Spotify"), may be empty
    public List<string> Addresses = new();
    public int Port; public long Capabilities = -1;
    public DateTimeOffset FirstSeen;
    public IReadOnlyDictionary<string, string> Txt = new Dictionary<string, string>();
    // pychromecast CastCapability: VIDEO_OUT=1, VIDEO_IN=2, AUDIO_OUT=4, AUDIO_IN=8, DEV_MODE=16, MULTIZONE_GROUP=32
    public const long VideoOut = 1, AudioOut = 4, MultizoneGroup = 32;
    /// <summary>A Cast group (Google Home app speaker group). Groups advertise on a port other than 8009 (pychromecast rule) and/or md "Google Cast Group".</summary>
    public bool IsGroup => Port is > 0 and not 8009 || string.Equals(Model, "Google Cast Group", StringComparison.OrdinalIgnoreCase) || Capabilities >= 0 && (Capabilities & MultizoneGroup) != 0 && (Capabilities & VideoOut) == 0;
    /// <summary>Has a screen (Chromecast dongle, Google TV, Cast TV, Nest Hub).</summary>
    public bool IsTv => !IsGroup && Capabilities >= 0 && (Capabilities & VideoOut) != 0;
    public string Kind => IsGroup ? "group" : IsTv ? "tv" : "speaker";
}

/// <summary>Keeps every _googlecast._tcp service seen in mDNS answers. Pure (no sockets) so it can be unit tested; same TTL / goodbye rules as AirPlayBrowseState.</summary>
public sealed class CastBrowseState
{
    public const string Service = "_googlecast._tcp.local";
    readonly object _lock = new();
    readonly Dictionary<string, DateTimeOffset> _ptr = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, (int Port, string Host, DateTimeOffset Exp)> _srv = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, (Dictionary<string, string> Txt, DateTimeOffset Exp)> _txt = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, Dictionary<string, DateTimeOffset>> _a = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, DateTimeOffset> _first = new(StringComparer.OrdinalIgnoreCase);
    public int Packets { get; private set; }

    static bool Ours(string instance) => instance.EndsWith("." + Service, StringComparison.OrdinalIgnoreCase);

    public bool Ingest(DnsWire.Message m, DateTimeOffset now)
    {
        if (!m.IsResponse) return false; bool any = false;
        lock (_lock)
        {
            Packets++;
            foreach (var r in m.Records)
            {
                var exp = now.AddSeconds(r.Ttl);
                switch (r.Type)
                {
                    case DnsWire.TypePtr:
                        if (!r.Name.Equals(Service, StringComparison.OrdinalIgnoreCase) && !(r.Name.EndsWith("._sub." + Service, StringComparison.OrdinalIgnoreCase))) break;
                        var inst = DnsWire.NameOf(r.Data); if (!Ours(inst)) break; any = true;
                        if (r.Ttl == 0) _ptr.Remove(inst); else { _ptr[inst] = exp; _first.TryAdd(inst, now); }
                        break;
                    case DnsWire.TypeSrv:
                        if (!Ours(r.Name)) break; var (port, host) = DnsWire.SrvOf(r.Data); any = true;
                        if (r.Ttl == 0) _srv.Remove(r.Name); else { _srv[r.Name] = (port, host, exp); if (!_ptr.ContainsKey(r.Name)) _ptr[r.Name] = exp; _first.TryAdd(r.Name, now); }
                        break;
                    case DnsWire.TypeTxt:
                        if (!Ours(r.Name)) break; any = true;
                        if (r.Ttl == 0) _txt.Remove(r.Name); else _txt[r.Name] = (DnsWire.TxtOf(r.Data), exp);
                        break;
                    case DnsWire.TypeA:
                        if (r.Data.Length != 4) break;
                        if (!_a.TryGetValue(r.Name, out var set)) _a[r.Name] = set = new();
                        var ip = new IPAddress(r.Data).ToString(); if (r.Ttl == 0) set.Remove(ip); else set[ip] = exp;
                        break;
                }
            }
        }
        return any;
    }

    public List<CastDevice> Devices(DateTimeOffset now)
    {
        var byId = new Dictionary<string, CastDevice>(StringComparer.OrdinalIgnoreCase);
        lock (_lock)
        {
            foreach (var (inst, pexp) in _ptr)
            {
                if (pexp <= now) continue;
                _srv.TryGetValue(inst, out var srv); _txt.TryGetValue(inst, out var txt);
                var t = txt.Exp > now ? txt.Txt : new Dictionary<string, string>();
                var label = inst[..^(Service.Length + 1)];
                var name = t.GetValueOrDefault("fn") is { Length: > 0 } fn ? fn : label;
                var id = NormId(t.GetValueOrDefault("id")) ?? "name:" + name.ToLowerInvariant();
                var d = byId.TryGetValue(id, out var have) ? have : byId[id] = new CastDevice { Id = id, Name = name, Instance = inst };
                if (_first.TryGetValue(inst, out var f) && (d.FirstSeen == default || f < d.FirstSeen)) d.FirstSeen = f;
                if (srv.Exp > now) { d.Port = srv.Port; d.Host = srv.Host; if (_a.TryGetValue(srv.Host, out var set)) foreach (var kv in set) if (kv.Value > now && Usable(kv.Key) && !d.Addresses.Contains(kv.Key)) d.Addresses.Add(kv.Key); }
                d.Txt = t; d.Model = t.GetValueOrDefault("md") ?? d.Model; d.Status = t.GetValueOrDefault("rs") ?? d.Status;
                if (long.TryParse(t.GetValueOrDefault("ca"), out var ca)) d.Capabilities = ca;
            }
        }
        foreach (var d in byId.Values) d.Addresses.Sort(StringComparer.Ordinal);
        return byId.Values.OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public void Prune(DateTimeOffset now)
    {
        lock (_lock)
        {
            foreach (var k in _ptr.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList()) { _ptr.Remove(k); _srv.Remove(k); _txt.Remove(k); _first.Remove(k); }
            foreach (var set in _a.Values) foreach (var k in set.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList()) set.Remove(k);
        }
    }

    public static string? NormId(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null; var h = new string(s.Where(Uri.IsHexDigit).ToArray()).ToLowerInvariant();
        return h.Length >= 8 ? h : null;
    }
    static bool Usable(string a) => IPAddress.TryParse(a, out var ip) && !ip.Equals(IPAddress.Any) && !IPAddress.IsLoopback(ip);

    /// <summary>The browse question (QM, so every socket sharing 5353 sees the answer).</summary>
    public static byte[] Query(bool unicastResponse = false) => DnsWire.Query(Service, DnsWire.TypePtr, unicastResponse);
}
