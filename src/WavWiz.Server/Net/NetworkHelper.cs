using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace WavWiz.Server.Net;

/// <summary>
/// 0.1.3 network / bind helper. Lists this PC's home-network (IPv4, private) addresses, says whether Windows treats each network as Private or Public
/// (WavWiz's firewall rules only open on Private networks), notices when the address WavWiz listens on has gone (the router handed out a new one)
/// and explains the fix in plain English. "Use this address" rewrites bindAddress in server.json and restarts the service.
/// </summary>
public static class NetworkHelper
{
    public sealed record Adapter(string Name, string Description, string Address, int Prefix, bool Gateway, string Kind, string Profile, bool IsBind);

    private static (DateTime At, Dictionary<int, (string Profile, string Network)> Map)? _profiles;
    private static readonly object _pl = new();
    /// <summary>Tests: replace the Windows profile lookup (interface index → Private/Public/Domain).</summary>
    public static Func<Dictionary<int, (string Profile, string Network)>>? ProfileOverride;
    public static Func<IEnumerable<Adapter>>? AdapterOverride;

    public static bool IsHomeAddress(IPAddress ip)
    {
        if (ip.AddressFamily != AddressFamily.InterNetwork) return false;
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 100 && b[1] >= 64 && b[1] <= 127);
    }

    public static Dictionary<int, (string Profile, string Network)> Profiles(bool fresh = false)
    {
        if (ProfileOverride != null) return ProfileOverride();
        if (!OperatingSystem.IsWindows()) return new();
        lock (_pl)
        {
            if (!fresh && _profiles is { } c && DateTime.UtcNow - c.At < TimeSpan.FromSeconds(60)) return c.Map;
            var map = new Dictionary<int, (string, string)>();
            try
            {
                var psi = new ProcessStartInfo("powershell.exe") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
                foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-Command", "Get-NetConnectionProfile | ForEach-Object { '{0}|{1}|{2}' -f $_.InterfaceIndex, $_.NetworkCategory, $_.Name }" }) psi.ArgumentList.Add(a);
                using var p = Process.Start(psi)!;
                var outTask = p.StandardOutput.ReadToEndAsync();
                if (!p.WaitForExit(6000)) { try { p.Kill(true); } catch { } }
                else foreach (var line in outTask.Result.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    var f = line.Split('|', 3); if (f.Length >= 2 && int.TryParse(f[0], out var idx)) map[idx] = (f[1] switch { "Private" => "Private", "Public" => "Public", "DomainAuthenticated" => "Domain", _ => f[1] }, f.Length > 2 ? f[2] : "");
                }
            }
            catch { /* unknown */ }
            _profiles = (DateTime.UtcNow, map); return map;
        }
    }

    public static List<Adapter> Adapters(string bind, bool fresh = false)
    {
        if (AdapterOverride != null) return AdapterOverride().Select(a => a with { IsBind = a.Address == bind }).ToList();
        var prof = Profiles(fresh); var list = new List<Adapter>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var ip = ni.GetIPProperties(); int idx = -1; try { idx = ip.GetIPv4Properties()?.Index ?? -1; } catch { }
                bool gw = ip.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                string kind = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? "Wi-Fi" : ni.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet ? "Ethernet" : "Other";
                if (Virtual(ni.Description + " " + ni.Name)) kind = "Virtual";
                foreach (var u in ip.UnicastAddresses)
                {
                    if (!IsHomeAddress(u.Address)) continue;
                    var addr = u.Address.ToString();
                    list.Add(new Adapter(ni.Name, ni.Description, addr, u.PrefixLength, gw, kind, prof.TryGetValue(idx, out var p) ? p.Profile : "Unknown", addr == bind));
                }
            }
            catch { /* adapter vanished mid-scan */ }
        }
        return list.OrderByDescending(a => a.Gateway).ThenBy(a => a.Kind == "Virtual").ThenBy(a => a.Kind == "Wi-Fi").ToList();
    }

    private static bool Virtual(string s) => new[] { "Hyper-V", "vEthernet", "VirtualBox", "VMware", "WSL", "Docker", "TAP-", "Tailscale", "ZeroTier", "WireGuard", "Loopback" }.Any(v => s.Contains(v, StringComparison.OrdinalIgnoreCase));

    public sealed record Report(string Bind, bool Loopback, bool AllInterfaces, bool BindPresent, string? Suggested, List<Adapter> Adapters, List<string> Problems, List<string> Fixes, string Status, bool CanRebind, ListenInfo? Listen = null);
    // ---- 0.6.8-#9: what "listening on" means in words + the addresses people can actually type ----
    public sealed record ListenAddr(string Address, string Kind);   // Kind: lan | tailscale | vpn
    public sealed record ListenInfo(string Label, List<ListenAddr> Addresses);
    public static Func<IEnumerable<(string Name, string Description, NetworkInterfaceType Type, IPAddress Ip)>>? ListenOverride;   // tests
    private static (DateTime At, string Bind, ListenInfo Info)? _listen;
    public static bool IsTailscaleIp(IPAddress ip) { var b = ip.GetAddressBytes(); return ip.AddressFamily == AddressFamily.InterNetwork && b[0] == 100 && b[1] >= 64 && b[1] <= 127; }
    /// <summary>For a wildcard bind (0.0.0.0 / ::): "Home network + Tailscale/VPN" with the LAN + Tailscale/VPN IPv4 addresses (Docker/Hyper-V/WSL skipped).
    /// For a single address: that address, labelled by its kind. Cached 30 s (it is on every /status).</summary>
    /// <summary>IPv4 to put in mDNS A records and beacons. A specific bind is returned as-is. A wildcard bind (0.0.0.0 / ::)
    /// picks a reachable home-network address (LAN first, then Tailscale/VPN) — never 0.0.0.0 itself.</summary>
    public static IPAddress AdvertiseAddress(IPAddress bind)
    {
        if (!bind.Equals(IPAddress.Any) && !bind.Equals(IPAddress.IPv6Any)) return bind;
        foreach (var a in Listening(new ServerConfig { BindAddress = bind.ToString() }).Addresses)
            if (IPAddress.TryParse(a.Address, out var ip) && !ip.Equals(IPAddress.Any) && !ip.Equals(IPAddress.IPv6Any) && !IPAddress.IsLoopback(ip))
                return ip;
        return bind;
    }

    public static ListenInfo Listening(ServerConfig cfg)
    {
        var bind = cfg.BindAddress.Trim('[', ']');
        if (ListenOverride == null && _listen is { } c && c.Bind == bind && DateTime.UtcNow - c.At < TimeSpan.FromSeconds(30)) return c.Info;
        ListenInfo info;
        if (IPAddress.TryParse(bind, out var b) && !b.Equals(IPAddress.Any) && !b.Equals(IPAddress.IPv6Any))
        {
            var k = IPAddress.IsLoopback(b) ? "local" : IsTailscaleIp(b) ? "tailscale" : "lan";
            info = new(k == "local" ? "This PC only" : k == "tailscale" ? "Tailscale" : "Home network", new() { new(bind, k) });
        }
        else
        {
            var found = new List<ListenAddr>();
            IEnumerable<(string Name, string Description, NetworkInterfaceType Type, IPAddress Ip)> all;
            if (ListenOverride != null) all = ListenOverride();
            else
            {
                var l = new List<(string, string, NetworkInterfaceType, IPAddress)>();
                try
                {
                    foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                    {
                        try { if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue; foreach (var u in ni.GetIPProperties().UnicastAddresses) l.Add((ni.Name, ni.Description, ni.NetworkInterfaceType, u.Address)); }
                        catch { }
                    }
                }
                catch { }
                all = l;
            }
            foreach (var (name, desc, type, ip) in all)
            {
                if (ip.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(ip) || !IsHomeAddress(ip)) continue;
                var n = name + " " + desc;
                string kind = IsTailscaleIp(ip) || n.Contains("Tailscale", StringComparison.OrdinalIgnoreCase) ? "tailscale"
                    : new[] { "WireGuard", "ZeroTier", "TAP-", "OpenVPN" }.Any(v => n.Contains(v, StringComparison.OrdinalIgnoreCase)) || new[] { "wg", "tun", "utun", "ppp" }.Any(v => name.StartsWith(v, StringComparison.OrdinalIgnoreCase)) || type is NetworkInterfaceType.Tunnel or NetworkInterfaceType.Ppp ? "vpn"
                    : Virtual(n) || n.StartsWith("docker", StringComparison.OrdinalIgnoreCase) || n.StartsWith("br-", StringComparison.OrdinalIgnoreCase) || n.StartsWith("veth", StringComparison.OrdinalIgnoreCase) ? "skip" : "lan";
                if (kind != "skip" && !found.Any(f => f.Address == ip.ToString())) found.Add(new(ip.ToString(), kind));
            }
            found = found.OrderBy(f => f.Kind == "lan" ? 0 : f.Kind == "tailscale" ? 1 : 2).ToList();
            bool lan = found.Any(f => f.Kind == "lan"), tun = found.Any(f => f.Kind != "lan");
            info = new(lan && tun ? "Home network + Tailscale/VPN" : tun ? "Tailscale/VPN" : lan ? "Home network" : "All network interfaces", found);
        }
        if (ListenOverride == null) _listen = (DateTime.UtcNow, bind, info);
        return info;
    }


    public static Report Check(ServerConfig cfg, bool fresh = false)
    {
        var bind = cfg.BindAddress.Trim('[', ']'); var ads = Adapters(bind, fresh);
        bool loop = IPAddress.TryParse(bind, out var bip) && IPAddress.IsLoopback(bip), all = bind is "0.0.0.0" or "::";
        bool present = loop || all || ads.Any(a => a.IsBind);
        var best = ads.FirstOrDefault(a => a.Gateway && a.Kind != "Virtual") ?? ads.FirstOrDefault(a => a.Kind != "Virtual");
        var mine = ads.FirstOrDefault(a => a.IsBind);
        var problems = new List<string>(); var fixes = new List<string>(); bool canRebind = OperatingSystem.IsWindows() || cfg.TestTreatAllClientsAsRemote;
        string Use(string addr) => canRebind ? $"Click \"Use {addr}\" below" : $"Set bindAddress to {addr} in server.json and restart WavWiz";
        if (loop)
        {
            problems.Add($"WavWiz only listens on this PC ({bind}), so other PCs and phones cannot reach it.");
            if (best != null) fixes.Add($"{Use(best.Address)} to listen on your home network ({best.Kind}: {best.Name}).");
        }
        else if (!present)
        {
            problems.Add($"WavWiz is set to listen on {bind}, but this PC no longer has that address - your router probably gave it a new one.");
            if (best != null) fixes.Add(canRebind ? $"{Use(best.Address)}. WavWiz restarts by itself and your players find it again within a minute." : Use(best.Address) + ".");
            fixes.Add("To stop this happening again, reserve this PC's address in your router (look for \"DHCP reservation\" or \"static lease\").");
        }
        var pub = (mine ?? (loop || all ? best : null)) is { Profile: "Public" } m ? m : null;
        if (pub != null)
        {
            problems.Add($"Windows treats the network on \"{pub.Name}\" as Public, so it blocks other devices from reaching WavWiz.");
            fixes.Add($"Open Windows Settings > Network & internet > {(pub.Kind == "Wi-Fi" ? "Wi-Fi > (your network)" : "Ethernet")} and set \"Network profile type\" to Private. Only do this on your own home network.");
        }
        if (mine is { Kind: "Virtual" }) { problems.Add($"{bind} belongs to a virtual adapter ({mine.Name}), not your home network."); if (best != null && best.Address != bind) fixes.Add($"Use {best.Address} instead."); }
        if (ads.Count == 0 && !loop) problems.Add("This PC has no home-network (private) address right now. Is it connected to your router?");
        string status = problems.Count == 0 ? "ok" : (!present || loop || pub != null) ? "fail" : "warn";
        return new Report(bind, loop, all, present, best?.Address != bind ? best?.Address : null, ads, problems, fixes, status, canRebind, Listening(cfg));
    }

    /// <summary>Write bindAddress into server.json (other keys untouched). Returns the path written.</summary>
    public static string SaveBind(ServerConfig cfg, string address)
    {
        var path = cfg.ConfigPath; JsonObject o;
        try { o = File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path).TrimStart('\uFEFF')) as JsonObject ?? new() : new(); } catch { o = new(); }
        var key = o.Select(kv => kv.Key).FirstOrDefault(k => k.Equals("bindAddress", StringComparison.OrdinalIgnoreCase)) ?? "bindAddress";
        o[key] = address;
        var tmp = path + ".tmp"; File.WriteAllText(tmp, o.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new System.Text.UTF8Encoding(false)); File.Move(tmp, path, true);
        return path;
    }
}
