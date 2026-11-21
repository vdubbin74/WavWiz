using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>
/// 0.7.2 t2175u: "Sync with WavWiz" for this PC's sound (Settings > Devices > Audio inputs > This PC · Speakers). While the loopback input plays
/// in Sync mode: Windows' default output (all three roles) moves to a spare, unused output; the process loopback keeps recording every app (it
/// follows processes, not devices) and the Player plays the house-synced copy on the real speakers (its own output is pinned there). Off, a lost
/// link, Exit, sign-out, the tray "Restore my speakers" and the next start after a crash put the previous defaults back (restore file written
/// BEFORE the switch). If the spare output goes away the Player goes back to Real time and tells the server.
/// Windows has no public API to change the default output: this uses the undocumented IPolicyConfig COM interface exactly as EarTrumpet and
/// SoundSwitch do (see <see cref="IPolicyConfig"/>).
/// </summary>
public sealed class LocalSync : IDisposable
{
    private readonly Action<string> _log; private readonly Action<string> _pinOutput; private readonly Func<string, string, Task> _fallback; private readonly Func<double?> _level; private float? _savedDb;
    private readonly string _file = Path.Combine(PlayerSettings.Dir, "localsync-restore.json");
    private readonly object _l = new(); private System.Threading.Timer? _watch; private LocalSyncState? _on;

    /// <param name="pinOutput">switch the Player's own output to these speakers (PlayerClient.SwitchOutput).</param>
    /// <param name="fallback">(inputId, why): tell the server the Player went back to Real time by itself.</param>
    /// <param name="level">the WavWiz volume (percent) this PC plays at now, null when unknown (0.7.2 t2192u: the hand-back level match).</param>
    public LocalSync(Action<string> log, Action<string> pinOutput, Func<string, string, Task> fallback, Func<double?>? level = null) { _log = log; _pinOutput = pinOutput; _fallback = fallback; _level = level ?? (() => null); }

    public bool Active { get { lock (_l) return _on != null; } }
    /// <summary>The loopback input that is synced now (null when not synced).</summary>
    public string? CurrentInput { get { lock (_l) return _on?.InputId; } }
    /// <summary>A restore file is waiting (switched now, or left over by a crash).</summary>
    public bool Pending => _on != null || File.Exists(_file);

    public void Handle(InputCmd c)
    {
        if (c.Action == LocalSyncRules.Off) { Restore("off"); return; }
        if (c.Action != LocalSyncRules.On || c.InputId is not { Length: > 0 } id) return;
        var why = Apply(id, c.Spare, c.Speakers);
        if (why != null) { _log("localsync: " + why); _ = _fallback(id, why); }
    }

    /// <summary>Returns null when switched, else why not (and nothing is changed).</summary>
    private string? Apply(string inputId, string? spare, string? speakers)
    {
        lock (_l)
        {
            if (_on != null && _on.Spare == spare && _on.Speakers == speakers) return null;
            if (_on != null) RestoreNoLock("changed");
            using var en = new MMDeviceEnumerator();
            bool Ok(string? id) { if (string.IsNullOrEmpty(id)) return false; try { using var d = en.GetDevice(id); return d.DataFlow == DataFlow.Render && d.State == DeviceState.Active; } catch { return false; } }
            if (string.IsNullOrEmpty(spare) || string.IsNullOrEmpty(speakers) || spare == speakers) return "Pick a spare output and different speakers. Playing in Real time.";
            if (!Ok(speakers)) return "Those speakers are not available. Playing in Real time.";
            if (!Ok(spare)) return "The spare output is not available (is the monitor or device switched on?). Playing in Real time.";
            string? Def(Role r) { try { using var d = en.GetDefaultAudioEndpoint(DataFlow.Render, r); return d.ID; } catch { return null; } }
            var st = new LocalSyncState(inputId, spare, speakers, Def(Role.Console), Def(Role.Multimedia), Def(Role.Communications));
            // a left-over file from a crash is never overwritten with spare-as-previous: restore it first
            if (File.Exists(_file)) RestoreNoLock("left over");
            try { Directory.CreateDirectory(PlayerSettings.Dir); File.WriteAllText(_file, LocalSyncRules.Serialize(st)); }
            catch (Exception e) { return "Could not save the restore file (" + e.Message + "). Playing in Real time."; }
            try { _pinOutput(speakers); } catch (Exception e) { _log("localsync: pin output failed: " + e.Message); }
            try { SetDefaultAll(spare, st); }
            catch (Exception e) { RestoreNoLock("switch failed"); return "Windows did not switch to the spare output (" + e.Message + "). Playing in Real time."; }
            _savedDb = null; try { using var sp = en.GetDevice(speakers); _savedDb = sp.AudioEndpointVolume.MasterVolumeLevel; } catch { }   // t2192u: the level when Sync started
            _on = st; _log($"localsync: on (spare {spare}, speakers {speakers}{(_savedDb is { } sd ? $", speakers at {sd:0.0} dB" : "")})");
            _watch = new System.Threading.Timer(_ => Check(), null, 3000, 3000);
            return null;
        }
    }

