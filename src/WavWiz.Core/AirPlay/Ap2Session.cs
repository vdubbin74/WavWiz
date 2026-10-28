using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace WavWiz.Core.AirPlay;

public enum Ap2Timing { Ptp, Ntp }

public sealed class Ap2Options
{
    public required IPEndPoint Endpoint { get; init; }
    public string Name { get; init; } = "WavWiz";
    public string DeviceId { get; init; } = "AA:BB:CC:DD:EE:01";
    public Ap2Timing Timing { get; init; } = Ap2Timing.Ptp;
    /// <summary>Audio is scheduled this far behind "now" on the shared clock.</summary>
    public int LatencyMs { get; init; } = 2000;
    public double? VolumeDb { get; init; }
    /// <summary>Buffered (type 103, AAC-LC via ffmpeg, TCP data, anchor/rate control) instead of realtime ALAC (type 96).</summary>
    public bool Buffered { get; init; }
}

/// <summary>
/// AirPlay 2 realtime (stream type 96) sender session: transient pairing + encrypted RTSP, two-phase plist SETUP
/// (session/timing, then the audio stream with a ChaCha20-Poly1305 key "shk"), SETPEERS (PTP), RECORD, /feedback
/// keep-alive every 2 s, ALAC-in-RTP audio with per-packet AEAD (AAD = RTP timestamp+SSRC, 8-byte nonce trailer),
/// and 0xD7 time-announce packets on the control port that anchor RTP time to the PTP timeline.
/// Clean-room from public AirPlay 2 protocol notes; behaviour checked against shairport-sync as a black box.
/// </summary>
public sealed class Ap2Session : IAsyncDisposable
{
    public const int Spf = 352, Rate = 44100;
    readonly Ap2Options _o; readonly PtpMaster? _ptp;
    public RtspClient Rtsp { get; } = new();
    public string Sid { get; } = Random.Shared.NextInt64(1, long.MaxValue).ToString();
    public string SessionUuid { get; } = Guid.NewGuid().ToString().ToUpperInvariant();
    public byte[] Shk { get; } = RandomNumberGenerator.GetBytes(32);
    public int DataPort, ControlPort, EventPort;
    public Dictionary<string, object?>? Setup1, Setup2;
    UdpClient? _data, _ctl; TcpClient? _event, _buf; public long AudioBufferSize; ChaCha20Poly1305? _aead;
    CancellationTokenSource _cts = new(); Task? _fb, _ctlRx;
    public long Feedbacks, CtlPacketsIn;

    public Ap2Session(Ap2Options o, PtpMaster? ptp) { _o = o; _ptp = ptp; if (o.Timing == Ap2Timing.Ptp && ptp == null) throw new ArgumentException("PTP timing needs a PtpMaster"); }
    string Uri => RtspClient.Uri(Rtsp.LocalAddress, Sid);

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        await Rtsp.ConnectAsync(_o.Endpoint, ct);
        Rtsp.DefaultHeaders["User-Agent"] = "AirPlay/409.16";
        Rtsp.DefaultHeaders["DACP-ID"] = Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
        Rtsp.DefaultHeaders["Active-Remote"] = ((uint)Random.Shared.Next()).ToString();
        await Ap2Pairing.PairAndEncryptAsync(Rtsp, ct);
        var local = Rtsp.LocalAddress;
        _data = new UdpClient(new IPEndPoint(local, 0)); _ctl = new UdpClient(new IPEndPoint(local, 0));

        var s1 = new Dictionary<string, object?>
        {
            ["deviceID"] = _o.DeviceId, ["macAddress"] = _o.DeviceId, ["sessionUUID"] = SessionUuid,
            ["name"] = _o.Name, ["model"] = "WavWiz", ["sourceVersion"] = "409.16",
            ["groupUUID"] = SessionUuid, ["groupContainsGroupLeader"] = false, ["isMultiSelectAirPlay"] = true,
            ["senderSupportsRelay"] = false, ["statsCollectionEnabled"] = false,
            ["timingProtocol"] = _o.Timing == Ap2Timing.Ptp ? "PTP" : "NTP",
        };
        if (_o.Timing == Ap2Timing.Ptp)
            s1["timingPeerInfo"] = new Dictionary<string, object?> { ["Addresses"] = new List<object?> { local.ToString() }, ["ID"] = local.ToString() };
        var r1 = await Rtsp.SendAsync("SETUP", Uri, null, BPlist.Write(s1), "application/x-apple-binary-plist", ct);
        if (!r1.Ok) throw new IOException($"SETUP(session): {r1.Status} {r1.Reason}");
        Setup1 = r1.Body.Length > 0 ? BPlist.Dict(r1.Body) : new();
        EventPort = (int)Setup1.Int("eventPort");
        if (EventPort > 0) { _event = new TcpClient(); await _event.ConnectAsync(new IPEndPoint(_o.Endpoint.Address, EventPort), ct); }

