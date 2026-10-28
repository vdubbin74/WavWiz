using System.Net;
using System.Net.Sockets;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Discovery;
namespace WavWiz.Server.AirPlay;

/// <summary>
/// 0.5.0 AirPlay sender stage 1: browses _raop._tcp and _airplay._tcp over mDNS. Listen-and-query only: it never connects to a speaker.
/// It shares UDP 5353 with WavWiz's own responder (DiscoveryHost): its own socket with SO_REUSEADDR, joined to 224.0.0.251, and it only
/// sends QM (multicast-answer) queries so every socket on the port, including the responder's, keeps seeing the traffic.
/// Questions are ignored here (the responder answers them).
/// </summary>
public sealed class AirPlayBrowser : IDisposable
{
    static readonly IPAddress Group = IPAddress.Parse("224.0.0.251");
    readonly Action<string>? _log; readonly CancellationTokenSource _cts = new();
    Socket? _s; IPEndPoint? _dest;
    public AirPlayBrowseState State { get; } = new();
    public string? Problem { get; private set; }
    public bool Running => _s != null;
    public DateTimeOffset? LastQuery { get; private set; }
    public int Port { get; init; } = 5353;

    public AirPlayBrowser(Action<string>? log = null) { _log = log; }

    public void Start(IPAddress bind)
    {
        if (_s != null) return;
        if (IPAddress.IsLoopback(bind)) { Problem = "AirPlay browse needs a home-network address (the server is bound to loopback)."; return; }
        try
        {
            var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            s.Bind(new IPEndPoint(OperatingSystem.IsWindows() ? bind : Group, Port));          // same bind rule as DiscoveryHost
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(Group, bind));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, bind.GetAddressBytes());
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255); s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastLoopback, true);
            _s = s; _dest = new IPEndPoint(Group, Port);
            _ = Task.Run(() => Loop(s));
            _ = Task.Run(QueryLoop);
        }
        catch (Exception e) { Problem = "AirPlay browse unavailable: " + e.Message; _log?.Invoke(Problem); }
    }

    /// <summary>Ask now (the dev page's "Search again"). Answers arrive within ~1 s on a normal LAN.</summary>
    public void QueryNow()
    {
        var s = _s; if (s == null || _dest == null) return;
        try { s.SendTo(AirPlayBrowseState.Query(unicastResponse: false), _dest); LastQuery = DateTimeOffset.Now; } catch (Exception e) { Problem = "query failed: " + e.Message; }
    }

    async Task QueryLoop()
    {
        int[] steps = { 20, 1000, 2000, 4000, 8000, 16000, 32000 };      // RFC 6762 5.2: start at 1 s, double, cap at 60 s
        try
        {
            foreach (var d in steps) { await Task.Delay(d, _cts.Token); QueryNow(); }
            while (!_cts.IsCancellationRequested) { await Task.Delay(60000, _cts.Token); State.Prune(DateTimeOffset.Now); QueryNow(); }
        }
        catch (OperationCanceledException) { }
    }

    async Task Loop(Socket s)
    {
        var buf = new byte[9000];
        while (!_cts.IsCancellationRequested)
        {
            SocketReceiveFromResult r;
            try { r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), _cts.Token); }
            catch (OperationCanceledException) { break; } catch (ObjectDisposedException) { break; } catch (SocketException) { continue; }
            try { if (DnsWire.TryParse(buf.AsSpan(0, r.ReceivedBytes), out var m) && m!.IsResponse) State.Ingest(m, DateTimeOffset.Now); } catch { }
        }
    }

    /// <summary>JSON shape for GET /api/v1/dev/airplay.</summary>
    public object Snapshot()
    {
        var now = DateTimeOffset.Now;
        return new
        {
            running = Running, problem = Problem, lastQuery = LastQuery, packets = State.Packets,
            devices = State.Devices(now).Select(d => new
            {
                id = d.Id, name = d.Name, host = d.Host, addresses = d.Addresses, raopPort = d.RaopPort, airplayPort = d.AirPlayPort,
                model = d.Model, manufacturer = d.Manufacturer, codecs = d.CodecNames, encryption = d.EncryptionNames, et = d.Encryption, cn = d.Codecs,
                features = "0x" + d.Features.ToString("X"), featureNames = d.FeatureNames.ToList(), flags = "0x" + d.StatusFlags.ToString("X"),
                airplay2 = d.SupportsAirPlay2, route = d.Route, password = d.PasswordRequired, pin = d.PinRequired, srcvers = d.SourceVersion,
                seenMs = d.FirstSeen == default ? (long?)null : (long)(now - d.FirstSeen).TotalMilliseconds,
            }).ToList(),
        };
    }

    public void Dispose() { _cts.Cancel(); try { _s?.Dispose(); } catch { } _s = null; }
}
