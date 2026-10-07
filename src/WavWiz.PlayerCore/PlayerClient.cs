using System.Net.Sockets;
using System.Text.Json;
using WavWiz.Core;
using WavWiz.Core.Clock;
using WavWiz.Core.Playback;
using WavWiz.Core.Protocol;
using WavWiz.Dsp;
using WavWiz.Measure;

namespace WavWiz.PlayerCore;

public sealed class PlayerClientOptions
{
    public string Host { get; init; } = "127.0.0.1";
    public int AudioPort { get; init; } = WavWizInfo.DefaultAudioPort;
    public string PlayerId { get; init; } = Guid.NewGuid().ToString("N");
    public string Name { get; init; } = Environment.MachineName;
    public string LinkType { get; init; } = "unknown";
    public Func<string?> Token { get; init; } = () => null;
    public IMonotonicClock Clock { get; init; } = new StopwatchClock();
    public required IOutputProvider Outputs { get; init; }
    public string? CacheFile { get; init; }
    /// <summary>When set, asked for the server address before every connection attempt (so a changed address found by discovery is used at once).</summary>
    public Func<string>? HostProvider { get; init; }
    /// <summary>No audio/status/clock reply from the server for this long = the link is dead (a Wi-Fi roam or sleep leaves TCP "open" for minutes): drop it and reconnect.</summary>
    public int DeadAfterMs { get; init; } = 6000;
    public int ConnectTimeoutMs { get; init; } = 5000;
    public int MaxBackoffMs { get; init; } = 5000;
}

public sealed record PlayerState(bool Connected, string Status, string? ActiveOutputId, double LatencyMs, string LatencySource, bool NotCalibrated, bool RecheckDue,
    double Volume, bool Muted, bool ZoneEnabled, string ServerVersion, string? Error, string Health = "ok", int Reconnects = 0, int UnderrunEvents = 0, bool NotPaired = false);

/// <summary>
/// The player's network + audio brain (platform independent). Connects to the server, keeps the clock model, feeds the PlaybackEngine, applies zone
/// and DSP updates, switches outputs, and reconnects with backoff. Rejoin after a long outage always goes to the CURRENT timeline position (spec 7.6).
/// </summary>
public sealed class PlayerClient : IAsyncDisposable
{
    private readonly PlayerClientOptions _o;
    private readonly ClockModel _clock = new();
    private readonly PlaybackEngine _engine;
    private readonly DspChain _dsp = new(48000);
    private IAudioSink? _sink;
    private string? _activeOutput;
    private readonly object _gate = new();
    private volatile PlayerState _state;
    private readonly Dictionary<string, ZoneUpdate> _zoneCache = new();
    private volatile TcpClient? _tcp;
    private volatile SemaphoreSlim _wake = new(0);
    private string? _wantedOutput;
    private CancellationTokenSource? _calRestore;

    public event Action<string>? Log;
    /// <summary>Raised after repeated failed connection attempts (argument = consecutive failures): the owner may look for the server again (its address may have changed).</summary>
    public event Action<int>? ServerUnreachable;
    private long _lastRxMs, _lastTcpMs; private bool _tcpKeepalive; private int _reconnects; private int _lastEventsLogged;
    public event Action<PlayerState>? StateChanged;
    public ClockModel Clock => _clock;
    public PlaybackEngine Engine => _engine;
    public DspChain Dsp => _dsp;
    public PlayerState State => _state;
    public string PlayerId => _o.PlayerId;

    public PlayerClient(PlayerClientOptions o)
    {
        _o = o; _engine = new PlaybackEngine(_clock); _engine.SetProcessor(_dsp);
        _state = new PlayerState(false, "Starting", null, 0, "none", false, false, 100, false, true, "", null);
        LoadCache();
    }

    private void Say(string m) { Log?.Invoke(m); }
    private static long NowMs => Environment.TickCount64;
    private void Publish(Func<PlayerState, PlayerState> f) { lock (_gate) { _state = f(_state); } StateChanged?.Invoke(_state); }

    // ---------- outputs ----------
    public IReadOnlyList<OutputInfo> ListOutputs() => _o.Outputs.List().Select(x => x with { Active = x.EndpointId == _activeOutput }).ToList();

