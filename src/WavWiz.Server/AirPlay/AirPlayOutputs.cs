using System.Net;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Stream;
using WavWiz.Server.Playback;

namespace WavWiz.Server.AirPlay;

/// <summary>
/// 0.5.0 stage 6: AirPlay speakers as WavWiz devices. Each connected speaker is an <see cref="AirPlaySink"/> subscribed to
/// a playback group like any WavWiz player (id "airplay:&lt;deviceid&gt;"), so it follows play / pause / seek / skip, the
/// house timeline and group moves. Per-speaker delay and volume are kept here. AirPlay 1 (RAOP et=0/1) only until the
/// AirPlay 2 stages land; AirPlay 2-only speakers report "needs AirPlay 2".
/// </summary>
public sealed class AirPlayOutputs : IAsyncDisposable
{
    public sealed class Out
    {
        public required string Key; public required string Name; public required string Address;
        public required IStreamSubscriber Sink; public required IAsyncDisposable SinkDisp; public required string Kind;
        public required Func<int, Task> Volumer; public required Func<Task> Teardown; public required Action<int> Delayer; public required Func<object> Stats;
        public int Volume = 50; public int DelayMs; public string State = "connected"; public string? Error;
        public DateTimeOffset Since = DateTimeOffset.UtcNow;
    }
    readonly ConductorRegistry _reg; readonly Func<AirPlayBrowser?> _browser; readonly Action<string>? _log;
    readonly Dictionary<string, Out> _outs = new(); readonly SemaphoreSlim _gate = new(1, 1);

    readonly Dictionary<IPAddress, PtpMaster> _ptp = new();
    public AirPlayOutputs(ConductorRegistry reg, Func<AirPlayBrowser?> browser, Action<string>? log = null) { _reg = reg; _browser = browser; _log = log; }
    /// <summary>Stage 10: AirPlay 2 speakers only when the experimental setting is on. Buffered (AAC via ffmpeg) unless off or no ffmpeg.</summary>
    public bool AirPlay2Enabled { get; set; }
    public bool PreferBuffered { get; set; } = true;
    public string? FfmpegPath { get; set; }

    PtpMaster PtpFor(IPAddress speaker)
    {
        using var probe = new System.Net.Sockets.UdpClient(speaker.AddressFamily); probe.Connect(speaker, 9);
        var local = ((IPEndPoint)probe.Client.LocalEndPoint!).Address;
        if (!_ptp.TryGetValue(local, out var m)) { m = new PtpMaster(local); m.Start(); _ptp[local] = m; _log?.Invoke($"airplay: PTP master on {local} clock {m.ClockId:X16}"); }
        return m;
    }

    public static string PlayerId(string key) => "airplay:" + key;

    /// <summary>Connects to a discovered speaker (by device id) or an explicit host:port, and subscribes it to its group.</summary>
    public async Task<Out> ConnectAsync(string key, string? endpoint, int delayMs, int volume, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_outs.TryGetValue(key, out var existing)) return existing;
            IPEndPoint ep; string name = key; int et = 0; bool ap2 = false; string? model = null;
            if (endpoint != null) { if (endpoint.StartsWith("ap2:")) { ap2 = true; endpoint = endpoint[4..]; } ep = IPEndPoint.Parse(endpoint); }
            else
            {
                var d = _browser()?.State.Devices(DateTimeOffset.UtcNow).FirstOrDefault(x => x.Id == key) ?? throw new InvalidOperationException("speaker not found; search again");
                var route = d.Route; model = d.Model; int port;
                if (route == "airplay2-ptp" && AirPlay2Enabled) { ap2 = true; port = d.AirPlayPort; }
                else if (d.Raop && route is "raop" or "raop-rsa" || (d.Raop && route.StartsWith("airplay2") && d.Encryption.Contains(0)))
                { et = d.Encryption.Count > 0 && !d.Encryption.Contains(0) ? 1 : 0; port = d.RaopPort; }
                else if (route.StartsWith("airplay2")) throw new InvalidOperationException(route == "airplay2-ntp" ? "AirPlay 2 with NTP timing is not supported" : "AirPlay 2 speakers are experimental: switch them on in AirPlay settings");
                else throw new InvalidOperationException($"route {route} not supported");
                var ip = d.Addresses.Select(IPAddress.Parse).OrderBy(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 0 : 1).FirstOrDefault()
                         ?? throw new InvalidOperationException("speaker has no address");
                ep = new IPEndPoint(ip, port); name = d.Name;
            }
            Out o;
            if (ap2) o = await ConnectAp2Async(key, name, ep, model, delayMs, volume, ct);
            else
            {
                var s = new RaopSession(new RaopOptions { Encryption = et });
                ushort seq = (ushort)Random.Shared.Next(); uint rtp = (uint)Random.Shared.Next();
                try { await s.ConnectAsync(ep, ct); await s.StartAsync(seq, rtp, ct); await s.SetVolumeAsync(RaopControls.ToAirPlayDb(volume, percent: true), ct); }
                catch { await s.DisposeAsync(); throw; }
                var sink = new AirPlaySink(PlayerId(key), s, _reg.Clock, seq, rtp) { DelayMs = delayMs, Log = m => _log?.Invoke($"airplay {key}: {m}") };
                sink.Start();
                o = new Out
                {
                    Key = key, Name = name, Address = ep.ToString(), Kind = et == 1 ? "AirPlay 1 (RSA)" : "AirPlay 1", Sink = sink, SinkDisp = sink, Volume = volume, DelayMs = delayMs,
                    Volumer = v => s.SetVolumeAsync(RaopControls.ToAirPlayDb(v, percent: true)), Delayer = v => sink.DelayMs = v,
                    Teardown = async () => { try { await s.TeardownAsync(); } catch { } await s.DisposeAsync(); },
                    Stats = () => new { packets = sink.Packets, syncs = sink.Syncs, flushes = sink.Flushes, resends = sink.Resends, framesIn = sink.FramesIn, timingRequests = s.TimingRequests },
                };
            }
            _outs[key] = o;
            _reg.Subscribe(o.Sink);
            _log?.Invoke($"airplay {key}: connected {ep} {o.Kind}");
            return o;
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> DisconnectAsync(string key)
    {
        Out? o;
        await _gate.WaitAsync();
        try { if (!_outs.Remove(key, out o)) return false; } finally { _gate.Release(); }
        _reg.Unsubscribe(o.Sink.Id);
        await o.SinkDisp.DisposeAsync();
        await o.Teardown();
        return true;
    }

