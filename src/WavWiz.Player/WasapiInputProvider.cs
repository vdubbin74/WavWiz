using NAudio.CoreAudioApi;
using NAudio.Wave;
using WavWiz.Core.Calibration;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>
/// 0.7.2: this PC's audio inputs for the server (only the Player on the server PC is asked to capture):
/// <list type="bullet">
/// <item>capture endpoints - Aux / line in (PKEY_AudioEndpoint_FormFactor LineLevel or the name), S/PDIF in (form factor SPDIF or the name) and
/// microphones / headset mics - captured in shared mode with the same polled IAudioCaptureClient loop as PC-mic calibration (<see cref="WasapiMicProvider"/>);</item>
/// <item>"This PC · Speakers": on Windows 10 2004+ process loopback that EXCLUDES this Player's own process tree (NAudio's
/// <see cref="WasapiRecorderBuilder.WithProcessLoopback"/> + <see cref="ProcessLoopbackMode.ExcludeTargetProcessTree"/>, built with BuildAsync as
/// process loopback requires), so WavWiz never records itself; on older Windows a whole-device loopback of the default speakers, refused when WavWiz
/// itself plays through them (<see cref="InputRules.DeviceLoopbackRefusal"/>).</item>
/// </list>
/// "Stereo Mix"-style capture devices are not listed (they would record WavWiz). Everything goes out as 1 or 2 channel float at the device rate; the
/// server resamples. UNVERIFIED ON WINDOWS: compiled on Linux against NAudio.Wasapi 3.1.0 (APIs checked by reflection) and exercised through the same
/// InputResponder with a synthetic provider. First things to check on a real PC: process loopback on 2004+, line-in form factors of common
/// Realtek / USB interfaces, and 24-bit integer mix formats.
/// </summary>
public sealed class WasapiInputProvider : IInputProvider, IDisposable
{
    private readonly MMDeviceEnumerator _enum = new(); private readonly Action<string> _log;
    private static readonly PropertyKey FormFactor = new(new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), 0);
    private static readonly PropertyKey ControllerDeviceId = new(new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc"), 2);
    private static readonly PropertyKey EnumeratorName = new(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);
    /// <summary>The endpoint WavWiz itself is playing on at the moment (for the old-Windows echo guard). Set by PlayerApp once the client exists.</summary>
    public Func<string?> ActiveOutput { get; set; } = () => null;
    private readonly bool _process = InputRules.ProcessLoopbackSupported(Environment.OSVersion.Version);

    public WasapiInputProvider(Action<string> log) { _log = log; }

    public IReadOnlyList<InputInfo> List()
    {
        var res = new List<InputInfo>();
        res.Add(_process
            ? new InputInfo(InputIds.ProcessLoopback, "This PC · Speakers (what you hear)", "loopback", Note: "process")
            : new InputInfo(InputRules.DeviceLoopback, "This PC · Speakers (what you hear)", "loopback", Note: "device"));
        string? defMic = null;
        try { if (_enum.TryGetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications, out var d) && d != null) { defMic = d.ID; d.Dispose(); } } catch { }
        try
        {
            foreach (var d in _enum.EnumerateAudioEndPoints(DataFlow.Capture, NAudio.CoreAudioApi.DeviceState.Active))
                using (d)
                {
                    string name = Safe(() => d.FriendlyName) ?? d.ID;
                    int ff = int.TryParse(Prop(d, FormFactor), out var f) ? f : 10;
                    var kind = InputRules.Classify(name, ff); if (kind == null) continue;
                    bool bt = MicKinds.IsBluetooth(name, Prop(d, ControllerDeviceId), Prop(d, EnumeratorName));
                    res.Add(new InputInfo(d.ID, name, kind, bt, kind == "mic" && d.ID == defMic));
                }
        }
        catch { /* audio service restarting: what we have */ }
        return res;
    }

    public IDisposable Start(string inputId, Action<float[], int, int> onBlock, Action<string> onError)
    {
        if (inputId == InputIds.ProcessLoopback) return StartRecorder(inputId, ProcessRecorder(), onBlock, onError);
        if (inputId == InputRules.DeviceLoopback) return StartRecorder(inputId, DeviceLoopbackRecorder(), onBlock, onError);
        try { return StartEndpoint(inputId, onBlock, onError); }
        catch (Exception e) when (InputRules.IsAccessDenied(e) && MicConsent.Denied()) { throw new MicPrivacyException(e); }
    }

    // ---------------- loopback (NAudio WasapiRecorder) ----------------
    private WasapiRecorder ProcessRecorder()
    {
        // NAudio marks WithProcessLoopback as Windows 10.0.19041+ (the same build InputRules uses); this check is the one the analyzer understands
        if (!_process || !OperatingSystem.IsWindowsVersionAtLeast(10, 0, InputRules.ProcessLoopbackBuild)) throw new NotSupportedException("needs Windows 10 version 2004 or later");
        // BuildAsync: process loopback activates asynchronously (ActivateAudioInterfaceAsync); there is no mix format, so the format is explicit.
        return new WasapiRecorderBuilder()
            .WithProcessLoopback((uint)Environment.ProcessId, ProcessLoopbackMode.ExcludeTargetProcessTree)
            .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(48000, 2))
            .WithSharedMode()
            .BuildAsync().GetAwaiter().GetResult();
    }

    private WasapiRecorder DeviceLoopbackRecorder()
    {
        var render = _enum.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        var refusal = InputRules.DeviceLoopbackRefusal(render.ID, ActiveOutput());
        if (refusal != null) { render.Dispose(); throw new InvalidOperationException(refusal); }
        return new WasapiRecorderBuilder().WithDevice(render).WithLoopbackCapture().WithSharedMode().Build();
    }

    private IDisposable StartRecorder(string id, WasapiRecorder rec, Action<float[], int, int> onBlock, Action<string> onError)
    {
        var fmt = rec.WaveFormat;
        bool isFloat = fmt.Encoding == WaveFormatEncoding.IeeeFloat || (fmt is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
        int bits = fmt.BitsPerSample, ch = fmt.Channels, rate = fmt.SampleRate;
        var stopping = 0;
        rec.DataAvailable += (data, flags, _, _) =>
        {
            float[] f;
            if ((flags & AudioClientBufferFlags.Silent) != 0) f = new float[data.Length / Math.Max(1, bits / 8)];   // "silent" packets: zeros, keep the clock going
            else f = InputRules.ToFloat(data, bits, isFloat);
            var o = InputRules.ToStereoOrMono(f, ch, out var oc);
            if (o.Length > 0) onBlock(o, rate, oc);
        };
        rec.RecordingStopped += (_, e) => { if (Volatile.Read(ref stopping) == 0) onError(e.Exception?.Message ?? "capture stopped"); };
        rec.StartRecording();
        _log($"input {id}: capturing {rate} Hz {ch} ch {bits}-bit{(isFloat ? " float" : "")}");
        return new Handle(() => { Volatile.Write(ref stopping, 1); try { rec.StopRecording(); } catch { } try { rec.Dispose(); } catch { } });
    }

    // ---------------- capture endpoints (same polled loop as PC-mic calibration) ----------------
    private IDisposable StartEndpoint(string id, Action<float[], int, int> onBlock, Action<string> onError)
    {
        var dev = _enum.GetDevice(id);      // throws for a device that went away: the responder reports it
        AudioClient client;
        try { client = dev.CreateAudioClient(); } catch { dev.Dispose(); throw; }
        var mix = client.MixFormat; int ch = mix.Channels, bits = mix.BitsPerSample, rate = mix.SampleRate;
        bool isFloat = mix.Encoding == WaveFormatEncoding.IeeeFloat || (mix is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
        try { client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.None, 1_000_000, 0, mix, Guid.Empty); }
        catch { client.Dispose(); dev.Dispose(); throw; }
        var cap = client.AudioCaptureClient; int frameBytes = Math.Max(1, ch * bits / 8);
        var cts = new CancellationTokenSource();
        client.Start();
        _log($"input {dev.FriendlyName}: capturing {rate} Hz {ch} ch {bits}-bit{(isFloat ? " float" : "")}");
        var thread = new Thread(() =>
        {
            try
            {
                while (!cts.IsCancellationRequested)
                {
                    Thread.Sleep(5);
                    while (cap.GetNextPacketSize() > 0)
                    {
                        var p = cap.GetBuffer(out int frames, out var flags, out long _, out long _);
                        float[] f;
                        if ((flags & AudioClientBufferFlags.Silent) != 0) f = new float[frames * ch];
                        else unsafe { f = InputRules.ToFloat(new ReadOnlySpan<byte>((void*)p, frames * frameBytes), bits, isFloat); }
                        cap.ReleaseBuffer(frames);
                        var o = InputRules.ToStereoOrMono(f, ch, out var oc);
                        if (o.Length > 0) onBlock(o, rate, oc);
                    }
                }
            }
            catch (Exception e) { if (!cts.IsCancellationRequested) { _log($"input {id} capture failed: {InputRules.Describe(e)}"); onError(InputRules.FailReason(InputRules.IsAccessDenied(e) && MicConsent.Denied() ? new MicPrivacyException(e) : e)); } }     // unplugged / driver reset; 0.7.2 t2170u: 0x80070005 = the privacy switch
            finally { try { client.Stop(); } catch { } try { client.Dispose(); } catch { } try { dev.Dispose(); } catch { } }
        }) { IsBackground = true, Name = "wavwiz-input", Priority = ThreadPriority.AboveNormal };
        thread.Start();
        return new Handle(() => cts.Cancel());
    }

    private sealed class Handle(Action a) : IDisposable { private int _done; public void Dispose() { if (Interlocked.Exchange(ref _done, 1) == 0) a(); } }
    private static string? Safe(Func<string> f) { try { return f(); } catch { return null; } }
    private static string? Prop(MMDevice d, PropertyKey k) { try { return d.Properties.Contains(k) ? d.Properties[k].Value?.ToString() : null; } catch { return null; } }
    public void Dispose() => _enum.Dispose();
}

/// <summary>0.7.2 t2176u: Windows' microphone consent store (Settings > Privacy & security > Microphone), read only. Deny anywhere that applies
/// to a desktop app (the machine switch, the user switch, "Let desktop apps access", or the AppPrivacy policy forcing deny) = privacy.</summary>
internal static class MicConsent
{
    private const string Store = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    public static bool Denied()
    {
        try
        {
            static string? V(Microsoft.Win32.RegistryKey root, string path) { using var k = root.OpenSubKey(path); return k?.GetValue("Value") as string; }
            bool deny(string? v) => string.Equals(v, "Deny", StringComparison.OrdinalIgnoreCase);
            var lm = Microsoft.Win32.Registry.LocalMachine; var cu = Microsoft.Win32.Registry.CurrentUser;
            if (deny(V(lm, Store)) || deny(V(cu, Store)) || deny(V(cu, Store + @"\NonPackaged"))) return true;
            using var pol = lm.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Windows\AppPrivacy");
            return pol?.GetValue("LetAppsAccessMicrophone") is int p && p == 2;
        }
        catch { return false; }   // can't read = unknown = not claimed as privacy
    }
}
