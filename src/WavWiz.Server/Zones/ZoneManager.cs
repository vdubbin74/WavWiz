using System.Text.Json;
using WavWiz.Core.Calibration;
using WavWiz.Core.Protocol;
using WavWiz.Server.Dsp;
using WavWiz.Server.Net;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Zones;

public sealed record OutputDto(long EndpointDbId, string DeviceId, string EndpointId, string Name, string Kind, string? BtAddress, bool Connected, bool Active,
    double LatencyMs, string LatencySource, string Label, bool NotCalibrated, bool RecheckDue, string? Reason, double? WinLatencyMs, string? Codec, int? DspPresetId, bool DspBypass,
    string? MeasuredWith = null, string? MeasuredAt = null);     // 0.2.5: how and when the current delay was set (card note "Measured with … · date")
public sealed record ZoneDto(long Id, string Name, string PlayerId, bool Connected, bool Enabled, double Volume, bool Muted, string? ActiveDeviceId, string? ActiveEndpointId,
    string Badge, string BadgeText, double? SyncErrorMs, double? BufferMs, int? Underruns, int? HardResyncs, double? RatioPpm, string? Link, string? RemoteIp, string? Health, List<OutputDto> Outputs, RoomState? Room = null, bool IsWeb = false, List<long>? GroupIds = null,
    bool Mine = false, bool Reference = false, bool OutputUnavailable = false, string? ChosenDeviceId = null, long? OwnerTokenId = null, string? LastSeen = null, double? VolCap = null, bool VolLocked = false);
public sealed record ZoneGroupDto(long Id, string Name, List<long> DeviceIds, int Members, int Online, int Enabled, bool Active, double Volume = 0, bool Muted = false,
    long? ReferenceId = null, string? RefNote = null);   // 0.6.8-#15: the zone's reference speaker + a quiet "Reference changed, re-check timing" note

/// <summary>0.3.2 F4: zone volume math (pure). The zone level = the average of its speakers. Moving the zone slider shifts every member by the
/// same amount from its "virtual" level (which may sit above 100 or below 0), and the real level is that clamped to 0-100 - so clamping at an end
/// never loses the offsets: coming back restores the original balance.</summary>
/// <summary>0.3.2 F18: per-room max-volume cap. Locked: nothing can raise the room above Cap; lowering is always allowed. Pure.</summary>
public sealed record VolumeCap(double? Cap, bool Locked)
{
    public static readonly VolumeCap None = new(null, false);
    public static double Apply(double v, VolumeCap c) => c.Locked && c.Cap is double cap && v > cap ? cap : v;
}

public static class ZoneVolume
{
    public static double Level(IReadOnlyList<double> actual) => actual.Count == 0 ? 0 : Math.Round(actual.Average(), 2);
    /// <summary>The virtual levels are still valid when every member's real level equals its clamped virtual level (nobody moved a speaker on its own).</summary>
    public static bool Valid(IReadOnlyList<double>? virt, IReadOnlyList<double> actual) => virt != null && virt.Count == actual.Count && virt.Zip(actual).All(p => Math.Abs(Math.Clamp(p.First, 0, 100) - p.Second) < 0.02);
    /// <summary>New virtual levels for slider value <paramref name="target"/>: the average of the virtual levels lands on target.</summary>
    public static double[] Shift(IReadOnlyList<double> virt, double target)
    {
        if (virt.Count == 0) return Array.Empty<double>();
        target = Math.Clamp(target, 0, 100); var d = target - virt.Average();
        return virt.Select(v => Math.Round(v + d, 2)).ToArray();
    }
    public static double[] Real(IReadOnlyList<double> virt) => virt.Select(v => Math.Round(Math.Clamp(v, 0, 100), 2)).ToArray();
}

/// <summary>
/// 1 player = 1 zone for the beta (spec 12). Keeps the zone rows, resolves each output's delay through <see cref="CalibrationLookup"/> and pushes
/// ZONE_UPDATE / DSP_CONFIG to the player whenever anything that affects it changes. "Unknown is never zero": an uncalibrated output is flagged, not silently 0.
/// </summary>
public sealed class ZoneManager
{
    private readonly Db _db; private readonly AudioHost _host; private readonly ConductorRegistry _reg; private readonly EventHub _ev; private readonly DspService _dsp;
    private readonly object _l = new();
    private readonly Dictionary<string, string> _lastHealth = new();
    public Action<string>? Log { get => _log; set { _log = value; Rooms.Log = value; } }
    public Action? AfterOutputsChanged;
    /// <summary>F170: devices that are not player sessions (AirPlay outputs "airplay:&lt;key&gt;"). Online = live sink; Patched = zone volume/mute/on-off changed; Removed = Forget.</summary>
    public Func<string, bool>? ExternalOnline; public Action<string>? ExternalPatched; public Action<string>? ExternalRemoved;
    /// <summary>0.4.0 Stage 2: maps zones to playback groups (set by the host after construction).</summary>
    public ZoneLinks? Links;
    private Action<string>? _log;
    public readonly RoomHealth Rooms = new();

    /// <summary>Tests and single-group hosts: one Conductor = the default playback group.</summary>
    public ZoneManager(Db db, AudioHost host, Conductor cond, EventHub ev, DspService dsp) : this(db, host, ConductorRegistry.Single(cond), ev, dsp) { }

    public ZoneManager(Db db, AudioHost host, ConductorRegistry reg, EventHub ev, DspService dsp)
    {
        _db = db; _host = host; _reg = reg; _ev = ev; _dsp = dsp;
        host.OnConnected = OnConnected; host.OnDisconnected = OnDisconnected; host.OnOutputs = OnOutputs; host.OnStatus = OnStatus;
        dsp.DeviceChanged += key => { foreach (var s in _host.Sessions) if (ActiveDeviceKey(s) == key) PushDsp(s); _ev.Publish("zones"); };
    }

    // ---------------- options ----------------
    public CalibrationOptions Options() => new()
    {
        BtDefaultLatencyMs = SettingD("bt.defaultLatencyMs", 200), WiredDefaultLatencyMs = SettingD("wired.defaultLatencyMs", 0),
        RecheckAfterDays = (int)SettingD("calibration.recheckDays", 30), WinLatencyChangeMs = SettingD("calibration.winLatencyChangeMs", 15),
    };
    private double SettingD(string k, double d) { var s = _db.Setting(k); return s != null && double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : d; }

    private static OutputKind ParseKind(string? k) => Enum.TryParse<OutputKind>(k, true, out var r) ? r : OutputKind.Other;
    private static string KindName(OutputKind k) => k.ToString().ToLowerInvariant();

