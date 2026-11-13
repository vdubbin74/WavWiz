using System.Net;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Stream;
using WavWiz.Server.Playback;
using WavWiz.Server.Media;

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
        /// <summary>0.7.0 t1930: non-fatal notice (for example PTP Delay_Req never arrived). Shown on the card; does not drop the session.</summary>
        public string? Warning;
        // 0.6.8-#14e: outgoing metadata (title/artist/album, artwork, progress). Each kind switches itself off for this session after the
        // speaker rejects it once, so a picky speaker never gets a second try and the audio path is never touched.
        public Func<byte[], string, Dictionary<string, string>?, Task<RtspResponse>>? SetParam; public Func<uint>? RtpNow;
        public bool MetaText = true, MetaArt = true, MetaProgress = true; public AirPlaySetup.MetaState? Meta; public int MetaBusy;
        public long MetaSent, MetaRejected; public bool Subscribed;
    }
    readonly ConductorRegistry _reg; readonly Func<AirPlayBrowser?> _browser; readonly Action<string>? _log;
    readonly Dictionary<string, Out> _outs = new(); readonly SemaphoreSlim _gate = new(1, 1);

    readonly Dictionary<IPAddress, PtpMaster> _ptp = new();
    public AirPlayOutputs(ConductorRegistry reg, Func<AirPlayBrowser?> browser, Action<string>? log = null) { _reg = reg; _browser = browser; _log = log; }
    /// <summary>0.6.8-#14e: cover art for the speaker's screen (JPEG/PNG bytes) or null; set by the server.</summary>
    public Func<QueueItem, CancellationToken, Task<byte[]?>>? ArtFor { get; set; }
    /// <summary>0.6.8-#14f: this PC's addresses, for refusing WavWiz's own receiver.</summary>
    public Func<IReadOnlyCollection<string>> Local { get; set; } = AirPlaySetup.LocalAddresses;
    /// <summary>What the speaker's group is playing (tests replace it).</summary>
    public Func<string, NowPlaying>? NowFor { get; set; }
    Timer? _metaTimer;
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
    public async Task<Out> ConnectAsync(string key, string? endpoint, int delayMs, int volume, CancellationToken ct = default, bool subscribe = true)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_outs.TryGetValue(key, out var existing)) return existing;
            IPEndPoint ep; string name = key; int et = 0; bool ap2 = false; string? model = null; (bool T, bool A, bool P) caps = (true, true, true);
            if (endpoint != null) { if (endpoint.StartsWith("ap2:")) { ap2 = true; endpoint = endpoint[4..]; } ep = IPEndPoint.Parse(endpoint); }
            else
            {
                var d = _browser()?.State.Devices(DateTimeOffset.UtcNow).FirstOrDefault(x => x.Id == key) ?? throw new InvalidOperationException("speaker not found; search again");
                if (AirPlaySetup.IsSelf(d.Name, d.Addresses, d.Host, Local())) throw new InvalidOperationException("this is WavWiz's own AirPlay receiver (audio loop)");   // 0.6.8-#14f
                caps = MetaCaps(d);
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
                    SetParam = (b, t, h) => s.SetParameterAsync(b, t, h), RtpNow = () => sink.RtpAt(_reg.Clock.NowUs),
                };
            }
            (o.MetaText, o.MetaArt, o.MetaProgress) = caps;
            _outs[key] = o;
            if (subscribe) { _reg.Subscribe(o.Sink); o.Subscribed = true; }   // 0.6.8-#14b: the setup's test connects without joining a group
            _metaTimer ??= new Timer(_ => MetaTick(), null, 1000, 1000);
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

    /// <summary>F170: true while the speaker has a live sink.</summary>
    public bool IsConnected(string key) { lock (_outs) return _outs.ContainsKey(key); }
    public Out? Get(string key) { lock (_outs) return _outs.TryGetValue(key, out var o) ? o : null; }
    /// <summary>F170: speaker card on/off -> the sink joins / leaves its playback group (the AirPlay session stays up).</summary>
    public void SetEnabled(string key, bool on)
    {
        var o = Get(key); if (o == null) return;
        if (on) _reg.Subscribe(o.Sink); else _reg.Unsubscribe(o.Sink.Id);
        o.Subscribed = on;
    }

    /// <summary>0.6.8-#14b: plays the setup chime on one connected speaker. A speaker that is in a group leaves it for ~4 s (its music
    /// pauses there) and rejoins; one that is not in a group just plays the chime.</summary>
    public async Task<bool> TestToneAsync(string key)
    {
        var o = Get(key); if (o == null) return false;
        bool was = o.Subscribed; if (was) _reg.Unsubscribe(o.Sink.Id);
        foreach (var m in AirPlaySetup.Chime(_reg.Clock.NowUs + 2_000_000, 0xC0DE0000u | (uint)Random.Shared.Next(0xFFFF))) o.Sink.Send(m);
        if (was) { await Task.Delay(4000); if (Get(key) == o && o.Subscribed) _reg.Subscribe(o.Sink); }
        return true;
    }

    /// <summary>0.6.8-#14e: what the speaker said it shows. AirPlay 1 "md" TXT lists 0 = text, 1 = artwork, 2 = progress; else the feature bits
    /// (15 artwork, 16 progress, 17 text); nothing advertised -> try all three once (a rejection switches that kind off).</summary>
    static (bool, bool, bool) MetaCaps(WavWiz.Core.AirPlay.AirPlayDevice d)
    {
        if (d.RaopTxt.TryGetValue("md", out var md) && md.Length > 0) { var p = md.Split(',').Select(x => x.Trim()).ToHashSet(); return (p.Contains("0"), p.Contains("1"), p.Contains("2")); }
        bool t = AirPlayFeatures.Has(d.Features, AirPlayFeatures.MetaText), a = AirPlayFeatures.Has(d.Features, AirPlayFeatures.MetaArtwork), g = AirPlayFeatures.Has(d.Features, AirPlayFeatures.MetaProgress);
        return t || a || g ? (t, a, g) : (true, true, true);
    }

    void MetaTick()
    {
        List<Out> all; lock (_outs) all = _outs.Values.ToList();
        foreach (var o in all)
        {
            if (o.SetParam == null || o.RtpNow == null || !o.Subscribed || !(o.MetaText || o.MetaArt || o.MetaProgress)) continue;
            if (Interlocked.CompareExchange(ref o.MetaBusy, 1, 0) != 0) continue;   // one request at a time per speaker
            _ = Task.Run(async () => { try { await MetaOnce(o); } catch (Exception e) { _log?.Invoke($"airplay {o.Key}: metadata skipped ({e.Message})"); } finally { o.MetaBusy = 0; } });
        }
    }

    async Task MetaOnce(Out o)
    {
        var n = NowFor?.Invoke(o.Sink.Id) ?? _reg.ForPlayer(o.Sink.Id).Now();
        var cur = new AirPlaySetup.MetaState(AirPlaySetup.ItemKey(n), n.State, n.PositionMs, n.DurationMs, Environment.TickCount64);
        var plan = AirPlaySetup.Plan(o.Meta, cur); o.Meta = cur;
        if (plan == AirPlaySetup.MetaSend.None) return;
        var at = RaopControls.At(o.RtpNow!());
        async Task<bool> Send(byte[] body, string type, Dictionary<string, string>? h)
        {
            var r = await o.SetParam!(body, type, h); o.MetaSent++;
            if (!r.Ok) { o.MetaRejected++; _log?.Invoke($"airplay {o.Key}: speaker rejected {type} ({r.Status}); not sent again this session"); }
            return r.Ok;
        }
        if (plan.HasFlag(AirPlaySetup.MetaSend.Text) && o.MetaText)
        {
            var (t, a, al) = AirPlaySetup.Text(n);
            if (!await Send(RaopControls.Dmap(t, a, al), "application/x-dmap-tagged", at)) o.MetaText = false;
        }
        if (plan.HasFlag(AirPlaySetup.MetaSend.Art) && o.MetaArt)
        {
            byte[]? img = null;
            if (n.Item != null && ArtFor != null) { using var cts = new CancellationTokenSource(4000); try { img = await ArtFor(n.Item, cts.Token); } catch { img = null; } }
            if (img != null && img.Length > 512 * 1024) img = null;   // keep the control channel quick
            // no picture: clear the old one ("image/none", empty body) so the previous song's cover does not linger
            if (!await Send(img ?? Array.Empty<byte>(), img != null ? RaopControls.ImageType(img) : "image/none", at)) o.MetaArt = false;
        }
        if (plan.HasFlag(AirPlaySetup.MetaSend.Progress) && o.MetaProgress && n.DurationMs > 0)
        {
            var (st, c, e) = AirPlaySetup.Progress(o.RtpNow!(), n.PositionMs, n.DurationMs);
            if (!await Send(RaopControls.Progress(st, c, e), "text/parameters", null)) o.MetaProgress = false;
        }
    }

    public bool SetDelay(string key, int delayMs)
    {
        if (!_outs.TryGetValue(key, out var o)) return false;
        o.DelayMs = Math.Clamp(delayMs, -500, 2000); o.Delayer(o.DelayMs); return true;
    }

    public object Snapshot() => _outs.Values.Select(o => new
    {
        key = o.Key, id = o.Sink.Id, name = o.Name, address = o.Address, kind = o.Kind, volume = o.Volume, delayMs = o.DelayMs, state = o.State, error = o.Error, warning = o.Warning,
        group = _reg.GroupOf(o.Sink.Id), stats = o.Stats(), since = o.Since,
        meta = new { text = o.MetaText, art = o.MetaArt, progress = o.MetaProgress, sent = o.MetaSent, rejected = o.MetaRejected }, inGroup = o.Subscribed,
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
        var o = new Out
        {
            Key = key, Name = name, Address = ep.ToString(), Kind = buffered ? "AirPlay 2 (buffered AAC)" : "AirPlay 2 (realtime ALAC)", Sink = sk, SinkDisp = sk, Volume = volume, DelayMs = delayMs,
            Volumer = v => s.SetVolumeAsync(RaopControls.ToAirPlayDb(v, percent: true)), Delayer = v => sk.DelayMs = v + q.DefaultDelayMs,
            Teardown = async () => { try { await s.TeardownAsync(); } catch { } await s.DisposeAsync(); ptp.RemovePeer(ep.Address); },
            Stats = () => new { packets = sk.Packets, announces = sk.Announces, flushes = sk.Flushes, segments = sk.Segments, framesIn = sk.FramesIn, feedbacks = s.Feedbacks, ptpSyncs = ptp.SyncsSent, ptpDelayReqs = ptp.DelayReqs, quirk = q.Label },
            SetParam = (b, t, h) => s.SetParameterAsync(b, t, h), RtpNow = () => sk.RtpAt(_reg.Clock.NowUs),   // 0.6.8-#14e: best effort on AirPlay 2
        };
        WatchPtp(o, ptp);
        return o;
    }

    /// <summary>0.7.0 t1930: after a few seconds of Syncs with no Delay_Req, tell the log and the card about the PTP firewall.</summary>
    void WatchPtp(Out o, PtpMaster ptp)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(5000);
                if (Get(o.Key) != o) return;
                var hint = AirPlaySetup.PtpNoFollowersHint(ptp.SyncsSent, ptp.DelayReqs);
                if (hint == null) return;
                o.Warning = hint;
                _log?.Invoke($"airplay {o.Key}: {hint}");
            }
            catch { }
        });
    }

    public async ValueTask DisposeAsync()
    {
        _metaTimer?.Dispose(); _metaTimer = null;
        foreach (var k in _outs.Keys.ToList()) await DisconnectAsync(k);
        foreach (var m in _ptp.Values) m.Dispose(); _ptp.Clear();
    }
}