    /// <summary>Switch this PC's active output (manual by default, D8). Loads that device's cached offset/DSP BEFORE the first sample.</summary>
    public void SwitchOutput(string endpointId)
    {
        lock (_gate)
        {
            _sink?.Dispose(); _sink = null;
            IAudioSink sink;
            try { sink = _o.Outputs.Open(endpointId, Render); }
            catch (Exception e)
            {
                _activeOutput = null; Say($"output unavailable: {endpointId}: {e.Message}");
                Publish(s => s with { ActiveOutputId = null, Error = "output unavailable - pick another output" });
                return;
            }
            _activeOutput = endpointId;
            sink.Faulted += why => OnSinkFaulted(sink, endpointId, why);
            _engine.SetOutputRate(sink.MixRate);
            if (_zoneCache.TryGetValue(endpointId, out var z)) ApplyZone(z, fromCache: true);   // saved delay is applied before the first sample
            _sink = sink; sink.Start();
            Publish(s => s with { ActiveOutputId = endpointId, Error = null });
        }
        _ = SendOutputsAsync("switch");
        Say("active output: " + endpointId);
    }

    private void OnSinkFaulted(IAudioSink sink, string endpointId, string why)
    {
        lock (_gate)
        {
            if (!ReferenceEquals(_sink, sink)) return;
            _sink = null; _activeOutput = null; _engine.Flush();
            Task.Run(() => { try { sink.Dispose(); } catch { } });
        }
        Say($"output {endpointId} failed: {why}");
        Publish(s => s with { ActiveOutputId = null, Error = "The speaker stopped working or was turned off - pick another output from the menu." });
        _ = SendOutputsAsync("lost");
    }

    /// <summary>One-line description of what delay this PC would apply to an output (shown in the output switcher). Honest: never a bare 0.</summary>
    public string DescribeOutput(string endpointId)
    {
        if (!_zoneCache.TryGetValue(endpointId, out var z)) return "not calibrated";
        if (z.NotCalibrated) return $"~{z.LatencyMs:0} ms - not calibrated";
        return z.LatencySource switch { "manual" => $"+{z.LatencyMs:0} ms - manual", "estimated" => $"+{z.LatencyMs:0} ms - estimated", _ => $"+{z.LatencyMs:0} ms - measured" };
    }

    private int Render(Span<float> dst, int frames, long dacLocalUs) => _engine.Render(dst, frames, dacLocalUs);

    // ---------- run loop ----------
    public async Task RunAsync(CancellationToken ct)
    {
        int backoff = 500, failures = 0;
        if (_activeOutput == null)
        {
            var first = _o.Outputs.DefaultEndpointId ?? _o.Outputs.List().FirstOrDefault(x => x.Connected)?.EndpointId;
            if (first != null) SwitchOutput(first);
        }
        while (!ct.IsCancellationRequested)
        {
            bool wasConnected = false;
            try
            {
                await ConnectOnceAsync(ct, () => wasConnected = true);
                backoff = 500;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                Say($"connection lost: {e.Message}");
                if (e.Message.Contains("unauthorized", StringComparison.OrdinalIgnoreCase))
                {
                    // The server forgot this player (or revoked its token). Retrying cannot help; show "not paired" and wait for the person to pair again.
                    Say("the server no longer knows this player - not paired");
                    Publish(s => s with { Connected = false, Status = "Not paired", Error = e.Message, Health = "notpaired", NotPaired = true });
                    _engine.Flush(); break;
                }
                Publish(s => s with { Connected = false, Status = "Reconnecting...", Error = e.Message, Health = "reconnecting" });
            }
            failures = wasConnected ? 1 : failures + 1;
            if (wasConnected) backoff = 500;
            _engine.Flush();               // rejoin goes to the current timeline position, never resumes where it stopped
            if (failures >= 3 && failures % 3 == 0) { try { ServerUnreachable?.Invoke(failures); } catch { } }
            try { await Task.Delay(backoff, ct); } catch (OperationCanceledException) { break; }
            backoff = Math.Min(backoff * 2, _o.MaxBackoffMs);
        }
    }