    public IEnumerable<CalibrationRecord> Calibrations(string deviceKey) => _db.Query(
        "SELECT output_device_id,player_id,latency_ms,method,measured_at,COALESCE(confidence,0.5),is_current,codec,win_reported_latency_ms FROM calibration WHERE output_device_id=$d",
        r => new CalibrationRecord(r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1), r.GetDouble(2), r.GetString(3), DateTimeOffset.Parse(r.GetString(4)), r.GetDouble(5), r.GetInt32(6) != 0,
            r.IsDBNull(7) ? null : r.GetString(7), r.IsDBNull(8) ? null : r.GetDouble(8)), ("$d", deviceKey));

    public ResolvedLatency Resolve(string deviceKey, OutputKind kind, string playerId, bool justReconnected = false, string? codec = null, double? winLatency = null)
        => CalibrationLookup.Resolve(deviceKey, kind, playerId, Calibrations(deviceKey), DateTimeOffset.UtcNow, Options(), new DeviceState(justReconnected, codec, winLatency));

    private static string SourceName(LatencySource s) => s switch { LatencySource.Measured => "measured", LatencySource.Manual => "manual", LatencySource.EstimatedFromOtherPc => "estimated", _ => "default-guess" };

    // ---------------- player lifecycle ----------------
    private Task OnConnected(PlayerSession s)
    {
        var now = DateTimeOffset.UtcNow.ToString("O");
        _db.Exec("INSERT INTO player(id,name,machine_name,app_version,last_seen_at,link_type) VALUES($i,$n,$m,$v,$t,$l) ON CONFLICT(id) DO UPDATE SET name=$n,machine_name=$m,app_version=$v,last_seen_at=$t,link_type=$l",
            ("$i", s.Id), ("$n", string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name), ("$m", s.Hello.MachineName), ("$v", s.Hello.AppVersion), ("$t", now), ("$l", s.Hello.LinkType));
        bool isNew = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone WHERE player_id=$p", ("$p", s.Id))) == 0;
        if (isNew && s.IsWeb) isNew = !MergeWebTwin(s);   // 0.6.8-#11e
        if (s.IsWeb) lock (_webIp) _webIp[s.Id] = s.Remote.ToString();
        if (isNew)
        {
            int sort = Convert.ToInt32(_db.Scalar("SELECT COALESCE(MAX(sort),0)+1 FROM zone"));
            var dev = _db.Insert("INSERT INTO zone(name,player_id,sort) VALUES($n,$p,$s)", ("$n", string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name), ("$p", s.Id), ("$s", sort));
            AdoptFirstSpeaker(dev);   // 0.6.8 zone fix: a fresh setup puts its first speaker into "Everywhere"
        }
        if (s.OwnerTokenId != null) _db.Exec("UPDATE player SET owner_token_id=$o WHERE id=$i", ("$o", s.OwnerTokenId), ("$i", s.Id));
        Rooms.Connected(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, s.Hello.LinkType, s.Remote.ToString());
        var z = ZoneRow(s.Id)!;
        PushZone(s); PushDsp(s);
        Links?.Apply(s.Id);
        if (z.Enabled) _reg.Subscribe(s);      // the device listens to its zone's playback group (a device in no zone stays silent)
        _ev.Publish("zones");
        return Task.CompletedTask;
    }

    // ---- 0.6.8-#11e: one device per phone. iOS gives every Home Screen install (and Safari) its own storage, so a new install can come up with a
    // new "web-…" id and the phone shows twice. The Home Screen start address carries the id (a2hs.js); when it still arrives as a NEW id, the
    // server re-keys the phone's existing entry to it instead of adding a twin: same phone name, same address, the old one offline. The zone row
    // (id, name, volume, groups) and its calibration + outputs move over; nothing is deleted. In-memory addresses only (cheap; after a server
    // restart the first reconnect simply adds the device as before).
    private readonly Dictionary<string, string> _webIp = new();
    private static readonly HashSet<string> PhoneNames = new(StringComparer.Ordinal) { "iPhone", "iPad", "Android phone", "Android tablet" };
    /// <summary>Pure: which offline web device a newly seen phone id replaces, or null.</summary>
    public static string? WebTwin(string newId, string name, string ip, IEnumerable<(string Id, string Name, string? Ip, bool Online)> known)
    {
        if (!PhoneNames.Contains(name)) return null;
        var c = known.Where(k => k.Id != newId && k.Id.StartsWith("web-", StringComparison.Ordinal) && !k.Online && k.Name == name && k.Ip == ip).Select(k => k.Id).ToList();
        return c.Count == 1 ? c[0] : null;   // two candidates = ambiguous, leave both
    }
    private bool MergeWebTwin(PlayerSession s)
    {
        try
        {
            var name = string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name;
            Dictionary<string, string> ips; lock (_webIp) ips = new(_webIp);
            var online = _host.Sessions.Select(x => x.Id).ToHashSet();
            var known = _db.Query("SELECT p.id,p.name FROM player p JOIN zone z ON z.player_id=p.id WHERE p.id LIKE 'web-%'", r => (Id: r.GetString(0), Name: r.GetString(1)))
                .Select(k => (k.Id, k.Name, ips.TryGetValue(k.Id, out var ip) ? ip : null, online.Contains(k.Id))).ToList();
            var old = WebTwin(s.Id, name ?? "", s.Remote.ToString(), known);
            if (old == null) return false;
            _db.Exec("UPDATE zone SET player_id=$n WHERE player_id=$o", ("$n", s.Id), ("$o", old));
            _db.Exec("UPDATE output_endpoint SET player_id=$n WHERE player_id=$o", ("$n", s.Id), ("$o", old));
            _db.Exec("UPDATE calibration SET player_id=$n WHERE player_id=$o", ("$n", s.Id), ("$o", old));
            _db.Exec("DELETE FROM player WHERE id=$o", ("$o", old));
            lock (_webIp) _webIp.Remove(old);
            _reg.Rekey(old, s.Id); Rooms.Forget(old); _lastHealth.Remove(old);
            _log?.Invoke($"web device {s.Id} ({name}) is the same phone as {old} (new Home Screen install) - kept one entry");
            return true;
        }
        catch (Exception e) { _log?.Invoke("web twin merge: " + e.Message); return false; }
    }

    private void OnDisconnected(PlayerSession s)
    {
        Rooms.Disconnected(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, s.EndReason ?? "connection closed");
        _reg.Disconnected(s.Id);
        _db.Exec("UPDATE output_endpoint SET connected=0 WHERE player_id=$p", ("$p", s.Id));
        _db.Exec("UPDATE player SET last_seen_at=$t WHERE id=$p", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$p", s.Id));
        _ev.Publish("zones");
    }

    private void OnStatus(PlayerSession s, PlayerStatus st)
    {
        // health transitions are events; the 1 Hz status itself is not broadcast (the UI polls /zones every 2 s while visible)
        Rooms.Status(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, st, StreamPlayingFor(s.Id));
        string h = Health(s) + Rooms.State(s.Id, true, st, StreamPlayingFor(s.Id), StreamAgeMsFor(s.Id)).State;
        if (!_lastHealth.TryGetValue(s.Id, out var prev) || prev != h) { _lastHealth[s.Id] = h; _ev.Publish("zones"); }
    }

    /// <summary>The device's own playback group is streaming (a split-off device is judged by its group, not by the house stream).</summary>
    public bool StreamPlayingFor(string playerId) => _reg.Playing(playerId);
    public long StreamAgeMsFor(string playerId) => _reg.StreamAgeMs(playerId);

    public static string Health(PlayerSession s)
    {
        var st = s.Status; if (st == null) return "connecting";
        if (st.Underruns > 0 && st.BufferMs < 200) return "starved";
        if (!s.IsWeb && Math.Abs(st.SyncErrorMs) > 3) return "drifting";
        return "ok";
    }

    private void OnOutputs(PlayerSession s, OutputsMsg m)
    {
        lock (_l)
        {
            var z = ZoneRow(s.Id); if (z == null) return;
            var now = DateTimeOffset.UtcNow.ToString("O");
            var keys = new Dictionary<string, string>();   // endpointId -> device key
            foreach (var o in m.Outputs)
            {
                var kind = ParseKind(o.Kind);
                // an endpoint the user linked by hand to a Bluetooth identity keeps that identity
                var linked = _db.Scalar("SELECT output_device_id FROM output_endpoint WHERE player_id=$p AND win_endpoint_id=$e", ("$p", s.Id), ("$e", o.EndpointId)) as string;
                var key = linked != null && linked.StartsWith("bt:") ? linked : CalibrationLookup.DeviceKey(kind, o.BtAddress, s.Id, o.EndpointId);
                keys[o.EndpointId] = key;
                _db.Exec("INSERT INTO output_device(id,kind,bt_address,friendly_name) VALUES($i,$k,$b,$n) ON CONFLICT(id) DO UPDATE SET friendly_name=$n,kind=$k,bt_address=COALESCE($b,bt_address)",
                    ("$i", key), ("$k", KindName(kind)), ("$b", o.BtAddress), ("$n", o.Name));
                _db.Exec("INSERT INTO output_endpoint(output_device_id,player_id,win_endpoint_id,last_seen_at,connected) VALUES($d,$p,$e,$t,$c) ON CONFLICT(player_id,win_endpoint_id) DO UPDATE SET output_device_id=$d,last_seen_at=$t,connected=$c",
                    ("$d", key), ("$p", s.Id), ("$e", o.EndpointId), ("$t", now), ("$c", o.Connected ? 1 : 0));
            }
            foreach (var gone in _db.Query("SELECT id,win_endpoint_id FROM output_endpoint WHERE player_id=$p", r => (Id: r.GetInt64(0), Ep: r.GetString(1)), ("$p", s.Id)))
                if (!keys.ContainsKey(gone.Ep)) _db.Exec("UPDATE output_endpoint SET connected=0 WHERE id=$i", ("$i", gone.Id));

            var active = m.Outputs.FirstOrDefault(o => o.Active);
            var wanted = z.ActiveDevice;
            bool serverWins = m.Reason is "connect" or "devices" or null;
            if (wanted != null && serverWins)
            {
                var wantedEp = m.Outputs.FirstOrDefault(o => o.Connected && keys[o.EndpointId] == wanted);
                if (wantedEp != null && (active == null || keys[active.EndpointId] != wanted)) { PushZone(s, wantedEp.EndpointId); return; }     // switch back to the user's choice
            }
            // 0.2.0 item 26: if the output the user chose is gone (unplugged HDMI, Bluetooth off), keep that choice saved and show "Output unavailable";
            // never silently adopt whatever Windows fell back to. A switch the person makes on the player itself (reason "user") is still adopted.
            bool wantedGone = wanted != null && !m.Outputs.Any(o => o.Connected && keys[o.EndpointId] == wanted);
            if (active != null && !(wantedGone && serverWins)) { _db.Exec("UPDATE zone SET active_output_device_id=$d WHERE player_id=$p", ("$d", keys[active.EndpointId]), ("$p", s.Id)); }
            PushZone(s); PushDsp(s);
            _ev.Publish("zones");
            AfterOutputsChanged?.Invoke();
        }
    }

    // ---------------- push to players ----------------
    private string? ActiveDeviceKey(PlayerSession s)
    {
        var act = s.Outputs.FirstOrDefault(o => o.Active); if (act == null) return null;
        return _db.Scalar("SELECT output_device_id FROM output_endpoint WHERE player_id=$p AND win_endpoint_id=$e", ("$p", s.Id), ("$e", act.EndpointId)) as string;
    }

    public void PushZone(PlayerSession s, string? forceEndpoint = null)
    {
        var z = ZoneRow(s.Id); if (z == null) return;
        string? epId = forceEndpoint ?? s.Outputs.FirstOrDefault(o => o.Active)?.EndpointId;
        double lat = 0; string src = "none"; bool notCal = false, recheck = false; long? rev = null;
        if (epId != null)
        {
            var info = s.Outputs.FirstOrDefault(o => o.EndpointId == epId);
            var key = _db.Scalar("SELECT output_device_id FROM output_endpoint WHERE player_id=$p AND win_endpoint_id=$e", ("$p", s.Id), ("$e", epId)) as string;
            if (key != null && info != null)
            {
                var prevConnected = false;
                var r = Resolve(key, ParseKind(info.Kind), s.Id, prevConnected, info.Codec, info.WinLatencyMs);
                lat = r.LatencyMs; src = SourceName(r.Source); notCal = r.NotCalibrated; recheck = r.RecheckDue;
                rev = _dsp.Effective(key).Revision;
            }
        }
        s.SendJson(MsgType.ZoneUpdate, new ZoneUpdate(z.Volume, z.Muted, z.Enabled, epId, lat, src, rev, notCal, recheck));
    }

    public void PushDsp(PlayerSession s)
    {
        var key = ActiveDeviceKey(s); if (key == null) return;
        var (rev, bypass, preset) = _dsp.Effective(key);
        s.SendJson(MsgType.DspConfig, new DspConfig(key, rev, bypass, preset));
    }

    public void PushPreview(string deviceKey, JsonElement? preset, bool bypass)
    {
        foreach (var s in _host.Sessions) if (ActiveDeviceKey(s) == deviceKey) s.SendJson(MsgType.DspConfig, new DspConfig(deviceKey, -1, bypass, preset, Preview: true));
    }

    public void Revert(string deviceKey) { foreach (var s in _host.Sessions) if (ActiveDeviceKey(s) == deviceKey) PushDsp(s); }

    public void RefreshLatency(string deviceKey)
    {
        foreach (var s in _host.Sessions) if (ActiveDeviceKey(s) == deviceKey) PushZone(s);
        _ev.Publish("zones");
    }

    // ---------------- zone rows ----------------
    private sealed record ZRow(long Id, string Name, string PlayerId, bool Enabled, double Volume, bool Muted, string? ActiveDevice, int Sort);
    private ZRow? ZoneRow(string playerId) => _db.Query("SELECT id,name,player_id,enabled,volume,muted,active_output_device_id,sort FROM zone WHERE player_id=$p",
        r => new ZRow(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3) != 0, r.GetDouble(4), r.GetInt32(5) != 0, r.IsDBNull(6) ? null : r.GetString(6), r.GetInt32(7)), ("$p", playerId)).FirstOrDefault();
    private ZRow? ZoneRow(long id) => _db.Query("SELECT id,name,player_id,enabled,volume,muted,active_output_device_id,sort FROM zone WHERE id=$i",
        r => new ZRow(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3) != 0, r.GetDouble(4), r.GetInt32(5) != 0, r.IsDBNull(6) ? null : r.GetString(6), r.GetInt32(7)), ("$i", id)).FirstOrDefault();

    /// <summary>0.2.0: the house reference speaker for calibration (setting calibration.referenceZoneId; 0 = none chosen).</summary>
    public long ReferenceZoneId
    {
        get { var j = _db.Setting("calibration.referenceZoneId"); return j != null && long.TryParse(j, out var v) ? v : 0; }
        set => _db.SetSetting("calibration.referenceZoneId", value.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// 0.2.0 item 28: is this device "the one the person is using"? A web speaker belongs to the browser session (api_token) that opened it;
    /// a Windows Player belongs to whoever browses from the same PC (same remote address, or both on the server PC itself).
    /// </summary>
    public static bool IsMine(string playerId, long? ownerTokenId, PlayerSession? live, AuthInfo? who, System.Net.IPAddress? remote)
    {
        if (who == null) return false;
        if (playerId.StartsWith("web-", StringComparison.Ordinal)) return ownerTokenId != null && ownerTokenId == who.TokenId;
        if (live == null || remote == null) return false;
        static System.Net.IPAddress N(System.Net.IPAddress a) => a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a;
        var a = N(live.Remote); var b = N(remote);
        if (a.Equals(b)) return true;
        return AuthService.IsThisMachine(a) && AuthService.IsThisMachine(b);
    }

    // ---------------- 0.6.8-#15: one reference speaker per zone ----------------
    private readonly object _refLock = new();
    /// <summary>Each zone's reference speaker (zone group id -> speaker id), normalized against the current membership. A zone whose reference left
    /// gets a new one (wired, then online, then steadiest), the saved offsets are re-based on it and a quiet note is left. First run migrates the
    /// house reference (<see cref="ReferenceZoneId"/>) to its zone. 0.6.8 zone fix: a zone that never had a reference gets none (no auto-REF).</summary>
    public Dictionary<long, long> ZoneReferenceMap()
    {
        lock (_refLock)
        {
            var members = _db.Query("SELECT group_id,device_id FROM zone_group_member", r => (G: r.GetInt64(0), D: r.GetInt64(1)))
                .GroupBy(x => x.G).ToDictionary(x => x.Key, x => x.Select(y => y.D).OrderBy(d => d).ToList());
            var stored = ZoneRefs.ParseMap(_db.Setting(ZoneRefs.MapKey));
            var (map, changes) = ZoneRefs.Normalize(stored, members, RefCand, ReferenceZoneId);
            if (stored == null || stored.Count != map.Count || map.Any(kv => !stored.TryGetValue(kv.Key, out var v) || v != kv.Value)) _db.SetSetting(ZoneRefs.MapKey, ZoneRefs.MapJson(map));
            foreach (var c in changes) { RebaseZone(c.Group, c.New, members[c.Group]); SetRefNote(c.Group, true); }
            return map;
        }
    }
    ZoneRefs.Cand RefCand(long id)
    {
        var row = _db.Query("SELECT z.player_id, COALESCE(d.kind,'') FROM zone z LEFT JOIN output_device d ON d.id=z.active_output_device_id WHERE z.id=$i", r => (P: r.GetString(0), K: r.GetString(1)), ("$i", id)).FirstOrDefault();
        if (row.P == null) return new(id, false, false, double.MaxValue);
        var s = _host.Get(row.P); var st = s?.Status;
        bool wired = ZoneRefs.IsWiredKind(row.K) && !(s?.IsWeb ?? row.P.StartsWith("web-", StringComparison.Ordinal)) && !row.P.StartsWith("airplay:", StringComparison.Ordinal) && !row.P.StartsWith("cast:", StringComparison.Ordinal);
        return new(id, wired, s != null || ExternalOnline?.Invoke(row.P) == true, st == null ? 1e6 : st.Underruns + st.HardResyncs + Math.Abs(st.SyncErrorMs));
    }
    /// <summary>The reference a speaker is calibrated against: its zone's reference, or the house reference for a speaker in no zone (0 = none).</summary>
    public long ReferenceFor(long speakerId)
    {
        var map = ZoneReferenceMap();
        var g = _db.Query("SELECT group_id FROM zone_group_member WHERE device_id=$d", r => r.GetInt64(0), ("$d", speakerId)).FirstOrDefault();
        return g != 0 && map.TryGetValue(g, out var r) ? r : ReferenceZoneId;
    }
    public long? GroupOfSpeaker(long speakerId) { var g = _db.Query("SELECT group_id FROM zone_group_member WHERE device_id=$d", r => r.GetInt64(0), ("$d", speakerId)).FirstOrDefault(); return g == 0 ? null : g; }
    /// <summary>Any speaker of a zone can be made its reference by hand. The saved offsets are re-based on it (no recalibration needed).</summary>
    public string? SetZoneReference(long groupId, long speakerId)
    {
        lock (_refLock)
        {
            var members = _db.Query("SELECT device_id FROM zone_group_member WHERE group_id=$g", r => r.GetInt64(0), ("$g", groupId)).OrderBy(d => d).ToList();
            if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group WHERE id=$i", ("$i", groupId))) == 0) return "zone not found";
            if (!members.Contains(speakerId)) return "that speaker is not in this zone";
            var map = ZoneReferenceMap();
            if (!map.TryGetValue(groupId, out var cur) || cur != speakerId)
            {
                map[groupId] = speakerId; _db.SetSetting(ZoneRefs.MapKey, ZoneRefs.MapJson(map));
                RebaseZone(groupId, speakerId, members);
            }
            SetRefNote(groupId, false);
        }
        _ev.Publish("zones"); return null;
    }
    /// <summary>Delays are absolute (house clock), so they stay; the stored offset of each calibrated speaker is rewritten against the new reference.</summary>
    void RebaseZone(long groupId, long newRef, IReadOnlyList<long> members)
    {
        var lat = new Dictionary<long, double>(); var rowOf = new Dictionary<long, long>(); string? refDev = null;
        foreach (var m in members)
        {
            var dev = _db.Scalar("SELECT active_output_device_id FROM zone WHERE id=$i", ("$i", m)) as string; if (dev == null) continue;
            if (m == newRef) refDev = dev;
            var row = _db.Query("SELECT id,latency_ms FROM calibration WHERE output_device_id=$d AND is_current=1 ORDER BY measured_at DESC LIMIT 1", r => (Id: r.GetInt64(0), L: r.GetDouble(1)), ("$d", dev)).FirstOrDefault();
            if (row.Id != 0) { lat[m] = row.L; rowOf[m] = row.Id; }
        }
        foreach (var (m, off) in ZoneRefs.Rebase(lat, newRef))
            _db.Exec("UPDATE calibration SET raw_latency_ms=$o, reference_device_id=$r WHERE id=$i", ("$o", off), ("$r", refDev), ("$i", rowOf[m]));
    }
    Dictionary<long, string> RefNotes() { try { return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(_db.Setting(ZoneRefs.NoteKey) ?? "{}")!.Where(kv => long.TryParse(kv.Key, out _)).ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value); } catch { return new(); } }
    /// <summary>Sets or clears the quiet "Reference changed, re-check timing" note of a zone.</summary>
    public void SetRefNote(long groupId, bool on)
    {
        var n = RefNotes(); if (on) n[groupId] = DateTimeOffset.UtcNow.ToString("O"); else if (!n.Remove(groupId)) return;
        _db.SetSetting(ZoneRefs.NoteKey, System.Text.Json.JsonSerializer.Serialize(n.ToDictionary(kv => kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv => kv.Value)));
    }
    public const string RefNoteText = "Reference changed, re-check timing";

    public bool IsMine(long zoneId, AuthInfo? who, System.Net.IPAddress? remote) => Zones(who, remote).FirstOrDefault(z => z.Id == zoneId)?.Mine ?? false;

    public List<ZoneDto> Zones(AuthInfo? who = null, System.Net.IPAddress? remote = null)
    {
        var res = new List<ZoneDto>();
        long house = ReferenceZoneId; var zref = ZoneReferenceMap(); var refSet = zref.Values.ToHashSet();   // 0.6.8-#15
        var owners = _db.Query("SELECT id,owner_token_id FROM player", r => (Id: r.GetString(0), Owner: r.IsDBNull(1) ? (long?)null : r.GetInt64(1))).ToDictionary(x => x.Id, x => x.Owner);
        var seen = _db.Query("SELECT id,last_seen_at FROM player WHERE last_seen_at IS NOT NULL", r => (Id: r.GetString(0), At: r.GetString(1))).ToDictionary(x => x.Id, x => x.At);
        var rows = _db.Query("SELECT id,name,player_id,enabled,volume,muted,active_output_device_id,sort FROM zone ORDER BY sort,id",
            r => new ZRow(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3) != 0, r.GetDouble(4), r.GetInt32(5) != 0, r.IsDBNull(6) ? null : r.GetString(6), r.GetInt32(7)));
        var memberships = _db.Query("SELECT device_id,group_id FROM zone_group_member", r => (Dev: r.GetInt64(0), Grp: r.GetInt64(1))).ToLookup(x => x.Dev, x => x.Grp);
        bool IsRef(long id) => refSet.Contains(id) || (id == house && !memberships[id].Any());   // a speaker in no zone: the house reference
        foreach (var z in rows)
        {
            var s = _host.Get(z.PlayerId); var st = s?.Status;
            bool ext = s == null && ExternalOnline?.Invoke(z.PlayerId) == true;   // F170: a connected AirPlay output counts as online
            var eps = _db.Query("SELECT e.id,e.output_device_id,e.win_endpoint_id,d.friendly_name,d.kind,d.bt_address,e.connected FROM output_endpoint e JOIN output_device d ON d.id=e.output_device_id WHERE e.player_id=$p ORDER BY d.friendly_name",
                r => (Id: r.GetInt64(0), Dev: r.GetString(1), Ep: r.GetString(2), Name: r.GetString(3), Kind: r.GetString(4), Bt: r.IsDBNull(5) ? null : r.GetString(5), Conn: r.GetInt32(6) != 0), ("$p", z.PlayerId));
            var activeEp = s?.Outputs.FirstOrDefault(o => o.Active)?.EndpointId;
            var outs = new List<OutputDto>();
            foreach (var e in eps)
            {
                var live = s?.Outputs.FirstOrDefault(o => o.EndpointId == e.Ep);
                var r = Resolve(e.Dev, ParseKind(e.Kind), z.PlayerId, false, live?.Codec, live?.WinLatencyMs);
                var a = _dsp.AssignmentFor(e.Dev);
                var how = r.NotCalibrated ? default : _db.Query("SELECT method,mic_source,measured_at FROM calibration WHERE output_device_id=$d AND is_current=1 AND (player_id=$p OR player_id IS NULL) ORDER BY measured_at DESC LIMIT 1",
                    q => (M: q.GetString(0), Src: q.IsDBNull(1) ? null : q.GetString(1), At: q.GetString(2)), ("$d", e.Dev), ("$p", z.PlayerId)).FirstOrDefault();
                outs.Add(new OutputDto(e.Id, e.Dev, e.Ep, e.Name, e.Kind, e.Bt, ext || (s != null && (live?.Connected ?? false)), ext || e.Ep == activeEp, r.LatencyMs, SourceName(r.Source), r.Label, r.NotCalibrated, r.RecheckDue, r.Reason, live?.WinLatencyMs, live?.Codec, (int?)a?.PresetId, a?.Bypass ?? false,
                    how.M == null ? null : how.Src == null ? how.M : how.M + ":" + how.Src, how.At));
            }
            var act = outs.FirstOrDefault(o => o.Active);
            string badge, text;
            if (ext) { badge = "synced"; text = z.PlayerId.StartsWith("cast:", StringComparison.Ordinal) ? "CAST" : "AIRPLAY"; }   // 0.7.0 F169
            else if (s == null) { badge = "offline"; text = "OFFLINE"; }
            else if (act == null) { badge = "nooutput"; text = "NO OUTPUT"; }
            else if (act.NotCalibrated) { badge = "uncalibrated"; text = "NOT CALIBRATED"; }
            else if (act.RecheckDue) { badge = "recheck"; text = "RE-CHECK DUE"; }
            else if (st != null && !(s?.IsWeb ?? false) && Math.Abs(st.SyncErrorMs) > 3) { badge = "drifting"; text = "RESYNCING"; }
            else { badge = "synced"; text = "SYNCED"; }
            owners.TryGetValue(z.PlayerId, out var owner);
            // chosen output known but not connected right now -> amber "Output unavailable" (only meaningful while the PC itself is online)
            bool unavailable = s != null && z.ActiveDevice != null && !outs.Any(o => o.DeviceId == z.ActiveDevice && o.Connected);
            res.Add(new ZoneDto(z.Id, z.Name, z.PlayerId, s != null || ext, z.Enabled, z.Volume, z.Muted, act?.DeviceId ?? z.ActiveDevice, act?.EndpointId, badge, text,
                (s?.IsWeb ?? false) ? null : st?.SyncErrorMs, st?.BufferMs, st?.Underruns, st?.HardResyncs, st?.RatioPpm, s?.LinkType, s?.Remote.ToString(), s == null ? null : Health(s), outs, Rooms.State(z.PlayerId, s != null, st, StreamPlayingFor(z.PlayerId), StreamAgeMsFor(z.PlayerId)), s?.IsWeb ?? z.PlayerId.StartsWith("web-"), memberships[z.Id].OrderBy(x => x).ToList(),
                IsMine(z.PlayerId, s?.OwnerTokenId ?? owner, s, who, remote), IsRef(z.Id), unavailable, z.ActiveDevice, null, seen.GetValueOrDefault(z.PlayerId), VolCapOf(z.Id).Cap, VolCapOf(z.Id).Locked));
        }
        return res;
    }

    public ZoneDto? Zone(long id) => Zones().FirstOrDefault(z => z.Id == id);

    // ---------------- user actions ----------------
    /// <summary>0.3.2 F18: the room's max-volume cap (setting "volcap.{id}"), persisted across restarts.</summary>
    public VolumeCap VolCapOf(long id) { var j = _db.Setting("volcap." + id); if (j == null) return VolumeCap.None; try { return System.Text.Json.JsonSerializer.Deserialize<VolumeCap>(j) ?? VolumeCap.None; } catch { return VolumeCap.None; } }
    public string? SetVolCap(long id, double? cap, bool? locked)
    {
        var z = ZoneRow(id); if (z == null) return "zone not found";
        var cur = VolCapOf(id); var c = cap ?? cur.Cap ?? 100; if (!double.IsFinite(c) || c < 0 || c > 100) return "cap must be 0-100";
        var n = new VolumeCap(Math.Round(c, 1), locked ?? cur.Locked);
        _db.SetSetting("volcap." + id, System.Text.Json.JsonSerializer.Serialize(n));
        if (n.Locked && z.Volume > c) return Patch(id, null, c, null, null);   // locking above the cap brings the room down to it
        _ev.Publish("zones"); return null;
    }
    public string? Patch(long id, string? name, double? volume, bool? muted, bool? enabled)
    {
        var z = ZoneRow(id); if (z == null) return "zone not found";
        if (name != null) { name = name.Trim(); if (name.Length is 0 or > 60) return "name must be 1-60 characters"; _db.Exec("UPDATE zone SET name=$n WHERE id=$i", ("$n", name), ("$i", id)); }
        if (volume != null) { if (!double.IsFinite(volume.Value)) return "volume must be a number"; _db.Exec("UPDATE zone SET volume=$v WHERE id=$i", ("$v", VolumeCap.Apply(Math.Clamp(volume.Value, 0, 100), VolCapOf(id))), ("$i", id)); }   // 0.3.2 F18: every volume write (master, zone, scenes, schedules, alarms, mini player, API) passes the room cap
        if (muted != null) _db.Exec("UPDATE zone SET muted=$m WHERE id=$i", ("$m", muted.Value ? 1 : 0), ("$i", id));
        if (enabled != null) _db.Exec("UPDATE zone SET enabled=$e WHERE id=$i", ("$e", enabled.Value ? 1 : 0), ("$i", id));
        var s = _host.Get(z.PlayerId);
        if (s != null)
        {
            PushZone(s);
            if (enabled == true) _reg.Subscribe(s); else if (enabled == false) _reg.Unsubscribe(s.Id);
        }
        else ExternalPatched?.Invoke(z.PlayerId);
        _ev.Publish("zones"); return null;
    }

    /// <summary>
    /// Master volume (0.2.0 item 10). Rules:
    ///  1. Speakers that are switched OFF are skipped (their level is not touched).
    ///  2. Mute is never changed: a muted speaker stays muted (its level still follows, so it comes back in balance when un-muted).
    ///  3. Balance is kept by scaling EVERY on-speaker by the SAME factor, based on the loudest one ("the master level" = the loudest on-speaker):
    ///     delta: loudest' = clamp(loudest + delta, 0, 100); scale: loudest' = clamp(loudest * scale, 0, 100); set: loudest' = clamp(set, 0, 100).
    ///     factor = loudest' / loudest. Because the loudest speaker reaches 100 first, raising stops there and no other room is ever squashed
    ///     against the cap (so the ratios between rooms are exactly preserved). If every on-speaker is at 0 there is no ratio to keep: they all get loudest'.
    /// Returns the new master level (the loudest on-speaker), or null when no speaker is on.
    /// </summary>
    public double? Master(double? delta, double? scale, double? set)
    {
        var on = Zones().Where(z => z.Enabled).ToList();
        if (on.Count == 0) return null;
        double loud = on.Max(z => z.Volume), target = loud;
        if (delta != null && double.IsFinite(delta.Value)) target = loud + delta.Value;
        else if (scale != null && double.IsFinite(scale.Value)) target = loud * Math.Max(0, scale.Value);
        else if (set != null && double.IsFinite(set.Value)) target = set.Value;
        target = Math.Clamp(target, 0, 100);
        foreach (var z in on)
        {
            double v = loud <= 0.0001 ? target : z.Volume * (target / loud);
            v = Math.Round(Math.Clamp(v, 0, 100), 2);
            if (Math.Abs(v - z.Volume) > 0.001) Patch(z.Id, null, v, null, null);   // muted: null = never touched
        }
        return target;
    }

    /// <summary>0.2.1 F17: Mute all (master strip). Mutes every device and remembers which ones it muted; Unmute all un-mutes only those, so a
    /// device you had muted on its own stays muted (per-device mute stays separate). The list is kept in the settings table across restarts.
    /// Returns the number of devices changed.</summary>
    public int MuteAll(bool on)
    {
        var zs = Zones(); int n = 0;
        if (on)
        {
            var mine = zs.Where(z => !z.Muted).Select(z => z.Id).ToList();
            var prev = MutedByAll(); _db.SetSetting("zones.mutedByAll", JsonSerializer.Serialize(prev.Union(mine).Distinct().ToList()));
            foreach (var id in mine) { Patch(id, null, null, true, null); n++; }
        }
        else
        {
            var ids = MutedByAll(); var list = ids.Count > 0 ? zs.Where(z => z.Muted && ids.Contains(z.Id)).ToList() : zs.Where(z => z.Muted).ToList();
            _db.SetSetting("zones.mutedByAll", "[]");
            foreach (var z in list) { Patch(z.Id, null, null, false, null); n++; }
        }
        return n;
    }
    private HashSet<long> MutedByAll() { try { return JsonSerializer.Deserialize<List<long>>(_db.Setting("zones.mutedByAll") ?? "[]")?.ToHashSet() ?? new(); } catch { return new(); } }

    /// <summary>The level the master slider shows: the loudest speaker that is on (0 when none).</summary>
    public double MasterLevel() { var on = Zones().Where(z => z.Enabled).ToList(); return on.Count == 0 ? 0 : on.Max(z => z.Volume); }

    public string? SetActiveOutput(long zoneId, long endpointDbId)
    {
        var z = ZoneRow(zoneId); if (z == null) return "zone not found";
        var ep = _db.Query("SELECT output_device_id,win_endpoint_id FROM output_endpoint WHERE id=$i AND player_id=$p", r => (Dev: r.GetString(0), Ep: r.GetString(1)), ("$i", endpointDbId), ("$p", z.PlayerId)).FirstOrDefault();
        if (ep == default) return "that output belongs to a different PC";
        _db.Exec("UPDATE zone SET active_output_device_id=$d WHERE id=$i", ("$d", ep.Dev), ("$i", zoneId));
        var s = _host.Get(z.PlayerId);
        if (s != null) { PushZone(s, ep.Ep); }
        _ev.Publish("zones"); return null;
    }

    /// <summary>
    /// Bluetooth identity fallback (unverified on Windows): when the PC cannot tell us a speaker's Bluetooth address, the user can say "this endpoint is that speaker"
    /// and its saved delay is shared by address across PCs.
    /// </summary>
    public string? LinkEndpoint(long endpointDbId, string btAddress)
    {
        var hex = new string((btAddress ?? "").Where(Uri.IsHexDigit).ToArray()).ToLowerInvariant();
        if (hex.Length != 12) return "a Bluetooth address looks like AA:BB:CC:DD:EE:FF";
        var key = "bt:" + hex;
        var old = _db.Query("SELECT output_device_id,player_id FROM output_endpoint WHERE id=$i", r => (Dev: r.GetString(0), P: r.GetString(1)), ("$i", endpointDbId)).FirstOrDefault();
        if (old == default) return "output not found";
        var name = _db.Scalar("SELECT friendly_name FROM output_device WHERE id=$d", ("$d", old.Dev)) as string ?? "Bluetooth speaker";
        _db.Exec("INSERT INTO output_device(id,kind,bt_address,friendly_name) VALUES($i,'bluetooth',$b,$n) ON CONFLICT(id) DO NOTHING", ("$i", key), ("$b", hex), ("$n", name));
        _db.Exec("UPDATE output_endpoint SET output_device_id=$n WHERE id=$i", ("$n", key), ("$i", endpointDbId));
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM calibration WHERE output_device_id=$d", ("$d", key))) == 0)
            _db.Exec("UPDATE calibration SET output_device_id=$n WHERE output_device_id=$o", ("$n", key), ("$o", old.Dev));
        _db.Exec("UPDATE zone SET active_output_device_id=$n WHERE active_output_device_id=$o", ("$n", key), ("$o", old.Dev));
        var s = _host.Get(old.P); if (s != null) { PushZone(s); PushDsp(s); }
        _ev.Publish("zones"); return null;
    }

    public (string? DeviceId, string? PlayerId, string? Kind) DeviceOfEndpoint(long endpointDbId) =>
        _db.Query("SELECT e.output_device_id,e.player_id,d.kind FROM output_endpoint e JOIN output_device d ON d.id=e.output_device_id WHERE e.id=$i", r => (r.GetString(0), (string?)r.GetString(1), (string?)r.GetString(2)), ("$i", endpointDbId)).FirstOrDefault();

    /// <summary>Plays a short chime in ONE room (the house stream is muted there while it plays) so the person can check that speaker.</summary>
    public string? TestSound(long zoneId)
    {
        var z = ZoneRow(zoneId); if (z == null) return "zone not found";
        var s = _host.Get(z.PlayerId); if (s == null) return $"{z.Name} is not connected right now.";
        if (!z.Enabled) return $"{z.Name} is switched off - switch it on first.";
        if (s.Outputs.FirstOrDefault(o => o.Active) == null) return $"{z.Name} has no speaker selected - choose an output for it first.";
        s.SendJson(MsgType.CalCmd, new CalCmd("test-tone", "test", _reg.Clock.NowUs + 800_000, -18, z.Name));
        Rooms.Note(z.PlayerId, "test sound requested"); return null;
    }

    public string? ZonePlayer(long zoneId) => ZoneRow(zoneId)?.PlayerId;
    public string? ZoneActiveDevice(long zoneId) { var s = ZonePlayer(zoneId) is string p ? _host.Get(p) : null; return s == null ? null : ActiveDeviceKey(s); }

    // ---------------- zones = optional groups of devices (0.0.3) ----------------
    public List<ZoneGroupDto> Groups()
    {
        var devs = _db.Query("SELECT id,player_id,enabled FROM zone", r => (Id: r.GetInt64(0), Player: r.GetString(1), On: r.GetInt32(2) != 0)).ToDictionary(x => x.Id);
        var mem = _db.Query("SELECT group_id,device_id FROM zone_group_member", r => (G: r.GetInt64(0), D: r.GetInt64(1))).ToLookup(x => x.G, x => x.D);
        var res = new List<ZoneGroupDto>(); var zref = ZoneReferenceMap(); var notes = RefNotes();   // 0.6.8-#15
        foreach (var g in _db.Query("SELECT id,name FROM zone_group ORDER BY sort,id", r => (Id: r.GetInt64(0), Name: r.GetString(1))))
        {
            var ids = mem[g.Id].Where(devs.ContainsKey).OrderBy(x => x).ToList();
            int online = ids.Count(i => _host.Get(devs[i].Player) != null), on = ids.Count(i => devs[i].On);
            // ACTIVE = exactly this group's devices are switched on (every other device is off)
            bool active = ids.Count > 0 && on == ids.Count && devs.Values.Count(d => d.On) == ids.Count;
            var vols = _db.Query("SELECT id,volume,muted FROM zone", r => (Id: r.GetInt64(0), V: r.GetDouble(1), M: r.GetInt32(2) != 0)).Where(x => ids.Contains(x.Id)).ToList();
            res.Add(new ZoneGroupDto(g.Id, g.Name, ids, ids.Count, online, on, active, ZoneVolume.Level(vols.Select(x => x.V).ToList()), vols.Count > 0 && vols.All(x => x.M),
                zref.TryGetValue(g.Id, out var rf) ? rf : null, notes.ContainsKey(g.Id) ? RefNoteText : null));
        }
        return res;
    }

    private readonly System.Collections.Concurrent.ConcurrentDictionary<long, (long[] Ids, double[] Virt)> _zoneVirt = new();
    /// <summary>0.3.2 F4: the zone slider. Moves every member keeping their offsets (see <see cref="ZoneVolume"/>). Returns the new zone level.</summary>
    public (double? Level, string? Err) GroupVolume(long groupId, double target)
    {
        if (!double.IsFinite(target)) return (null, "volume must be a number");
        var g = Groups().FirstOrDefault(x => x.Id == groupId); if (g == null) return (null, "zone not found");
        return DevicesVolume(groupId, g.DeviceIds, target);
    }
    /// <summary>0.4.0: the zone slider for any set of devices (a zone, or the Jukebox zone with key -1): moves them together keeping their offsets.</summary>
    public (double? Level, string? Err) DevicesVolume(long key, IEnumerable<long> deviceIds, double target)
    {
        if (!double.IsFinite(target)) return (null, "volume must be a number"); long groupId = key;
        var ids = deviceIds.ToArray(); if (ids.Length == 0) return (0, null);
        var vol = _db.Query("SELECT id,volume FROM zone", r => (Id: r.GetInt64(0), V: r.GetDouble(1))).ToDictionary(x => x.Id, x => x.V);
        var actual = ids.Select(i => vol[i]).ToList();
        var virt = _zoneVirt.TryGetValue(groupId, out var m) && m.Ids.SequenceEqual(ids) && ZoneVolume.Valid(m.Virt, actual) ? m.Virt : actual.ToArray();
        var nv = ZoneVolume.Shift(virt, target); var real = ZoneVolume.Real(nv);
        _zoneVirt[groupId] = (ids, nv);
        for (int i = 0; i < ids.Length; i++) if (Math.Abs(real[i] - actual[i]) > 0.001) Patch(ids[i], null, real[i], null, null);
        return (ZoneVolume.Level(real), null);
    }
    /// <summary>0.3.2 F4: zone mute = every member muted / un-muted.</summary>
    public string? GroupMute(long groupId, bool muted)
    {
        var g = Groups().FirstOrDefault(x => x.Id == groupId); if (g == null) return "zone not found";
        foreach (var id in g.DeviceIds) Patch(id, null, null, muted, null);
        return null;
    }
    public void DevicesMute(IEnumerable<long> deviceIds, bool muted) { foreach (var id in deviceIds) Patch(id, null, null, muted, null); }

    private static string? CheckName(ref string? name)
    {
        name = (name ?? "").Trim(); return name.Length is 0 or > 60 ? "a zone name must be 1-60 characters" : null;
    }

    public (long Id, string? Error) CreateGroup(string? name, IEnumerable<long>? devices)
    {
        var err = CheckName(ref name); if (err != null) return (0, err);
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group WHERE name=$n COLLATE NOCASE", ("$n", name))) > 0) return (0, "there is already a zone with that name");
        var id = _db.Insert("INSERT INTO zone_group(name,sort,created_at) VALUES($n,(SELECT COALESCE(MAX(sort),0)+1 FROM zone_group),$t)", ("$n", name), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        SetMembers(id, devices); Links?.Apply(); _ev.Publish("zones"); return (id, null);   // 0.6.8 zone fix: its speakers leave Unassigned (silent) and play in it
    }

    private void SetMembers(long group, IEnumerable<long>? devices)
    {
        if (devices == null) return;
        _db.Exec("DELETE FROM zone_group_member WHERE group_id=$g", ("$g", group));
        foreach (var d in devices.Distinct())
            if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone WHERE id=$i", ("$i", d))) > 0)
            {   // 0.4.2: a speaker belongs to exactly ONE zone: putting it here takes it out of any other zone (it moves)
                _db.Exec("DELETE FROM zone_group_member WHERE device_id=$d AND group_id<>$g", ("$d", d), ("$g", group));
                _db.Exec("INSERT OR IGNORE INTO zone_group_member(group_id,device_id) VALUES($g,$d)", ("$g", group), ("$d", d));
            }
    }

    public const string ModelKey = "zones.model", PreMigrationKey = "zones.premigration.v041";
    /// <summary>0.4.2: flatten the 0.4.1 overlapping zones (one speaker in several zones, "smaller zone wins") to one zone per speaker: a speaker stays in the SMALLEST zone it was in (tie: the first by order); speakers in no zone stay Unassigned. The old memberships and claims are saved in the setting <see cref="PreMigrationKey"/> first. Runs once; returns how many speakers were moved out of extra zones.</summary>
    public int MigrateSingleMembership()
    {
        if (_db.Setting(ModelKey) == "2") return 0;
        var rows = _db.Query("SELECT m.group_id,m.device_id,g.sort FROM zone_group_member m JOIN zone_group g ON g.id=m.group_id", r => (G: r.GetInt64(0), D: r.GetInt64(1), Sort: r.GetInt64(2))).ToList();
        var size = rows.GroupBy(x => x.G).ToDictionary(x => x.Key, x => x.Count()); int moved = 0;
        try { _db.SetSetting(PreMigrationKey, System.Text.Json.JsonSerializer.Serialize(new { members = rows.Select(x => new { group = x.G, device = x.D }), links = _db.Setting("zone.links"), claims = _db.Setting("zone.claims") })); } catch { }
        foreach (var dev in rows.GroupBy(x => x.D).Where(x => x.Count() > 1))
        {
            var keep = dev.OrderBy(x => size[x.G]).ThenBy(x => x.Sort).ThenBy(x => x.G).First().G;
            foreach (var x in dev.Where(x => x.G != keep)) { _db.Exec("DELETE FROM zone_group_member WHERE group_id=$g AND device_id=$d", ("$g", x.G), ("$d", x.D)); moved++; }
        }
        try { _db.DeleteSetting("zone.claims"); } catch { }
        _db.SetSetting(ModelKey, "2"); return moved;
    }

    // ---------------- 0.6.8 zone fix: a real "Everywhere" zone instead of the hidden house fallback ----------------
    public const string EverywhereKey = "zones.everywhere", EverywhereName = "Everywhere";
    /// <summary>
    /// 0.6.8 zone fix. A speaker in no zone is silent now (ZoneLinks.Apply), so the house needs a real zone to play in. Runs once per database
    /// (setting <see cref="EverywhereKey"/>):
    /// <list type="bullet">
    /// <item>fresh setup (no speakers, no zones): nothing yet - the FIRST speaker that shows up goes into a new "Everywhere" zone (<see cref="AdoptFirstSpeaker"/>);</item>
    /// <item>upgrade of a house without any named zone (every speaker played in the hidden house group): "Everywhere" is created with all of those
    ///   speakers. It plays in the house group, so the music and queue carry on exactly as before;</item>
    /// <item>upgrade of a house that already has named zones: nothing changes. Speakers outside every zone go silent (the UI already said so).</item>
    /// </list>
    /// It also clears a reference speaker that 0.6.8-#15 picked by itself for a one-speaker zone (no speaker is REF until the user picks one).
    /// Returns what it did ("pending", "created", "kept") for the log and the tests.
    /// </summary>
    public string MigrateEverywhere()
    {
        var done = _db.Setting(EverywhereKey); if (done is "done" or "pending") return "skipped";
        DropAutoReferences();
        bool hasZones = Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group")) > 0;
        if (hasZones) { _db.SetSetting(EverywhereKey, "done"); return "kept"; }
        var devs = _db.Query("SELECT id FROM zone ORDER BY sort,id", r => r.GetInt64(0));
        if (devs.Count == 0) { _db.SetSetting(EverywhereKey, "pending"); return "pending"; }
        var (_, err) = CreateGroup(EverywhereName, devs); if (err != null) { _log?.Invoke("everywhere zone: " + err); return "failed"; }
        _db.SetSetting(EverywhereKey, "done"); _log?.Invoke($"zones: created \"{EverywhereName}\" with {devs.Count} speaker(s) that played in the house group"); return "created";
    }
    /// <summary>0.6.8 zone fix: the first speaker of a fresh setup goes into a new "Everywhere" zone. Only while the setup is still waiting for it
    /// (<see cref="MigrateEverywhere"/> left "pending"); later speakers wait in Unassigned, silent, until the user adds them to a zone.</summary>
    public void AdoptFirstSpeaker(long deviceId)
    {
        if (_db.Setting(EverywhereKey) != "pending") return;
        _db.SetSetting(EverywhereKey, "done");
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group")) > 0) return;   // the user made a zone before any speaker came
        var (_, err) = CreateGroup(EverywhereName, new[] { deviceId }); if (err != null) _log?.Invoke("everywhere zone: " + err);
    }
    /// <summary>0.6.8 zone fix: 0.6.8-#15 auto-picked the only speaker of a zone as its reference. Forget those picks once (a reference that is also the
    /// house reference the user chose is kept), so a lone speaker shows NO DELAY instead of REF until the user picks a reference.</summary>
    void DropAutoReferences()
    {
        lock (_refLock)
        {
            var stored = ZoneRefs.ParseMap(_db.Setting(ZoneRefs.MapKey)); if (stored == null || stored.Count == 0) return;
            var members = _db.Query("SELECT group_id,device_id FROM zone_group_member", r => (G: r.GetInt64(0), D: r.GetInt64(1))).ToLookup(x => x.G, x => x.D);
            long house = ReferenceZoneId; var keep = stored.Where(kv => !(members[kv.Key].Count() == 1 && members[kv.Key].First() == kv.Value && kv.Value != house)).ToDictionary(kv => kv.Key, kv => kv.Value);
            if (keep.Count != stored.Count) _db.SetSetting(ZoneRefs.MapKey, ZoneRefs.MapJson(keep));
        }
    }

    public string? UpdateGroup(long id, string? name, IEnumerable<long>? devices)
    {
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group WHERE id=$i", ("$i", id))) == 0) return "zone not found";
        if (name != null)
        {
            var err = CheckName(ref name); if (err != null) return err;
            if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group WHERE name=$n COLLATE NOCASE AND id<>$i", ("$n", name), ("$i", id))) > 0) return "there is already a zone with that name";
            _db.Exec("UPDATE zone_group SET name=$n WHERE id=$i", ("$n", name), ("$i", id));
        }
        SetMembers(id, devices); Links?.Apply(); _ev.Publish("zones"); return null;
    }

    /// <summary>Removes a zone (the group and its membership list). The devices stay; they move to Unassigned and go silent.
    /// 0.6.8 zone fix: the zone's music goes with it. Its own playback group is dropped (stopped, queue forgotten) by ZoneLinks.Apply; when it played in
    /// the house group and no other zone does any more, the house group is stopped and emptied too - nothing keeps playing for a zone that is gone, and
    /// no queue is left behind under its old name.</summary>
    public string? DeleteGroup(long id)
    {
        var g = Groups().FirstOrDefault(x => x.Id == id); if (g == null) return "zone not found";
        var pid = Links?.PlaybackId(id) ?? Conductor.DefaultGroupId;
        _db.Exec("DELETE FROM zone_group_member WHERE group_id=$g", ("$g", id)); _db.Exec("DELETE FROM zone_group WHERE id=$g", ("$g", id)); Links?.Forget(id);
        bool houseUsed = Links?.ZoneList().Any(z => Links.PlaybackId(z.Id) == Conductor.DefaultGroupId) ?? false;
        if (pid == Conductor.DefaultGroupId && !houseUsed) _reg.Default.Clear();
        else if (Links?.ZoneList().Any(z => Links.PlaybackId(z.Id) == pid) == false) _reg.Get(pid)?.Stop();   // a group only this zone used (Prune normally drops it already)
        _ev.Publish("zones"); return null;
    }

    /// <summary>Plays here: switches on every device of this zone and switches the others off.</summary>
    public string? ActivateGroup(long id)
    {
        var g = Groups().FirstOrDefault(x => x.Id == id); if (g == null) return "zone not found";
        if (g.DeviceIds.Count == 0) return "this zone has no devices yet - add some first";
        foreach (var z in Zones()) Patch(z.Id, null, null, null, g.DeviceIds.Contains(z.Id));
        return null;
    }

    /// <summary>Forget a device: the server stops trusting it (token revoked, open connection closed with "unauthorized" so a still-running player shows "not paired") and it leaves every list and zone.</summary>
    public string? RemovePlayer(string playerId) { RemovePlayerRows(playerId); _ev.Publish("zones"); return null; }

    /// <summary>
    /// 0.2.3 U11: revoking a token takes everything that token owns off the device list at once. Before, only a PLAYER token (player_id set) was handled and
    /// only with ?removeFromList=1; revoking a paired phone/browser (a Control token, player_id null) left its "web-…" speakers (player.owner_token_id) in
    /// every list, still connected and still playing, because a speaker connection is only authorized when it opens. Now: every speaker owned by the token
    /// (by owner_token_id or by a live session it opened) is removed and its connection closed with "unauthorized"; the token's own player is removed too
    /// when <paramref name="removePlayer"/> (else it is signed out and stays listed as offline, as before). One "zones" event tells every open page.
    /// The caller revokes the token first, so a reconnect is refused and the device has to pair again.
    /// </summary>
    public IReadOnlyList<string> RemoveOwnedBy(long tokenId, string? tokenPlayerId, bool removePlayer)
    {
        var ids = _db.Query("SELECT id FROM player WHERE owner_token_id=$t", r => r.GetString(0), ("$t", tokenId)).ToList();
        foreach (var s in _host.Sessions) if (s.OwnerTokenId == tokenId && !ids.Contains(s.Id)) ids.Add(s.Id);
        if (tokenPlayerId != null && removePlayer && !ids.Contains(tokenPlayerId)) ids.Add(tokenPlayerId);
        foreach (var id in ids) RemovePlayerRows(id);
        if (tokenPlayerId != null && !removePlayer) _host.Get(tokenPlayerId)?.CloseUnauthorized();
        _ev.Publish("zones"); return ids;
    }

    private void RemovePlayerRows(string playerId)
    {
        try { ExternalRemoved?.Invoke(playerId); } catch (Exception e) { _log?.Invoke("remove external " + playerId + ": " + e.Message); }
        foreach (var zid in _db.Query("SELECT id FROM zone WHERE player_id=$p", r => r.GetInt64(0), ("$p", playerId))) _db.Exec("DELETE FROM zone_group_member WHERE device_id=$d", ("$d", zid));
        _db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", playerId));
        _host.Get(playerId)?.CloseUnauthorized();
        _reg.Forget(playerId);
        _db.Exec("DELETE FROM zone WHERE player_id=$p", ("$p", playerId));
        _db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", playerId));
        _db.Exec("DELETE FROM output_endpoint WHERE player_id=$p", ("$p", playerId));
        _db.Exec("DELETE FROM player WHERE id=$p", ("$p", playerId)); Rooms.Forget(playerId); _lastHealth.Remove(playerId);
    }
}
