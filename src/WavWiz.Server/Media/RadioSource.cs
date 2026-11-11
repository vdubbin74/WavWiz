using System.Diagnostics;
using System.Text;
namespace WavWiz.Server.Media;

/// <summary>
/// Internet radio (spec 10.2): the server reads the HTTP stream itself (ICY metadata, reconnect with backoff 1..30 s) and pipes the audio bytes into
/// ffmpeg for decoding. The only outbound connection WavWiz makes by default, and only to the station you chose. Keeps a short buffer so a hiccup
/// never reaches the rooms; when the buffer runs dry the stream timeline is padded with silence by the StreamEngine, so every zone stays aligned.
/// </summary>
public sealed class RadioDecoder : IPcmDecoder
{
    private readonly string _ffmpeg, _url; private readonly PcmRing _ring = new(48000 * 12); private readonly CancellationTokenSource _cts = new(); private readonly Thread _t;
    private readonly HttpClient _http; private volatile bool _buffering = true;
    public int PrebufferFrames { get; init; } = 48000 * 3;
    public string? Error { get; private set; }
    public string? StationName { get; private set; }
    public string? NowPlaying { get; private set; }
    public int Reconnects { get; private set; }
    public event Action<string>? Metadata;
    public event Action<string>? Status;
    public Func<int, int> BackoffMs { get; init; } = attempt => Math.Min(30_000, 1000 << Math.Min(attempt, 5));

