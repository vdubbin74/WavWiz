using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using WavWiz.Core;
using WavWiz.Core.Discovery;
namespace WavWiz.Server.Net;

/// <summary>
/// Lets players find this server without typing an address (0.0.2): (1) a UDP probe/answer on the discovery port - answered on the server's own LAN address and on the
/// subnet's directed-broadcast address, and also to unicast probes (a player that sweeps the subnet); (2) multicast DNS (Bonjour) "_unison._tcp" for phones and Macs.
/// Never binds 0.0.0.0. Only private-network sources are answered. The answer carries no secret (name, address, ports, version).
/// </summary>
public sealed class DiscoveryHost : IDisposable
{
    private readonly ServerConfig _cfg; private readonly Func<ServerBeacon> _beacon; private readonly Action<string>? _log;
    private readonly List<Socket> _udp = new(); private Socket? _mdns; private readonly CancellationTokenSource _cts = new();
    public int UdpPort { get; private set; }
    public bool MdnsActive => _mdns != null;
    public string? Problem { get; private set; }

    /// <summary>0.1.1: more services on the same responder (AirPlay "_raop._tcp", Spotify Connect fallback). Each group = PTR+SRV+TXT+A, given the host name and address.</summary>
    public Func<string, IPAddress, IEnumerable<List<DnsWire.Record>>>? Extra { get; set; }
    private IPAddress? _bind;

    public DiscoveryHost(ServerConfig cfg, Func<ServerBeacon> beacon, Action<string>? log = null) { _cfg = cfg; _beacon = beacon; _log = log; }

