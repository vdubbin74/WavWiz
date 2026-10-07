using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Threading.Channels;
using WavWiz.Core;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.Core.Stream;
namespace WavWiz.Server.Net;

/// <summary>One connected player. Implements the stream subscriber: Send() never blocks the 10 ms pump; a player that cannot keep up is dropped (and reconnects).</summary>
public sealed class PlayerSession : IStreamSubscriber
{
    private readonly Channel<byte[]> _out = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(1200) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private uint _ctlSeq;
    public string Id { get; }
    public Hello Hello { get; }
    public IPAddress Remote { get; }
    public int BufferDepthMs { get; }
    public DateTimeOffset ConnectedAt { get; } = DateTimeOffset.UtcNow;
    public volatile PlayerStatus? Status; public DateTime StatusAt = DateTime.MinValue;
    public volatile OutputInfo[] Outputs = Array.Empty<OutputInfo>();
    public volatile bool Dead;
    public bool IsWeb { get; init; }
    public volatile string? EndReason;
    public CancellationTokenSource Cts { get; } = new();
    public ChannelReader<byte[]> Reader => _out.Reader;
    public string LinkType => Hello.LinkType;

    public PlayerSession(Hello h, IPAddress remote)
    {
        Id = h.PlayerId; Hello = h; Remote = remote;
        BufferDepthMs = string.Equals(h.LinkType, "wifi", StringComparison.OrdinalIgnoreCase) ? 4000 : 3000;     // spec 7.4 / D2
    }

    public void Send(byte[] message)
    {
        if (Dead) return;
        if (!_out.Writer.TryWrite(message)) { EndReason ??= "the server could not keep up with this player and dropped it"; Dead = true; Cts.Cancel(); }       // cannot keep up: drop, it reconnects and re-joins at the live position
    }

    public void SendJson<T>(MsgType type, T body) => Send(Wire.EncodeJson(type, Interlocked.Increment(ref _ctlSeq), body));
    /// <summary>Tells the player "unauthorized: pair this player again" (so it shows "not paired" instead of retrying) and closes shortly after, so the message can leave first.</summary>
    public void CloseUnauthorized() { try { SendJson(MsgType.Bye, new Bye("unauthorized: this player was removed from WavWiz - pair it again")); } catch { } _ = Task.Run(async () => { await Task.Delay(400); Close(); }); }
    public void Close() { Dead = true; Cts.Cancel(); _out.Writer.TryComplete(); }
}

public sealed class AudioHost : IAsyncDisposable
{
    private readonly ServerConfig _cfg; private readonly AuthService _auth; private readonly IMonotonicClock _clock; private readonly ClockHost _clockHost;
    private TcpListener? _listener; private readonly CancellationTokenSource _cts = new(); private Task? _loop;
    private readonly ConcurrentDictionary<string, PlayerSession> _sessions = new();
    public Func<PlayerSession, Task>? OnConnected; public Action<PlayerSession>? OnDisconnected;
    public Action<PlayerSession, OutputsMsg>? OnOutputs; public Action<PlayerSession, CalResult>? OnCalResult; public Action<PlayerSession, PlayerStatus>? OnStatus;
    public Action<string>? Log;

    public AudioHost(ServerConfig cfg, AuthService auth, IMonotonicClock clock, ClockHost clockHost) { _cfg = cfg; _auth = auth; _clock = clock; _clockHost = clockHost; }