    public RadioDecoder(string ffmpeg, string url, HttpClient? http = null)
    {
        _ffmpeg = ffmpeg; _url = url; _http = http ?? new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5), ConnectTimeout = TimeSpan.FromSeconds(10) }) { Timeout = Timeout.InfiniteTimeSpan };
        _t = new Thread(Run) { IsBackground = true, Name = "radio" }; _t.Start();
    }

    public bool Finished => false;       // a station never "ends"; the queue stays on it until the user changes it
    public bool Buffering => _buffering;

    public int Read(Span<float> dst, int frames)
    {
        if (_buffering) { if (_ring.Count < PrebufferFrames) return 0; _buffering = false; }
        int n = _ring.Read(dst, frames);
        if (n == 0) { _buffering = true; Status?.Invoke("Buffering..."); }
        return n;
    }

    private void Run()
    {
        int attempt = 0;
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var target = ResolveUrl(_url);
                Status?.Invoke(attempt == 0 ? "Connecting..." : "Reconnecting...");
                if (target.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase)) RunDirect(target); else RunIcy(target);
                attempt = 0;
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Error = e.Message; Status?.Invoke("Reconnecting... (" + e.Message + ")"); }
            if (_cts.IsCancellationRequested) break;
            Reconnects++; attempt++;
            if (_cts.Token.WaitHandle.WaitOne(BackoffMs(attempt))) break;
        }
    }

    private string ResolveUrl(string url)
    {
        if (!(url.EndsWith(".pls", StringComparison.OrdinalIgnoreCase) || url.EndsWith(".m3u", StringComparison.OrdinalIgnoreCase))) return url;
        var text = _http.GetStringAsync(url, _cts.Token).GetAwaiter().GetResult();
        return PlaylistParser.FirstUrl(text) ?? throw new InvalidDataException("playlist has no stream URL");
    }

    private Process StartFfmpeg(string input)
    {
        var psi = new ProcessStartInfo(_ffmpeg) { RedirectStandardInput = input == "pipe:0", RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in new[] { "-nostdin", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1" }) psi.ArgumentList.Add(a);
        if (input == "pipe:0") psi.ArgumentList.Remove("-nostdin");
        var p = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg did not start");
        p.ErrorDataReceived += (_, _) => { };
        p.BeginErrorReadLine();
        return p;
    }

    private void DrainOutput(Process p)
    {
        var s = p.StandardOutput.BaseStream; var bytes = new byte[32768]; int have = 0; var floats = new float[bytes.Length / 4];
        while (!_cts.IsCancellationRequested)
        {
            int n = s.Read(bytes, have, bytes.Length - have);
            if (n <= 0) break;
            have += n; int whole = have / 8 * 8;
            if (whole > 0) { Buffer.BlockCopy(bytes, 0, floats, 0, whole); if (!_ring.Write(floats.AsSpan(0, whole / 4), _cts.Token)) break; Buffer.BlockCopy(bytes, whole, bytes, 0, have - whole); have -= whole; }
        }
    }

    private void RunDirect(string url)
    {
        using var p = StartFfmpeg(url);
        using var reg = _cts.Token.Register(() => { try { p.Kill(true); } catch { } });
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        var meta = Task.Run(() => PollHlsTitles(url, stop.Token));            // 0.7.0: HLS stations name the song in #EXTINF
        try { DrainOutput(p); } finally { stop.Cancel(); try { meta.Wait(2000); } catch { } }
        if (!_cts.IsCancellationRequested) throw new IOException("stream ended");
    }

    /// <summary>0.7.0: HLS now-playing. Re-reads the media playlist about once per target duration (5-15 s) and takes the newest segment's
    /// #EXTINF title (RFC 8216 4.3.2.1: "#EXTINF:&lt;duration&gt;,[&lt;title&gt;]"); a master playlist is followed to its first variant.
    /// ID3 timed metadata inside the segments is NOT read (ffmpeg decodes the audio only). Failures are silent: the audio is unaffected.</summary>
    private async Task PollHlsTitles(string url, CancellationToken ct)
    {
        string media = url; int waitMs = 10_000;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var text = await _http.GetStringAsync(media, ct);
                if (HlsMeta.Variant(text, media) is { } v && v != media) { media = v; continue; }
                waitMs = Math.Clamp((int)(HlsMeta.TargetDuration(text) * 1000), 5_000, 15_000);
                var title = HlsMeta.LastTitle(text);
                if (title != null && title != NowPlaying) { NowPlaying = title; Metadata?.Invoke(title); }
            }
            catch (OperationCanceledException) { return; }
            catch { waitMs = 15_000; }
            try { await Task.Delay(waitMs, ct); } catch (OperationCanceledException) { return; }
        }
    }

    private void RunIcy(string url)
    {
        using var conn = IcyConnection.Open(url, "WavWiz/" + Core.WavWizInfo.Version, _cts.Token);
        int metaint = conn.Headers.TryGetValue("icy-metaint", out var mi) && int.TryParse(mi, out var m) ? m : 0;
        if (conn.Headers.TryGetValue("icy-name", out var nm)) StationName = nm;
        var body = conn.Body;
        using var ff = StartFfmpeg("pipe:0");
        using var reg = _cts.Token.Register(() => { try { ff.Kill(true); } catch { } });
        var drain = new Thread(() => { try { DrainOutput(ff); } catch { } }) { IsBackground = true };
        drain.Start();
        var input = ff.StandardInput.BaseStream;
        var buf = new byte[16384]; int untilMeta = metaint;
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                int want = metaint > 0 ? Math.Min(buf.Length, untilMeta) : buf.Length;
                int n = body.Read(buf, 0, want);
                if (n <= 0) throw new IOException("stream ended");
                input.Write(buf, 0, n);
                if (metaint > 0)
                {
                    untilMeta -= n;
                    if (untilMeta == 0)
                    {
                        int len = body.ReadByte(); if (len < 0) throw new IOException("stream ended");
                        if (len > 0)
                        {
                            var meta = new byte[len * 16]; body.ReadExactly(meta);
                            var title = ParseStreamTitle(Encoding.UTF8.GetString(meta));
                            if (title != null && title != NowPlaying) { NowPlaying = title; Metadata?.Invoke(title); }
                        }
                        untilMeta = metaint;
                    }
                }
            }
        }
        finally { try { input.Close(); } catch { } try { if (!ff.HasExited) ff.Kill(true); } catch { } drain.Join(1000); }
    }

    public static string? ParseStreamTitle(string meta)
    {
        const string key = "StreamTitle='";
        int i = meta.IndexOf(key, StringComparison.Ordinal); if (i < 0) return null;
        i += key.Length; int j = meta.IndexOf("';", i, StringComparison.Ordinal);
        if (j < 0) j = meta.IndexOf('\'', i); if (j < 0) return null;
        var t = meta[i..j].Trim('\0', ' ');
        return t.Length == 0 ? null : t;
    }

    public void Dispose() { _cts.Cancel(); try { _t.Join(2000); } catch { } _cts.Dispose(); }
}

/// <summary>
/// Minimal HTTP/ICY client. .NET's HttpClient rejects the "ICY 200 OK" status line that Shoutcast v1 servers send, so streams are opened on a raw
/// socket (TLS via SslStream for https). HTTP/1.0 request, so no chunked encoding; follows up to 5 redirects.
/// </summary>
public sealed class IcyConnection : IDisposable
{
    private readonly System.Net.Sockets.TcpClient _tcp;
    public Stream Body { get; }
    public Dictionary<string, string> Headers { get; }
    public int Status { get; }
    private IcyConnection(System.Net.Sockets.TcpClient t, Stream body, Dictionary<string, string> h, int status) { _tcp = t; Body = body; Headers = h; Status = status; }
    public void Dispose() { try { Body.Dispose(); } catch { } try { _tcp.Dispose(); } catch { } }

