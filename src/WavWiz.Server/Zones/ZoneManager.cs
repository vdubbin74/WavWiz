using System.Text.Json;
using WavWiz.Core.Calibration;
using WavWiz.Core.Protocol;
using WavWiz.Server.Dsp;
using WavWiz.Server.Net;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Zones;

public sealed record OutputDto(long EndpointDbId, string DeviceId, string EndpointId, string Name, string Kind, string? BtAddress, bool Connected, bool Active,
    double LatencyMs, string LatencySource, string Label, bool NotCalibrated, bool RecheckDue, string? Reason, double? WinLatencyMs, string? Codec, int? DspPresetId, bool DspBypass);
public sealed record ZoneDto(long Id, string Name, string PlayerId, bool Connected, bool Enabled, double Volume, bool Muted, string? ActiveDeviceId, string? ActiveEndpointId,
    string Badge, string BadgeText, double? SyncErrorMs, double? BufferMs, int? Underruns, int? HardResyncs, double? RatioPpm, string? Link, string? RemoteIp, string? Health, List<OutputDto> Outputs, RoomState? Room = null, bool IsWeb = false, List<long>? GroupIds = null);
public sealed record ZoneGroupDto(long Id, string Name, List<long> DeviceIds, int Members, int Online, int Enabled, bool Active);

/// <summary>
/// 1 player = 1 zone for the beta (spec 12). Keeps the zone rows, resolves each output's delay through <see cref="CalibrationLookup"/> and pushes
/// ZONE_UPDATE / DSP_CONFIG to the player whenever anything that affects it changes. "Unknown is never zero": an uncalibrated output is flagged, not silently 0.
/// </summary>
public sealed class ZoneManager
{
    private readonly Db _db; private readonly AudioHost _host; private readonly Conductor _cond; private readonly EventHub _ev; private readonly DspService _dsp;
    private readonly object _l = new();
    private readonly Dictionary<string, string> _lastHealth = new();
    public Action<string>? Log { get => _log; set { _log = value; Rooms.Log = value; } }
    public Action? AfterOutputsChanged;
    private Action<string>? _log;
    public readonly RoomHealth Rooms = new();

    public ZoneManager(Db db, AudioHost host, Conductor cond, EventHub ev, DspService dsp)
    {
        _db = db; _host = host; _cond = cond; _ev = ev; _dsp = dsp;
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
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone WHERE player_id=$p", ("$p", s.Id))) == 0)
        {
            int sort = Convert.ToInt32(_db.Scalar("SELECT COALESCE(MAX(sort),0)+1 FROM zone"));
            _db.Insert("INSERT INTO zone(name,player_id,sort) VALUES($n,$p,$s)", ("$n", string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name), ("$p", s.Id), ("$s", sort));
        }
        Rooms.Connected(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, s.Hello.LinkType, s.Remote.ToString());
        var z = ZoneRow(s.Id)!;
        PushZone(s); PushDsp(s);
        if (z.Enabled) _cond.Subscribe(s);
        _ev.Publish("zones");
        return Task.CompletedTask;
    }

    private void OnDisconnected(PlayerSession s)
    {
        Rooms.Disconnected(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, s.EndReason ?? "connection closed");
        _cond.Unsubscribe(s.Id);
        _db.Exec("UPDATE output_endpoint SET connected=0 WHERE player_id=$p", ("$p", s.Id));
        _db.Exec("UPDATE player SET last_seen_at=$t WHERE id=$p", ("$t", DateTimeOffset.UtcNow.ToString("O")), ("$p", s.Id));
        _ev.Publish("zones");
    }

    private void OnStatus(PlayerSession s, PlayerStatus st)
    {
        // health transitions are events; the 1 Hz status itself is not broadcast (the UI polls /zones every 2 s while visible)
        Rooms.Status(s.Id, string.IsNullOrWhiteSpace(s.Hello.Name) ? s.Hello.MachineName : s.Hello.Name, st, StreamPlaying);
        string h = Health(s) + Rooms.State(s.Id, true, st, StreamPlaying, StreamAgeMs).State;
        if (!_lastHealth.TryGetValue(s.Id, out var prev) || prev != h) { _lastHealth[s.Id] = h; _ev.Publish("zones"); }
    }

    public bool StreamPlaying => _cond.State == PlayState.Playing && _cond.Engine.Playing;
    public long StreamAgeMs => _cond.Engine.Playing ? (_cond.Clock.NowUs - _cond.Engine.EpochStartUs) / 1000 : 0;

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
            if (active != null) { _db.Exec("UPDATE zone SET active_output_device_id=$d WHERE player_id=$p", ("$d", keys[active.EndpointId]), ("$p", s.Id)); }
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