    public IReadOnlyCollection<PlayerSession> Sessions => _sessions.Values.ToList();
    public PlayerSession? Get(string playerId) => _sessions.TryGetValue(playerId, out var s) ? s : null;
    public int Port => _listener == null ? 0 : ((IPEndPoint)_listener.LocalEndpoint).Port;

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Parse(_cfg.BindAddress), _cfg.AudioPort);
        _listener.Start(); _loop = Task.Run(AcceptLoop);
    }

    private async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient c;
            try { c = await _listener!.AcceptTcpClientAsync(_cts.Token); } catch { break; }
            var ip = (c.Client.RemoteEndPoint as IPEndPoint)?.Address;
            if (!AuthService.IsPrivateSource(ip, _cfg.ExtraAllowedSubnets)) { try { c.Dispose(); } catch { } continue; }       // spec 13: source filtering
            _ = Task.Run(() => Serve(c, ip!));
        }
    }

    private async Task Serve(TcpClient tcp, IPAddress remote)
    {
        try
        {
            using var _ = tcp; tcp.NoDelay = true;
            try { tcp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true); } catch { }
            await ServeStream(tcp.GetStream(), remote, null);
        }
        catch (Exception e) when (e is IOException or ObjectDisposedException or SocketException) { }
    }

    /// <summary>
    /// One player connection on any byte stream: a TCP socket (Windows players) or a WebSocket (a phone/browser acting as a device, 0.0.2 - then
    /// <paramref name="webUser"/> is the signed-in browser and the player id must start with "web-").
    /// </summary>
    public async Task ServeStream(Stream net, IPAddress remote, AuthInfo? webUser)
    {
        PlayerSession? sess = null; uint clockSession = 0; string endReason = "connection closed";
        try
        {
            using var hs = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var (h, p) = await FrameIO.ReadAsync(net, hs.Token);
            if (h.Type != MsgType.Hello) return;
            var hello = Wire.DecodeJson<Hello>(p);
            if (hello == null || string.IsNullOrWhiteSpace(hello.PlayerId) || hello.PlayerId.Length > 64) return;
            bool ok;
            if (webUser != null) ok = webUser.Role is Role.Control or Role.Admin && hello.PlayerId.StartsWith("web-", StringComparison.Ordinal) && hello.PlayerId.Skip(4).All(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_');
            else { var info = _auth.Validate(hello.DeviceToken); ok = info != null && info.Role == Role.Player && string.Equals(info.PlayerId, hello.PlayerId, StringComparison.Ordinal) && !hello.PlayerId.StartsWith("web-", StringComparison.Ordinal); }
            if (!ok)
            {
                await FrameIO.WriteAsync(net, Wire.EncodeJson(MsgType.Bye, 0, new Bye("unauthorized: pair this player again")), CancellationToken.None);
                Log?.Invoke($"player {hello.PlayerId} from {remote} refused (bad token)"); return;
            }
            sess = new PlayerSession(hello, remote) { IsWeb = webUser != null };
            if (_sessions.TryRemove(sess.Id, out var old)) { old.EndReason = "replaced by a newer connection from the same player (the old one had silently died)"; old.Close(); try { OnDisconnected?.Invoke(old); } catch { } }           // a reconnect replaces the stale session
            _sessions[sess.Id] = sess;
            string clockKey = "";
            if (webUser == null)
            {
                var key = RandomNumberGenerator.GetBytes(32); clockSession = (uint)RandomNumberGenerator.GetInt32(1, int.MaxValue);
                _clockHost.Register(clockSession, key); clockKey = Convert.ToBase64String(key);
            }
            var welcome = new Welcome(Guid.NewGuid().ToString("N")[..12], "pcm24", Wire.SampleRate, Wire.Channels, 24, Wire.FrameSamples, _clock.NowUs, sess.BufferDepthMs,
                WavWizInfo.Version, WavWizInfo.Channel, clockSession, clockKey, webUser != null ? 0 : (_clockHost.Port != 0 ? _clockHost.Port : _cfg.ClockPort));
            await FrameIO.WriteAsync(net, Wire.EncodeJson(MsgType.Welcome, 0, welcome), CancellationToken.None);
            Log?.Invoke($"player {sess.Id} ({hello.Name}) connected from {remote}, link {hello.LinkType}{(sess.IsWeb ? ", web page" : "")}");
            if (OnConnected != null) await OnConnected(sess);

            var writer = Task.Run(async () =>
            {
                try { await foreach (var m in sess.Reader.ReadAllAsync(sess.Cts.Token)) { await net.WriteAsync(m, sess.Cts.Token); await net.FlushAsync(sess.Cts.Token); } }
                catch { }
                sess.Close();
            });
            _ = Task.Run(async () =>      // 0.0.2 keepalive: lets a player tell a dead audio connection from an idle one (0.0.7: web pages too, every 5 s, so the phone's watchdog can spot a half-open Wi-Fi link)
            { try { using var tk = new PeriodicTimer(TimeSpan.FromSeconds(webUser == null ? 2 : 5)); while (await tk.WaitForNextTickAsync(sess.Cts.Token)) sess.SendJson(MsgType.CalResult, new CalResult("keepalive", "ok", null)); } catch { } });
            try
            {
                while (!sess.Cts.IsCancellationRequested)
                {
                    using var idle = CancellationTokenSource.CreateLinkedTokenSource(sess.Cts.Token); idle.CancelAfter(TimeSpan.FromSeconds(15));   // status arrives every 1 s: silence = dead link
                    (Header mh, byte[] mp) msg;
                    try { msg = await FrameIO.ReadAsync(net, idle.Token); }
                    catch (OperationCanceledException) when (!sess.Cts.IsCancellationRequested) { endReason = "no status from the player for 15 s (the network stalled or the PC slept)"; throw; }
                    var (mh, mp) = msg;
                    switch (mh.Type)
                    {
                        case MsgType.PlayerStatus: { var st = Wire.DecodeJson<PlayerStatus>(mp); if (st != null) { sess.Status = st; sess.StatusAt = DateTime.UtcNow; OnStatus?.Invoke(sess, st); } break; }
                        case MsgType.Outputs: { var o = Wire.DecodeJson<OutputsMsg>(mp); if (o != null) { sess.Outputs = o.Outputs; OnOutputs?.Invoke(sess, o); } break; }
                        case MsgType.CalResult: { var r = Wire.DecodeJson<CalResult>(mp); if (r != null) OnCalResult?.Invoke(sess, r); break; }
                        case MsgType.Bye: endReason = "the player said goodbye (closed or switched off)"; return;
                    }
                }
                endReason = "closed by the server";
            }
            finally { sess.Close(); await Task.WhenAny(writer, Task.Delay(500)); }
        }
        catch (EndOfStreamException) { endReason = "the player closed the connection or the network dropped"; }
        catch (Exception e) when (e is IOException or OperationCanceledException or InvalidDataException or SocketException or ObjectDisposedException or System.Text.Json.JsonException or System.Net.WebSockets.WebSocketException)
        { if (e is IOException or SocketException or System.Net.WebSockets.WebSocketException) endReason = "network error: " + e.Message; }
        catch (Exception e) { endReason = "error: " + e.Message; Log?.Invoke("audio connection error: " + e.Message); }
        finally
        {
            if (clockSession != 0) _clockHost.Unregister(clockSession);
            if (sess != null)
            {
                sess.EndReason ??= endReason;
                if (_sessions.TryGetValue(sess.Id, out var cur) && ReferenceEquals(cur, sess)) { _sessions.TryRemove(sess.Id, out _); OnDisconnected?.Invoke(sess); Log?.Invoke($"player {sess.Id} disconnected: {sess.EndReason}"); }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel(); try { _listener?.Stop(); } catch { }
        foreach (var s in _sessions.Values) s.Close();
        if (_loop != null) await Task.WhenAny(_loop, Task.Delay(1000));
    }
}

/// <summary>UDP clock-sync responder: authenticated by a per-connection key (HMAC-16), so a stranger on the LAN cannot skew anybody's clock (spec 9.1).</summary>
public sealed class ClockHost : IDisposable
{
    private readonly ServerConfig _cfg; private readonly IMonotonicClock _clock; private UdpClient? _udp; private Task? _loop;
    private readonly ConcurrentDictionary<uint, byte[]> _keys = new();
    public int Port => _udp == null ? 0 : ((IPEndPoint)_udp.Client.LocalEndPoint!).Port;
    public ClockHost(ServerConfig cfg, IMonotonicClock clock) { _cfg = cfg; _clock = clock; }
    public void Register(uint session, byte[] key) => _keys[session] = key;
    public void Unregister(uint session) => _keys.TryRemove(session, out _);

    public void Start()
    {
        _udp = new UdpClient(new IPEndPoint(IPAddress.Parse(_cfg.BindAddress), _cfg.ClockPort));
        _loop = Task.Run(async () =>
        {
            while (true)
            {
                UdpReceiveResult r;
                try { r = await _udp.ReceiveAsync(); } catch (ObjectDisposedException) { break; } catch (SocketException) { continue; }
                long t1 = _clock.NowUs;
                try
                {
                    if (!AuthService.IsPrivateSource(r.RemoteEndPoint.Address, _cfg.ExtraAllowedSubnets)) continue;
                    if (!ClockPacket.TryReadSessionId(r.Buffer, out var sid) || !_keys.TryGetValue(sid, out var key)) continue;
                    if (!ClockPacket.TryDecodePing(r.Buffer, key, out var seq, out var t0)) continue;
                    var pong = ClockPacket.EncodePong(sid, seq, t0, t1, _clock.NowUs, key);
                    await _udp.SendAsync(pong, pong.Length, r.RemoteEndPoint);
                }
                catch { }
            }
        });
    }

    public void Dispose() { try { _udp?.Dispose(); } catch { } }
}
