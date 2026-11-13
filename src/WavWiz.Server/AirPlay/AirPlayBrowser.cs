using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Discovery;
namespace WavWiz.Server.AirPlay;

/// <summary>
/// 0.5.0 AirPlay sender stage 1: browses _raop._tcp and _airplay._tcp over mDNS. Listen-and-query only: it never connects to a speaker.
/// It shares UDP 5353 with WavWiz's own responder (DiscoveryHost): its own socket with SO_REUSEADDR, joined to 224.0.0.251, and it only
/// sends QM (multicast-answer) queries so every socket on the port, including the responder's, keeps seeing the traffic.
/// Questions are ignored here (the responder answers them).
/// 0.6.9 #22b (t1860): a browse that fails to start, or whose socket dies, is retried with backoff (5 s, 15 s, 30 s, then every 60 s) instead of
/// staying off until a restart. Start / failure / retry / speakers seen go to the server log, and <see cref="Status"/> ('running', 'retrying',
/// 'off') with <see cref="LastError"/> is reported to the Find card.
/// </summary>
public sealed class AirPlayBrowser : IDisposable
{
    static readonly IPAddress Group = IPAddress.Parse("224.0.0.251");
    readonly Action<string>? _log; readonly CancellationTokenSource _cts = new(); readonly object _gate = new();
    Socket? _s; IPEndPoint? _dest; IPAddress? _bind; CancellationTokenSource? _gen; bool _retryLoop; int _sendFails; int _loggedCount = -1;
    public AirPlayBrowseState State { get; } = new();
    /// <summary>Plain reason when the browse is not running (null while it runs).</summary>
    public string? Problem { get; private set; }
    /// <summary>The last start / socket failure (kept while retrying; cleared on a successful start).</summary>
    public string? LastError { get; private set; }
    public bool Running => _s != null;
    /// <summary>'starting' before Start, 'running', 'retrying' (failed or died; another try at <see cref="NextRetry"/>), 'off' (cannot work with this config: loopback bind).</summary>
    public string Status { get; private set; } = "starting";
    public DateTimeOffset? NextRetry { get; private set; }
    public int Attempts { get; private set; }
    public DateTimeOffset? LastQuery { get; private set; }
    public int Port { get; init; } = 5353;
    /// <summary>Test seam: opens the multicast socket for a bind address (default: the real 5353 socket).</summary>
    public Func<IPAddress, int, Socket>? Open { get; init; }
    /// <summary>Test seam: where queries go (default the mDNS group 224.0.0.251).</summary>
    public IPAddress QueryTo { get; init; } = Group;
    /// <summary>Test seam: retry delay after the n-th failed try (1-based). Default <see cref="RetryDelay"/>.</summary>
    public Func<int, TimeSpan> Delay { get; init; } = RetryDelay;
    /// <summary>Consecutive receive / send socket errors that count as "the socket died".</summary>
    public const int DeadAfterErrors = 20, DeadAfterSendFails = 3;

    public AirPlayBrowser(Action<string>? log = null) { _log = log; }

    /// <summary>Backoff after the n-th failure (1-based): 5 s, 15 s, 30 s, then every 60 s. Pure.</summary>
    public static TimeSpan RetryDelay(int failures) => TimeSpan.FromSeconds(failures switch { <= 1 => 5, 2 => 15, 3 => 30, _ => 60 });

    void Log(string m) { try { _log?.Invoke("AirPlay browse: " + m); } catch { } }

    public void Start(IPAddress bind)
    {
        lock (_gate)
        {
            if (_s != null || _cts.IsCancellationRequested) return;
            _bind = bind;
            if (IPAddress.IsLoopback(bind))
            {
                Status = "off"; Problem = LastError = "AirPlay browse needs a home-network address (the server is bound to loopback).";
                Log("not started - the server is bound to loopback (" + bind + "), so it cannot search the home network"); return;
            }
            if (TryStart()) return;
        }
        StartRetryLoop();
    }

