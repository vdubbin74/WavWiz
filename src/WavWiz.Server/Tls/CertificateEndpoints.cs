using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace WavWiz.Server.Tls;

/// <summary>F245: a listening wildcard is not a certificate endpoint identity.</summary>
internal static class CertificateEndpoints
{
    internal sealed record InterfaceAddress(IPAddress Address, bool Up, bool Lan, bool HasGateway, bool Tailscale);
    internal static IPAddress Normalize(IPAddress ip) => ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip;
    internal static bool Wildcard(IPAddress ip) => ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any);
    private static bool Tailnet(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 ? b[0] == 100 && b[1] >= 64 && b[1] <= 127 :
            b.Length == 16 && b[0] == 0xfd && b[1] == 0x7a && b[2] == 0x11 && b[3] == 0x5c && b[4] == 0xa1 && b[5] == 0xe0;
    }
    private static bool Private(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 ? b[0] == 10 || b[0] == 172 && b[1] >= 16 && b[1] <= 31 || b[0] == 192 && b[1] == 168 :
            b.Length == 16 && (b[0] & 0xfe) == 0xfc;
    }
    internal static IReadOnlyList<IPAddress> Select(IPAddress bind, IEnumerable<InterfaceAddress> interfaces)
    {
        bind = Normalize(bind);
        var ips = new HashSet<IPAddress> { IPAddress.Loopback };
        if (bind.AddressFamily == AddressFamily.InterNetworkV6) ips.Add(IPAddress.IPv6Loopback);
        if (!Wildcard(bind)) ips.Add(bind);
        else foreach (var i in interfaces)
        {
            var ip = Normalize(i.Address);
            if (bind.Equals(IPAddress.Any) && ip.AddressFamily != AddressFamily.InterNetwork) continue;
            if (!i.Up || Wildcard(ip) || IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6Multicast ||
                (ip.AddressFamily == AddressFamily.InterNetwork && (ip.GetAddressBytes()[0] == 169 || ip.GetAddressBytes()[0] >= 224))) continue;
            // Default-route LAN interfaces + active Tailnet endpoints. No Docker/Hyper-V/no-gateway
            // bridges, arbitrary public interfaces or scoped IPv6 link-local addresses.
            if ((i.Lan && i.HasGateway && Private(ip)) || (i.Tailscale && Tailnet(ip))) ips.Add(ip);
        }
        return ips.OrderBy(ip => ip.AddressFamily).ThenBy(ip => ip.ToString(), StringComparer.Ordinal).ToArray();
    }
    internal static IReadOnlyList<IPAddress> Resolve(IPAddress bind)
    {
        if (!Wildcard(Normalize(bind))) return Select(bind, []);
        var addresses = new List<InterfaceAddress>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            var props = nic.GetIPProperties();
            var gateway = props.GatewayAddresses.Any(g => !Wildcard(g.Address));
            var tail = (nic.Name + " " + nic.Description).Contains("tailscale", StringComparison.OrdinalIgnoreCase);
            var lan = nic.NetworkInterfaceType is NetworkInterfaceType.Ethernet or NetworkInterfaceType.Wireless80211;
            foreach (var a in props.UnicastAddresses) addresses.Add(new(a.Address, true, lan, gateway, tail));
        }
        var selected = Select(bind, addresses);
        if (!selected.Any(ip => !IPAddress.IsLoopback(ip))) throw new InvalidOperationException("No active LAN/Tailscale certificate endpoints found for wildcard bind; use an explicit reachable bind address or restore the interface. Existing certificates are unchanged.");
        return selected;
    }
    internal static string[] DnsNames() => new[] { "localhost", "wavwiz.local", Environment.MachineName.ToLowerInvariant(), Environment.MachineName.ToLowerInvariant() + ".local" }.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    internal static bool Covers(System.Security.Cryptography.X509Certificates.X509Certificate2 cert, IEnumerable<IPAddress> ips)
    {
        var ext = cert.Extensions.Cast<System.Security.Cryptography.X509Certificates.X509Extension>().FirstOrDefault(e => e.Oid?.Value == "2.5.29.17");
        if (ext == null) return false;
        try
        {
            var san = new System.Security.Cryptography.X509Certificates.X509SubjectAlternativeNameExtension(ext.RawData, ext.Critical);
            var actualIps = san.EnumerateIPAddresses().Select(Normalize).ToHashSet();
            var actualDns = san.EnumerateDnsNames().ToHashSet(StringComparer.OrdinalIgnoreCase);
            return ips.Select(Normalize).All(actualIps.Contains) && DnsNames().All(actualDns.Contains);
        }
        catch (System.Security.Cryptography.CryptographicException) { return false; }
    }
}
