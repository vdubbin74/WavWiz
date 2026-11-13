using System.Net;
using System.Net.NetworkInformation;
using WavWiz.Core.Protocol;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;

namespace WavWiz.Server.AirPlay;

/// <summary>0.6.8-#14: pure helpers for the AirPlay Find / Test / Add setup - error classes, "is this WavWiz itself", the test chime and
/// the outgoing-metadata plan. No I/O except <see cref="LocalAddresses"/>.</summary>
public static class AirPlaySetup
{
    // ---------------- 14d: separate errors ----------------
    public const string Discovery = "discovery", Denied = "denied", Auth = "auth", Transport = "transport", Other = "other";
    public sealed record Problem(string Code, string Title, string Text, bool Retry);

    /// <summary>Sorts a connect failure into discovery / denied / pairing-auth / unsupported transport, with plain words and TV-side steps.
    /// Order matters: "own receiver" and unsupported routes first, then a refusal (403, HomeKit back-off/busy), then pairing/auth, then reachability.</summary>
    public static Problem Classify(string? message, string name)
    {
        var m = message ?? "";
        bool Has(string re) => System.Text.RegularExpressions.Regex.IsMatch(m, re, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (Has(@"own AirPlay receiver|audio loop"))
            return new(Transport, "This is WavWiz itself", $"{name} is this server's own AirPlay receiver. Sending WavWiz to itself would loop the audio, so it cannot be added.", false);
        if (Has(@"experimental"))
            return new(Transport, "AirPlay 2 is off", $"{name} is an AirPlay 2 speaker. Turn on AirPlay 2 speakers (experimental) in Settings > Network > AirPlay speakers, then try again.", false);
        if (Has(@"NTP timing|not supported|unsupported|route \S+|FairPlay|MFi|raop-mfi"))
            return new(Transport, "Not supported yet", $"{name} uses an AirPlay mode WavWiz cannot send to yet ({Short(m)}).", false);
        if (Has(@"\b403\b|forbidden|denied|not allowed|error (3|6|7)\b|back ?off|busy"))
            return new(Denied, "The device said no", $"{name} refused the connection. On a TV, a prompt may ask to allow \"WavWiz\" - choose Allow. If its AirPlay setting \"Allow access\" / \"Require device approval\" is set to Only me, Only people sharing this home or Require code, set it to Everyone on the same network (you can switch it back after), then press Retry.", true);
        if (Has(@"\b401\b|\b470\b|unauthori[sz]ed|authori[sz]ation|pair-setup|pair-verify|proof mismatch|password|\bPIN\b|wrong code"))
            return new(Auth, "Needs pairing WavWiz can't do yet", $"{name} asked for a password, an on-screen code or a pairing that WavWiz does not support yet. If it is a TV, turn off \"Require code\" / passwords in its AirPlay settings and press Retry. HomePod and Apple TV are not supported yet.", true);
        if (Has(@"not found|search again|no address|refused|timed? ?out|timeout|unreachable|no route|no such host|network is|connection (reset|closed)|actively|host"))
            return new(Discovery, "Couldn't reach it", $"Couldn't find or reach {name}. Is it switched on and on the same network as this PC (VPN off)? Press Search again. If it keeps failing, check the AirPlay firewall rules (Settings > Network > AirPlay speakers).", true);
        return new(Other, "Couldn't add it", m.Length is > 0 and <= 120 ? m : $"Couldn't connect to {name}.", true);
    }
    static string Short(string m) { m = m.Trim(); return m.Length <= 80 ? m : m[..80] + "…"; }

    /// <summary>0.7.0 t1930: AirPlay 2 needs a completed PTP handshake. Metadata travels over TCP, so a TV can show the
    /// song title even when inbound UDP 319/320 (Delay_Req) is blocked and audio/progress never start. Null when the
    /// clock looks healthy (followers have called back, or we have not sent Syncs yet).</summary>
    public static string? PtpNoFollowersHint(long syncsSent, long delayReqs)
    {
        if (syncsSent <= 0 || delayReqs > 0) return null;
        return "The speaker has not answered the timing clock (PTP). The song title can still show, but there is no audio and the progress bar stays at 0. On Windows, allow AirPlay speakers through the firewall (Settings > Network > AirPlay speakers): UDP ports 319 and 320, home network only. Then stop and start the song, or remove and add the speaker again.";
    }

    // ---------------- 14f: WavWiz's own receiver ----------------
    /// <summary>TXT key this server puts on its own _raop advertisement so Find can recognise it without relying on the A record.</summary>
    public const string SelfTxtKey = "wwid";

    /// <summary>True for this server's own AirPlay receiver. Prefers the wwid TXT marker (unique per server). Name + a local address/host/RAOP port
    /// is the fallback for advertisements that predate the marker. Another WavWiz on the LAN (different wwid / address) is not self.</summary>
    public static bool IsSelf(string? name, IEnumerable<string>? addresses, string? host, IReadOnlyCollection<string> local,
        string? wwid = null, string? serverId = null, int raopPort = 0, IEnumerable<int>? ownPorts = null)
    {
        if (!string.IsNullOrEmpty(wwid) && !string.IsNullOrEmpty(serverId))
            return string.Equals(wwid, serverId, StringComparison.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(name) || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^WavWiz\s*[–-]")) return false;
        var mine = new HashSet<string>(local, StringComparer.OrdinalIgnoreCase);
        if ((addresses ?? Array.Empty<string>()).Any(a => UsableAddress(a) && mine.Contains(a))) return true;
        var h = (host ?? "").TrimEnd('.');
        if (h.Length > 0)
        {
            if (IPAddress.TryParse(h, out _)) { if (UsableAddress(h) && mine.Contains(h)) return true; }
            else if (mine.Contains(h) || mine.Contains(h.Split('.')[0])) return true;
        }
        return raopPort > 0 && ownPorts != null && ownPorts.Contains(raopPort);
    }
    /// <summary>Address shown in Find: a resolved unicast IPv4/IPv6, never 0.0.0.0 or a bind wildcard.</summary>
    public static string? DisplayAddress(IEnumerable<string>? addresses, string? host)
    {
        foreach (var a in addresses ?? Array.Empty<string>()) if (UsableAddress(a)) return a;
        return UsableAddress(host) ? host!.TrimEnd('.') : null;
    }
    static bool UsableAddress(string? a)
    {
        if (string.IsNullOrWhiteSpace(a) || !IPAddress.TryParse(a.TrimEnd('.'), out var ip)) return false;
        return !ip.Equals(IPAddress.Any) && !ip.Equals(IPAddress.IPv6Any) && !IPAddress.IsLoopback(ip);
    }
    /// <summary>This PC's addresses and host name (for <see cref="IsSelf"/>).</summary>
    public static IReadOnlyCollection<string> LocalAddresses()
    {
        var l = new List<string> { "127.0.0.1", "::1", Environment.MachineName, Environment.MachineName + ".local" };
        try { foreach (var n in NetworkInterface.GetAllNetworkInterfaces()) foreach (var a in n.GetIPProperties().UnicastAddresses) l.Add(a.Address.ToString()); } catch { }
        return l;
    }

    // ---------------- 14b: test chime ----------------
    /// <summary>A short two-note chime (about 1.1 s, -18 dBFS peak) as house-stream messages in its own epoch, starting at <paramref name="startUs"/>.
    /// Ends with STOP_AT so the speaker goes quiet; the next real epoch flushes it.</summary>
    public static List<byte[]> Chime(long startUs, uint epoch)
    {
        var msgs = new List<byte[]>(); uint seq = 1;
        msgs.Add(Wire.EncodeEpoch(seq++, epoch, startUs));
        const int rate = Wire.SampleRate, per = rate / 50; double amp = Math.Pow(10, -18 / 20.0);
        int frames = 56; var buf = new float[per * 2];
        for (int f = 0; f < frames; f++)
        {
            for (int i = 0; i < per; i++)
            {
                double t = (f * per + i) / (double)rate; double hz = t < 0.45 ? 880 : 1318.5; double tt = t < 0.45 ? t : t - 0.45;
                double env = Math.Min(1, tt / 0.01) * Math.Exp(-tt * 4.0) * (t < 1.1 ? 1 : 0);
                float v = (float)(amp * env * Math.Sin(2 * Math.PI * hz * tt)); buf[i * 2] = v; buf[i * 2 + 1] = v;
            }
            msgs.Add(Wire.EncodeAudio(seq++, startUs + f * 20_000L, epoch, buf));
        }
        msgs.Add(Wire.EncodeStopAt(seq, epoch, startUs + frames * 20_000L));
        return msgs;
    }

    // ---------------- 14e: outgoing metadata plan ----------------
    public sealed record MetaState(string Key, string State, long PositionMs, long DurationMs, long AtMs);
    [Flags] public enum MetaSend { None = 0, Text = 1, Art = 2, Progress = 4 }
    /// <summary>What to send now: text + artwork on start or track change, progress on start / change / play-pause / a seek (position off the
    /// expected one by more than 2.5 s). Nothing while stopped.</summary>
    public static MetaSend Plan(MetaState? prev, MetaState? cur)
    {
        if (cur == null || cur.State is not ("playing" or "paused") || cur.Key.Length == 0) return MetaSend.None;
        if (prev == null || prev.Key != cur.Key || prev.State is not ("playing" or "paused")) return MetaSend.Text | MetaSend.Art | MetaSend.Progress;
        if (prev.State != cur.State) return MetaSend.Progress;
        long expect = prev.PositionMs + (prev.State == "playing" ? cur.AtMs - prev.AtMs : 0);
        return Math.Abs(cur.PositionMs - expect) > 2500 ? MetaSend.Progress : MetaSend.None;
    }
    public static string ItemKey(NowPlaying n) => n.Item == null ? "" : n.Item.Kind == "radio" ? $"radio:{n.Item.RefId}:{n.LiveTitle}" : $"{n.Item.Kind}:{n.Item.Id}:{n.Item.RefId}:{n.Item.Location}";
    /// <summary>Title / artist / album for the speaker's screen (radio: the live song, else the station).</summary>
    public static (string? Title, string? Artist, string? Album) Text(NowPlaying n)
    {
        var it = n.Item; if (it == null) return (null, null, null);
        if (it.Kind == "radio") return (n.LiveSong ?? n.LiveTitle ?? it.Title, n.LiveArtist ?? it.Title, it.Title);
        return (it.Title, it.Artist, it.Album);
    }
    /// <summary>"progress: start/current/end" in 44.1 kHz RTP frames from the speaker's "now" RTP time.</summary>
    public static (uint Start, uint Cur, uint End) Progress(uint rtpNow, long posMs, long durMs)
    {
        uint start = (uint)(rtpNow - (uint)(Math.Max(0, posMs) * 44.1)); uint end = durMs > 0 ? (uint)(start + (uint)(durMs * 44.1)) : rtpNow;
        return (start, rtpNow, end);
    }
}
