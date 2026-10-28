using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace WavWiz.Core.AirPlay;

/// <summary>Options for one AirPlay 1 (RAOP) sender session.</summary>
public sealed class RaopOptions
{
    /// <summary>0 = clear, 1 = RSA-wrapped AES-128-CBC.</summary>
    public int Encryption { get; set; }
    public int SampleRate { get; set; } = 44100;
    public int FramesPerPacket { get; set; } = 352;
    /// <summary>Receiver latency in frames announced with RECORD / sync packets (2 s default, AirPlay 1 convention).</summary>
    public int LatencyFrames { get; set; } = 88200;
    public string UserAgent { get; set; } = "WavWiz/0.5.0";
    public string? Password { get; set; }
}

/// <summary>
/// 0.5.0 AirPlay 1 sender session: RTSP handshake (OPTIONS, ANNOUNCE, SETUP, RECORD, SET_PARAMETER, FLUSH, TEARDOWN),
/// UDP control + timing sockets, NTP timing replies. Audio, sync and retransmit live in <see cref="RaopStreamer"/>.
/// Clean-room: written from the public RAOP descriptions (Apple RTSP conventions, openairplay spec) and MIT libraop notes.
/// </summary>
public sealed class RaopSession : IAsyncDisposable
{
    public RaopOptions Opt { get; }
    public RtspClient Rtsp { get; } = new();
    public string Sid { get; } = ((uint)Random.Shared.Next()).ToString();
    public string DacpId { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
    public uint ActiveRemote { get; } = (uint)Random.Shared.Next();
    public UdpClient Control { get; private set; } = null!;
    public UdpClient Timing { get; private set; } = null!;
    public UdpClient Audio { get; private set; } = null!;
    public IPEndPoint ServerAudio { get; private set; } = null!;
    public IPEndPoint ServerControl { get; private set; } = null!;
    public IPEndPoint ServerTiming { get; private set; } = null!;
    public byte[]? AesKey { get; private set; }
    public byte[]? AesIv { get; private set; }
    public int AudioLatency { get; private set; }
    public int TimingRequests;
    public event Action<byte[], IPEndPoint>? ControlPacket;
    readonly CancellationTokenSource _cts = new();
    string Uri => RtspClient.Uri(Rtsp.LocalAddress, Sid);

    public RaopSession(RaopOptions? o = null) { Opt = o ?? new(); }

    public async Task ConnectAsync(IPEndPoint ep, CancellationToken ct = default)
    {
        await Rtsp.ConnectAsync(ep, ct);
        Rtsp.DefaultHeaders["User-Agent"] = Opt.UserAgent;
        Rtsp.DefaultHeaders["Client-Instance"] = DacpId;
        Rtsp.DefaultHeaders["DACP-ID"] = DacpId;
        Rtsp.DefaultHeaders["Active-Remote"] = ActiveRemote.ToString();
        var bind = Rtsp.LocalAddress;
        Control = new UdpClient(new IPEndPoint(bind, 0));
        Timing = new UdpClient(new IPEndPoint(bind, 0));
        Audio = new UdpClient(new IPEndPoint(bind, 0));
        _ = Task.Run(() => TimingLoop(_cts.Token));
        _ = Task.Run(() => ControlLoop(_cts.Token));
    }

    public Task<RtspResponse> OptionsAsync(CancellationToken ct = default) => Rtsp.SendAsync("OPTIONS", "*", null, null, null, ct);

    /// <summary>The SDP for ANNOUNCE: ALAC 16-bit stereo, 352 frames/packet (Apple's fmtp layout).</summary>
    public string BuildSdp()
    {
        var sb = new StringBuilder();
        sb.Append("v=0\r\n");
        sb.Append($"o=iTunes {Sid} 0 IN IP4 {Rtsp.LocalAddress}\r\n");
        sb.Append("s=iTunes\r\n");
        sb.Append($"c=IN IP4 {Rtsp.Remote.Address}\r\n");
        sb.Append("t=0 0\r\n");
        sb.Append("m=audio 0 RTP/AVP 96\r\n");
        sb.Append("a=rtpmap:96 AppleLossless\r\n");
        sb.Append($"a=fmtp:96 {Opt.FramesPerPacket} 0 16 40 10 14 2 255 0 0 {Opt.SampleRate}\r\n");
        if (Opt.Encryption == 1)
        {
            AesKey = RandomNumberGenerator.GetBytes(16); AesIv = RandomNumberGenerator.GetBytes(16);
            sb.Append("a=rsaaeskey:").Append(B64NoPad(RaopCrypto.WrapKey(AesKey))).Append("\r\n");
            sb.Append("a=aesiv:").Append(B64NoPad(AesIv)).Append("\r\n");
        }
        return sb.ToString();
    }
    static string B64NoPad(byte[] b) => Convert.ToBase64String(b).TrimEnd('=');

    /// <summary>OPTIONS, ANNOUNCE, SETUP, RECORD. Returns the RECORD response.</summary>
    public async Task<RtspResponse> StartAsync(ushort seq, uint rtptime, CancellationToken ct = default)
    {
        var o = await OptionsAsync(ct); Need(o, "OPTIONS");
        var a = await Rtsp.SendAsync("ANNOUNCE", Uri, null, Encoding.ASCII.GetBytes(BuildSdp()), "application/sdp", ct); Need(a, "ANNOUNCE");
        int cport = ((IPEndPoint)Control.Client.LocalEndPoint!).Port, tport = ((IPEndPoint)Timing.Client.LocalEndPoint!).Port;
        var s = await Rtsp.SendAsync("SETUP", Uri, new() { ["Transport"] = $"RTP/AVP/UDP;unicast;interleaved=0-1;mode=record;control_port={cport};timing_port={tport}" }, null, null, ct);
        Need(s, "SETUP");
        var tr = RtspClient.ParseTransport(s.H("Transport") ?? "");
        var ip = Rtsp.Remote.Address;
        ServerAudio = new IPEndPoint(ip, int.Parse(tr["server_port"]));
        ServerControl = new IPEndPoint(ip, tr.TryGetValue("control_port", out var c) ? int.Parse(c) : 0);
        ServerTiming = new IPEndPoint(ip, tr.TryGetValue("timing_port", out var t) ? int.Parse(t) : 0);
        var r = await Rtsp.SendAsync("RECORD", Uri, new() { ["Range"] = "npt=0-", ["RTP-Info"] = $"seq={seq};rtptime={rtptime}" }, null, null, ct);
        Need(r, "RECORD");
        AudioLatency = int.TryParse(r.H("Audio-Latency"), out var al) ? al : 0;
        return r;
    }

    static void Need(RtspResponse r, string what) { if (!r.Ok) throw new IOException($"{what} failed: {r.Status} {r.Reason}"); }

    /// <summary>AirPlay volume: 0 dB max, -30 dB min, -144 mute.</summary>
    public Task<RtspResponse> SetVolumeAsync(double db, CancellationToken ct = default) =>
        Rtsp.SendAsync("SET_PARAMETER", Uri, null, Encoding.ASCII.GetBytes($"volume: {db.ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture)}\r\n"), "text/parameters", ct);

    public Task<RtspResponse> SetParameterAsync(byte[] body, string contentType, Dictionary<string, string>? h = null, CancellationToken ct = default) =>
        Rtsp.SendAsync("SET_PARAMETER", Uri, h, body, contentType, ct);

    public Task<RtspResponse> FlushAsync(ushort seq, uint rtptime, CancellationToken ct = default) =>
        Rtsp.SendAsync("FLUSH", Uri, new() { ["RTP-Info"] = $"seq={seq};rtptime={rtptime}" }, null, null, ct);

    public Task<RtspResponse> TeardownAsync(CancellationToken ct = default) =>
        Rtsp.SendAsync("TEARDOWN", Uri, new() { ["Connection"] = "close" }, null, null, ct);

    /// <summary>Answers timing requests (PT 0x52) with timing replies (PT 0x53) carrying our NTP clock.</summary>
    async Task TimingLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await Timing.ReceiveAsync(ct); } catch { return; }
            var p = r.Buffer; var now = Ntp.Now();
            if (p.Length < 32 || (p[1] & 0x7F) != 0x52) continue;
            Interlocked.Increment(ref TimingRequests);
            var reply = Rtp.TimingReply(p, now, Ntp.Now());
            try { await Timing.SendAsync(reply, r.RemoteEndPoint, ct); } catch { }
        }
    }

    async Task ControlLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await Control.ReceiveAsync(ct); } catch { return; }
            ControlPacket?.Invoke(r.Buffer, r.RemoteEndPoint);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        await Task.Yield();
        Control?.Dispose(); Timing?.Dispose(); Audio?.Dispose(); Rtsp.Dispose();
    }
}

