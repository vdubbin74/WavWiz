using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tls;

/// <summary>F274 3.5: phones that proved they trust the WavWiz CA ("iPhone: Secure ✓"). Informational only: it grants no access and no pairing.
/// A report is accepted only over HTTPS (which itself proves the phone trusts the certificate) from a home-network / Tailscale address,
/// at most 10 a minute per address; the list keeps the 20 most recent devices (name + last seen) in the setting tls.trustedDevices.</summary>
public static class PhoneTrust
{
    public const string Key = "tls.trustedDevices";
    public const int Max = 20, PerMinute = 10;
    public sealed record Device(string Name, DateTimeOffset LastSeen);
    public static Func<DateTimeOffset> Now = () => DateTimeOffset.UtcNow;     // test seam
    private static readonly Dictionary<string, Queue<DateTimeOffset>> Hits = new();
    private static readonly object L = new();

    /// <summary>HTTPS + a home-network or Tailscale source (never loopback: a browser on the server PC is not a phone).</summary>
    public static bool AcceptsSource(bool https, IPAddress? ip, IEnumerable<string>? extra = null)
    {
        if (!https || ip == null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return false;
        var b = ip.GetAddressBytes(); bool tailscale = b.Length == 4 && b[0] == 100 && b[1] >= 64 && b[1] <= 127;   // 100.64.0.0/10
        return tailscale || AuthService.IsPrivateSource(ip, extra);
    }

    /// <summary>Sliding one-minute window per address; the 11th call inside a minute is refused (429).</summary>
    public static bool Allow(string key)
    {
        var now = Now();
        lock (L)
        {
            if (!Hits.TryGetValue(key, out var q)) Hits[key] = q = new Queue<DateTimeOffset>();
            while (q.Count > 0 && now - q.Peek() >= TimeSpan.FromMinutes(1)) q.Dequeue();
            if (q.Count >= PerMinute) return false;
            q.Enqueue(now);
            if (Hits.Count > 512) foreach (var k in Hits.Where(kv => kv.Value.Count == 0).Select(kv => kv.Key).ToList()) Hits.Remove(k);
            return true;
        }
    }
    public static void ResetRate() { lock (L) Hits.Clear(); }

    /// <summary>A short, plain device label ("iPhone", "Android phone", "iPad"): letters, digits, spaces and . - ( ) only, at most 40 characters.</summary>
    public static string CleanName(string? raw)
    {
        var t = new string((raw ?? "").Where(ch => char.IsLetterOrDigit(ch) || ch is ' ' or '.' or '-' or '(' or ')' or '\'').ToArray()).Trim();
        while (t.Contains("  ")) t = t.Replace("  ", " ");
        if (t.Length > 40) t = t[..40].TrimEnd();
        return t.Length == 0 ? "Phone" : t;
    }

    public static IReadOnlyList<Device> List(Db db)
    {
        try
        {
            var j = db.Setting(Key); if (string.IsNullOrEmpty(j)) return Array.Empty<Device>();
            return (JsonSerializer.Deserialize<List<Device>>(j, Opt) ?? new()).Where(d => !string.IsNullOrWhiteSpace(d.Name)).OrderByDescending(d => d.LastSeen).Take(Max).ToList();
        }
        catch { return Array.Empty<Device>(); }
    }
    public static void Record(Db db, string name)
    {
        name = CleanName(name);
        lock (L)
        {
            var list = List(db).Where(d => !string.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
            list.Insert(0, new Device(name, Now()));
            db.SetSetting(Key, JsonSerializer.Serialize(list.Take(Max).ToList(), Opt));
        }
    }
    /// <summary>A new CA (recreate) means every phone must trust it again.</summary>
    public static void Clear(Db db) { lock (L) db.SetSetting(Key, "[]"); }

    /// <summary>"iPhone: Secure ✓ (Nov 26) · Android phone: Secure ✓ (Nov 20)".</summary>
    public static string Label(IEnumerable<Device> list) =>
        string.Join(" · ", list.Select(d => $"{d.Name}: Secure \u2713 ({d.LastSeen.ToLocalTime():MMM d})"));

    private static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
}

/// <summary>F274 3.1 (D1): turn the phones' secure connection on by itself at the first start when the server has a home address.
/// Upgrades that already have it are untouched; loopback or a Docker bridge without WAVWIZ_ADVERTISE_ADDRESS stay manual.</summary>
public static class TlsAuto
{
    /// <summary>The address to create the certificate for, or null (no automatic set-up).</summary>
    public static IPAddress? Target(ServerConfig cfg, bool bridgeMode)
    {
        if (!IPAddress.TryParse(cfg.BindAddress?.Trim('[', ']') ?? "", out var bind) || IPAddress.IsLoopback(bind)) return null;
        bool wildcard = bind.Equals(IPAddress.Any) || bind.Equals(IPAddress.IPv6Any);
        if (!wildcard) return bind;
        if (Net.NetworkHelper.ConfiguredAdvertise(cfg) is { } adv) return adv;   // Docker bridge: the host's LAN address
        return bridgeMode ? null : bind;                                          // same as the manual button for a wildcard bind
    }

    /// <summary>Runs at server start. Returns null when nothing was needed or it worked, else the reason (shown as tls state "error").</summary>
    public static string? Run(ServerConfig cfg, LocalCa ca, Action<string> log, bool? bridgeMode = null)
    {
        if (ca.Enabled) return null;
        var ip = Target(cfg, bridgeMode ?? SafeBridge());
        if (ip == null) return null;
        try { ca.Enable(ip); log("HTTPS set up automatically for phones (" + ip + ")."); return null; }
        catch (Exception e) { log("Could not set up the secure connection for phones: " + e.Message); return e.Message; }
    }
    private static bool SafeBridge() { try { return Net.NetworkHelper.BridgeMode(); } catch { return false; } }
}