    public static IcyConnection Open(string url, string userAgent, CancellationToken ct)
    {
        for (int hop = 0; hop < 6; hop++)
        {
            var uri = new Uri(url); bool tls = uri.Scheme == "https";
            if (uri.Scheme != "http" && !tls) throw new InvalidDataException("unsupported scheme " + uri.Scheme);
            var tcp = new System.Net.Sockets.TcpClient { NoDelay = true };
            try
            {
                using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct)) { cts.CancelAfter(10_000); tcp.ConnectAsync(uri.Host, uri.Port, cts.Token).AsTask().GetAwaiter().GetResult(); }
                Stream st = tcp.GetStream();
                if (tls) { var ssl = new System.Net.Security.SslStream(st); ssl.AuthenticateAsClient(uri.Host); st = ssl; }
                var req = $"GET {uri.PathAndQuery} HTTP/1.0\r\nHost: {uri.Authority}\r\nUser-Agent: {userAgent}\r\nIcy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n";
                var rb = Encoding.ASCII.GetBytes(req); st.Write(rb, 0, rb.Length); st.Flush();
                tcp.ReceiveTimeout = 30_000;
                var status = ReadLine(st) ?? throw new IOException("no response");
                var parts = status.Split(' ', 3);
                if (parts.Length < 2 || !(parts[0].StartsWith("HTTP/") || parts[0] == "ICY") || !int.TryParse(parts[1], out var code)) throw new InvalidDataException("bad status line: " + status);
                var h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                for (string? line; (line = ReadLine(st)) != null && line.Length > 0;) { var c = line.IndexOf(':'); if (c > 0) h[line[..c].Trim()] = line[(c + 1)..].Trim(); }
                if (code is 301 or 302 or 303 or 307 or 308 && h.TryGetValue("location", out var loc)) { tcp.Dispose(); url = new Uri(uri, loc).ToString(); continue; }
                if (code != 200) throw new IOException($"station answered {status}");
                // keep the 30 s receive timeout while streaming: a stalled station throws IOException and the decoder reconnects
                return new IcyConnection(tcp, st, h, code);
            }
            catch { tcp.Dispose(); throw; }
        }
        throw new IOException("too many redirects");
    }

    private static string? ReadLine(Stream s)
    {
        var sb = new StringBuilder();
        while (true)
        {
            int b = s.ReadByte(); if (b < 0) return sb.Length == 0 ? null : sb.ToString();
            if (b == '\n') return sb.ToString().TrimEnd('\r');
            if (sb.Length > 8192) throw new InvalidDataException("header line too long");
            sb.Append((char)b);
        }
    }
}

public static class PlaylistParser
{
    public static string? FirstUrl(string text)
    {
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith("File1=", StringComparison.OrdinalIgnoreCase)) return line[6..].Trim();
            if (line.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || line.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return line;
        }
        return null;
    }

    /// <summary>M3U/M3U8/PLS entries: (location, title). Relative paths are resolved against <paramref name="baseDir"/>.</summary>
    public static List<(string Location, string? Title)> Parse(string text, string? baseDir)
    {
        var res = new List<(string, string?)>(); string? pendingTitle = null;
        var pls = new Dictionary<string, (string? File, string? Title)>();
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim().TrimStart('\uFEFF'); if (line.Length == 0) continue;
            if (line.StartsWith("#EXTINF:", StringComparison.OrdinalIgnoreCase)) { var c = line.IndexOf(','); pendingTitle = c >= 0 ? line[(c + 1)..].Trim() : null; continue; }
            if (line.StartsWith('#') || line.StartsWith('[')) continue;
            var eq = line.IndexOf('=');
            if (eq > 0 && (line.StartsWith("File", StringComparison.OrdinalIgnoreCase) || line.StartsWith("Title", StringComparison.OrdinalIgnoreCase)))
            {
                var k = line[..eq]; var v = line[(eq + 1)..].Trim();
                var num = new string(k.Where(char.IsDigit).ToArray());
                pls.TryGetValue(num, out var cur);
                pls[num] = k.StartsWith("File", StringComparison.OrdinalIgnoreCase) ? (v, cur.Title) : (cur.File, v);
                continue;
            }
            if (eq > 0 && System.Text.RegularExpressions.Regex.IsMatch(line[..eq], "^[A-Za-z]+[0-9]*$")) continue;   // other PLS keys (Length1=, NumberOfEntries=, Version=)
            res.Add((Resolve(line, baseDir), pendingTitle)); pendingTitle = null;
        }
        foreach (var kv in pls.OrderBy(k => int.TryParse(k.Key, out var n) ? n : 0)) if (kv.Value.File != null) res.Add((Resolve(kv.Value.File, baseDir), kv.Value.Title));
        return res;
    }

    private static string Resolve(string loc, string? baseDir)
        => loc.Contains("://") || Path.IsPathRooted(loc) || baseDir == null ? loc : Path.GetFullPath(Path.Combine(baseDir, loc));
}

