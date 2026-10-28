using System.Globalization;
using System.Net;
using WavWiz.Core.Discovery;
namespace WavWiz.Core.AirPlay;

// AirPlay sender, stage 1: discovery model (clean-room, written from the unofficial AirPlay spec
// https://openairplay.github.io/airplay-spec/ and pyatv's MIT docs; no GPL code used).

/// <summary>What one mDNS service record (_raop._tcp or _airplay._tcp) told us.</summary>
public sealed record AirPlayService(string Kind, string Instance, string Host, int Port, IReadOnlyDictionary<string, string> Txt);

/// <summary>One AirPlay speaker, merged from its _raop and _airplay records (joined by MAC / deviceid).</summary>
public sealed class AirPlayDevice
{
    public string Id = "";                      // 12 hex digits of the MAC (deviceid), or "name:..." if neither record has one
    public string Name = "";
    public string? Host; public List<string> Addresses = new();
    public int RaopPort, AirPlayPort;
    public IReadOnlyDictionary<string, string> RaopTxt = new Dictionary<string, string>(), AirPlayTxt = new Dictionary<string, string>();
    public string? Model, Manufacturer, SourceVersion;
    public List<int> Codecs = new(), Encryption = new();
    public ulong Features; public uint StatusFlags;
    public bool PasswordRequired, PinRequired;
    public string? PublicKey, GroupId;
    public DateTimeOffset FirstSeen;
    public bool Raop => RaopPort > 0; public bool AirPlay2Service => AirPlayPort > 0;
    public bool SupportsAirPlay2 => AirPlayFeatures.Has(Features, AirPlayFeatures.AudioFormat2) && AirPlayFeatures.Has(Features, AirPlayFeatures.AudioFormat3) && (AirPlayFeatures.Has(Features, AirPlayFeatures.BufferedAudio) || AirPlayFeatures.Has(Features, AirPlayFeatures.Ptp) || AirPlayFeatures.Has(Features, AirPlayFeatures.TransientPairing));
    /// <summary>The sender route later stages take. FairPlay-only (et=3/5 with nothing else) is out of scope.</summary>
    public string Route
    {
        get
        {
            if (SupportsAirPlay2 && AirPlayPort > 0) return AirPlayFeatures.Has(Features, AirPlayFeatures.Ptp) ? "airplay2-ptp" : "airplay2-ntp";
            if (Raop) { if (Encryption.Count == 0 || Encryption.Contains(0)) return "raop"; if (Encryption.Contains(1)) return "raop-rsa"; if (Encryption.Contains(4)) return "raop-mfi"; return "unsupported"; }
            return "unsupported";
        }
    }
    public IEnumerable<string> FeatureNames => AirPlayFeatures.Names(Features);
    public string CodecNames => string.Join(", ", Codecs.Select(c => c switch { 0 => "PCM", 1 => "ALAC", 2 => "AAC", 3 => "AAC-ELD", _ => "codec " + c }));
    public string EncryptionNames => Encryption.Count == 0 ? "none listed" : string.Join(", ", Encryption.Select(e => e switch { 0 => "none", 1 => "RSA", 3 => "FairPlay", 4 => "MFi-SAP", 5 => "FairPlay SAPv2.5", _ => "et " + e }));
}