    private async Task ConnectOnceAsync(CancellationToken ct, Action markConnected)
    {
        using var tcp = new TcpClient { NoDelay = true };
        var host = _o.HostProvider?.Invoke() ?? _o.Host;
        using (var cto = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            cto.CancelAfter(_o.ConnectTimeoutMs);
            try { await tcp.ConnectAsync(host, _o.AudioPort, cto.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new TimeoutException($"no answer from {host}:{_o.AudioPort} within {_o.ConnectTimeoutMs / 1000} s (server off, wrong address, or the network is down)"); }
        }
        try { tcp.Client.SetSocketOption(System.Net.Sockets.SocketOptionLevel.Socket, System.Net.Sockets.SocketOptionName.KeepAlive, true); } catch { }
        _tcp = tcp;
        var net = tcp.GetStream();
        await FrameIO.WriteAsync(net, Wire.EncodeJson(MsgType.Hello, 0, new Hello(_o.PlayerId, _o.Token(), WavWizInfo.Version, new[] { "pcm24" }, 48000, _o.LinkType, _o.Name, Environment.MachineName)), ct);
        using var hsCts = CancellationTokenSource.CreateLinkedTokenSource(ct); hsCts.CancelAfter(_o.ConnectTimeoutMs);
        var (h, p) = await FrameIO.ReadAsync(net, hsCts.Token);
        if (h.Type == MsgType.Bye) throw new InvalidOperationException("server refused: " + Wire.DecodeJson<Bye>(p)?.Reason);
        if (h.Type != MsgType.Welcome) throw new InvalidDataException("expected WELCOME");
        var w = Wire.DecodeJson<Welcome>(p)!;
        var key = Convert.FromBase64String(w.ClockKey);
        _clock.Reset(keepSkew: true);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var udp = new UdpClient();
        udp.Connect(host, w.ClockPort);
        _lastRxMs = _lastTcpMs = NowMs; _tcpKeepalive = Version.TryParse(new string((w.ServerVersion ?? "").TakeWhile(c => char.IsDigit(c) || c == '.').ToArray()), out var sv) && sv >= new Version(0, 0, 2);   // 0.0.2+ servers send a keepalive every 2 s
        var tasks = new List<Task> { PingLoopAsync(udp, w.ClockSessionId, key, cts.Token), PongLoopAsync(udp, key, cts.Token), StatusLoopAsync(net, cts.Token), WatchdogAsync(cts.Token) };
        if (_everConnected) _reconnects++; _everConnected = true;
        markConnected();
        Publish(s => s with { Connected = true, Status = "Connected", ServerVersion = w.ServerVersion + " " + w.Channel, Error = null, Health = "ok", Reconnects = _reconnects });
        Say($"connected to server {w.ServerVersion} {w.Channel} at {host}" + (_reconnects > 0 ? $" (reconnect #{_reconnects})" : ""));
        await SendOutputsAsync("connect");
        var reader = ReadLoopAsync(net, cts.Token);
        tasks.Add(reader);
        var done = await Task.WhenAny(tasks);
        cts.Cancel();
        try { await done; } catch (OperationCanceledException) { }
        _tcp = null;
        if (done.IsFaulted) throw done.Exception!.GetBaseException();
        throw new IOException("server closed the connection");
    }
    private bool _everConnected;

    private async Task WatchdogAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(500, ct);
            var quiet = NowMs - Interlocked.Read(ref _lastRxMs);
            if (quiet > _o.DeadAfterMs) throw new IOException($"the server has been silent for {quiet / 1000.0:0.#} s (Wi-Fi dropped or the network stalled); reconnecting");
            var tcpQuiet = NowMs - Interlocked.Read(ref _lastTcpMs);        // the clock replies (UDP) can keep arriving while the audio connection (TCP) is dead
            if (_tcpKeepalive && tcpQuiet > _o.DeadAfterMs) throw new IOException($"the audio connection has been silent for {tcpQuiet / 1000.0:0.#} s (the network stalled); reconnecting");
        }
    }

    private async Task ReadLoopAsync(NetworkStream net, CancellationToken ct)
    {
        while (true)
        {
            var (h, p) = await FrameIO.ReadAsync(net, ct);
            Interlocked.Exchange(ref _lastRxMs, NowMs); Interlocked.Exchange(ref _lastTcpMs, NowMs);
            switch (h.Type)
            {
                case MsgType.Epoch: if (Wire.TryDecodeEpoch(p, out var e, out var st)) _engine.OnEpoch(e, st); break;
                case MsgType.Audio: if (Wire.TryDecodeAudio(p, out var f, out _)) _engine.OnAudio(f!); break;
                case MsgType.StopAt: if (Wire.TryDecodeStopAt(p, out var se, out var at)) _engine.OnStopAt(se, at); break;
                case MsgType.ZoneUpdate: ApplyZone(Wire.DecodeJson<ZoneUpdate>(p)!, fromCache: false); break;
                case MsgType.DspConfig: ApplyDsp(Wire.DecodeJson<DspConfig>(p)!); break;
                case MsgType.CalCmd: HandleCal(Wire.DecodeJson<CalCmd>(p)!); break;
                case MsgType.Bye: throw new IOException("server said bye: " + Wire.DecodeJson<Bye>(p)?.Reason);
            }
        }
    }

    // ---------- server -> player updates ----------
    private void ApplyZone(ZoneUpdate z, bool fromCache)
    {
        _dsp.SetMuted(z.Muted); _dsp.SetVolume(z.Volume);
        _engine.SetDeviceLatencyMs(z.LatencyMs);
        if (!z.Enabled) _engine.Flush();
        Publish(s => s with { Volume = z.Volume, Muted = z.Muted, ZoneEnabled = z.Enabled, LatencyMs = z.LatencyMs, LatencySource = z.LatencySource, NotCalibrated = z.NotCalibrated, RecheckDue = z.RecheckDue });
        if (!fromCache)
        {
            if (z.ActiveOutputId != null) { _zoneCache[z.ActiveOutputId] = z; SaveCache(); }
            if (z.ActiveOutputId != null && z.ActiveOutputId != _activeOutput && _o.Outputs.List().Any(x => x.EndpointId == z.ActiveOutputId && x.Connected))
            { _wantedOutput = z.ActiveOutputId; Task.Run(() => SwitchOutput(z.ActiveOutputId)); }
        }
    }

    private void ApplyDsp(DspConfig c)
    {
        if (c.Preset is JsonElement je && je.ValueKind == JsonValueKind.Object)
        {
            var preset = JsonSerializer.Deserialize<DspPreset>(je.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? DspPreset.Flat;
            _dsp.SetPreset(preset with { Bypass = c.Bypass });
        }
        else _dsp.SetPreset(DspPreset.Flat with { Bypass = c.Bypass });
        Say($"DSP preset applied for {c.OutputDeviceId} (rev {c.Revision}{(c.Bypass ? ", bypass" : "")})");
    }

    private void HandleCal(CalCmd c)
    {
        if (c.Action == "test-tone")
        {
            _engine.PlayTestSignal(WavWiz.Core.Playback.TestTone.Generate(c.LevelDb), c.AtUs);
            Say("test sound scheduled for this device");
            var tcts = new CancellationTokenSource(); _calRestore?.Cancel(); _calRestore = tcts;
            _ = Task.Delay(TimeSpan.FromSeconds(8), tcts.Token).ContinueWith(t => { if (!t.IsCanceled) _engine.ClearTestSignal(); });
            return;
        }
        if (c.Action != "play-pattern") return;
        _calRestore?.Cancel();
        var pat = new ChirpPattern(c.LevelDb);
        var wasBypass = _dsp.Preset.Bypass;
        _dsp.SetBypass(true);                         // EQ off for the click test; trim + limiter stay (spec 8.5)
        _engine.PlayTestSignal(pat.Signal, c.AtUs);
        var cts = _calRestore = new CancellationTokenSource();
        _ = Task.Delay(TimeSpan.FromSeconds(20), cts.Token).ContinueWith(t => { if (!t.IsCanceled) { _engine.ClearTestSignal(); _dsp.SetBypass(wasBypass); } });
        Say($"calibration pattern scheduled ({c.Label})");
    }

    // ---------- player -> server ----------
    public Task SendOutputsAsync(string reason)
    {
        var tcp = _tcp; if (tcp == null || !tcp.Connected) return Task.CompletedTask;
        var msg = Wire.EncodeJson(MsgType.Outputs, 0, new OutputsMsg(ListOutputs().ToArray(), reason));
        return SafeSend(tcp, msg);
    }

    private static async Task SafeSend(TcpClient tcp, byte[] msg)
    {
        try { var s = tcp.GetStream(); await FrameIO.WriteAsync(s, msg, CancellationToken.None); } catch { /* the read loop notices a dead connection */ }
    }

    private async Task StatusLoopAsync(NetworkStream net, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(1000, ct);
            var st = _state;
            var s = new PlayerStatus(_engine.BufferMs, 0, _clock.IsValid ? _clock.SkewPpm : 0, _clock.LastRttUs, _engine.ErrorMs, _engine.RatioPpm, _engine.Underruns, _engine.HardResyncs,
                _activeOutput, _engine.DeviceLatencyMs, _o.LinkType, 0, _dsp.LimiterReductionDb, _dsp.ClipCount, _engine.IsPlaying, _engine.UnderrunEvents, _reconnects);
            if (_engine.UnderrunEvents > _lastEventsLogged)
            {
                Say($"UNDERRUN: audio ran out {_engine.UnderrunEvents - _lastEventsLogged}x (total {_engine.UnderrunEvents}); buffer {_engine.BufferMs:0} ms, link {_o.LinkType}, hard resyncs {_engine.HardResyncs}, clock rtt {_clock.LastRttUs / 1000.0:0.0} ms");
                _lastEventsLogged = _engine.UnderrunEvents;
                Publish(x => x with { UnderrunEvents = _engine.UnderrunEvents, Health = "buffering" });
            }
            else if (_state.Health == "buffering" && _engine.BufferMs > 1000) Publish(x => x with { Health = "ok" });
            await FrameIO.WriteAsync(net, Wire.EncodeJson(MsgType.PlayerStatus, 0, s), ct);
        }
    }

    private async Task PingLoopAsync(UdpClient udp, uint session, byte[] key, CancellationToken ct)
    {
        uint seq = 0;
        while (!ct.IsCancellationRequested)
        {
            var t0 = _o.Clock.NowUs;
            _pending[seq & 63] = t0;
            await udp.SendAsync(ClockPacket.EncodePing(session, seq, t0, key), ct);
            seq++;
            await Task.Delay(seq < 40 ? 250 : 1000, ct);
        }
    }

    private readonly long[] _pending = new long[64];

    private async Task PongLoopAsync(UdpClient udp, byte[] key, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var r = await udp.ReceiveAsync(ct);
            long t3 = _o.Clock.NowUs;
            if (ClockPacket.TryDecodePong(r.Buffer, key, out _, out var t0, out var t1, out var t2)) { _clock.AddPong(t0, t1, t2, t3); Interlocked.Exchange(ref _lastRxMs, NowMs); }
        }
    }

    // ---------- cache (spec 8.5: a re-paired speaker gets its value even if the server is briefly unreachable) ----------
    private void LoadCache()
    {
        try
        {
            if (_o.CacheFile is { } f && File.Exists(f))
                foreach (var kv in JsonSerializer.Deserialize<Dictionary<string, ZoneUpdate>>(File.ReadAllText(f)) ?? new()) _zoneCache[kv.Key] = kv.Value;
        }
        catch (Exception e) { Say("cache ignored: " + e.Message); }
    }

    private void SaveCache()
    {
        try
        {
            if (_o.CacheFile is not { } f) return;
            Directory.CreateDirectory(Path.GetDirectoryName(f)!);
            File.WriteAllText(f, JsonSerializer.Serialize(_zoneCache), new System.Text.UTF8Encoding(false));
        }
        catch (Exception e) { Say("cache not saved: " + e.Message); }
    }

    public async ValueTask DisposeAsync()
    {
        _calRestore?.Cancel();
        lock (_gate) { _sink?.Dispose(); _sink = null; }
        await Task.CompletedTask;
    }
}
