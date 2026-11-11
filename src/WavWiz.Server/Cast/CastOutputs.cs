using System.Net;
using System.Security.Cryptography;
using WavWiz.Core.Cast;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Cast;

/// <summary>
/// 0.7.0 F169: Google Cast devices as WavWiz speakers ("cast:&lt;id&gt;"). Each connected device has a CASTV2 control connection (Default Media
/// Receiver launched) and a <see cref="CastSink"/> subscribed to its playback group; the device pulls the sink's live WAV from
/// GET /api/v1/cast/stream/&lt;token&gt; over plain HTTP on the LAN address it can reach. Same shape as AirPlayOutputs so zones, volume,
/// mute, on/off, delay and Forget work the same way.
/// </summary>
public sealed class CastOutputs : IAsyncDisposable
{
    public sealed class Out
    {
        public required string Key, Name, Address, Kind, Token, Url; public required CastSink Sink; public required CastClient Client;
        public int Volume = 50, DelayMs; public string State = "connected"; public string? Error; public bool Subscribed; public int Reloads;
        public DateTimeOffset Since = DateTimeOffset.UtcNow;
    }
    readonly ConductorRegistry _reg; readonly Func<CastBrowser?> _browser; readonly Action<string>? _log;
    readonly Dictionary<string, Out> _outs = new(); readonly SemaphoreSlim _gate = new(1, 1);
    public CastOutputs(ConductorRegistry reg, Func<CastBrowser?> browser, Action<string>? log = null) { _reg = reg; _browser = browser; _log = log; }
    /// <summary>The server's plain-HTTP port (the device fetches the stream there).</summary>
    public Func<int> HttpPort { get; set; } = () => WavWiz.Core.WavWizInfo.DefaultHttpPort;
    /// <summary>The server's bind address; a specific LAN address is used as-is, a wildcard means "the address that routes to the device".</summary>
    public Func<string> BindAddress { get; set; } = () => "0.0.0.0";
    /// <summary>Estimated receiver buffer, ms (CastSink.LatencyMs). Tuned on real hardware.</summary>
    public int LatencyMs { get; set; } = 2000;
    /// <summary>Tests swap the transport (plain TCP to a fake receiver).</summary>
    public Func<IPEndPoint, CancellationToken, Task<CastClient>> Dial { get; set; } = (ep, ct) => CastClient.ConnectAsync(ep, ct);
    /// <summary>Called when a device drops (socket closed / heartbeat lost / app replaced); CastSpeakers reconnects it.</summary>
    public Action<string, string>? Dropped;

    public static string PlayerId(string key) => "cast:" + key;
    public static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    /// <summary>The LAN address the device should use to reach this server: the bind address when it is specific, else the local
    /// address the OS would route from towards the device (a UDP "connect" sends nothing). Always an IP: Cast devices use Google DNS, not mDNS or the LAN's DNS.</summary>
    public static IPAddress StreamHost(string bind, IPAddress device)
    {
        if (IPAddress.TryParse(bind.Trim('[', ']'), out var b) && !b.Equals(IPAddress.Any) && !b.Equals(IPAddress.IPv6Any) && !IPAddress.IsLoopback(b)) return b;
        using var probe = new System.Net.Sockets.UdpClient(device.AddressFamily); probe.Connect(device, 9);
        return ((IPEndPoint)probe.Client.LocalEndPoint!).Address;
    }
    public static string StreamUrl(IPAddress host, int port, string token) => $"http://{(host.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? "[" + host + "]" : host.ToString())}:{port}/api/v1/cast/stream/{token}.wav";

