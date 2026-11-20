using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using WavWiz.Core;
using WavWiz.Core.Discovery;
namespace WavWiz.PlayerCore.Discovery;

/// <summary>
/// Finds WavWiz servers on the home network so the person never types an address (0.0.2): multicast DNS (Bonjour) + a UDP "who is there" probe sent as a broadcast and
/// as a unicast sweep of the local subnet + (last resort) an HTTP look at every neighbor's WavWiz port. All methods are LAN-only and send nothing but a tiny probe.
/// </summary>
public static class ServerFinder
{
    public sealed record Options(int DiscoveryPort = WavWizInfo.DefaultDiscoveryPort, int HttpPort = WavWizInfo.DefaultHttpPort, bool Mdns = true, bool Broadcast = true, bool UdpSweep = true, bool HttpSweep = true,
        IReadOnlyList<IPAddress>? ExtraProbeTargets = null, string? WantedId = null, Action<string>? Log = null);

    public static List<(IPAddress Ip, IPAddress Mask)> LocalInterfaces()
    {
        var res = new List<(IPAddress, IPAddress)>();
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                foreach (var u in n.GetIPProperties().UnicastAddresses)
                    if (u.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(u.Address) && u.Address.GetAddressBytes() is { } b && b[0] != 169 && u.IPv4Mask != null) res.Add((u.Address, u.IPv4Mask));
            }
        }
        catch { }
        return res;
    }

    // ---------------- 0.7.1 t2069u: Docker bridge addresses ----------------
    /// <summary>Docker's default bridge pools, 172.17.0.0 - 172.31.255.255 (172.16.x is a normal home range and is left alone).</summary>
    public static bool IsDockerBridge(IPAddress ip) => ip.AddressFamily == AddressFamily.InterNetwork && ip.GetAddressBytes() is var b && b[0] == 172 && b[1] >= 17 && b[1] <= 31;
    public static bool OnLocalSubnet(IPAddress ip, IEnumerable<(IPAddress Ip, IPAddress Mask)> ifs) =>
        ip.AddressFamily == AddressFamily.InterNetwork && ifs.Any(i => i.Ip.AddressFamily == AddressFamily.InterNetwork && (ToU(i.Ip) & ToU(i.Mask)) == (ToU(ip) & ToU(i.Mask)));
    /// <summary>A server address this PC almost certainly cannot reach: a Docker bridge (container) address that is not on one of this PC's own networks.
    /// (A Player on the Docker host itself, or a home network that really uses 172.20.x, is on that subnet and keeps it.)</summary>
    public static bool Unreachable(string? host, IReadOnlyList<(IPAddress Ip, IPAddress Mask)> ifs) =>
        IPAddress.TryParse(host ?? "", out var ip) && IsDockerBridge(ip) && !OnLocalSubnet(ip, ifs);
    /// <summary>Pure: a server that announced its container address (Docker bridge, no WAVWIZ_ADVERTISE_ADDRESS) is used at the address its answer came
    /// from instead (the Docker host, through the published port), when that one is usable. Nothing better = keep it (graceful fallback).</summary>
    public static ServerBeacon? PreferReachable(ServerBeacon? b, IPAddress? sender, IReadOnlyList<(IPAddress Ip, IPAddress Mask)> ifs)
    {
        if (b == null || !Unreachable(b.Host, ifs)) return b;
        if (sender is { AddressFamily: AddressFamily.InterNetwork } s && !IPAddress.IsLoopback(s) && !s.Equals(IPAddress.Any) && !Unreachable(s.ToString(), ifs)) return b with { Host = s.ToString() };
        return b;
    }
    /// <summary>Pure: of two answers from the same server keep the reachable one (the first otherwise).</summary>
    public static ServerBeacon Better(ServerBeacon have, ServerBeacon got, IReadOnlyList<(IPAddress Ip, IPAddress Mask)> ifs) => Unreachable(have.Host, ifs) && !Unreachable(got.Host, ifs) ? got : have;
    /// <summary>Pure: the list order - reachable servers first, then by name.</summary>
    public static List<ServerBeacon> Order(IEnumerable<ServerBeacon> found, IReadOnlyList<(IPAddress Ip, IPAddress Mask)> ifs) =>
        found.OrderBy(b => Unreachable(b.Host, ifs) ? 1 : 0).ThenBy(b => b.Name, StringComparer.OrdinalIgnoreCase).ToList();

    public static IEnumerable<IPAddress> SubnetHosts(IPAddress ip, IPAddress mask, int maxHosts = 1022)
    {
        uint a = ToU(ip), m = ToU(mask); int bits = System.Numerics.BitOperations.PopCount(m);
        if (bits < 22) { m = 0xFFFFFC00; }                 // never sweep more than a /22 around our own address
        if (bits > 30) yield break;
        uint net = a & m, bc = net | ~m; int n = 0;
        for (uint h = net + 1; h < bc && n < maxHosts; h++) { if (h == a) continue; n++; yield return FromU(h); }
    }
    private static uint ToU(IPAddress ip) { var b = ip.GetAddressBytes(); return (uint)(b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]); }
    private static IPAddress FromU(uint u) => new(new[] { (byte)(u >> 24), (byte)(u >> 16), (byte)(u >> 8), (byte)u });
    private static IPAddress Directed(IPAddress ip, IPAddress mask) { var a = ip.GetAddressBytes(); var m = mask.GetAddressBytes(); return new IPAddress(Enumerable.Range(0, 4).Select(i => (byte)(a[i] | ~m[i])).ToArray()); }

    /// <summary>Looks for servers for up to <paramref name="timeout"/>. Returns as soon as something is found plus a short grace period for a second server to answer.</summary>
    public static async Task<List<ServerBeacon>> FindAsync(TimeSpan timeout, Options? o = null, CancellationToken ct = default)
    {
        o ??= new Options(); var found = new Dictionary<string, ServerBeacon>(); var gate = new object(); var firstAt = 0L;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(timeout);
        var ifs = LocalInterfaces(); var tasks = new List<Task>();
        void Add(ServerBeacon? b0, IPAddress? sender, string how)
        {
            var b = PreferReachable(b0, sender, ifs); if (b == null) return;     // 0.7.1 t2069u: a Docker container address -> the address the answer came from
            if (b0 != null && b.Host != b0.Host) o.Log?.Invoke($"{b0.Name} announced {b0.Host} (a Docker-internal address); using {b.Host}");
            lock (gate)
            {
                var key = (b.Id.Length > 0 ? b.Id : b.Host);
                if (found.TryAdd(key, b)) { o.Log?.Invoke($"found {b.Name} at {b.Host} ({how})"); if (firstAt == 0) firstAt = Environment.TickCount64; }
                else if (Better(found[key], b, ifs) is var keep && !ReferenceEquals(keep, found[key])) { found[key] = keep; o.Log?.Invoke($"found {b.Name} at {b.Host} ({how}), reachable"); }
            }
        }
        bool Enough() { lock (gate) { if (o.WantedId != null && found.Values.Any(b => b.Id == o.WantedId && !Unreachable(b.Host, ifs))) return true; return firstAt != 0 && Environment.TickCount64 - firstAt > 1200; } }

        foreach (var (ip, mask) in ifs)
        {
            if (o.Mdns) tasks.Add(Safe(() => MdnsQuery(ip, (b, from) => Add(b, from, "Bonjour"), cts.Token)));
            tasks.Add(Safe(() => UdpProbe(ip, mask, o, (b, from) => Add(b, from, "UDP"), Enough, cts.Token)));
        }
        if (o.ExtraProbeTargets is { Count: > 0 }) tasks.Add(Safe(() => UdpProbe(IPAddress.Any, IPAddress.None, o with { Broadcast = false, UdpSweep = false }, (b, from) => Add(b, from, "UDP"), Enough, cts.Token)));
        if (o.HttpSweep) tasks.Add(Safe(async () =>
        {
            await Task.Delay(1500, cts.Token);
            bool any; lock (gate) any = found.Count > 0; if (any) return;
            foreach (var (ip, mask) in ifs) await HttpSweep(ip, mask, o, b => Add(b, null, "HTTP"), cts.Token);
        }));
        while (!cts.IsCancellationRequested && !Enough() && tasks.Any(t => !t.IsCompleted)) { try { await Task.Delay(100, cts.Token); } catch (OperationCanceledException) { break; } }
        cts.Cancel(); try { await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(1)); } catch { }
        lock (gate) return Order(found.Values, ifs);
    }

    private static async Task Safe(Func<Task> f) { try { await f(); } catch { } }

    private static async Task MdnsQuery(IPAddress ifIp, Action<ServerBeacon?, IPAddress?> add, CancellationToken ct)
    {
        using var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.Bind(new IPEndPoint(ifIp, 0));
        s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, ifIp.GetAddressBytes()); s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255);
        var q = DnsWire.Query(WavWizInfo.MdnsService + ".local", DnsWire.TypePtr, unicastResponse: true); var group = new IPEndPoint(IPAddress.Parse("224.0.0.251"), 5353);
        _ = Task.Run(async () => { try { for (int i = 0; i < 3 && !ct.IsCancellationRequested; i++) { await s.SendToAsync(q, SocketFlags.None, group, ct); await Task.Delay(700, ct); } } catch { } });
        var buf = new byte[4096];
        while (!ct.IsCancellationRequested)
        {
            var r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), ct);
            if (DnsWire.TryParse(buf.AsSpan(0, r.ReceivedBytes), out var m) && m!.IsResponse) add(ServerBeacon.FromMdns(m), ((IPEndPoint)r.RemoteEndPoint).Address);
        }
    }

    private static async Task UdpProbe(IPAddress ifIp, IPAddress mask, Options o, Action<ServerBeacon?, IPAddress?> add, Func<bool> enough, CancellationToken ct)
    {
        using var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.EnableBroadcast = true; s.Bind(new IPEndPoint(ifIp, 0));
        var probe = Encoding.ASCII.GetBytes(ServerBeacon.Probe);
        _ = Task.Run(async () =>
        {
            try
            {
                for (int round = 0; round < 3 && !ct.IsCancellationRequested; round++)
                {
                    if (o.ExtraProbeTargets != null) foreach (var t in o.ExtraProbeTargets) await s.SendToAsync(probe, SocketFlags.None, new IPEndPoint(t, o.DiscoveryPort), ct);
                    if (o.Broadcast && !ifIp.Equals(IPAddress.Any))
                    {
                        await s.SendToAsync(probe, SocketFlags.None, new IPEndPoint(IPAddress.Broadcast, o.DiscoveryPort), ct);
                        await s.SendToAsync(probe, SocketFlags.None, new IPEndPoint(Directed(ifIp, mask), o.DiscoveryPort), ct);
                    }
                    if (o.UdpSweep && round == 1 && !ifIp.Equals(IPAddress.Any))
                        foreach (var h in SubnetHosts(ifIp, mask)) { await s.SendToAsync(probe, SocketFlags.None, new IPEndPoint(h, o.DiscoveryPort), ct); }
                    await Task.Delay(600, ct);
                }
            }
            catch { }
        });
        var buf = new byte[1024];
        while (!ct.IsCancellationRequested)
        {
            var r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), ct);
            var from = ((IPEndPoint)r.RemoteEndPoint).Address; add(ServerBeacon.FromUdp(buf.AsSpan(0, r.ReceivedBytes), from), from);
        }
    }

    private static async Task HttpSweep(IPAddress ip, IPAddress mask, Options o, Action<ServerBeacon?> add, CancellationToken ct)
    {
        using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromMilliseconds(500) }) { Timeout = TimeSpan.FromMilliseconds(1200) };
        using var sem = new SemaphoreSlim(48);
        var tasks = SubnetHosts(ip, mask, 254).Select(async h =>
        {
            await sem.WaitAsync(ct);
            try
            {
                using var resp = await http.GetAsync($"http://{h}:{o.HttpPort}/api/v1/auth/state", ct); if (!resp.IsSuccessStatusCode) return;
                using var d = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct)); var r = d.RootElement;
                if (!r.TryGetProperty("display", out var disp) || disp.GetString() is not { } dsp || !dsp.StartsWith("WavWiz", StringComparison.Ordinal)) return;
                add(new ServerBeacon(r.TryGetProperty("serverId", out var sid) ? sid.GetString() ?? "" : "", r.TryGetProperty("serverName", out var sn) ? sn.GetString() ?? h.ToString() : h.ToString(), h.ToString(), o.HttpPort, WavWizInfo.DefaultHttpsPort, WavWizInfo.DefaultAudioPort, r.TryGetProperty("appVersion", out var v) ? v.GetString() ?? "" : ""));
            }
            catch { }
            finally { sem.Release(); }
        }).ToList();
        await Task.WhenAll(tasks);
    }
}
