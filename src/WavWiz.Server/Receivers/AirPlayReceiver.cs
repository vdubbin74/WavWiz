using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using WavWiz.Core.Discovery;
using WavWiz.Server.Api;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Receivers;

/// <summary>
/// 0.1.2: always-on AirPlay speaker "WavWiz – Everywhere". wavwiz-airplay.exe (shairplay, AirPlay 1 / RAOP) receives and decodes; the audio goes into a
/// <see cref="LiveFeed"/> that the house stream plays in every zone (so the visualizers react); title/artist/album/artwork come from the AirPlay metadata;
/// the phone's volume scales the stream, pause/skip on the phone flush it. WavWiz's own mDNS responder advertises "_raop._tcp" (no Bonjour needed).
/// </summary>
public sealed class AirPlayReceiver : IDisposable
{
    public const string Name = "WavWiz – Everywhere";
    /// <summary>0.4.0: the name this instance shows on phones ("WavWiz – Everywhere", or "WavWiz – Kitchen" for a zone's own receiver).</summary>
    public string DisplayName { get; set; } = Name;
    private readonly ZoneReceiverTarget? _zt; private Conductor? _regCond; private bool _rebinding;
    private string? _key => _zt?.Key;
    private Conductor Cond => _zt?.Cond() ?? _s.Conductor;
    private string ArtPath => "/api/v1/live/art/" + (_key ?? "airplay");
    /// <summary>Move the feed to the zone's CURRENT playback group (after link/split). A session that was open on the old group ends.</summary>
    public void Bind()
    {
        var c = Cond; if (ReferenceEquals(c, _regCond)) return;
        if (_regCond != null && _session && _zt != null && _s.Links is { Carrying: true } l && l.ZoneCasting(_zt.Id))
        { _regCond.EndLive("airplay", _key); _regCond.UnregisterFeed(_key ?? "airplay", Feed); c.RegisterFeed("airplay", Feed, _key); _regCond = c; c.BeginLive("airplay", Title ?? "AirPlay", Artist ?? "", "AirPlay", null, _key); return; }   // 0.4.9: Everywhere moved this casting zone - keep its cast
        if (_regCond != null) { _rebinding = true; try { EndSession(); } finally { _rebinding = false; } _regCond.UnregisterFeed(_key ?? "airplay", Feed); }
        c.RegisterFeed("airplay", Feed, _key); _regCond = c;
    }
    private readonly Services _s; private readonly ReceiverProcess _proc; private readonly Action<string>? _log; private readonly PcmAssembler _pcm = new(4);
    public readonly LiveFeed Feed = new() { TargetMs = 1800 };
    private int _rate = 44100; private volatile bool _session; private byte[]? _art; private string _artType = "image/jpeg"; private int _artVer;
    public string HwAddr { get; }
    public int Port { get; }
    public bool Ready { get; private set; }
    public bool InSession => _session;
    public string? LastSender { get; private set; }
    public DateTimeOffset? LastSessionAt { get; private set; }
    public string? Title { get; private set; }

    public AirPlayReceiver(Services s, Action<string>? log, ZoneReceiverTarget? zone = null)
    {
        _s = s; _log = log; _zt = zone; Port = zone?.Port ?? s.Cfg.AirPlayPort;
        if (zone != null) DisplayName = zone.Name;
        HwAddr = zone?.HwAddr ?? (s.Db.Setting("airplay.hwaddr") is string h && h.Length > 10 ? System.Text.Json.JsonSerializer.Deserialize<string>(h)! : NewHwAddr(s.Db));
        var dir = Path.Combine(AppContext.BaseDirectory, "receivers");
        _proc = new ReceiverProcess(_zt != null ? "airplay-" + _zt.Id : "airplay", Path.Combine(dir, OperatingSystem.IsWindows() ? "wavwiz-airplay.exe" : "wavwiz-airplay"),
            () => new[] { "--port", Port.ToString(), "--hwaddr", HwAddr, "--key", Path.Combine(dir, "airport.key") },
            (b, n) => _pcm.Push(b, n, f => Feed.WriteS16(f, _rate)), OnLine, log)
        { Exited = () => { Ready = false; EndSession(); } };
        Bind();
    }