    /// <summary>Resolves a device (from the browser, or an explicit "ip:port"), connects, launches the Default Media Receiver and loads the live stream.</summary>
    public async Task<Out> ConnectAsync(string key, string? endpoint, int delayMs, int volume, CancellationToken ct = default, bool subscribe = true, string? displayName = null)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_outs.TryGetValue(key, out var existing)) return existing;
            IPEndPoint ep; string name = key, kind = "Cast";
            if (endpoint != null) { ep = IPEndPoint.Parse(endpoint); name = string.IsNullOrWhiteSpace(displayName) ? key : displayName; }   // 0.7.0 item 5b: an added-by-IP device keeps the name typed for it
            else
            {
                var d = _browser()?.State.Devices(DateTimeOffset.UtcNow).FirstOrDefault(x => x.Id == key) ?? throw new InvalidOperationException("Cast device not found; search again");
                var ip = d.Addresses.Select(IPAddress.Parse).OrderBy(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 0 : 1).FirstOrDefault()
                         ?? throw new InvalidOperationException("Cast device has no address");
                ep = new IPEndPoint(ip, d.Port > 0 ? d.Port : 8009); name = d.Name;
                kind = d.IsGroup ? "Cast group" : d.IsTv ? "Cast (TV)" : "Cast speaker";
            }
            var client = await Dial(ep, ct);
            client.Log = m => _log?.Invoke($"cast {key}: {m}");
            CastSink? sink = null; Out? o = null;
            try
            {
                await client.LaunchAsync(CastProto.DefaultMediaReceiver, ct);
                sink = new CastSink(PlayerId(key), _reg.Clock) { DelayMs = delayMs, LatencyMs = LatencyMs, Log = m => _log?.Invoke($"cast {key}: {m}") };
                sink.Start();
                var token = NewToken();
                var url = StreamUrl(StreamHost(BindAddress(), ep.Address), HttpPort(), token);
                o = new Out { Key = key, Name = name, Address = ep.ToString(), Kind = kind, Token = token, Url = url, Sink = sink, Client = client, Volume = volume, DelayMs = delayMs };
                // register before LOAD: a receiver may GET the stream URL before it even answers LOAD (seen under QEMU as a 404 race)
                lock (_outs) _outs[key] = o;
                await LoadAsync(o, ct);
                try { await client.SetVolumeAsync(volume / 100.0, ct); } catch (Exception e) { o.Error = "volume: " + e.Message; }
                var live = o;
                client.MediaStatusChanged += ms => OnMedia(live, ms);
                client.Closed += why => OnClosed(live, why);
                if (subscribe) { _reg.Subscribe(sink); o.Subscribed = true; }
                _log?.Invoke($"cast {key}: connected {ep} {kind}, stream {url}");
                return o;
            }
            catch { if (o != null) lock (_outs) { if (_outs.TryGetValue(key, out var x) && x == o) _outs.Remove(key); } if (sink != null) await sink.DisposeAsync(); await client.DisposeAsync(); throw; }
        }
        finally { _gate.Release(); }
    }

    Task LoadAsync(Out o, CancellationToken ct = default) => o.Client.LoadAsync(o.Url, "audio/wav", "WavWiz", o.Name, null, null, ct);

    void OnMedia(Out o, CastJson.MediaStatus ms)
    {
        // the stream never ends on its own: IDLE with FINISHED / ERROR means the receiver dropped it (network hiccup, decoder gave up) -> load it again
        if (ms.PlayerState != "IDLE" || ms.IdleReason is not ("ERROR" or "FINISHED") || Get(o.Key) != o) return;
        if (++o.Reloads > 20) { o.State = "error"; o.Error = "the Cast device keeps stopping the stream"; return; }
        _log?.Invoke($"cast {o.Key}: receiver idle ({ms.IdleReason}), loading the stream again");
        _ = Task.Run(async () => { try { await Task.Delay(1500); if (Get(o.Key) == o && !o.Client.IsClosed && o.Client.TransportId != null) await LoadAsync(o); } catch (Exception e) { o.Error = e.Message; } });
    }

    void OnClosed(Out o, string why)
    {
        if (Get(o.Key) != o) return;
        o.State = "offline"; o.Error = why; _log?.Invoke($"cast {o.Key}: dropped ({why})");
        _ = Task.Run(async () => { await DisconnectAsync(o.Key, stopApp: false); Dropped?.Invoke(o.Key, why); });
    }

    public async Task<bool> DisconnectAsync(string key, bool stopApp = true)
    {
        Out? o;
        await _gate.WaitAsync();
        try { lock (_outs) if (!_outs.Remove(key, out o)) return false; } finally { _gate.Release(); }
        _reg.Unsubscribe(o.Sink.Id);
        if (stopApp && !o.Client.IsClosed) { try { using var t = new CancellationTokenSource(3000); await o.Client.StopAppAsync(t.Token); } catch { } }
        await o.Client.DisposeAsync(); await o.Sink.DisposeAsync();
        return true;
    }

    public bool IsConnected(string key) { lock (_outs) return _outs.ContainsKey(key); }
    public Out? Get(string key) { lock (_outs) return _outs.TryGetValue(key, out var o) ? o : null; }
    public CastSink? SinkFor(string token) { lock (_outs) return _outs.Values.FirstOrDefault(o => CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(o.Token), System.Text.Encoding.ASCII.GetBytes(token)))?.Sink; }

    public async Task<bool> SetVolumeAsync(string key, int volume)
    {
        var o = Get(key); if (o == null) return false;
        o.Volume = Math.Clamp(volume, 0, 100);
        try { await o.Client.SetVolumeAsync(o.Volume / 100.0); return true; } catch (Exception e) { o.Error = e.Message; return false; }
    }
    public void SetEnabled(string key, bool on)
    {
        var o = Get(key); if (o == null) return;
        if (on) _reg.Subscribe(o.Sink); else _reg.Unsubscribe(o.Sink.Id);
        o.Subscribed = on;
    }
    public bool SetDelay(string key, int delayMs)
    {
        var o = Get(key); if (o == null) return false;
        o.DelayMs = Math.Clamp(delayMs, -1000, 2000); o.Sink.DelayMs = o.DelayMs; return true;
    }

    /// <summary>Setup chime: leaves the group for the chime (+ the receiver's buffer), then rejoins - same rule as AirPlay.</summary>
    public async Task<bool> TestToneAsync(string key)
    {
        var o = Get(key); if (o == null) return false;
        bool was = o.Subscribed; if (was) _reg.Unsubscribe(o.Sink.Id);
        long lead = (o.Sink.LatencyMs + o.Sink.DelayMs + o.Sink.PrerollMs + 400) * 1000L;
        foreach (var m in AirPlay.AirPlaySetup.Chime(_reg.Clock.NowUs + lead, 0xCA570000u | (uint)Random.Shared.Next(0xFFFF))) o.Sink.Send(m);
        if (was) { await Task.Delay(1500 + o.Sink.LatencyMs + 1200); if (Get(key) == o && o.Subscribed) _reg.Subscribe(o.Sink); }
        return true;
    }

    public object Snapshot() { List<Out> all; lock (_outs) all = _outs.Values.ToList(); return all.Select(o => new
    {
        key = o.Key, id = o.Sink.Id, name = o.Name, address = o.Address, kind = o.Kind, volume = o.Volume, delayMs = o.DelayMs, state = o.State, error = o.Error,
        group = _reg.GroupOf(o.Sink.Id), inGroup = o.Subscribed, since = o.Since, player = o.Client.Media?.PlayerState, app = o.Client.Receiver?.DisplayName, reloads = o.Reloads,
        stats = new { framesIn = o.Sink.FramesIn, slots = o.Sink.SlotsOut, silent = o.Sink.SlotsSilent, late = o.Sink.Late, readers = o.Sink.Readers, latencyMs = o.Sink.LatencyMs },
    }).ToList(); }

    public async ValueTask DisposeAsync() { List<string> keys; lock (_outs) keys = _outs.Keys.ToList(); foreach (var k in keys) await DisconnectAsync(k); }
}