/// <summary>NTP 64-bit timestamps (seconds since 1900 in the high word).</summary>
public static class Ntp
{
    const long Epoch = 2208988800L;
    public static ulong Now() => FromUnixTicks(DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks);
    public static ulong FromUnixTicks(long ticks)
    {
        long sec = ticks / TimeSpan.TicksPerSecond; long rem = ticks % TimeSpan.TicksPerSecond;
        return ((ulong)(sec + Epoch) << 32) | (ulong)((rem << 32) / TimeSpan.TicksPerSecond);
    }
}

/// <summary>RAOP RTP packet builders (audio, sync, timing reply, resend reply).</summary>
public static class Rtp
{
    public static void Be16(Span<byte> b, int o, ushort v) { b[o] = (byte)(v >> 8); b[o + 1] = (byte)v; }
    public static void Be32(Span<byte> b, int o, uint v) { b[o] = (byte)(v >> 24); b[o + 1] = (byte)(v >> 16); b[o + 2] = (byte)(v >> 8); b[o + 3] = (byte)v; }
    public static void Be64(Span<byte> b, int o, ulong v) { Be32(b, o, (uint)(v >> 32)); Be32(b, o + 4, (uint)v); }
    public static ulong Rd64(ReadOnlySpan<byte> b, int o) => ((ulong)Rd32(b, o) << 32) | Rd32(b, o + 4);
    public static uint Rd32(ReadOnlySpan<byte> b, int o) => (uint)(b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]);
    public static ushort Rd16(ReadOnlySpan<byte> b, int o) => (ushort)(b[o] << 8 | b[o + 1]);

    /// <summary>Timing reply (0x80 0xD3): reference = request's send time, then our receive and send times.</summary>
    public static byte[] TimingReply(byte[] req, ulong recv, ulong send)
    {
        var b = new byte[32];
        b[0] = 0x80; b[1] = 0xD3; Be16(b, 2, 7);
        Be64(b, 8, Rd64(req, 24)); Be64(b, 16, recv); Be64(b, 24, send);
        return b;
    }

    /// <summary>Audio packet: 12-byte RTP header (PT 96, marker on the first packet) + payload.</summary>
    public static byte[] Audio(ushort seq, uint ts, uint ssrc, ReadOnlySpan<byte> payload, bool first)
    {
        var b = new byte[12 + payload.Length];
        b[0] = 0x80; b[1] = (byte)(first ? 0xE0 : 0x60); Be16(b, 2, seq); Be32(b, 4, ts); Be32(b, 8, ssrc);
        payload.CopyTo(b.AsSpan(12));
        return b;
    }

    /// <summary>Sync (0x80/0x90 0xD4): rtptime now minus latency, NTP now, rtptime now. Extension bit set on the first.</summary>
    public static byte[] Sync(uint rtpNow, int latency, ulong ntp, bool first)
    {
        var b = new byte[20];
        b[0] = (byte)(first ? 0x90 : 0x80); b[1] = 0xD4; Be16(b, 2, 7);
        Be32(b, 4, (uint)(rtpNow - latency)); Be64(b, 8, ntp); Be32(b, 16, rtpNow);
        return b;
    }

    /// <summary>Resend reply (0x80 0xD6) wrapping the original audio packet.</summary>
    public static byte[] Resend(ushort seq, byte[] original)
    {
        var b = new byte[4 + original.Length];
        b[0] = 0x80; b[1] = 0xD6; Be16(b, 2, seq); original.CopyTo(b, 4);
        return b;
    }
}