    public async Task<bool> SetVolumeAsync(string key, int volume)
    {
        if (!_outs.TryGetValue(key, out var o)) return false;
        o.Volume = Math.Clamp(volume, 0, 100);
        try { await o.Volumer(o.Volume); return true; }
        catch (Exception e) { o.Error = e.Message; return false; }
    }

    public bool SetDelay(string key, int delayMs)
    {
        if (!_outs.TryGetValue(key, out var o)) return false;
        o.DelayMs = Math.Clamp(delayMs, -500, 2000); o.Delayer(o.DelayMs); return true;
    }

    public object Snapshot() => _outs.Values.Select(o => new
    {
        key = o.Key, id = o.Sink.Id, name = o.Name, address = o.Address, kind = o.Kind, volume = o.Volume, delayMs = o.DelayMs, state = o.State, error = o.Error,
        group = _reg.GroupOf(o.Sink.Id), stats = o.Stats(), since = o.Since,
    }).ToList();

    async Task<Out> ConnectAp2Async(string key, string name, IPEndPoint ep, string? model, int delayMs, int volume, CancellationToken ct)
    {
        var q = AirPlayQuirks.For(model);
        bool buffered = PreferBuffered && q.Buffered && !string.IsNullOrEmpty(FfmpegPath) && (File.Exists(FfmpegPath) || FfmpegPath == "ffmpeg");
        var ptp = PtpFor(ep.Address);
        var s = new Ap2Session(new Ap2Options { Endpoint = ep, Name = "WavWiz", Buffered = buffered, VolumeDb = RaopControls.ToAirPlayDb(volume, percent: true) }, ptp);
        Ap2Sink? sink = null;
        try
        {
            await s.ConnectAsync(ct);
            sink = new Ap2Sink(PlayerId(key), s, ptp, _reg.Clock, buffered, FfmpegPath) { DelayMs = delayMs + q.DefaultDelayMs, Log = m => _log?.Invoke($"airplay {key}: {m}") };
            await sink.StartAsync();
        }
        catch { if (sink != null) await sink.DisposeAsync(); await s.DisposeAsync(); ptp.RemovePeer(ep.Address); throw; }
        var sk = sink;
        return new Out
        {
            Key = key, Name = name, Address = ep.ToString(), Kind = buffered ? "AirPlay 2 (buffered AAC)" : "AirPlay 2 (realtime ALAC)", Sink = sk, SinkDisp = sk, Volume = volume, DelayMs = delayMs,
            Volumer = v => s.SetVolumeAsync(RaopControls.ToAirPlayDb(v, percent: true)), Delayer = v => sk.DelayMs = v + q.DefaultDelayMs,
            Teardown = async () => { try { await s.TeardownAsync(); } catch { } await s.DisposeAsync(); ptp.RemovePeer(ep.Address); },
            Stats = () => new { packets = sk.Packets, announces = sk.Announces, flushes = sk.Flushes, segments = sk.Segments, framesIn = sk.FramesIn, feedbacks = s.Feedbacks, quirk = q.Label },
        };
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var k in _outs.Keys.ToList()) await DisconnectAsync(k);
        foreach (var m in _ptp.Values) m.Dispose(); _ptp.Clear();
    }
}