    public static IPAddress? DirectedBroadcast(IPAddress ip)
    {
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
                foreach (var u in n.GetIPProperties().UnicastAddresses)
                    if (u.Address.Equals(ip) && u.IPv4Mask != null)
                    {
                        var a = ip.GetAddressBytes(); var m = u.IPv4Mask.GetAddressBytes(); var b = new byte[4];
                        for (int i = 0; i < 4; i++) b[i] = (byte)(a[i] | ~m[i]);
                        return new IPAddress(b);
                    }
        }
        catch { }
        return null;
    }

    public void Start()
    {
        if (!_cfg.Discovery) return;
        var bind = IPAddress.Parse(_cfg.BindAddress.Trim('[', ']'));
        var targets = new List<IPAddress> { bind };
        if (!IPAddress.IsLoopback(bind) && DirectedBroadcast(bind) is { } bc && !bc.Equals(bind)) targets.Add(bc);
        foreach (var t in targets)
        {
            try
            {
                var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                s.Bind(new IPEndPoint(t, _cfg.DiscoveryPort)); if (UdpPort == 0) UdpPort = ((IPEndPoint)s.LocalEndPoint!).Port; _udp.Add(s);
                var sock = s; _ = Task.Run(() => UdpLoop(sock));
            }
            catch (Exception e) { Problem = $"discovery on {t}:{_cfg.DiscoveryPort} unavailable: {e.Message}"; _log?.Invoke(Problem); }
        }
        if (!IPAddress.IsLoopback(bind)) StartMdns(bind);
    }

    private async Task UdpLoop(Socket s)
    {
        var buf = new byte[512];
        while (!_cts.IsCancellationRequested)
        {
            SocketReceiveFromResult r;
            try { r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), _cts.Token); } catch (OperationCanceledException) { break; } catch (ObjectDisposedException) { break; } catch (SocketException) { continue; }
            try
            {
                var from = (IPEndPoint)r.RemoteEndPoint;
                if (!AuthService.IsPrivateSource(from.Address, _cfg.ExtraAllowedSubnets)) continue;
                if (Encoding.ASCII.GetString(buf, 0, Math.Min(r.ReceivedBytes, 16)).TrimEnd('\0', '\n') != ServerBeacon.Probe) continue;
                await s.SendToAsync(_beacon().ToUdp(), SocketFlags.None, from);
            }
            catch { }
        }
    }

    // ---------------- multicast DNS ----------------
    private static readonly IPAddress MdnsGroup = IPAddress.Parse("224.0.0.251");

    private void StartMdns(IPAddress bind)
    {
        try
        {
            var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            // Windows delivers multicast to a socket bound to the interface address; Linux needs the group address (unverified on Windows)
            s.Bind(new IPEndPoint(OperatingSystem.IsWindows() ? bind : MdnsGroup, 5353));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(MdnsGroup, bind));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, bind.GetAddressBytes());
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255); s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastLoopback, true);
            _mdns = s; _bind = bind; _ = Task.Run(() => MdnsLoop(s, bind));
            _ = Task.Run(async () => { for (int i = 0; i < 3 && !_cts.IsCancellationRequested; i++) { await Task.Delay(i == 0 ? 500 : 2000, _cts.Token); Announce(s, bind); } });
        }
        catch (Exception e) { Problem = (Problem == null ? "" : Problem + " | ") + "Bonjour/mDNS unavailable: " + e.Message; _log?.Invoke("mDNS unavailable: " + e.Message); }
    }

    private void Announce(Socket s, IPAddress bind)
    {
        try { s.SendTo(DnsWire.Response(_beacon().ToMdns(bind)), new IPEndPoint(MdnsGroup, 5353)); } catch { }
        try { foreach (var g in Groups(_beacon(), bind, Extra).Skip(1)) s.SendTo(DnsWire.Response(g), new IPEndPoint(MdnsGroup, 5353)); } catch { }
    }

    /// <summary>Announce again now (a new service came up), three times like at startup.</summary>
    public void AnnounceSoon()
    {
        var s = _mdns; var b = _bind; if (s == null || b == null) return;
        _ = Task.Run(async () => { for (int i = 0; i < 3 && !_cts.IsCancellationRequested; i++) { await Task.Delay(i == 0 ? 300 : 1500, _cts.Token); Announce(s, b); } });
    }

    private static IEnumerable<List<DnsWire.Record>> Groups(ServerBeacon beacon, IPAddress ip, Func<string, IPAddress, IEnumerable<List<DnsWire.Record>>>? extra)
    {
        var own = beacon.ToMdns(ip); yield return own;
        if (extra == null) yield break;
        var host = own.First(r => r.Type == DnsWire.TypeA).Name;
        List<List<DnsWire.Record>> more; try { more = extra(host, ip).ToList(); } catch { yield break; }
        foreach (var g in more) yield return g;
    }

    /// <summary>Pure: the answer (or null) for an incoming mDNS packet. Public for tests.</summary>
    public static byte[]? Answer(ReadOnlySpan<byte> packet, ServerBeacon beacon, IPAddress ip, Func<string, IPAddress, IEnumerable<List<DnsWire.Record>>>? extra = null)
    {
        if (!DnsWire.TryParse(packet, out var m) || m!.IsResponse) return null;
        var svc = WavWizInfo.MdnsService + ".local";
        bool wanted = m.Questions.Any(q => string.Equals(q.Name, svc, StringComparison.OrdinalIgnoreCase) && q.Type is DnsWire.TypePtr or DnsWire.TypeAny);
        var recs = new List<DnsWire.Record>(); if (wanted) recs.AddRange(beacon.ToMdns(ip));
        if (extra != null)
            foreach (var g in Groups(beacon, ip, extra).Skip(1))       // 0.1.1: AirPlay / Spotify: a question for the service type or the instance name gets the whole group
                if (m.Questions.Any(q => g.Any(r => r.Type != DnsWire.TypeA && string.Equals(r.Name, q.Name, StringComparison.OrdinalIgnoreCase) && (q.Type == DnsWire.TypeAny || q.Type == r.Type || r.Type == DnsWire.TypePtr && q.Type == DnsWire.TypePtr))))
                    recs.AddRange(g.Where(r => !recs.Contains(r)));
        return recs.Count > 0 ? DnsWire.Response(recs) : null;
    }

    private async Task MdnsLoop(Socket s, IPAddress bind)
    {
        var buf = new byte[4096];
        while (!_cts.IsCancellationRequested)
        {
            SocketReceiveFromResult r;
            try { r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), _cts.Token); } catch (OperationCanceledException) { break; } catch (ObjectDisposedException) { break; } catch (SocketException) { continue; }
            try
            {
                var from = (IPEndPoint)r.RemoteEndPoint; if (!AuthService.IsPrivateSource(from.Address, _cfg.ExtraAllowedSubnets)) continue;
                var ans = Answer(buf.AsSpan(0, r.ReceivedBytes), _beacon(), bind, Extra); if (ans == null) continue;
                bool unicast = from.Port != 5353 || (DnsWire.TryParse(buf.AsSpan(0, r.ReceivedBytes), out var q) && q!.Questions.Any(x => x.UnicastResponse));
                await s.SendToAsync(ans, SocketFlags.None, unicast ? from : new IPEndPoint(MdnsGroup, 5353));
            }
            catch { }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        foreach (var s in _udp) try { s.Dispose(); } catch { }
        try { _mdns?.Dispose(); } catch { }
    }
}
