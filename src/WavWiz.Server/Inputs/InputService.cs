using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Core.Protocol;
using WavWiz.Server.Media;
using WavWiz.Server.Net;
using WavWiz.Server.Playback;

namespace WavWiz.Server.Inputs;

/// <summary>0.7.2: what the user set for one input (setting <c>inputs.config</c>, keyed by the input's short id). Defaults: off, 0 dB, no Turntable mode;
/// a microphone is never a live source until an administrator turns that on.</summary>
public sealed record InputCfg
{
    public string PlayerId { get; init; } = ""; public string EndpointId { get; init; } = ""; public string Kind { get; init; } = "aux"; public string DeviceName { get; init; } = "";
    public string? Name { get; init; }
    public bool Enabled { get; init; }
    public double GainDb { get; init; }
    /// <summary>Aux in only: the record-player path (vinyl icon, needle-drop auto-start, end-of-side auto-stop, phono-level warning).</summary>
    public bool Turntable { get; init; }
    /// <summary>null = the default for the mode (on in Turntable mode, off otherwise).</summary>
    public bool? AutoStart { get; init; }
    /// <summary>Microphones only: may be played like a source (Admin). Off = Announce only, shown "Muted".</summary>
    public bool LiveSource { get; init; }
    /// <summary>Where it played last ("g:&lt;zone id&gt;", "everywhere" or null = the house group): where a needle drop starts it.</summary>
    public string? LastZone { get; init; }
}

/// <summary>
/// 0.7.2 M1: audio inputs of the WavWiz Player on the server PC (Aux in with optional Turntable mode, S/PDIF in, microphones / headset mics, and
/// "what this PC is playing"). The Player captures (the Windows Service never opens a sound card) and sends PCM up the audio link; each input has its
/// own <see cref="LiveFeed"/> (resample + clock-drift trim + gain + the shared live limiter). Playing an input works like AirPlay: the zone's queue is
/// set aside, the input plays live, and Stop puts the previous queue back paused (Conductor.EndLive). Capture runs only while it is needed: playing,
/// a Turntable waiting for the needle, or Settings showing meters (never a microphone, which only opens to play it as an enabled live source).
/// </summary>
public sealed class InputService : IDisposable
{
    public const string ConfigKey = "inputs.config";
    public const string Everywhere = "everywhere";
    public const double MinGainDb = -12, MaxGainDb = 6;
    /// <summary>Approved input buffer for Synced mode (with the 600 ms house lead the sound is about 1.4 s behind the source).</summary>
    public const int TargetMs = 800;
    public static readonly TimeSpan MeterLease = TimeSpan.FromSeconds(30);
    public const int RetryAfterErrorMs = 30_000;
    public const string NoPlayerNote = "Open WavWiz Player on the server PC to use its Aux in, S/PDIF in, microphones and this PC's sound.";

    private readonly Services _s; private readonly object _l = new(); private readonly Timer _tick;
    private readonly Dictionary<string, Live> _live = new();     // by short id: inputs on a connected server-PC player
    private DateTime _meterUntil = DateTime.MinValue;
    /// <summary>Tests: which player sessions count as "the server PC". Default: a Windows Player on this machine (loopback address or same machine name).</summary>
    public Func<PlayerSession, bool> IsServerPc { get; set; } = DefaultIsServerPc;
    /// <summary>Tests: the detector used for new inputs (shorter holds).</summary>
    public Func<InputSignalDetector> NewDetector { get; set; } = () => new InputSignalDetector();
    /// <summary>Tests: the clock in milliseconds.</summary>
    public Func<long> NowMs { get; set; } = () => Environment.TickCount64;

