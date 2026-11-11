using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
namespace WavWiz.Core.Cast;

/// <summary>
/// Minimal CASTV2 sender: TLS to the device (port 8009, or a Cast group's own port), virtual connection to receiver-0, PING/PONG heartbeat,
/// launch the Default Media Receiver, open the app's transport, LOAD / STOP and device volume. Requests are matched to replies by requestId.
/// Cast devices present a self-signed per-device certificate, so the TLS certificate is not validated (the same as every open-source sender);
/// WavWiz only connects to private LAN addresses it found by mDNS or the admin typed. The optional device-auth challenge is not used.
/// </summary>
public sealed class CastClient : IAsyncDisposable
{
    readonly System.IO.Stream _s; readonly IDisposable? _owner; readonly SemaphoreSlim _tx = new(1, 1); readonly CancellationTokenSource _cts = new();
    readonly ConcurrentDictionary<int, TaskCompletionSource<string>> _wait = new();
    readonly HashSet<string> _open = new();
    int _rid = Random.Shared.Next(1, 1 << 20);
    long _lastRxTicks = Environment.TickCount64;
    Task? _rx, _hb;
    public Action<string>? Log;
    /// <summary>Unsolicited (or any) MEDIA_STATUS from the app. Runs on the reader task: keep it short.</summary>
    public event Action<CastJson.MediaStatus>? MediaStatusChanged;
    /// <summary>The socket closed or the heartbeat stopped answering.</summary>
    public event Action<string>? Closed;
    public CastJson.ReceiverStatus? Receiver { get; private set; }
    public CastJson.MediaStatus? Media { get; private set; }
    public string? TransportId { get; private set; }
    public bool IsClosed { get; private set; }
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
    public int HeartbeatMs { get; init; } = 5000;
    /// <summary>No traffic at all for this long = gone (pychromecast: ping 10 s + pong 10 s).</summary>
    public int DeadMs { get; init; } = 20000;

    public CastClient(System.IO.Stream s, IDisposable? owner = null) { _s = s; _owner = owner; }

