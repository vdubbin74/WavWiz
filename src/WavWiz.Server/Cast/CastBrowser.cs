using System.Net;
using System.Net.Sockets;
using WavWiz.Core.Cast;
using WavWiz.Core.Discovery;
namespace WavWiz.Server.Cast;

/// <summary>
/// 0.7.0 F169: browses _googlecast._tcp over mDNS. Listen-and-query only, never connects. Shares UDP 5353 with WavWiz's own responder and the
/// AirPlay browser exactly like <see cref="AirPlay.AirPlayBrowser"/> (own socket, SO_REUSEADDR, 224.0.0.251, QM queries only).
/// Started the first time an admin opens the Cast card, so an idle server does no Cast browsing.
/// </summary>
public sealed class CastBrowser : IDisposable
{
    static readonly IPAddress Group = IPAddress.Parse("224.0.0.251");
    readonly Action<string>? _log; readonly CancellationTokenSource _cts = new();
    Socket? _s; IPEndPoint? _dest;
    public CastBrowseState State { get; } = new();
    public string? Problem { get; private set; }
    public bool Running => _s != null;
    public DateTimeOffset? LastQuery { get; private set; }
    public int Port { get; init; } = 5353;
    public CastBrowser(Action<string>? log = null) { _log = log; }

    public void Start(IPAddress bind)
    {
        if (_s != null) return;
        if (IPAddress.IsLoopback(bind)) { Problem = "Cast search needs a home-network address (the server is bound to loopback)."; return; }
        try
        {
            var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            s.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            s.Bind(new IPEndPoint(OperatingSystem.IsWindows() ? bind : Group, Port));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.AddMembership, new MulticastOption(Group, bind));
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, bind.GetAddressBytes());
            s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 255); s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastLoopback, true);
            _s = s; _dest = new IPEndPoint(Group, Port);
            _ = Task.Run(() => Loop(s)); _ = Task.Run(QueryLoop);
        }
        catch (Exception e) { Problem = "Cast search unavailable: " + e.Message; _log?.Invoke(Problem); }
    }

    public void QueryNow()
    {
        var s = _s; if (s == null || _dest == null) return;
        try { s.SendTo(CastBrowseState.Query(), _dest); LastQuery = DateTimeOffset.Now; } catch (Exception e) { Problem = "query failed: " + e.Message; }
    }

    async Task QueryLoop()
    {
        int[] steps = { 20, 1000, 2000, 4000, 8000, 16000, 32000 };
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

    public void Dispose() { _cts.Cancel(); try { _s?.Dispose(); } catch { } _s = null; }
}