    private sealed class Live
    {
        public required string Id; public required PlayerSession Sess; public required InputInfo Info;
        public readonly LiveFeed Feed = new() { TargetMs = InputService.TargetMs };
        public InputSignalDetector Detector = new();
        public bool Capturing; public long ErrorAtMs = long.MinValue / 2; public double PeakDb = -120; public long LastLevelPubMs; public string? Error;
        public bool GotAudio; public bool Privacy;   // 0.7.2 t2170u: audio arrived since the last start; Windows' mic privacy refused it (no auto-retry)
        public Conductor? Cond; public string? Zone; public bool LinkedEverywhere; public bool AutoStarted;
        public string Key => "input:" + Id;
    }

    public InputService(Services s)
    {
        _s = s;
        s.Audio.OnInputsListed = OnListed; s.Audio.OnInputAudio = OnAudio; s.Audio.OnInputsGone = OnGone;
        _tick = new Timer(_ => { try { Tick(); } catch (Exception e) { _s.Log?.Invoke("inputs: " + e.Message); } }, null, 1000, 1000);
    }

    public static bool DefaultIsServerPc(PlayerSession p) => !p.IsWeb && (System.Net.IPAddress.IsLoopback(p.Remote) || string.Equals(p.Hello.MachineName, Environment.MachineName, StringComparison.OrdinalIgnoreCase));