        if (_o.Timing == Ap2Timing.Ptp)
        {
            _ptp!.AddPeer(_o.Endpoint.Address);
            var peers = new List<object?> { local.ToString(), _o.Endpoint.Address.ToString() };
            var rp = await Rtsp.SendAsync("SETPEERS", Uri, null, BPlist.Write(peers), "/peer-list-changed", ct);
            if (!rp.Ok) throw new IOException($"SETPEERS: {rp.Status}");
        }

        var stream = new Dictionary<string, object?>
        {
            ["type"] = _o.Buffered ? 103 : 96, ["ct"] = _o.Buffered ? 4 : 2, ["audioFormat"] = _o.Buffered ? 0x400000 : 0x40000,
            ["spf"] = _o.Buffered ? AacLiveEncoder.FramesPerPacket : Spf, ["sr"] = Rate,
            ["controlPort"] = ((IPEndPoint)_ctl.Client.LocalEndPoint!).Port, ["shk"] = Shk, ["isMedia"] = true,
            ["latencyMin"] = 11025, ["latencyMax"] = 88200, ["audioMode"] = "default", ["redundantAudio"] = 0,
            ["streamConnectionID"] = (long)(uint)Random.Shared.Next(), ["supportsDynamicStreamID"] = false,
        };
        var r2 = await Rtsp.SendAsync("SETUP", Uri, null, BPlist.Write(new Dictionary<string, object?> { ["streams"] = new List<object?> { stream } }), "application/x-apple-binary-plist", ct);
        if (!r2.Ok) throw new IOException($"SETUP(stream): {r2.Status} {r2.Reason}");
        Setup2 = BPlist.Dict(r2.Body);
        var st = (Setup2["streams"] as List<object?>)?.FirstOrDefault() as Dictionary<string, object?> ?? throw new IOException("SETUP(stream): no streams in reply");
        DataPort = (int)st.Int("dataPort"); ControlPort = (int)st.Int("controlPort");
        _aead = new ChaCha20Poly1305(Shk);
        if (_o.Buffered)
        {
            AudioBufferSize = st.Int("audioBufferSize");
            _buf = new TcpClient { NoDelay = true };
            await _buf.ConnectAsync(new IPEndPoint(_o.Endpoint.Address, DataPort), ct);
        }