    public List<ZoneDto> Zones()
    {
        var res = new List<ZoneDto>();
        var rows = _db.Query("SELECT id,name,player_id,enabled,volume,muted,active_output_device_id,sort FROM zone ORDER BY sort,id",
            r => new ZRow(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3) != 0, r.GetDouble(4), r.GetInt32(5) != 0, r.IsDBNull(6) ? null : r.GetString(6), r.GetInt32(7)));
        var memberships = _db.Query("SELECT device_id,group_id FROM zone_group_member", r => (Dev: r.GetInt64(0), Grp: r.GetInt64(1))).ToLookup(x => x.Dev, x => x.Grp);
        foreach (var z in rows)
        {
            var s = _host.Get(z.PlayerId); var st = s?.Status;
            var eps = _db.Query("SELECT e.id,e.output_device_id,e.win_endpoint_id,d.friendly_name,d.kind,d.bt_address,e.connected FROM output_endpoint e JOIN output_device d ON d.id=e.output_device_id WHERE e.player_id=$p ORDER BY d.friendly_name",
                r => (Id: r.GetInt64(0), Dev: r.GetString(1), Ep: r.GetString(2), Name: r.GetString(3), Kind: r.GetString(4), Bt: r.IsDBNull(5) ? null : r.GetString(5), Conn: r.GetInt32(6) != 0), ("$p", z.PlayerId));
            var activeEp = s?.Outputs.FirstOrDefault(o => o.Active)?.EndpointId;
            var outs = new List<OutputDto>();
            foreach (var e in eps)
            {
                var live = s?.Outputs.FirstOrDefault(o => o.EndpointId == e.Ep);
                var r = Resolve(e.Dev, ParseKind(e.Kind), z.PlayerId, false, live?.Codec, live?.WinLatencyMs);
                var a = _dsp.AssignmentFor(e.Dev);
                outs.Add(new OutputDto(e.Id, e.Dev, e.Ep, e.Name, e.Kind, e.Bt, s != null && (live?.Connected ?? false), e.Ep == activeEp, r.LatencyMs, SourceName(r.Source), r.Label, r.NotCalibrated, r.RecheckDue, r.Reason, live?.WinLatencyMs, live?.Codec, (int?)a?.PresetId, a?.Bypass ?? false));
            }
            var act = outs.FirstOrDefault(o => o.Active);
            string badge, text;
            if (s == null) { badge = "offline"; text = "OFFLINE"; }
            else if (act == null) { badge = "nooutput"; text = "NO OUTPUT"; }
            else if (act.NotCalibrated) { badge = "uncalibrated"; text = "NOT CALIBRATED"; }
            else if (act.RecheckDue) { badge = "recheck"; text = "RE-CHECK DUE"; }
            else if (st != null && !(s?.IsWeb ?? false) && Math.Abs(st.SyncErrorMs) > 3) { badge = "drifting"; text = "RESYNCING"; }
            else { badge = "synced"; text = "SYNCED"; }
            res.Add(new ZoneDto(z.Id, z.Name, z.PlayerId, s != null, z.Enabled, z.Volume, z.Muted, act?.DeviceId ?? z.ActiveDevice, act?.EndpointId, badge, text,
                (s?.IsWeb ?? false) ? null : st?.SyncErrorMs, st?.BufferMs, st?.Underruns, st?.HardResyncs, st?.RatioPpm, s?.LinkType, s?.Remote.ToString(), s == null ? null : Health(s), outs, Rooms.State(z.PlayerId, s != null, st, StreamPlaying, StreamAgeMs), s?.IsWeb ?? z.PlayerId.StartsWith("web-"), memberships[z.Id].OrderBy(x => x).ToList()));
        }
        return res;
    }

    public ZoneDto? Zone(long id) => Zones().FirstOrDefault(z => z.Id == id);

    // ---------------- user actions ----------------
    public string? Patch(long id, string? name, double? volume, bool? muted, bool? enabled)
    {
        var z = ZoneRow(id); if (z == null) return "zone not found";
        if (name != null) { name = name.Trim(); if (name.Length is 0 or > 60) return "name must be 1-60 characters"; _db.Exec("UPDATE zone SET name=$n WHERE id=$i", ("$n", name), ("$i", id)); }
        if (volume != null) { if (!double.IsFinite(volume.Value)) return "volume must be a number"; _db.Exec("UPDATE zone SET volume=$v WHERE id=$i", ("$v", Math.Clamp(volume.Value, 0, 100)), ("$i", id)); }
        if (muted != null) _db.Exec("UPDATE zone SET muted=$m WHERE id=$i", ("$m", muted.Value ? 1 : 0), ("$i", id));
        if (enabled != null) _db.Exec("UPDATE zone SET enabled=$e WHERE id=$i", ("$e", enabled.Value ? 1 : 0), ("$i", id));
        var s = _host.Get(z.PlayerId);
        if (s != null)
        {
            PushZone(s);
            if (enabled == true) _cond.Subscribe(s); else if (enabled == false) _cond.Unsubscribe(s.Id);
        }
        _ev.Publish("zones"); return null;
    }

    /// <summary>Master volume: relative (delta in points) or scale (factor) so the balance between rooms is kept.</summary>
    public void Master(double? delta, double? scale, double? set)
    {
        foreach (var z in Zones())
        {
            double v = z.Volume;
            if (delta != null) v += delta.Value; else if (scale != null) v *= scale.Value; else if (set != null) v = set.Value;
            Patch(z.Id, null, Math.Clamp(v, 0, 100), null, null);
        }
    }

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
        s.SendJson(MsgType.CalCmd, new CalCmd("test-tone", "test", _cond.Clock.NowUs + 800_000, -18, z.Name));
        Rooms.Note(z.PlayerId, "test sound requested"); return null;
    }

    public string? ZonePlayer(long zoneId) => ZoneRow(zoneId)?.PlayerId;
    public string? ZoneActiveDevice(long zoneId) { var s = ZonePlayer(zoneId) is string p ? _host.Get(p) : null; return s == null ? null : ActiveDeviceKey(s); }

    // ---------------- zones = optional groups of devices (0.0.3) ----------------
    public List<ZoneGroupDto> Groups()
    {
        var devs = _db.Query("SELECT id,player_id,enabled FROM zone", r => (Id: r.GetInt64(0), Player: r.GetString(1), On: r.GetInt32(2) != 0)).ToDictionary(x => x.Id);
        var mem = _db.Query("SELECT group_id,device_id FROM zone_group_member", r => (G: r.GetInt64(0), D: r.GetInt64(1))).ToLookup(x => x.G, x => x.D);
        var res = new List<ZoneGroupDto>();
        foreach (var g in _db.Query("SELECT id,name FROM zone_group ORDER BY sort,id", r => (Id: r.GetInt64(0), Name: r.GetString(1))))
        {
            var ids = mem[g.Id].Where(devs.ContainsKey).OrderBy(x => x).ToList();
            int online = ids.Count(i => _host.Get(devs[i].Player) != null), on = ids.Count(i => devs[i].On);
            // ACTIVE = exactly this group's devices are switched on (every other device is off)
            bool active = ids.Count > 0 && on == ids.Count && devs.Values.Count(d => d.On) == ids.Count;
            res.Add(new ZoneGroupDto(g.Id, g.Name, ids, ids.Count, online, on, active));
        }
        return res;
    }

    private static string? CheckName(ref string? name)
    {
        name = (name ?? "").Trim(); return name.Length is 0 or > 60 ? "a zone name must be 1-60 characters" : null;
    }

    public (long Id, string? Error) CreateGroup(string? name, IEnumerable<long>? devices)
    {
        var err = CheckName(ref name); if (err != null) return (0, err);
        if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone_group WHERE name=$n COLLATE NOCASE", ("$n", name))) > 0) return (0, "there is already a zone with that name");
        var id = _db.Insert("INSERT INTO zone_group(name,sort,created_at) VALUES($n,(SELECT COALESCE(MAX(sort),0)+1 FROM zone_group),$t)", ("$n", name), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        SetMembers(id, devices); _ev.Publish("zones"); return (id, null);
    }

    private void SetMembers(long group, IEnumerable<long>? devices)
    {
        if (devices == null) return;
        _db.Exec("DELETE FROM zone_group_member WHERE group_id=$g", ("$g", group));
        foreach (var d in devices.Distinct())
            if (Convert.ToInt32(_db.Scalar("SELECT COUNT(*) FROM zone WHERE id=$i", ("$i", d))) > 0) _db.Exec("INSERT OR IGNORE INTO zone_group_member(group_id,device_id) VALUES($g,$d)", ("$g", group), ("$d", d));
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
        SetMembers(id, devices); _ev.Publish("zones"); return null;
    }

    /// <summary>Removes a zone (the group and its membership list). The devices stay; they just fall back to Unassigned. Playback is stopped first if this zone is the one playing.</summary>
    public string? DeleteGroup(long id)
    {
        var g = Groups().FirstOrDefault(x => x.Id == id); if (g == null) return "zone not found";
        if (g.Active && _cond.State != PlayState.Stopped) _cond.Stop();
        _db.Exec("DELETE FROM zone_group_member WHERE group_id=$g", ("$g", id)); _db.Exec("DELETE FROM zone_group WHERE id=$g", ("$g", id));
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
    public string? RemovePlayer(string playerId)
    {
        foreach (var zid in _db.Query("SELECT id FROM zone WHERE player_id=$p", r => r.GetInt64(0), ("$p", playerId))) _db.Exec("DELETE FROM zone_group_member WHERE device_id=$d", ("$d", zid));
        _db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", playerId));
        _host.Get(playerId)?.CloseUnauthorized();
        _cond.Unsubscribe(playerId);
        _db.Exec("DELETE FROM zone WHERE player_id=$p", ("$p", playerId));
        _db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", playerId));
        _db.Exec("DELETE FROM output_endpoint WHERE player_id=$p", ("$p", playerId));
        _db.Exec("DELETE FROM player WHERE id=$p", ("$p", playerId)); Rooms.Forget(playerId);
        _ev.Publish("zones"); return null;
    }
}