    /// <summary>One attempt (caller holds _gate). True when the socket is open and the loops run.</summary>
    bool TryStart()
    {
        Attempts++;
        Socket? s = null;
        try
        {
            s = (Open ?? OpenMulticast)(_bind!, Port);
            _s = s; _dest = new IPEndPoint(QueryTo, Port); _sendFails = 0;
            _gen?.Cancel(); _gen = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            var tok = _gen.Token;
            Status = "running"; Problem = null; LastError = null; NextRetry = null;
            Log($"started on {_bind}:{Port} ({InterfaceOf(_bind!)}){(Attempts > 1 ? $" after {Attempts} tries" : "")}; listening for _raop._tcp / _airplay._tcp");
            if (IsVpnAddress(_bind!)) Log($"{_bind} looks like a VPN (Tailscale / CGNAT 100.64.0.0/10) address - speakers on the home network will not answer here; set the server's network address to the home-network adapter");
            _ = Task.Run(() => Loop(s, tok));
            _ = Task.Run(() => QueryLoop(tok));
            return true;
        }
        catch (Exception e)
        {
            try { s?.Dispose(); } catch { }
            _s = null; Failed("couldn't start on " + _bind + ":" + Port + ": " + e.Message);
            return false;
        }
    }

    /// <summary>Records a failure and schedules the next try (caller holds _gate).</summary>
    void Failed(string why)
    {
        LastError = why; Problem = "AirPlay browse unavailable: " + why; Status = "retrying";
        var d = Delay(Math.Max(1, Attempts)); NextRetry = DateTimeOffset.Now + d;
        Log($"{why} - trying again in {d.TotalSeconds:0} s (try {Attempts})");
    }

    void StartRetryLoop()
    {
        lock (_gate) { if (_retryLoop) return; _retryLoop = true; }
        _ = Task.Run(async () =>
        {
            try
            {
                while (!_cts.IsCancellationRequested)
                {
                    TimeSpan wait;
                    lock (_gate) { if (_s != null) break; wait = Delay(Math.Max(1, Attempts)); }
                    await Task.Delay(wait, _cts.Token);
                    lock (_gate) { if (_s != null || _cts.IsCancellationRequested) break; if (TryStart()) break; }
                }
            }
            catch (OperationCanceledException) { }
            finally { lock (_gate) _retryLoop = false; }
        });
    }

    /// <summary>The socket stopped working: close it and retry with backoff (the speakers already heard stay listed until they age out).</summary>
    void Died(Socket s, string why)
    {
        lock (_gate)
        {
            if (!ReferenceEquals(_s, s) || _cts.IsCancellationRequested) return;
            _gen?.Cancel(); try { s.Dispose(); } catch { }
            _s = null; Attempts = 1; Failed("stopped: " + why);
        }
        StartRetryLoop();
    }