        var rr = await Rtsp.SendAsync("RECORD", Uri, null, null, null, ct);
        if (!rr.Ok) throw new IOException($"RECORD: {rr.Status}");
        if (_o.VolumeDb is double v) await SetVolumeAsync(v, ct);
        _fb = Task.Run(() => FeedbackLoop(_cts.Token));
        _ctlRx = Task.Run(() => CtlLoop(_cts.Token));
    }

    public Task<RtspResponse> SetVolumeAsync(double db, CancellationToken ct = default) =>
        Rtsp.SendAsync("SET_PARAMETER", Uri, null, Encoding.ASCII.GetBytes(FormattableString.Invariant($"volume: {db:0.000000}\r\n")), "text/parameters", ct);

    async Task FeedbackLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Task.Delay(2000, ct); var r = await Rtsp.SendAsync("POST", "/feedback", null, null, null, ct); if (r.Ok) Interlocked.Increment(ref Feedbacks); }
            catch (OperationCanceledException) { return; } catch (IOException) { }
        }
    }
    async Task CtlLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) { try { await _ctl!.ReceiveAsync(ct); Interlocked.Increment(ref CtlPacketsIn); } catch { return; } }
    }

    ulong _nonce;
    /// <summary>One encrypted realtime audio packet: RTP header | ChaCha20-Poly1305(ALAC) | tag | 8-byte nonce.</summary>
    public byte[] AudioPacket(ushort seq, uint rtp, uint ssrc, ReadOnlySpan<byte> alac, bool first)
    {
        var p = new byte[12 + alac.Length + 16 + 8];
        p[0] = 0x80; p[1] = (byte)(first ? 0xE0 : 0x60);
        Rtp.Be16(p, 2, seq); Rtp.Be32(p, 4, rtp); Rtp.Be32(p, 8, ssrc);
        var nonce8 = new byte[8]; BinaryPrimitives.WriteUInt64LittleEndian(nonce8, _nonce++);
        var n12 = new byte[12]; nonce8.CopyTo(n12, 4);
        _aead!.Encrypt(n12, alac, p.AsSpan(12, alac.Length), p.AsSpan(12 + alac.Length, 16), p.AsSpan(4, 8));
        nonce8.CopyTo(p, 12 + alac.Length + 16);
        return p;
    }

    /// <summary>0xD7 time announce: RTP frame <paramref name="rtp"/> is to be heard at PTP time <paramref name="ns"/>.</summary>
    public byte[] TimeAnnounce(ushort seq, uint rtp, ulong ns, ulong clockId)
    {
        const uint Fixed = 11035, Notified = 77175;
        var p = new byte[28]; p[0] = 0x90; p[1] = 0xD7; Rtp.Be16(p, 2, seq);
        Rtp.Be32(p, 4, rtp + Fixed); Rtp.Be64(p, 8, ns); Rtp.Be32(p, 16, rtp + Fixed + Notified); Rtp.Be64(p, 20, clockId);
        return p;
    }

    /// <summary>Buffered audio packet: 2-byte BE total length | RTP header (24-bit seq in bytes 1-3) | AEAD(AAC) | tag | nonce.</summary>
    public byte[] BufferedPacket(uint seq, uint rtp, uint ssrc, ReadOnlySpan<byte> au)
    {
        int n = 2 + 12 + au.Length + 16 + 8; var b = new byte[n];
        Rtp.Be16(b, 0, (ushort)n);
        var p = b.AsSpan(2);
        p[0] = 0x80; p[1] = (byte)(seq >> 16); p[2] = (byte)(seq >> 8); p[3] = (byte)seq;
        Rtp.Be32(b, 6, rtp); Rtp.Be32(b, 10, ssrc);
        var nonce8 = new byte[8]; BinaryPrimitives.WriteUInt64LittleEndian(nonce8, _nonce++);
        var n12 = new byte[12]; nonce8.CopyTo(n12, 4);
        _aead!.Encrypt(n12, au, p.Slice(12, au.Length), p.Slice(12 + au.Length, 16), p.Slice(4, 8));
        nonce8.CopyTo(p.Slice(12 + au.Length + 16));
        return b;
    }
    public async Task SendBufferedAsync(byte[] pkt, CancellationToken ct = default) => await _buf!.GetStream().WriteAsync(pkt, ct);

    /// <summary>SETRATEANCHORTIME: rate 1 = play with RTP <paramref name="rtp"/> heard at PTP <paramref name="ns"/>; rate 0 = pause now.</summary>
    public Task<RtspResponse> SetRateAnchorAsync(int rate, uint rtp = 0, ulong ns = 0, CancellationToken ct = default)
    {
        var d = new Dictionary<string, object?> { ["rate"] = rate };
        if (rate != 0)
        {
            d["rtpTime"] = (long)rtp; d["networkTimeSecs"] = (long)(ns / 1_000_000_000);
            d["networkTimeFrac"] = unchecked((long)(ulong)(((UInt128)(ns % 1_000_000_000) << 64) / 1_000_000_000));
            d["networkTimeTimelineID"] = unchecked((long)(_ptp?.ClockId ?? 0));
        }
        return Rtsp.SendAsync("SETRATEANCHORTIME", Uri, null, BPlist.Write(d), "application/x-apple-binary-plist", ct);
    }

    /// <summary>FLUSHBUFFERED: drop buffered audio [from, until) (from omitted = everything before until).</summary>
    public Task<RtspResponse> FlushBufferedAsync(uint untilSeq, uint untilTs, uint? fromSeq = null, uint? fromTs = null, CancellationToken ct = default)
    {
        var d = new Dictionary<string, object?> { ["flushUntilSeq"] = (long)untilSeq, ["flushUntilTS"] = (long)untilTs };
        if (fromSeq is uint fs) { d["flushFromSeq"] = (long)fs; d["flushFromTS"] = (long)(fromTs ?? 0); }
        return Rtsp.SendAsync("FLUSHBUFFERED", Uri, null, BPlist.Write(d), "application/x-apple-binary-plist", ct);
    }

    /// <summary>Realtime-stream FLUSH (drops queued audio from seq/rtptime on).</summary>
    public Task<RtspResponse> FlushAsync(ushort seq, uint rtp, CancellationToken ct = default) =>
        Rtsp.SendAsync("FLUSH", Uri, new() { ["RTP-Info"] = $"seq={seq};rtptime={rtp}" }, null, null, ct);

    public Task SendAudioAsync(byte[] pkt, CancellationToken ct = default) => _data!.SendAsync(pkt, new IPEndPoint(_o.Endpoint.Address, DataPort), ct).AsTask();
    public Task SendControlAsync(byte[] pkt, CancellationToken ct = default) => _ctl!.SendAsync(pkt, new IPEndPoint(_o.Endpoint.Address, ControlPort), ct).AsTask();

    public async Task TeardownAsync()
    {
        _cts.Cancel();
        try { await Rtsp.SendAsync("TEARDOWN", Uri, null, BPlist.Write(new Dictionary<string, object?> { ["streams"] = new List<object?> { new Dictionary<string, object?> { ["type"] = _o.Buffered ? 103 : 96 } } }), "application/x-apple-binary-plist"); } catch { }
        try { await Rtsp.SendAsync("TEARDOWN", Uri); } catch { }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        try { if (_fb != null) await _fb; } catch { }
        _ptp?.RemovePeer(_o.Endpoint.Address);
        _event?.Dispose(); _buf?.Dispose(); _data?.Dispose(); _ctl?.Dispose(); _aead?.Dispose(); Rtsp.Dispose();
    }
}