public static class AirPlayFeatures
{
    public const int Video = 0, Audio = 9, AudioRedundant = 11, Auth4 = 14, MetaArtwork = 15, MetaProgress = 16, MetaText = 17, AudioFormat1 = 18, AudioFormat2 = 19, AudioFormat3 = 20, AudioFormat4 = 21,
        Auth1Rsa = 23, UnifiedAdvertiser = 26, LegacyPairing = 27, Raop = 30, SupportsVolume = 32, CoreUtilsPairing = 38, BufferedAudio = 40, Ptp = 41, SystemPairing = 43, HkPairing = 46, TransientPairing = 48, MetaBplist = 50, MfiAuth = 51;
    static readonly Dictionary<int, string> N = new()
    {
        [0] = "Video", [1] = "Photo", [7] = "Screen", [9] = "Audio", [11] = "AudioRedundant", [12] = "FPSAPv2.5", [14] = "Auth4(FairPlay)", [15] = "Meta:Artwork", [16] = "Meta:Progress", [17] = "Meta:Text",
        [18] = "AudioFormat1", [19] = "AudioFormat2", [20] = "AudioFormat3", [21] = "AudioFormat4", [23] = "Auth1(RSA)", [26] = "UnifiedAdvertiserInfo", [27] = "LegacyPairing", [30] = "RAOP",
        [32] = "SupportsVolume", [38] = "CoreUtilsPairing", [40] = "BufferedAudio", [41] = "PTP", [43] = "SystemPairing", [46] = "HKPairing", [48] = "TransientPairing", [50] = "Meta:bplist", [51] = "MFiAuth",
    };
    public static bool Has(ulong f, int bit) => (f >> bit & 1) != 0;
    public static IEnumerable<string> Names(ulong f) { for (int b = 0; b < 64; b++) if (Has(f, b)) yield return N.TryGetValue(b, out var n) ? n : "bit" + b; }
    /// <summary>"0x5A7FFFF7,0x1E" (low word, high word) or a single "0x445F8A00" / decimal value.</summary>
    public static ulong Parse(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return 0;
        var p = s.Split(','); ulong lo = Num(p[0]), hi = p.Length > 1 ? Num(p[1]) : 0; return p.Length > 1 ? (lo & 0xFFFFFFFF) | hi << 32 : lo;
        static ulong Num(string x) { x = x.Trim(); return x.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? ulong.TryParse(x[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var h) ? h : 0 : ulong.TryParse(x, out var d) ? d : 0; }
    }
}

/// <summary>Keeps every AirPlay service seen in mDNS answers and merges them into devices. Pure (no sockets) so it can be unit tested.</summary>
public sealed class AirPlayBrowseState
{
    public const string Raop = "_raop._tcp.local", AirPlay = "_airplay._tcp.local";
    private readonly object _lock = new();
    private readonly Dictionary<string, (string Svc, DateTimeOffset Exp)> _ptr = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (int Port, string Host, DateTimeOffset Exp)> _srv = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (Dictionary<string, string> Txt, DateTimeOffset Exp)> _txt = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, DateTimeOffset>> _a = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _first = new(StringComparer.OrdinalIgnoreCase);
    public int Packets { get; private set; }

    /// <summary>Feed one received mDNS message (answers and additionals). TTL 0 = goodbye, removes the record.</summary>
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
                        if (!IsOurs(r.Name)) break; var inst = DnsWire.NameOf(r.Data); any = true;
                        if (r.Ttl == 0) _ptr.Remove(inst); else { _ptr[inst] = (SvcOf(inst) is { Length: > 0 } sv ? sv : r.Name, exp); _first.TryAdd(inst, now); }
                        break;
                    case DnsWire.TypeSrv:
                        if (!IsOurs(SvcOf(r.Name))) break; var (port, host) = DnsWire.SrvOf(r.Data); any = true;
                        if (r.Ttl == 0) _srv.Remove(r.Name); else { _srv[r.Name] = (port, host, exp); if (!_ptr.ContainsKey(r.Name)) _ptr[r.Name] = (SvcOf(r.Name), exp); _first.TryAdd(r.Name, now); }
                        break;
                    case DnsWire.TypeTxt:
                        if (!IsOurs(SvcOf(r.Name))) break; any = true;
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

    static bool IsOurs(string svc) => svc.Equals(Raop, StringComparison.OrdinalIgnoreCase) || svc.Equals(AirPlay, StringComparison.OrdinalIgnoreCase);
    static string SvcOf(string instance)
    {
        foreach (var s in new[] { Raop, AirPlay }) if (instance.EndsWith("." + s, StringComparison.OrdinalIgnoreCase)) return s;
        return "";
    }

    public List<AirPlayService> Services(DateTimeOffset now)
    {
        lock (_lock)
        {
            var list = new List<AirPlayService>();
            foreach (var (inst, p) in _ptr)
            {
                if (p.Exp <= now) continue;
                _srv.TryGetValue(inst, out var srv); _txt.TryGetValue(inst, out var txt);
                list.Add(new AirPlayService(p.Svc.Equals(Raop, StringComparison.OrdinalIgnoreCase) ? "raop" : "airplay", inst, srv.Exp > now ? srv.Host : "", srv.Exp > now ? srv.Port : 0, txt.Exp > now ? txt.Txt : new Dictionary<string, string>()));
            }
            return list;
        }
    }

    public List<string> AddressesOf(string host, DateTimeOffset now)
    { lock (_lock) return _a.TryGetValue(host, out var s) ? s.Where(kv => kv.Value > now).Select(kv => kv.Key).OrderBy(x => x).ToList() : new(); }