/// <summary>0.7.0: the bits of an HLS playlist the radio needs for now-playing (RFC 8216). Pure, unit-tested.</summary>
public static class HlsMeta
{
    /// <summary>A master playlist's first variant (absolute URL), or null for a media playlist.</summary>
    public static string? Variant(string text, string baseUrl)
    {
        var lines = text.Split('\n').Select(l => l.Trim()).ToList();
        for (int i = 0; i < lines.Count; i++)
            if (lines[i].StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal))
                for (int j = i + 1; j < lines.Count; j++) { if (lines[j].Length == 0 || lines[j].StartsWith('#')) continue; return Uri.TryCreate(new Uri(baseUrl), lines[j], out var u) ? u.ToString() : null; }
        return null;
    }
    public static double TargetDuration(string text)
    {
        foreach (var l in text.Split('\n')) { var t = l.Trim(); if (t.StartsWith("#EXT-X-TARGETDURATION:", StringComparison.Ordinal) && double.TryParse(t[22..], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d)) return d; }
        return 10;
    }
    /// <summary>The title of the newest segment ("#EXTINF:10.0,Artist - Title" or iHeart-style key="value" pairs), null when the station sends none.</summary>
    public static string? LastTitle(string text)
    {
        string? last = null;
        foreach (var l in text.Split('\n'))
        {
            var t = l.Trim(); if (!t.StartsWith("#EXTINF:", StringComparison.Ordinal)) continue;
            int c = t.IndexOf(','); var title = c < 0 ? "" : t[(c + 1)..].Trim();
            last = title.Length == 0 ? null : title;
        }
        return last;
    }
}

/// <summary>0.6.8-#8: what a station says is playing. Plain "Artist - Title" and iHeart-style key=value StreamTitles
/// (<c>Nirvana - text="Something In The Way" song_spot="M" amgArtworkURL="http://…" length="00:03:52"</c>) both become artist + title;
/// <see cref="ArtUrl"/> is the song picture when the station sends one (amgArtworkURL), else null (the station logo is used).</summary>
public sealed record RadioLive(string Display, string? Artist, string? Title, string? ArtUrl)
{
    private static readonly System.Text.RegularExpressions.Regex Kv = new(@"(\w+)=""([^""]*)""", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    public static RadioLive? Parse(string? raw)
    {
        raw = raw?.Trim(); if (string.IsNullOrEmpty(raw)) return null;
        var kv = Kv.Matches(raw);
        if (kv.Count > 0)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Text.RegularExpressions.Match m in kv) d.TryAdd(m.Groups[1].Value, m.Groups[2].Value.Trim());
            var lead = raw[..kv[0].Index].Trim();                       // "Nirvana -" / "Nirvana"
            if (lead.EndsWith('-')) lead = lead[..^1].TrimEnd();
            string? title = d.GetValueOrDefault("text") is { Length: > 0 } t ? t : d.GetValueOrDefault("title") is { Length: > 0 } t2 ? t2 : null;
            string? artist = d.GetValueOrDefault("artist") is { Length: > 0 } a ? a : lead.Length > 0 ? lead : null;
            if (title == null && artist != null) { var (pa, pt) = SplitPlain(artist); if (pt != null) { artist = pa; title = pt; } }
            var art = d.GetValueOrDefault("amgArtworkURL") is { Length: > 0 } u && Uri.TryCreate(u, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? u : null;
            if (title == null && artist == null) return null;
            return new(artist != null && title != null ? artist + " - " + title : (title ?? artist)!, artist, title, art);
        }
        var (ar, ti) = SplitPlain(raw);
        return new(raw, ti == null ? null : ar, ti ?? raw, null);
    }
    private static (string artist, string? title) SplitPlain(string s)
    {
        int i = s.IndexOf(" - ", StringComparison.Ordinal);
        return i > 0 && i < s.Length - 3 ? (s[..i].Trim(), s[(i + 3)..].Trim()) : (s, null);
    }
}