/// <summary>Paced realtime streamer for <see cref="Ap2Session"/>: 352-frame ALAC packets scheduled on the PTP clock.</summary>
public sealed class Ap2Streamer : IAsyncDisposable
{
    readonly Ap2Session _s; readonly PtpMaster _ptp; readonly Func<short[], int> _fill; readonly int _latencyMs;
    readonly CancellationTokenSource _cts = new(); Task? _t;
    public ushort Seq; public uint Rtp0 = (uint)Random.Shared.Next(), Ssrc = (uint)Random.Shared.Next();
    public ulong T0Ns; public long PacketsSent, AnnouncesSent;

    public Ap2Streamer(Ap2Session s, PtpMaster ptp, Func<short[], int> fill, int latencyMs = 2000) { _s = s; _ptp = ptp; _fill = fill; _latencyMs = latencyMs; Seq = (ushort)Random.Shared.Next(); }

    public ulong PlayAtNs(uint rtp) => T0Ns + (ulong)((long)(uint)(rtp - Rtp0) * 1_000_000_000L / Ap2Session.Rate);

    public void Start() { T0Ns = _ptp.NowNs + (ulong)_latencyMs * 1_000_000; _t = Task.Run(() => Run(_cts.Token)); }

    async Task Run(CancellationToken ct)
    {
        var pcm = new short[Ap2Session.Spf * 2]; var alac = new byte[AlacRaw.Size(Ap2Session.Spf)];
        uint rtp = Rtp0; ushort aseq = 0; ulong nextAnn = 0; bool first = true;
        while (!ct.IsCancellationRequested)
        {
            ulong now = _ptp.NowNs;
            if (now >= nextAnn)
            {
                // anchor: the frame that should be heard right now (+ latency) on the shared timeline
                ulong at = now + (ulong)_latencyMs * 1_000_000;
                uint r = Rtp0 + (uint)((long)(at - T0Ns) * Ap2Session.Rate / 1_000_000_000L);
                await _s.SendControlAsync(_s.TimeAnnounce(aseq++, r, at, _ptp.ClockId), ct);
                AnnouncesSent++; nextAnn = now + 1_000_000_000;
            }
            while (PlayAtNs(rtp) < now + (ulong)_latencyMs * 1_000_000)
            {
                Array.Clear(pcm); _fill(pcm);
                int n = AlacRaw.Encode(pcm, alac);
                await _s.SendAudioAsync(_s.AudioPacket(Seq++, rtp, Ssrc, alac.AsSpan(0, n), first), ct);
                first = false; rtp += Ap2Session.Spf; PacketsSent++;
            }
            try { await Task.Delay(5, ct); } catch (OperationCanceledException) { }
        }
    }

    public async ValueTask DisposeAsync() { _cts.Cancel(); try { if (_t != null) await _t; } catch { } }
}