    /// <summary>Stable short id for an input: the same Player + endpoint always gives the same id (URLs, settings, the feed key "input:&lt;id&gt;").</summary>
    public static string ShortId(string playerId, string endpointId) => "i" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(playerId + "\n" + endpointId)))[..10].ToLowerInvariant();

    public static string KindLabel(string kind) => kind switch { "aux" => "Aux in", "spdif" => "S/PDIF in", "mic" => "Microphone", "loopback" => "Speakers (what you hear)", _ => "Input" };
    public static string DefaultName(InputInfo i) => i.Kind switch { "aux" => "Aux in", "spdif" => "S/PDIF in", "loopback" => "This PC · Speakers", _ => string.IsNullOrWhiteSpace(i.Name) ? "Microphone" : i.Name };
    /// <summary>The effective auto-start switch: as set, else on in Turntable mode (Aux in only) and off for everything else. Never on for mics or loopback.</summary>
    public static bool AutoStartOn(InputCfg c) => c.Kind == "aux" && c.Turntable && (c.AutoStart ?? true);
    public static float GainOf(double db) => (float)Math.Pow(10, Math.Clamp(double.IsFinite(db) ? db : 0, MinGainDb, MaxGainDb) / 20.0);

    // ---------------- config ----------------
    private Dictionary<string, InputCfg> LoadCfg()
    {
        try { var raw = _s.Db.Setting(ConfigKey); return string.IsNullOrWhiteSpace(raw) ? new() : JsonSerializer.Deserialize<Dictionary<string, InputCfg>>(raw, EventHub.Json) ?? new(); }
        catch { return new(); }
    }
    private void SaveCfg(Dictionary<string, InputCfg> c) => _s.Db.SetSetting(ConfigKey, JsonSerializer.Serialize(c, EventHub.Json));
    private InputCfg CfgOf(Dictionary<string, InputCfg> all, Live l) => all.TryGetValue(l.Id, out var c) ? c with { Kind = l.Info.Kind, DeviceName = l.Info.Name } : new InputCfg { PlayerId = l.Sess.Id, EndpointId = l.Info.Id, Kind = l.Info.Kind, DeviceName = l.Info.Name };

    // ---------------- player events ----------------
    private void OnListed(PlayerSession sess, string? reason)
    {
        if (!IsServerPc(sess) || !sess.SpeaksInputs) return;
        if (reason != null && reason.StartsWith("input-error:", StringComparison.Ordinal)) OnPlayerError(sess, reason);
        lock (_l)
        {
            var now = sess.Inputs.Where(i => i.Kind is "aux" or "spdif" or "mic" or "loopback" && i.Id.Length is > 0 and <= Wire.MaxInputIdLength).ToList();
            var ids = now.Select(i => ShortId(sess.Id, i.Id)).ToHashSet();
            foreach (var gone in _live.Values.Where(l => l.Sess.Id == sess.Id && !ids.Contains(l.Id)).ToList()) { StopNoLock(gone, "unplugged"); _live.Remove(gone.Id); }
            foreach (var i in now)
            {
                var id = ShortId(sess.Id, i.Id);
                if (_live.TryGetValue(id, out var l)) { l.Info = i; l.Sess = sess; continue; }
                _live[id] = new Live { Id = id, Sess = sess, Info = i, Detector = NewDetector() };
            }
            ApplyGainsNoLock(); ReconcileNoLock();
        }
        _s.Events.Publish("inputs");
    }

    /// <summary>The Player said it could not open (or lost) an input.</summary>
    public void OnPlayerError(PlayerSession sess, string reason)
    {
        if (!reason.StartsWith("input-error:", StringComparison.Ordinal)) return;
        var rest = reason["input-error:".Length..]; int c = rest.IndexOf('\n'); if (c <= 0) return;   // "input-error:<id>\n<why>" (InputResponder.ErrorReason)
        var ep = rest[..c]; var why = rest[(c + 1)..];
        bool stopped = false;
        lock (_l)
        {
            var l = _live.Values.FirstOrDefault(x => x.Sess.Id == sess.Id && x.Info.Id == ep); if (l == null) return;
            l.Privacy = why.StartsWith(WavWiz.PlayerCore.InputRules.PrivacyTag, StringComparison.Ordinal);
            l.Error = l.Privacy ? why[WavWiz.PlayerCore.InputRules.PrivacyTag.Length..] : why; l.ErrorAtMs = NowMs(); l.Capturing = false;
            // 0.7.2 t2170u: it never delivered (could not open): stop like Stop, so the zone gets its queue back instead of "Playing" silence; the error stays.
            // A mid-stream loss (unplugged, driver reset) keeps playing and retries as before.
            if (l.Cond != null && !l.GotAudio) { StopNoLock(l, "could not open: " + l.Error); stopped = true; }
        }
        _s.Events.Publish("inputs"); if (stopped) _s.Events.Publish("zones");
    }

    private void OnGone(PlayerSession sess)
    {
        bool any;
        lock (_l)
        {
            var mine = _live.Values.Where(l => ReferenceEquals(l.Sess, sess)).ToList(); any = mine.Count > 0;
            foreach (var l in mine) { StopNoLock(l, "player closed"); _live.Remove(l.Id); }
        }
        if (any) _s.Events.Publish("inputs");
    }

    private void OnAudio(PlayerSession sess, string endpointId, int rate, int ch, float[] pcm)
    {
        Live? l; bool started = false, ended = false, publish = false; double db; bool phono;
        lock (_l)
        {
            l = _live.Values.FirstOrDefault(x => ReferenceEquals(x.Sess, sess) && x.Info.Id == endpointId);
            if (l == null || !l.Capturing) return;
            l.Error = null; l.Privacy = false; l.GotAudio = true;        // it is delivering: any earlier open error is over
            float g = l.Feed.Gain; float peak = 0;
            foreach (var v in pcm) { var a = Math.Abs(v); if (a > peak) peak = a; }
            l.PeakDb = db = peak > 0 ? 20 * Math.Log10(peak * g) : -120;     // the meter shows the level after the input's gain (before the limiter)
            (started, ended) = l.Detector.Update(20 * Math.Log10(Math.Max(peak, 1e-6f)), NowMs());   // needle drop / phono check use the raw input level
            phono = l.Detector.PhonoLow;
            if (l.Cond != null)
            {
                // the feed is stereo: mono is doubled, more than two channels keep front left / right (players send 1 or 2; this is the backstop)
                if (ch == 1) { var st = new float[pcm.Length * 2]; for (int i = 0; i < pcm.Length; i++) st[i * 2] = st[i * 2 + 1] = pcm[i]; l.Feed.WriteFloat(st, rate); }
                else if (ch == 2) l.Feed.WriteFloat(pcm, rate);
                else l.Feed.WriteFloat(WavWiz.PlayerCore.InputRules.ToStereoOrMono(pcm, ch, out _), rate);
            }
            var now = NowMs(); if (now - l.LastLevelPubMs >= 120) { l.LastLevelPubMs = now; publish = true; }
        }
        if (publish) _s.Events.Publish("inputlevel", new { id = l.Id, peakDb = Math.Round(db, 1), phonoLow = phono });
        if (started || ended) OnSignal(l.Id, started, ended);
    }

    private void OnSignal(string id, bool started, bool ended)
    {
        string? zone = null; bool start = false, stop = false;
        lock (_l)
        {
            if (!_live.TryGetValue(id, out var l)) return;
            var c = CfgOf(LoadCfg(), l);
            if (started && l.Cond == null && c.Enabled && AutoStartOn(c)) { start = true; zone = c.LastZone ?? Everywhere; }
            if (ended && l.Cond != null && c.Turntable && c.Kind == "aux") stop = true;   // end of the side: same as pressing Stop
        }
        if (start) { var err = Play(id, zone, auto: true); if (err != null) _s.Log?.Invoke($"inputs: needle drop could not start {id}: {err}"); }
        if (stop) Stop(id);
    }

    // ---------------- reconcile: tell the Player which inputs to capture ----------------
    private bool WantedNoLock(Live l, InputCfg c)
    {
        if (!c.Enabled) return false;
        if (l.Cond != null) return true;                                  // playing
        if (c.Kind == "mic") return false;                                // a mic opens only to play it (or, later, to announce)
        if (AutoStartOn(c)) return true;                                  // a Turntable listens for the needle
        return DateTime.UtcNow < _meterUntil && c.Kind != "loopback";     // Settings open: meters (not the PC's own sound - nothing to show until it plays)
    }
    private void ReconcileNoLock()
    {
        var cfg = LoadCfg();
        foreach (var l in _live.Values)
        {
            bool want = WantedNoLock(l, CfgOf(cfg, l)) && l.Sess.SpeaksInputs && !l.Sess.Dead;
            if (want == l.Capturing) continue;
            if (want && NowMs() - l.ErrorAtMs < RetryAfterErrorMs) continue;   // it just failed to open: try again in a while, not every second
            if (want && l.Privacy) continue;                               // 0.7.2 t2170u: Windows' mic privacy said no: wait for the user to press Play again
            if (want) l.GotAudio = false;
            l.Capturing = want; if (!want) { l.PeakDb = -120; l.Detector.Reset(); }
            try { l.Sess.SendJson(MsgType.InputCmd, new InputCmd(want ? "start" : "stop", l.Info.Id)); } catch { }
        }
    }
    private void ApplyGainsNoLock()
    {
        var cfg = LoadCfg(); bool lim = LiveLimiter.Enabled(_s.Db);
        foreach (var l in _live.Values) { l.Feed.Gain = GainOf(CfgOf(cfg, l).GainDb); l.Feed.Limit = lim; }
    }
    /// <summary>Settings > live.limiter changed.</summary>
    public void ApplyLevels() { lock (_l) ApplyGainsNoLock(); }

    private void Tick()
    {
        bool changed = false;
        lock (_l)
        {
            foreach (var l in _live.Values.Where(x => x.Cond != null).ToList())
            {
                var it = l.Cond!.Now().Item;
                if (it == null || it.Kind != "input" || it.Location != l.Key) { ForgetPlayNoLock(l); changed = true; }   // something else took the zone (a song, AirPlay): stop capturing
            }
            ReconcileNoLock();
        }
        if (changed) _s.Events.Publish("inputs");
    }

    // ---------------- user actions ----------------
    /// <summary>Settings showing meters: capture enabled Aux / S/PDIF inputs for <see cref="MeterLease"/> (renewed while the card is open).</summary>
    public void Meter(bool on) { lock (_l) { _meterUntil = on ? DateTime.UtcNow + MeterLease : DateTime.MinValue; ReconcileNoLock(); } }

    /// <summary>Admin: change an input's settings. Returns an error, or null.</summary>
    public string? Patch(string id, JsonElement b)
    {
        lock (_l)
        {
            if (!_live.TryGetValue(id, out var l)) return "input not found";
            var all = LoadCfg(); var c = CfgOf(all, l);
            if (b.TryGetProperty("name", out var n)) { if (n.ValueKind == JsonValueKind.Null) c = c with { Name = null }; else if (n.ValueKind != JsonValueKind.String || n.GetString()!.Trim().Length is 0 or > 40) return "name must be 1 to 40 characters"; else c = c with { Name = n.GetString()!.Trim() }; }
            if (b.TryGetProperty("enabled", out var e)) { if (e.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "enabled must be true or false"; c = c with { Enabled = e.GetBoolean() }; }
            if (b.TryGetProperty("gainDb", out var g)) { if (g.ValueKind != JsonValueKind.Number || g.GetDouble() < MinGainDb || g.GetDouble() > MaxGainDb) return $"gainDb must be between {MinGainDb} and +{MaxGainDb}"; c = c with { GainDb = Math.Round(g.GetDouble(), 1) }; }
            if (b.TryGetProperty("turntable", out var t)) { if (t.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "turntable must be true or false"; if (t.GetBoolean() && c.Kind != "aux") return "Turntable mode is only for Aux in"; c = c with { Turntable = t.GetBoolean() }; }
            if (b.TryGetProperty("autoStart", out var a)) { if (a.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "autoStart must be true or false"; if (a.GetBoolean() && !(c.Kind == "aux" && c.Turntable)) return "auto-start needs Turntable mode on Aux in"; c = c with { AutoStart = a.GetBoolean() }; }
            if (b.TryGetProperty("liveSource", out var ls)) { if (ls.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "liveSource must be true or false"; if (c.Kind != "mic") return "only a microphone has a live-source switch"; c = c with { LiveSource = ls.GetBoolean() }; }
            all[id] = c; SaveCfg(all);
            if ((!c.Enabled || c.Kind == "mic" && !c.LiveSource) && l.Cond != null) StopNoLock(l, "turned off");
            if (!AutoStartOn(c)) l.Detector.Reset();
            ApplyGainsNoLock(); ReconcileNoLock();
        }
        _s.Events.Publish("inputs"); return null;
    }

    /// <summary>Control: play an input in a zone ("g:&lt;id&gt;"), Everywhere ("everywhere") or the house group (null). Returns an error, or null.</summary>
    public string? Play(string id, string? zone, bool auto = false)
    {
        lock (_l)
        {
            if (!_live.TryGetValue(id, out var l)) return "input not found";
            var all = LoadCfg(); var c = CfgOf(all, l);
            if (!c.Enabled) return "This input is turned off. An administrator can turn it on in Settings > Devices > Audio inputs.";
            if (c.Kind == "mic" && !c.LiveSource) return "Microphones are for Announce. An administrator can turn one on as a live source in Settings > Devices > Audio inputs.";
            zone = string.IsNullOrWhiteSpace(zone) || zone == "default" ? null : zone.Trim();
            bool everywhere = zone == Everywhere;
            Conductor cond;
            if (everywhere) cond = _s.Conductor;
            else if (zone != null) { var gid = _s.Links.ResolveZone(zone, forPlay: true); if (gid == null) return "no such zone"; cond = _s.Registry.Get(gid) ?? _s.Conductor; }
            else cond = _s.Conductor;
            if (_s.Jukebox != null && ReferenceEquals(_s.Jukebox.Owns, cond)) return "Audio inputs can't play in the Jukebox zone";
            if (l.Cond != null) StopNoLock(l, "moved");                    // already playing somewhere: move it
            if (everywhere) { try { _s.Links.EverywhereBegin(); } catch (Exception e) { _s.Log?.Invoke("inputs: link all zones failed: " + e.Message); } }
            l.Privacy = false; l.Error = null; l.ErrorAtMs = long.MinValue / 2;   // 0.7.2 t2170u: Play is the user's retry (also after a privacy refusal)
            l.Feed.Flush(); l.Feed.Gain = GainOf(c.GainDb); l.Feed.Limit = LiveLimiter.Enabled(_s.Db);
            cond.RegisterFeed("input", l.Feed, l.Key);
            cond.BeginLive("input", c.Name ?? DefaultName(l.Info), "This PC · " + KindLabel(l.Info.Kind), "Audio input", null, l.Key);
            l.Cond = cond; l.Zone = zone; l.LinkedEverywhere = everywhere; l.AutoStarted = auto;
            all[id] = c with { LastZone = zone }; SaveCfg(all);
            ReconcileNoLock();
        }
        _s.Events.Publish("inputs"); _s.Events.Publish("zones"); return null;
    }

    /// <summary>Control: stop an input. The zone's previous queue comes back paused (not playing), the same as when AirPlay ends.</summary>
    public string? Stop(string id)
    {
        lock (_l) { if (!_live.TryGetValue(id, out var l)) return "input not found"; StopNoLock(l, "stopped"); ReconcileNoLock(); }
        _s.Events.Publish("inputs"); _s.Events.Publish("zones"); return null;
    }

    private void StopNoLock(Live l, string why)
    {
        if (l.Cond == null) return;
        var cond = l.Cond; bool linked = l.LinkedEverywhere;
        ForgetPlayNoLock(l);
        try { cond.EndLive("input", l.Key); } catch { }
        if (linked) { try { _s.Links.EverywhereEnd(); } catch { } }
        _s.Log?.Invoke($"inputs: {l.Info.Name} {why}");
    }
    private void ForgetPlayNoLock(Live l)
    {
        if (l.Cond is { } c) c.UnregisterFeed(l.Key, l.Feed);
        l.Cond = null; l.Zone = null; l.LinkedEverywhere = false; l.AutoStarted = false; l.Feed.Flush();
    }

    // ---------------- views ----------------
    /// <summary>Is a Player on the server PC connected that can capture (0.7.2+)?</summary>
    public bool PlayerReady => _s.Audio.Sessions.Any(p => p.SpeaksInputs && IsServerPc(p));

    public object View()
    {
        lock (_l)
        {
            var cfg = LoadCfg();
            var list = _live.Values.OrderBy(l => l.Info.Kind switch { "loopback" => 0, "aux" => 1, "spdif" => 2, _ => 3 }).ThenBy(l => l.Info.Name, StringComparer.OrdinalIgnoreCase).Select(l =>
            {
                var c = CfgOf(cfg, l);
                return new
                {
                    id = l.Id, name = c.Name ?? DefaultName(l.Info), defaultName = DefaultName(l.Info), kind = l.Info.Kind, source = "This PC · " + KindLabel(l.Info.Kind), device = l.Info.Name,
                    enabled = c.Enabled, gainDb = c.GainDb, turntable = c.Turntable, autoStart = AutoStartOn(c), liveSource = c.LiveSource, muted = l.Info.Kind == "mic" && !c.LiveSource,
                    bluetooth = l.Info.Bluetooth, note = l.Info.Note, playing = l.Cond != null, zone = l.Cond != null ? (l.Zone ?? "default") : null, groupId = l.Cond?.GroupId,
                    capturing = l.Capturing, peakDb = l.Capturing ? Math.Round(l.PeakDb, 1) : (double?)null, phonoLow = c.Turntable && l.Detector.PhonoLow, error = l.Error, privacy = l.Error != null && l.Privacy,
                };
            }).ToList();
            return new { available = PlayerReady, note = PlayerReady ? null : NoPlayerNote, limiter = LiveLimiter.Enabled(_s.Db), inputs = list };
        }
    }

    public void Dispose() { _tick.Dispose(); }
}