    private void Check()
    {
        LocalSyncState? st; lock (_l) st = _on; if (st == null) return;
        bool ok;
        try { using var en = new MMDeviceEnumerator(); ok = Alive(en, st.Spare) && Alive(en, st.Speakers); } catch { ok = true; }   // can't tell: keep going
        if (ok) return;
        Restore("device gone");
        _ = _fallback(st.InputId, "The spare output or the speakers went away. Back to Real time.");
        static bool Alive(MMDeviceEnumerator en, string id) { try { using var d = en.GetDevice(id); return d.State == DeviceState.Active; } catch { return false; } }
    }

    /// <summary>Put Windows' previous default outputs back (also a file left over by a crash). Safe to call any time, from any thread.</summary>
    public void Restore(string why) { lock (_l) RestoreNoLock(why); }

    private void RestoreNoLock(string why)
    {
        _watch?.Dispose(); _watch = null;
        string? text = null; try { if (File.Exists(_file)) text = File.ReadAllText(_file); } catch { }
        var live = _on; var st = LocalSyncRules.Parse(text) ?? _on; _on = null;
        if (st == null) { try { File.Delete(_file); } catch { } return; }
        if (live != null && LocalSyncRules.MatchesLevel(why)) MatchLevel(live.Speakers);   // first, so the apps never come back loud
        bool allOk = true;
        foreach (var (prev, role) in new[] { (st.PrevConsole, ERole.Console), (st.PrevMultimedia, ERole.Multimedia), (st.PrevCommunications, ERole.Communications) })
        {
            if (string.IsNullOrEmpty(prev)) continue;
            try { Policy().SetDefaultEndpoint(prev, role); } catch (Exception e) { allOk = false; _log($"localsync: restore {role} failed: {e.Message}"); }
        }
        if (allOk) { try { File.Delete(_file); } catch { } }    // keep the file when something failed: the next start tries again
        _log($"localsync: restored ({why}){(allOk ? "" : " - partly; will retry at the next start")}");
    }

    /// <summary>0.7.2 t2192u: lower (never raise) the speakers' Windows volume so the apps keep the level heard through WavWiz.</summary>
    private void MatchLevel(string speakers)
    {
        try
        {
            double? pct = null; try { pct = _level(); } catch { }
            using var en = new MMDeviceEnumerator(); using var d = en.GetDevice(speakers);
            var ev = d.AudioEndpointVolume; var cur = ev.MasterVolumeLevel;
            if (LocalSyncRules.HandBackDb(cur, _savedDb, pct, ev.VolumeRange.MinDecibels, ev.VolumeRange.MaxDecibels) is not { } t) return;
            ev.MasterVolumeLevel = t;
            _log($"localsync: speakers {cur:0.0} -> {t:0.0} dB to keep the WavWiz level ({pct:0}%)");
        }
        catch (Exception e) { _log("localsync: level match skipped: " + e.Message); }
        finally { _savedDb = null; }
    }

    /// <summary>Console + Multimedia always; Communications only when calls were going to the speakers too (0.7.2 t2189u: on PCBOXV2 the HyperX is the
    /// communications device for chat; moving it to the spare would silence calls, and it never played through the speakers anyway).</summary>
    private static void SetDefaultAll(string id, LocalSyncState st)
    {
        var p = Policy(); p.SetDefaultEndpoint(id, ERole.Console); p.SetDefaultEndpoint(id, ERole.Multimedia);
        if (LocalSyncRules.MoveCommunications(st)) p.SetDefaultEndpoint(id, ERole.Communications);
    }
    private static IPolicyConfig Policy() => (IPolicyConfig)new PolicyConfigClient();

    public void Dispose() { Restore("closing"); }

    // ---------------- undocumented Windows interop ----------------
    // Source: EarTrumpet (github.com/File-New-Project/EarTrumpet), EarTrumpet/Interop/MMDeviceAPI/IPolicyConfig.cs (IPolicyConfigWin7,
    // "Win7-Win8, W10_RS1-Present") and PolicyConfigClient.cs; the same GUIDs are used by SoundSwitch (AudioDefaultSwitcher / CPolicyConfigClient).
    // Only SetDefaultEndpoint is called; the slots before it keep the vtable order (8 unused methods, GetPropertyValue, SetPropertyValue).
    private enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        void Unused1(); void Unused2(); void Unused3(); void Unused4(); void Unused5(); void Unused6(); void Unused7(); void Unused8();
        void GetPropertyValue(); void SetPropertyValue();
        void SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, ERole eRole);
        void SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, [MarshalAs(UnmanagedType.I2)] short isVisible);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    private class PolicyConfigClient { }
}