    public static async Task<CastClient> ConnectAsync(IPEndPoint ep, CancellationToken ct = default, bool tls = true)
    {
        var tcp = new TcpClient(ep.AddressFamily) { NoDelay = true };
        using (var t = CancellationTokenSource.CreateLinkedTokenSource(ct)) { t.CancelAfter(6000); await tcp.ConnectAsync(ep, t.Token); }
        System.IO.Stream st = tcp.GetStream();
        if (tls)
        {
            // 0.7.0 Pi smoke test: the callback goes in the options ONLY. Setting it in the SslStream constructor too makes .NET throw
            // "The 'RemoteCertificateValidationCallback' option was already set" before any handshake (missed by the plain-TCP fake).
            var ssl = new SslStream(st, false);
            using var t = CancellationTokenSource.CreateLinkedTokenSource(ct); t.CancelAfter(8000);
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = ep.Address.ToString(), RemoteCertificateValidationCallback = (_, _, _, _) => true }, t.Token);
            st = ssl;
        }
        var c = new CastClient(st, tcp); c.Start(); return c;
    }

    public void Start()
    {
        _rx ??= Task.Run(ReadLoop);
        _hb ??= Task.Run(HeartbeatLoop);
    }

    int NextId() => Interlocked.Increment(ref _rid);

    public async Task SendAsync(string dst, string ns, string json, CancellationToken ct = default)
    {
        if (IsClosed) throw new IOException("cast connection closed");
        var f = CastProto.Frame(new CastMessage(CastProto.SenderId, dst, ns, json));
        await _tx.WaitAsync(ct);
        try { await _s.WriteAsync(f, ct); await _s.FlushAsync(ct); } finally { _tx.Release(); }
    }

    async Task EnsureChannel(string dst, CancellationToken ct)
    {
        lock (_open) if (!_open.Add(dst)) return;
        await SendAsync(dst, CastProto.NsConnection, CastJson.Connect(), ct);
    }

    /// <summary>Sends a request and waits for the reply with the same requestId (or a *_ERROR / LOAD_FAILED reply).</summary>
    public async Task<string> RequestAsync(string dst, string ns, Func<int, string> build, CancellationToken ct = default)
    {
        await EnsureChannel(dst, ct);
        int id = NextId(); var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously); _wait[id] = tcs;
        try
        {
            await SendAsync(dst, ns, build(id), ct);
            using var t = CancellationTokenSource.CreateLinkedTokenSource(ct, _cts.Token); t.CancelAfter(Timeout);
            using var reg = t.Token.Register(() => tcs.TrySetException(new TimeoutException($"no reply from the Cast device ({ns.Split('.').Last()})")));
            return await tcs.Task;
        }
        finally { _wait.TryRemove(id, out _); }
    }

    public async Task<CastJson.ReceiverStatus?> GetStatusAsync(CancellationToken ct = default)
    {
        var r = await RequestAsync(CastProto.ReceiverId, CastProto.NsReceiver, CastJson.GetStatus, ct);
        return Receiver = CastJson.ParseReceiverStatus(r) ?? Receiver;
    }

    /// <summary>Launches (or re-uses) an app and opens a virtual connection to its transport.</summary>
    public async Task<CastJson.ReceiverStatus> LaunchAsync(string appId = CastProto.DefaultMediaReceiver, CancellationToken ct = default)
    {
        var st = await GetStatusAsync(ct);
        if (st?.AppId != appId || st.TransportId == null)
        {
            var r = await RequestAsync(CastProto.ReceiverId, CastProto.NsReceiver, id => CastJson.Launch(id, appId), ct);
            var type = CastJson.TypeOf(r);
            if (type != "RECEIVER_STATUS") throw new InvalidOperationException($"cast launch refused ({type ?? "no reply"})");
            st = CastJson.ParseReceiverStatus(r);
            // some devices answer LAUNCH before the app is up: poll status a few times
            for (int i = 0; i < 10 && (st?.AppId != appId || st.TransportId == null); i++) { await Task.Delay(500, ct); st = await GetStatusAsync(ct); }
            if (st?.AppId != appId || st.TransportId == null) throw new InvalidOperationException("cast app did not start");
        }
        Receiver = st; TransportId = st.TransportId;
        await EnsureChannel(TransportId!, ct);
        return st;
    }

    public async Task<CastJson.MediaStatus> LoadAsync(string url, string contentType, string? title = null, string? artist = null, string? album = null, string? image = null, CancellationToken ct = default)
    {
        var tid = TransportId ?? throw new InvalidOperationException("cast app not launched");
        var r = await RequestAsync(tid, CastProto.NsMedia, id => CastJson.Load(id, url, contentType, title, artist, album, image), ct);
        var type = CastJson.TypeOf(r);
        if (type != "MEDIA_STATUS") throw new InvalidOperationException($"cast LOAD failed ({type ?? "no reply"})");
        var m = CastJson.ParseMediaStatus(r) ?? throw new InvalidOperationException("cast LOAD: no media status");
        Media = m; return m;
    }

    public async Task SetVolumeAsync(double level, CancellationToken ct = default)
    {
        var r = await RequestAsync(CastProto.ReceiverId, CastProto.NsReceiver, id => CastJson.SetVolume(id, level), ct);
        Receiver = CastJson.ParseReceiverStatus(r) ?? Receiver;
    }

    /// <summary>Stops the app (the device goes back to its idle screen / ambient mode).</summary>
    public async Task StopAppAsync(CancellationToken ct = default)
    {
        var sid = Receiver?.SessionId; if (sid == null) return;
        try { await RequestAsync(CastProto.ReceiverId, CastProto.NsReceiver, id => CastJson.StopApp(id, sid), ct); } catch (TimeoutException) { }
        TransportId = null; Media = null;
    }

    async Task ReadLoop()
    {
        string why = "closed by the device";
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                var m = await CastProto.ReadAsync(_s, _cts.Token); if (m == null) break;
                Interlocked.Exchange(ref _lastRxTicks, Environment.TickCount64);
                if (m.PayloadUtf8 is not { } json) continue;
                var type = CastJson.TypeOf(json);
                if (m.Namespace == CastProto.NsHeartbeat) { if (type == "PING") _ = SendSafe(m.SourceId, CastProto.NsHeartbeat, CastJson.Pong()); continue; }
                if (m.Namespace == CastProto.NsConnection && type == "CLOSE")
                {
                    lock (_open) _open.Remove(m.SourceId);
                    if (m.SourceId == TransportId) { TransportId = null; Media = null; Log?.Invoke("cast app closed its connection"); }
                    continue;
                }
                if (m.Namespace == CastProto.NsReceiver && type == "RECEIVER_STATUS")
                {
                    var rs = CastJson.ParseReceiverStatus(json);
                    if (rs != null) { Receiver = rs; if (TransportId != null && rs.TransportId != TransportId) { TransportId = null; Media = null; Log?.Invoke($"cast app replaced ({rs.DisplayName ?? "none"})"); } }
                }
                if (m.Namespace == CastProto.NsMedia && type == "MEDIA_STATUS" && CastJson.ParseMediaStatus(json) is { } ms) { Media = ms; try { MediaStatusChanged?.Invoke(ms); } catch { } }
                int rid = CastJson.RequestIdOf(json);
                if (rid != 0 && _wait.TryGetValue(rid, out var tcs)) tcs.TrySetResult(json);
            }
        }
        catch (OperationCanceledException) { why = "closed"; }
        catch (Exception e) { why = e.Message; }
        Close(why);
    }

    async Task HeartbeatLoop()
    {
        try
        {
            await EnsureChannel(CastProto.ReceiverId, _cts.Token);
            while (!_cts.IsCancellationRequested)
            {
                await Task.Delay(HeartbeatMs, _cts.Token);
                if (Environment.TickCount64 - Interlocked.Read(ref _lastRxTicks) > DeadMs) { Close("the Cast device stopped answering"); return; }
                await SendSafe(CastProto.ReceiverId, CastProto.NsHeartbeat, CastJson.Ping());
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Close(e.Message); }
    }

    async Task SendSafe(string dst, string ns, string json) { try { await SendAsync(dst, ns, json); } catch (Exception e) { Log?.Invoke("cast send: " + e.Message); } }

    void Close(string why)
    {
        if (IsClosed) return; IsClosed = true;
        foreach (var w in _wait.Values) w.TrySetException(new IOException("cast connection closed: " + why));
        try { _cts.Cancel(); } catch { }
        try { Closed?.Invoke(why); } catch { }
    }

    public async ValueTask DisposeAsync()
    {
        if (!IsClosed)
        {
            List<string> open; lock (_open) open = _open.ToList();
            foreach (var d in open) { try { await SendAsync(d, CastProto.NsConnection, CastJson.Close()); } catch { } }
        }
        Close("disposed");
        try { _s.Dispose(); } catch { }
        _owner?.Dispose();
        if (_rx != null) try { await _rx; } catch { }
    }
}