    /// <summary>Merge _raop and _airplay services into devices (by MAC/deviceid, falling back to name).</summary>
    public List<AirPlayDevice> Devices(DateTimeOffset now)
    {
        var byId = new Dictionary<string, AirPlayDevice>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in Services(now).OrderBy(s => s.Kind))      // "airplay" first, so its name and model win
        {
            var label = s.Instance[..^((s.Kind == "raop" ? Raop.Length : AirPlay.Length) + 1)];
            string? mac = null; string name = label;
            if (s.Kind == "raop") { int at = label.IndexOf('@'); if (at > 0) { mac = NormMac(label[..at]); name = label[(at + 1)..]; } }
            else mac = NormMac(s.Txt.GetValueOrDefault("deviceid"));
            var id = mac ?? "name:" + name.ToLowerInvariant();
            if (!byId.TryGetValue(id, out var d)) { d = new AirPlayDevice { Id = id, Name = name }; byId[id] = d; }
            lock (_lock) if (_first.TryGetValue(s.Instance, out var f) && (d.FirstSeen == default || f < d.FirstSeen)) d.FirstSeen = f;
            if (!string.IsNullOrEmpty(s.Host)) { d.Host ??= s.Host; foreach (var ip in AddressesOf(s.Host, now)) if (!d.Addresses.Contains(ip)) d.Addresses.Add(ip); }
            var t = s.Txt;
            if (s.Kind == "raop")
            {
                d.RaopPort = s.Port; d.RaopTxt = t;
                d.Codecs = Ints(t.GetValueOrDefault("cn")); d.Encryption = Ints(t.GetValueOrDefault("et"));
                d.Model ??= t.GetValueOrDefault("am"); d.PasswordRequired |= Bool(t.GetValueOrDefault("pw"));
                if (d.Features == 0) d.Features = AirPlayFeatures.Parse(t.GetValueOrDefault("ft"));
                if (d.StatusFlags == 0) d.StatusFlags = (uint)AirPlayFeatures.Parse(t.GetValueOrDefault("sf"));
                d.PublicKey ??= t.GetValueOrDefault("pk"); d.SourceVersion ??= t.GetValueOrDefault("vs");
            }
            else
            {
                d.AirPlayPort = s.Port; d.AirPlayTxt = t; d.Name = name;
                d.Model = t.GetValueOrDefault("model") ?? d.Model; d.Manufacturer = t.GetValueOrDefault("manufacturer");
                var f = AirPlayFeatures.Parse(t.GetValueOrDefault("features")); if (f != 0) d.Features = f;
                var fl = (uint)AirPlayFeatures.Parse(t.GetValueOrDefault("flags")); if (fl != 0) d.StatusFlags = fl;
                d.PublicKey = t.GetValueOrDefault("pk") ?? d.PublicKey; d.GroupId = t.GetValueOrDefault("gid"); d.SourceVersion = t.GetValueOrDefault("srcvers") ?? d.SourceVersion;
                d.PasswordRequired |= Bool(t.GetValueOrDefault("pw"));
            }
        }
        // spec status flags: bit 3 = PIN required, bit 7 = password required [bit 7 unverified]
        foreach (var d in byId.Values) { d.PinRequired = (d.StatusFlags & 0x8) != 0; d.PasswordRequired |= (d.StatusFlags & 0x80) != 0; }
        return byId.Values.OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public void Prune(DateTimeOffset now)
    {
        lock (_lock)
        {
            foreach (var k in _ptr.Where(kv => kv.Value.Exp <= now).Select(kv => kv.Key).ToList()) { _ptr.Remove(k); _srv.Remove(k); _txt.Remove(k); _first.Remove(k); }
            foreach (var set in _a.Values) foreach (var k in set.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList()) set.Remove(k);
        }
    }

    public static string? NormMac(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null; var h = new string(s.Where(Uri.IsHexDigit).ToArray()).ToUpperInvariant();
        return h.Length == 12 ? h : null;
    }
    static List<int> Ints(string? s) => (s ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(x => int.TryParse(x, out var v) ? v : -1).Where(v => v >= 0).Distinct().ToList();
    static bool Bool(string? s) => s != null && (s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "1");

    /// <summary>The browse query: PTR questions for both service types in one packet.</summary>
    public static byte[] Query(bool unicastResponse)
    {
        var a = DnsWire.Query(Raop, DnsWire.TypePtr, unicastResponse); var b = DnsWire.Query(AirPlay, DnsWire.TypePtr, unicastResponse);
        var outp = new byte[a.Length + b.Length - 12]; a.CopyTo(outp, 0); b.AsSpan(12).CopyTo(outp.AsSpan(a.Length)); outp[5] = 2; return outp;
    }
}