    static Socket OpenMulticast(IPAddress bind, int port)
    {
        var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
        try
        {
            s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            s.Bind(new IPEndPoint(OperatingSystem.IsWindows() ? bind : Group, port));          // same bind rule as DiscoveryHost
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(Group, bind));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, bind.GetAddressBytes());
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255); s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastLoopback, true);
            return s;
        }
        catch { s.Dispose(); throw; }
    }

    /// <summary>100.64.0.0/10 (Tailscale and other carrier-grade NAT VPNs). Pure.</summary>
    public static bool IsVpnAddress(IPAddress a) { var b = a.GetAddressBytes(); return b.Length == 4 && b[0] == 100 && (b[1] & 0xC0) == 64; }

    /// <summary>"interface Ethernet" for the adapter that owns the bind address (best effort, for the log).</summary>
    static string InterfaceOf(IPAddress bind)
    {
        if (bind.Equals(IPAddress.Any)) return "all interfaces";
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
                foreach (var a in n.GetIPProperties().UnicastAddresses)
                    if (a.Address.Equals(bind)) return $"interface {n.Name}, {n.OperationalStatus}";
        }
        catch { }
        return "no adapter owns this address";
    }

    /// <summary>Ask now (the card's "Search again"). Answers arrive within ~1 s on a normal LAN.</summary>
    public void QueryNow()
    {
        var s = _s; if (s == null || _dest == null) return;
        try
        {
            s.SendTo(AirPlayBrowseState.Query(unicastResponse: false), _dest); LastQuery = DateTimeOffset.Now; _sendFails = 0;
            // 0.6.9 #22b: ask for the SRV / TXT / A a device left out (TVs often answer the browse with the PTR only)
            foreach (var (name, type) in State.Missing(DateTimeOffset.Now)) s.SendTo(DnsWire.Query(name, type, unicastResponse: false), _dest);
        }
        catch (ObjectDisposedException) { Died(s, "socket closed"); }
        catch (Exception e)
        {
            Problem = "query failed: " + e.Message;
            if (++_sendFails >= DeadAfterSendFails) Died(s, "queries keep failing (" + e.Message + ")");
        }
    }

    async Task QueryLoop(CancellationToken tok)
    {
        int[] steps = { 20, 1000, 2000, 4000, 8000, 16000, 32000 };      // RFC 6762 5.2: start at 1 s, double, cap at 60 s
        try
        {
            foreach (var d in steps) { await Task.Delay(d, tok); QueryNow(); }
            LogSeen(force: true);
            while (!tok.IsCancellationRequested) { await Task.Delay(60000, tok); State.Prune(DateTimeOffset.Now); QueryNow(); LogSeen(force: false); }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>Logs how many AirPlay speakers have answered (once ~1 min after start, then when the number changes).</summary>
    void LogSeen(bool force)
    {
        int n; try { n = State.Devices(DateTimeOffset.Now).Count; } catch { return; }
        if (!force && n == _loggedCount) return;
        _loggedCount = n;
        Log(n > 0 ? $"{n} AirPlay speaker{(n == 1 ? "" : "s")} seen ({State.Packets} mDNS answers heard)"
                  : State.Packets == 0 ? "no mDNS answers heard at all - a firewall may be blocking UDP 5353 for WavWiz"
                  : $"no AirPlay speakers have answered ({State.Packets} other mDNS answers heard)");
    }

    readonly Dictionary<string, string> _seen = new();
    /// <summary>One log line per AirPlay device (speaker, receiver or TV - nothing is filtered here) when it is first seen or its details change:
    /// name, model / maker, address, which services (_raop / _airplay) and the interface it was heard on.</summary>
    void LogServices(EndPoint from)
    {
        List<AirPlayDevice> devs; try { devs = State.Devices(DateTimeOffset.Now); } catch { return; }
        foreach (var d in devs)
        {
            var svc = string.Join("+", new[] { d.Raop ? "_raop._tcp" : null, d.AirPlay2Service ? "_airplay._tcp" : null }.Where(x => x != null));
            var line = $"seen {d.Name} ({DescribeDevice(d)}) at {(d.Addresses.Count > 0 ? string.Join(", ", d.Addresses) : d.Host is { Length: > 0 } h ? h + " (address not resolved yet)" : "address not known yet")} via {(svc.Length > 0 ? svc : "browse answer")}, heard from {(from as IPEndPoint)?.Address} on {_bind} ({InterfaceOf(_bind!)})";
            lock (_seen) { if (_seen.TryGetValue(d.Id, out var old) && old == line) continue; if (_seen.Count > 500) _seen.Clear(); _seen[d.Id] = line; }
            Log(line);
        }
    }
    /// <summary>"model OLED65C1PUB, LG Electronics, AirPlay 2" for the log. Pure.</summary>
    public static string DescribeDevice(AirPlayDevice d)
    {
        var parts = new List<string>();
        parts.Add("model " + (string.IsNullOrEmpty(d.Model) ? "unknown" : d.Model));
        if (!string.IsNullOrEmpty(d.Manufacturer)) parts.Add(d.Manufacturer!);
        parts.Add(d.SupportsAirPlay2 ? "AirPlay 2" : "AirPlay 1");
        if (AirPlayFeatures.Has(d.Features, AirPlayFeatures.Video)) parts.Add("video");
        parts.Add("route " + d.Route);
        return string.Join(", ", parts);
    }

    async Task Loop(Socket s, CancellationToken tok)
    {
        var buf = new byte[9000]; int errs = 0;
        while (!tok.IsCancellationRequested)
        {
            SocketReceiveFromResult r;
            try { r = await s.ReceiveFromAsync(buf, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), tok); errs = 0; }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { if (!tok.IsCancellationRequested) Died(s, "socket closed"); break; }
            catch (SocketException e)
            {
                if (++errs < DeadAfterErrors) { try { await Task.Delay(50, tok); } catch (OperationCanceledException) { break; } continue; }   // a transient error (e.g. ICMP reset); no hot spin
                Died(s, "receive keeps failing (" + e.Message + ")"); break;
            }
            try { if (DnsWire.TryParse(buf.AsSpan(0, r.ReceivedBytes), out var m) && m!.IsResponse && State.Ingest(m, DateTimeOffset.Now)) LogServices(r.RemoteEndPoint); } catch { }
        }
    }

    /// <summary>JSON shape for GET /api/v1/dev/airplay.</summary>
    public object Snapshot()
    {
        var now = DateTimeOffset.Now;
        return new
        {
            running = Running, status = Status, problem = Problem, lastError = LastError, lastQuery = LastQuery, packets = State.Packets,
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

    public void Dispose()
    {
        _cts.Cancel();
        lock (_gate) { _gen?.Cancel(); try { _s?.Dispose(); } catch { } _s = null; Status = "off"; NextRetry = null; }
    }
}
