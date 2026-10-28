using System.Net;
using System.Net.Sockets;
using System.Text;

namespace WavWiz.Core.AirPlay;

/// <summary>One RTSP response (status line, headers, body).</summary>
public sealed record RtspResponse(int Status, string Reason, Dictionary<string, string> Headers, byte[] Body)
{
    public string? H(string name) => Headers.TryGetValue(name, out var v) ? v : null;
    public bool Ok => Status == 200;
}

/// <summary>
/// 0.5.0 minimal RTSP/1.0 client for AirPlay senders: one TCP connection, sequential requests, CSeq numbering,
/// Content-Length bodies, and a text transcript of every exchange (bodies summarised). Written from RFC 2326 and the
/// public AirPlay protocol notes; no GPL code used. An optional <see cref="Wrap"/> hook lets AirPlay 2 swap the stream
/// for an encrypted one after pairing.
/// </summary>
public sealed class RtspClient : IDisposable
{
    readonly TcpClient _tcp = new() { NoDelay = true };
    System.IO.Stream _s = System.IO.Stream.Null;
    int _cseq;
    readonly SemaphoreSlim _lock = new(1, 1);
    public IPEndPoint Remote { get; private set; } = new(IPAddress.None, 0);
    public IPAddress LocalAddress { get; private set; } = IPAddress.None;
    public Dictionary<string, string> DefaultHeaders { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<string> Transcript { get; } = new();
    public string? Session { get; set; }
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);

    public async Task ConnectAsync(IPEndPoint ep, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(Timeout);
        await _tcp.ConnectAsync(ep.Address, ep.Port, cts.Token);
        _s = _tcp.GetStream(); Remote = ep;
        LocalAddress = ((IPEndPoint)_tcp.Client.LocalEndPoint!).Address;
        if (LocalAddress.IsIPv4MappedToIPv6) LocalAddress = LocalAddress.MapToIPv4();
        Log($"# connected {ep} from {LocalAddress}");
    }

    /// <summary>Replace the underlying stream (AirPlay 2 encrypted control channel).</summary>
    public void Wrap(Func<System.IO.Stream, System.IO.Stream> f) => _s = f(_s);
    public System.IO.Stream RawStream => _tcp.GetStream();

    void Log(string s) { lock (Transcript) Transcript.Add($"{DateTime.Now:HH:mm:ss.fff} {s}"); }

    public static string Uri(IPAddress local, string sid) => $"rtsp://{local}/{sid}";

    public async Task<RtspResponse> SendAsync(string method, string uri, Dictionary<string, string>? headers = null,
        byte[]? body = null, string? contentType = null, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var sb = new StringBuilder();
            sb.Append(method).Append(' ').Append(uri).Append(" RTSP/1.0\r\n");
            sb.Append("CSeq: ").Append(++_cseq).Append("\r\n");
            foreach (var kv in DefaultHeaders) sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            if (Session != null && !(headers?.ContainsKey("Session") ?? false)) sb.Append("Session: ").Append(Session).Append("\r\n");
            if (headers != null) foreach (var kv in headers) sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            if (body != null)
            {
                if (contentType != null) sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
                sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            }
            sb.Append("\r\n");
            var head = Encoding.ASCII.GetBytes(sb.ToString());
            Log("> " + sb.ToString().TrimEnd().Replace("\r\n", "\n  ") + Summ(body, contentType));
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(Timeout);
            if (body != null) { var all = new byte[head.Length + body.Length]; head.CopyTo(all, 0); body.CopyTo(all, head.Length); await _s.WriteAsync(all, cts.Token); }
            else await _s.WriteAsync(head, cts.Token);
            await _s.FlushAsync(cts.Token);
            var r = await ReadResponseAsync(_s, cts.Token);
            Log("< " + r.Status + " " + r.Reason + string.Concat(r.Headers.Select(k => "\n  " + k.Key + ": " + k.Value)) + Summ(r.Body, r.H("Content-Type")));
            if (r.H("Session") is { } sess) Session = sess.Split(';')[0].Trim();
            return r;
        }
        finally { _lock.Release(); }
    }

    static string Summ(byte[]? b, string? ct) => b == null || b.Length == 0 ? "" :
        ct != null && (ct.StartsWith("text/") || ct.StartsWith("application/sdp")) ? string.Concat(Encoding.UTF8.GetString(b).TrimEnd().Split('\n').Select(l => "\n  | " + l.TrimEnd('\r')))
        : $"\n  [{b.Length} bytes {ct}]";

    /// <summary>Parses one RTSP response from a stream. Public for tests.</summary>
    public static async Task<RtspResponse> ReadResponseAsync(System.IO.Stream s, CancellationToken ct)
    {
        var line = new List<byte>(); var lines = new List<string>(); var one = new byte[1];
        while (true)
        {
            int n = await s.ReadAsync(one, ct);
            if (n == 0) throw new IOException("RTSP connection closed");
            if (one[0] == '\n')
            {
                var l = Encoding.ASCII.GetString(line.ToArray()).TrimEnd('\r'); line.Clear();
                if (l.Length == 0) { if (lines.Count == 0) continue; break; }
                lines.Add(l);
            }
            else line.Add(one[0]);
        }
        var st = lines[0].Split(' ', 3);
        if (st.Length < 2 || !st[0].StartsWith("RTSP/") && !st[0].StartsWith("HTTP/")) throw new IOException("bad status line: " + lines[0]);
        var h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines.Skip(1)) { int i = l.IndexOf(':'); if (i > 0) h[l[..i].Trim()] = l[(i + 1)..].Trim(); }
        var body = Array.Empty<byte>();
        if (h.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var len) && len > 0)
        {
            body = new byte[len]; int got = 0;
            while (got < len) { int n = await s.ReadAsync(body.AsMemory(got), ct); if (n == 0) throw new IOException("short body"); got += n; }
        }
        return new RtspResponse(int.Parse(st[1]), st.Length > 2 ? st[2] : "", h, body);
    }

    /// <summary>Parses "RTP/AVP/UDP;unicast;server_port=6000;control_port=6001" into a key/value map.</summary>
    public static Dictionary<string, string> ParseTransport(string t)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in t.Split(';')) { int i = p.IndexOf('='); if (i > 0) d[p[..i].Trim()] = p[(i + 1)..].Trim(); else d[p.Trim()] = ""; }
        return d;
    }

    public void Dispose() { try { _tcp.Dispose(); } catch { } }
}