    /// <summary>0.1.2: extra level 0…+6 dB applied AFTER the phone's AirPlay volume (setting airplay.levelDb).</summary>
    public double LevelDb
    {
        get
        {
            var j = _s.Db.Setting("airplay.levelDb");
            if (j != null && double.TryParse(j.Trim().Trim('"'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
                return Math.Clamp(Math.Round(d), 0, 6);
            return 0;
        }
    }
    private volatile float _phoneGain = 1f;
    private float LevelGain() => (float)Math.Pow(10, LevelDb / 20.0);
    private void SetGainFromPhone(float phoneGain) { _phoneGain = phoneGain; Feed.Gain = phoneGain * LevelGain(); }
    public void SetLevelDb(double db)
    {
        db = Math.Clamp(Math.Round(db), 0, 6);
        _s.Db.SetSetting("airplay.levelDb", db.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Feed.Gain = _phoneGain * LevelGain();
    }

    public bool Installed => _proc.Installed;
    public bool Running => _proc.Running;
    public string? LastError => _proc.LastError;
    public int Restarts => _proc.Restarts;
    public void Start() { if (_zt != null || _s.Cfg.AirPlay) { Bind(); _proc.Start(); } }
    public void Stop() { _proc.Stop(); Ready = false; EndSession(); }
    /// <summary>0.1.3 Diagnostics "Restart AirPlay": end any session, stop the receiver and start it again (the phone sees the speaker re-appear).</summary>
    public void Restart() { EndSession(); _proc.Stop(); Ready = false; Start(); }
    /// <summary>In a session but no audio for over a minute (the phone left without saying goodbye).</summary>
    public bool StaleSession => _session && (Feed.DataAgeMs ?? long.MaxValue) > 60_000 && (DateTimeOffset.Now - (LastSessionAt ?? DateTimeOffset.Now)).TotalSeconds > 60;
    public void EndStaleSession() { if (StaleSession) EndSession(); }

    private static string NewHwAddr(Db db)
    {
        var b = RandomNumberGenerator.GetBytes(6); b[0] = (byte)((b[0] & 0xFC) | 0x02);       // locally administered, unicast
        var hw = string.Join(":", b.Select(x => x.ToString("X2"))); db.SetSetting("airplay.hwaddr", System.Text.Json.JsonSerializer.Serialize(hw)); return hw;
    }

    /// <summary>mDNS records for "_raop._tcp.local" (AirPlay 1 audio). TXT keys as shairplay's own dnssd registration.</summary>
    public List<DnsWire.Record> MdnsRecords(string host, System.Net.IPAddress ip)
    {
        var svc = "_raop._tcp.local"; var inst = HwAddr.Replace(":", "") + "@" + DisplayName + "." + svc;
        return new()
        {
            DnsWire.Ptr(svc, inst), DnsWire.Srv(inst, host, Port),
            DnsWire.Txt(inst, new[] { "txtvers=1", "ch=2", "cn=0,1", "et=0,1", "sv=false", "da=true", "sr=44100", "ss=16", "pw=false", "vn=3", "tp=TCP,UDP", "md=0,1,2", "vs=130.14", "sm=false", "ek=1", "am=WavWiz" }),
            DnsWire.A(host, ip),
        };
    }

    public void OnLine(string line)
    {
        int sp = line.IndexOf(' '); var cmd = sp < 0 ? line : line[..sp]; var arg = sp < 0 ? "" : line[(sp + 1)..];
        switch (cmd)
        {
            case "READY": Ready = true; break;
            case "INIT":
                var p = arg.Split(' '); if (p.Length == 3 && int.TryParse(p[2], out var r) && r is > 7999 and < 200001) _rate = r;
                if (_zt != null && !_session) try { _s.Links?.ZoneCastBegin(_zt.Id); Bind(); } catch (Exception ex) { _log?.Invoke("airplay: zone cast: " + ex.Message); }   // leaves Everywhere, plays its own cast
                _session = true; LastSessionAt = DateTimeOffset.Now; Title = null; _art = null; Feed.Flush(); SetGainFromPhone(1f);
                // 0.4.9 fix: "Everywhere" (the house receiver) takes over every zone - the house group alone may have no speakers left (zones split / claimed)
                if (_zt == null) try { _s.Links?.EverywhereBegin(); } catch (Exception ex) { _log?.Invoke("airplay: link all zones failed: " + ex.Message); }
                Cond.BeginLive("airplay", "AirPlay", "", "AirPlay", null, _key);
                _log?.Invoke($"AirPlay: session on \"{DisplayName}\" (port {Port}) - playing in {(_zt == null ? "every zone" : "zone " + _zt.Id)}");
                WatchAudio(); Cast(); break;
            case "FLUSH": Feed.Flush(); break;
            case "STOP": EndSession(); break;
            case "VOL":
                if (double.TryParse(arg, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var db)) SetGainFromPhone(VolumeToGain(db)); break;
            case "META":
                try { var m = Dmap.Parse(Convert.FromBase64String(arg)); Title = m.GetValueOrDefault("minm"); Artist = m.GetValueOrDefault("asar"); ApplyMeta(m); Cast(); } catch { }
                break;
            case "ART":
                try
                {
                    var bytes = Convert.FromBase64String(arg); if (bytes.Length < 16) break;
                    _art = bytes; _artType = bytes[0] == 0x89 ? "image/png" : "image/jpeg"; var v = Interlocked.Increment(ref _artVer);
                    Cond.UpdateLive("airplay", q => q with { ArtUrl = $"{ArtPath}?v={v}" }, _key);
                }
                catch { }
                break;
            case "DACP": LastSender = arg.Split(' ')[0]; break;
            case "LOG": _log?.Invoke("airplay: " + (arg.Length > 300 ? arg[..300] : arg)); break;
        }
    }

    private void ApplyMeta(Dictionary<string, string> m)
    {
        string title = m.GetValueOrDefault("minm") ?? "AirPlay", artist = m.GetValueOrDefault("asar") ?? "", album = m.GetValueOrDefault("asal") ?? "", genre = m.GetValueOrDefault("asgn") ?? "";
        Cond.UpdateLive("airplay", q => q with { Title = title, Artist = artist, Album = album, Genre = genre.Length > 0 ? genre : null }, _key);
    }

    private void EndSession()
    {
        if (!_session) return;
        _session = false; _art = null; Title = null; Artist = null; Feed.Flush();
        (_regCond ?? Cond).EndLive("airplay", _key);
        if (_zt == null) try { _s.Links?.EverywhereEnd(); } catch { }
        else try { _s.Links?.ZoneCastEnd(_zt.Id, !_rebinding); } catch { }
        Cast();
    }
    /// <summary>0.4.9 F78: the Devices "Casting" bar follows the house receiver's session live.</summary>
    private void Cast() { if (_zt == null) try { _s.Events.Publish("zones"); } catch { } }
    public string? Artist { get; private set; }
    /// <summary>0.4.9 F78: Stop in the Casting bar - end the session (the zones get their own queues back) and drop the phone's connection.</summary>
    public void StopCast() { if (!_session) return; EndSession(); _proc.Stop(); Ready = false; Start(); }
    /// <summary>0.4.9: RTSP connected but no UDP audio = almost always the Windows Firewall blocking wavwiz-airplay.exe's random UDP ports.</summary>
    public int NoAudioAfterMs = 5000;
    private void WatchAudio()
    {
        var t0 = Environment.TickCount64; NoAudio = false;
        _ = Task.Delay(NoAudioAfterMs).ContinueWith(_ =>
        {
            if (!_session || LastSessionAt == null) return; var age = Feed.DataAgeMs;
            if (age == null || age > Environment.TickCount64 - t0) { NoAudio = true; _log?.Invoke($"AirPlay: connected but no audio packets on \"{DisplayName}\" after {NoAudioAfterMs / 1000} s, check firewall (wavwiz-airplay.exe needs inbound UDP on private networks)"); }
        });
    }
    public bool NoAudio { get; private set; }

    /// <summary>AirPlay volume: -144 = mute, else -30..0 dB.</summary>
    public static float VolumeToGain(double db) => db <= -143 ? 0f : (float)Math.Pow(10, Math.Clamp(db, -30, 0) / 20.0);

    public (byte[] Bytes, string Type)? Art => _art is { } a ? (a, _artType) : null;

    public void Dispose() => _proc.Dispose();
}

/// <summary>DMAP (DAAP) tagged metadata: 4-byte tag, 4-byte big-endian length, value; "mlit" is a container. Strings only.</summary>
public static class Dmap
{
    private static readonly HashSet<string> Containers = new() { "mlit", "mlcl", "cmst", "mdcl" };
    private static readonly HashSet<string> Strings = new() { "minm", "asar", "asal", "asgn", "ascp", "asaa" };
    public static Dictionary<string, string> Parse(ReadOnlySpan<byte> b)
    {
        var d = new Dictionary<string, string>(); Walk(b, d, 0); return d;
    }
    private static void Walk(ReadOnlySpan<byte> b, Dictionary<string, string> d, int depth)
    {
        int i = 0;
        while (i + 8 <= b.Length && depth < 4)
        {
            var tag = Encoding.ASCII.GetString(b.Slice(i, 4)); int len = (int)BinaryPrimitives.ReadUInt32BigEndian(b.Slice(i + 4, 4));
            if (len < 0 || i + 8 + len > b.Length) break;
            var v = b.Slice(i + 8, len);
            if (Containers.Contains(tag)) Walk(v, d, depth + 1);
            else if (Strings.Contains(tag)) d[tag] = Encoding.UTF8.GetString(v);
            i += 8 + len;
        }
    }
}

/// <summary>Re-assembles whole PCM frames from arbitrary pipe reads.</summary>
public sealed class PcmAssembler
{
    private readonly int _frameBytes; private byte[] _carry = new byte[16]; private int _n;
    public PcmAssembler(int frameBytes) { _frameBytes = frameBytes; }
    public void Push(byte[] buf, int len, Action<ReadOnlySpan<byte>> whole)
    {
        var all = new byte[_n + len]; Array.Copy(_carry, all, _n); Array.Copy(buf, 0, all, _n, len);
        int usable = all.Length / _frameBytes * _frameBytes;
        if (usable > 0) whole(all.AsSpan(0, usable));
        _n = all.Length - usable; Array.Copy(all, usable, _carry, 0, _n);
    }
}
