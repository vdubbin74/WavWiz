using System.Net;
using System.Net.Sockets;
namespace WavWiz.Server.Library;

/// <summary>SSRF guard for server-side fetches of Radio Browser favicons (and other remote art).
/// Rejects loopback, private, link-local and CGNAT addresses; resolves hostnames and checks every address.</summary>
public static class RemoteUrlGuard
{
    /// <summary>Test hook on an ArtService / RadioFinder instance should be preferred. This is only for unit tests of the checker itself.</summary>
    public static bool IsSafeRemoteUrl(string? url) => IsSafeRemoteUrl(url, out _);

    public static bool IsSafeRemoteUrl(string? url, out Uri? uri)
    {
        uri = null;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return false;
        if (u.IsLoopback) return false;
        if (!TryResolve(u, out var addrs) || addrs.Length == 0) return false;
        if (addrs.Any(IsBlockedAddress)) return false;
        uri = u;
        return true;
    }

    /// <summary>True when the address must not be fetched (loopback, private, link-local, CGNAT, unspecified, multicast/reserved).</summary>
    public static bool IsBlockedAddress(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.None)) return true;
        var b = ip.GetAddressBytes();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            if (b[0] == 0) return true;                                 // 0.0.0.0/8
            if (b[0] == 10) return true;                                // 10.0.0.0/8
            if (b[0] == 127) return true;                               // 127.0.0.0/8 (in case IsLoopback missed a form)
            if (b[0] == 169 && b[1] == 254) return true;                // 169.254.0.0/16 link-local (incl. cloud metadata)
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;   // 172.16.0.0/12
            if (b[0] == 192 && b[1] == 168) return true;                // 192.168.0.0/16
            if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return true;  // 100.64.0.0/10 CGNAT
            if (b[0] >= 224) return true;                               // multicast + reserved
            return false;
        }
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast) return true;
            if ((b[0] & 0xfe) == 0xfc) return true;                     // fc00::/7 unique local
            return false;
        }
        return true;
    }

    public static bool TryResolve(Uri u, out IPAddress[] addrs)
    {
        addrs = Array.Empty<IPAddress>();
        try
        {
            if (IPAddress.TryParse(u.DnsSafeHost, out var one)) { addrs = new[] { one }; return true; }
            addrs = Dns.GetHostAddresses(u.DnsSafeHost);
            return addrs.Length > 0;
        }
        catch { return false; }
    }
}
