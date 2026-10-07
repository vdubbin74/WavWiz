using System.Net;
using System.Net.NetworkInformation;
using System.Text.Json;
namespace WavWiz.Server.Features;

/// <summary>B7: Tailscale-only remote access helpers. Nothing is opened to the public internet; LAN bind rules stay.</summary>
public static class RemoteAccess
{
    public static object Status(ServerConfig cfg, Db db)
    {
        var ts = DetectTailscale();
        var prefer = db.Setting("remote.preferTailscale");
        bool preferTs = prefer != null && prefer.Contains("true", StringComparison.OrdinalIgnoreCase);
        return new
        {
            mode = "tailscale-only",
            note = "WavWiz never opens itself to the public internet. Away-from-home access uses Tailscale (or another private mesh VPN) on the server PC. Bind the server to your Tailscale IP (100.x) or keep the LAN IP and reach it over the Tailscale network.",
            bindAddress = cfg.BindAddress,
            preferTailscale = preferTs,
            tailscale = ts,
            publicInternet = false,
            firewallNote = "Installer firewall rules stay Private-profile and local-subnet only. Tailscale traffic uses the Tailscale adapter; do not create a public inbound rule."
        };
    }

    public static object DetectTailscale()
    {
        var addrs = new List<object>();
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up))
            {
                var name = ni.Name + " " + ni.Description;
                bool looksTs = name.Contains("Tailscale", StringComparison.OrdinalIgnoreCase) || name.Contains("tailscale", StringComparison.OrdinalIgnoreCase);
                foreach (var ua in ni.GetIPProperties().UnicastAddresses.Where(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork))
                {
                    var ip = ua.Address.ToString();
                    bool cgNat = ip.StartsWith("100.");
                    if (looksTs || cgNat) addrs.Add(new { interfaceName = ni.Name, ip, tailscaleLikely = looksTs || cgNat });
                }
            }
        }
        catch { /* non-Windows / restricted */ }
        return new { addresses = addrs, installed = addrs.Count > 0, help = "Install Tailscale on the server PC and each phone/laptop that should reach WavWiz away from home. Then open http://<tailscale-ip>:47800 — or set the bind address to the Tailscale IP in the installer / server.json." };
    }

    public static bool IsPrivateOrTailscale(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        var b = ip.GetAddressBytes();
        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
        // RFC1918 + Tailscale CGNAT 100.64/10
        if (b[0] == 10) return true;
        if (b[0] == 192 && b[1] == 168) return true;
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;
        if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return true;
        return false;
    }
}
