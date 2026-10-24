using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using WavWiz.Core.Discovery;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Receivers;

/// <summary>
/// 0.1.1: optional Spotify Connect device "WavWiz – Everywhere" (OFF by default; Settings > Network, admin). librespot.exe (MIT) runs as a separate
/// process with the pipe backend: it appears in the Spotify app on this network (zeroconf), the person who picks it signs in with their own Spotify
/// Premium on their phone, and the decoded audio comes here and plays in every zone. WavWiz holds no Spotify account or credentials
/// (--disable-credential-cache). Track title/artist/artwork arrive through librespot's --onevent hook (wavwiz-hook.exe, a one-datagram forwarder).
/// </summary>
public sealed class SpotifyReceiver : IDisposable
{
    public const string Name = "WavWiz – Everywhere";
    /// <summary>0.4.0: the name this instance shows in the Spotify app (a zone's own receiver is "WavWiz – Kitchen").</summary>
    public string DisplayName { get; private set; } = Name;
    private readonly ZoneReceiverTarget? _zt; private Conductor? _regCond; private bool _rebinding;
    private string? _key => _zt?.Key;
    private Conductor Cond => _zt?.Cond() ?? _s.Conductor;
    private string ArtPath => "/api/v1/live/art/" + (_key ?? "spotify");
    public void Bind()
    {
        var c = Cond; if (ReferenceEquals(c, _regCond)) return;
        if (_regCond != null && _live && _zt != null && _s.Links is { Carrying: true } l && l.ZoneCasting(_zt.Id))
        { _regCond.EndLive("spotify", _key); _regCond.UnregisterFeed(_key ?? "spotify", Feed); c.RegisterFeed("spotify", Feed, _key); _regCond = c; { var m = _meta ?? ("Spotify", "", ""); c.BeginLive("spotify", m.Title, m.Artist, m.Album, null, _key); } return; }   // 0.4.9: Everywhere moved this casting zone - keep its cast
        if (_regCond != null) { _rebinding = true; try { End(); } finally { _rebinding = false; } _regCond.UnregisterFeed(_key ?? "spotify", Feed); }
        c.RegisterFeed("spotify", Feed, _key); _regCond = c;
    }
    /// <summary>The zone was renamed: librespot takes the name on its command line, so a running receiver restarts with the new one.</summary>
    /// <summary>0.4.9 F78: the Devices "Casting" bar.</summary>
    public bool InSession => _live;
    public (string Title, string Artist, string Album)? Meta => _meta;
    public void StopCast() { if (!_live) return; End(); if (Running) { _proc.Stop(); _proc.Start(); } }
    public void Rename(string name) { if (name == DisplayName) return; DisplayName = name; if (Running) { End(); _proc.Stop(); _proc.Start(); } }
    private readonly Services _s; private readonly ReceiverProcess _proc; private readonly PcmAssembler _pcm = new(4); private readonly Action<string>? _log;
    public readonly LiveFeed Feed = new() { TargetMs = 1000 };
    private readonly string _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)); private UdpClient? _hookSock; private string? _hookExe;
    private volatile bool _live; private byte[]? _art; private string _artType = "image/jpeg"; private int _artVer; private string? _artSrc;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private (string Title, string Artist, string Album)? _meta;
    public int Port { get; }
    public bool ZeroconfFallback { get; private set; }
    public bool SessionActive => _live;
    public string? User { get; private set; }
    public string? Title => _meta?.Title;

    public SpotifyReceiver(Services s, Action<string>? log, ZoneReceiverTarget? zone = null)
    {
        _s = s; _log = log; _zt = zone; Port = zone?.Port ?? s.Cfg.SpotifyPort; if (zone != null) DisplayName = zone.Name;
        var dir = Path.Combine(AppContext.BaseDirectory, "receivers");
        _proc = new ReceiverProcess(_zt != null ? "spotify-" + _zt.Id : "spotify", Path.Combine(dir, OperatingSystem.IsWindows() ? "librespot.exe" : "librespot"), Args,
            (b, n) => _pcm.Push(b, n, f => { Feed.WriteS16(f, 44100); if (!_live) Begin(); }), OnLine, log)
        { Exited = () => End() };
        Bind();
        ApplyLevelGain();
    }

    /// <summary>0.1.2: extra level 0…+6 dB on the Spotify Connect LiveFeed (setting spotify.levelDb).</summary>
    public double LevelDb
    {
        get
        {
            var j = _s.Db.Setting("spotify.levelDb");
            if (j != null && double.TryParse(j.Trim().Trim('"'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
                return Math.Clamp(Math.Round(d), 0, 6);
            return 0;
        }
    }
    private float LevelGain() => (float)Math.Pow(10, LevelDb / 20.0);
    public void ApplyLevelGain() => Feed.Gain = LevelGain();
    public void SetLevelDb(double db)
    {
        db = Math.Clamp(Math.Round(db), 0, 6);
        _s.Db.SetSetting("spotify.levelDb", db.ToString(System.Globalization.CultureInfo.InvariantCulture));
        ApplyLevelGain();
    }

    public bool Enabled => _zt != null ? _zt.Enabled() : _s.Db.Setting("spotify.enabled") == "true";
    public bool Installed => _proc.Installed;
    public bool Running => _proc.Running;
    public string? LastError => _proc.LastError;
    public int Restarts => _proc.Restarts;

    /// <summary>Start or stop to match the admin setting.</summary>
    public void Apply()
    {
        if (Enabled) { Bind(); EnsureHook(); _proc.Start(); }
        else { _proc.Stop(); End(); ZeroconfFallback = false; }
    }

    private IEnumerable<string> Args()
    {
        var a = new List<string> { "--name", DisplayName, "--backend", "pipe", "--format", "S16", "--bitrate", "320", "--device-type", "speaker", "--initial-volume", "100",
            "--zeroconf-port", Port.ToString(), "--disable-audio-cache", "--disable-credential-cache" };
        if (IPAddress.TryParse(_s.Cfg.BindAddress, out var ip) && !IPAddress.IsLoopback(ip) && !ip.Equals(IPAddress.Any)) { a.Add("--zeroconf-interface"); a.Add(ip.ToString()); }
        if (_hookExe != null && _hookSock != null) { a.Add("--onevent"); a.Add($"{_hookExe} {((IPEndPoint)_hookSock.Client.LocalEndPoint!).Port} {_token}"); }
        return a;
    }

    /// <summary>librespot splits --onevent on spaces, so the hook runs from the data folder (C:\ProgramData\WavWiz\receivers), not Program Files.</summary>
    private void EnsureHook()
    {
        try
        {
            if (_hookSock == null) { _hookSock = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)); _ = Task.Run(HookLoop); }
            var src = Path.Combine(AppContext.BaseDirectory, "receivers", "wavwiz-hook.exe"); if (!File.Exists(src)) return;
            var dstDir = Path.Combine(_s.Cfg.DataDir, "receivers"); var dst = Path.Combine(dstDir, "wavwiz-hook.exe");
            if (dst.Contains(' ')) { _log?.Invoke("spotify: data folder path has a space; track titles from Spotify are unavailable"); return; }
            Directory.CreateDirectory(dstDir);
            if (!File.Exists(dst) || new FileInfo(dst).Length != new FileInfo(src).Length) File.Copy(src, dst, true);
            _hookExe = dst;
        }
        catch (Exception e) { _log?.Invoke("spotify hook: " + e.Message); }
    }

    private async Task HookLoop()
    {
        while (_hookSock != null)
        {
            try
            {
                var r = await _hookSock.ReceiveAsync();
                if (!IPAddress.IsLoopback(r.RemoteEndPoint.Address)) continue;
                var ev = ParseEvent(Encoding.UTF8.GetString(r.Buffer), _token); if (ev != null) OnEvent(ev);
            }
            catch (ObjectDisposedException) { break; }
            catch (Exception e) { _log?.Invoke("spotify event: " + e.Message); }
        }
    }

    /// <summary>"WAVWIZ &lt;token&gt;" then KEY=VALUE lines; null if the token is wrong. Public for tests.</summary>
    public static Dictionary<string, string>? ParseEvent(string text, string token)
    {
        var lines = text.Split('\n'); if (lines.Length == 0 || lines[0].Trim() != "WAVWIZ " + token) return null;
        var d = new Dictionary<string, string>();
        foreach (var l in lines.Skip(1)) { int eq = l.IndexOf('='); if (eq > 0) d[l[..eq]] = l[(eq + 1)..]; }
        return d;
    }

    public void OnEvent(Dictionary<string, string> e)
    {
        switch (e.GetValueOrDefault("PLAYER_EVENT"))
        {
            case "track_changed":
                var title = e.GetValueOrDefault("NAME") ?? "Spotify"; var artist = (e.GetValueOrDefault("ARTISTS") ?? e.GetValueOrDefault("SHOW_NAME") ?? "").Replace("\t", ", "); var album = e.GetValueOrDefault("ALBUM") ?? "";
                _meta = (title, artist, album);
                Cond.UpdateLive("spotify", q => q with { Title = title, Artist = artist, Album = album }, _key);
                var cover = (e.GetValueOrDefault("COVERS") ?? "").Split('\t', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                if (cover != null && cover != _artSrc && cover.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) { _artSrc = cover; _ = FetchArt(cover); }
                break;
            case "playing": case "started": if (!_live) Begin(); break;
            case "session_connected": User = e.GetValueOrDefault("USER_NAME"); break;
            case "session_disconnected": case "stopped": End(); User = e.GetValueOrDefault("PLAYER_EVENT") == "stopped" ? User : null; break;
        }
    }

    private async Task FetchArt(string url)
    {
        try
        {
            var bytes = await Http.GetByteArrayAsync(url); if (bytes.Length < 16 || bytes.Length > 4_000_000 || url != _artSrc) return;
            _art = bytes; _artType = bytes[0] == 0x89 ? "image/png" : "image/jpeg"; var v = Interlocked.Increment(ref _artVer);
            Cond.UpdateLive("spotify", q => q with { ArtUrl = $"{ArtPath}?v={v}" }, _key);
        }
        catch (Exception ex) { _log?.Invoke("spotify art: " + ex.Message); }
    }

    private void Begin()
    {
        if (_zt != null && !_live) try { _s.Links?.ZoneCastBegin(_zt.Id); Bind(); } catch (Exception ex) { _log?.Invoke("spotify: zone cast: " + ex.Message); }   // 0.4.9: see AirPlayReceiver
        _live = true; Feed.Flush(); ApplyLevelGain();
        if (_zt == null) try { _s.Events.Publish("zones"); } catch { }
        if (_zt == null) try { _s.Links?.EverywhereBegin(); } catch (Exception ex) { _log?.Invoke("spotify: link all zones failed: " + ex.Message); }   // 0.4.9: see AirPlayReceiver
        var m = _meta ?? ("Spotify", "", "");
        Cond.BeginLive("spotify", m.Title, m.Artist, m.Album, _art != null ? $"{ArtPath}?v={_artVer}" : null, _key);
    }

    private void End()
    {
        if (!_live) return;
        _live = false; Feed.Flush(); (_regCond ?? Cond).EndLive("spotify", _key);
        if (_zt == null) try { _s.Links?.EverywhereEnd(); } catch { }
        else try { _s.Links?.ZoneCastEnd(_zt.Id, !_rebinding); } catch { }
        if (_zt == null) try { _s.Events.Publish("zones"); } catch { }
    }

    public void OnLine(string line)
    {
        if (line.Contains("libmdns error", StringComparison.OrdinalIgnoreCase) || line.Contains("dns_sd error", StringComparison.OrdinalIgnoreCase))
        { if (!ZeroconfFallback) { ZeroconfFallback = true; _log?.Invoke("spotify: librespot mDNS failed; WavWiz advertises the device instead"); _s.Discovery?.AnnounceSoon(); } }
        else if (line.Contains(" ERROR ", StringComparison.Ordinal) || line.Contains(" WARN ", StringComparison.Ordinal)) _log?.Invoke("librespot: " + (line.Length > 300 ? line[..300] : line));
    }

    /// <summary>Spotify Connect zeroconf records when librespot's own responder could not start (same name, port and TXT as librespot's).</summary>
    public List<DnsWire.Record>? MdnsRecords(string host, IPAddress ip)
    {
        if (!ZeroconfFallback || !Running) return null;
        var svc = "_spotify-connect._tcp.local"; var inst = DisplayName + "." + svc;
        return new() { DnsWire.Ptr(svc, inst), DnsWire.Srv(inst, host, Port), DnsWire.Txt(inst, new[] { "VERSION=1.0", "CPath=/" }), DnsWire.A(host, ip) };
    }

    public (byte[] Bytes, string Type)? Art => _art is { } a ? (a, _artType) : null;

    public void Dispose() { _proc.Dispose(); try { _hookSock?.Dispose(); } catch { } _hookSock = null; }
}
