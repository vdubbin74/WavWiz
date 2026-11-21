using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
namespace WavWiz.PlayerCore;

/// <summary>
/// 0.7.2: this PC's audio inputs - Aux in (line in, a turntable through its preamp), S/PDIF in, microphones and headset mics, and
/// "what this PC is playing" (loopback). WASAPI in the Windows app (WasapiInputProvider); a synthetic source in tests.
/// </summary>
public interface IInputProvider
{
    IReadOnlyList<InputInfo> List();
    /// <summary>Open <paramref name="inputId"/> and call <paramref name="onBlock"/> with interleaved float blocks (any rate, 1 or 2 channels) until the
    /// returned handle is disposed. <paramref name="onError"/> is told once if capture stops by itself (device unplugged, driver error).</summary>
    IDisposable Start(string inputId, Action<float[], int, int> onBlock, Action<string> onError);
}

/// <summary>A PC with no inputs (Linux / Pi server player until M3, headless).</summary>
public sealed class NoInputProvider : IInputProvider
{
    public IReadOnlyList<InputInfo> List() => Array.Empty<InputInfo>();
    public IDisposable Start(string inputId, Action<float[], int, int> onBlock, Action<string> onError) => throw new InvalidOperationException("this PC has no audio inputs");
}

/// <summary>
/// Synthetic inputs for tests and headless runs: every 20 ms each started input produces a block from <see cref="Level"/> (linear peak of a 440 Hz
/// tone, 0 = silence) at <see cref="Rate"/> with <see cref="Channels"/> channels. Nothing here touches a sound card.
/// </summary>
public sealed class SynthInputProvider : IInputProvider
{
    public List<InputInfo> Inputs { get; } = new()
    {
        new InputInfo("in-aux-1", "Line In (Test)", "aux"),
        new InputInfo("in-spdif-1", "S/PDIF In (Test)", "spdif"),
        new InputInfo("in-mic-1", "Headset Microphone (Test)", "mic"),
        new InputInfo(InputIds.ProcessLoopback, "This PC · Speakers (what you hear)", "loopback", Note: "process"),
    };
    /// <summary>Linear peak level per input id (thread safe to change while running).</summary>
    public System.Collections.Concurrent.ConcurrentDictionary<string, float> Level { get; } = new();
    public int Rate { get; set; } = 44100;
    public int Channels { get; set; } = 2;
    public int Started; public int Stopped;
    public IReadOnlyList<InputInfo> List() => Inputs;
    public IDisposable Start(string inputId, Action<float[], int, int> onBlock, Action<string> onError)
    {
        if (!Inputs.Any(i => i.Id == inputId)) throw new InvalidOperationException("that input is not connected any more");
        Interlocked.Increment(ref Started);
        double phase = 0; int rate = Rate, ch = Channels;
        var t = new Timer(_ =>
        {
            int n = rate / 50; var b = new float[n * ch]; float a = Level.TryGetValue(inputId, out var l) ? l : 0f;
            for (int i = 0; i < n; i++) { float v = (float)(a * Math.Sin(phase)); phase += 2 * Math.PI * 440 / rate; for (int c = 0; c < ch; c++) b[i * ch + c] = v; }
            onBlock(b, rate, ch);
        }, null, 0, 20);
        return new Stop(() => { t.Dispose(); Interlocked.Increment(ref Stopped); });
    }
    private sealed class Stop(Action a) : IDisposable { private int _done; public void Dispose() { if (Interlocked.Exchange(ref _done, 1) == 0) a(); } }
}

/// <summary>0.7.2: well-known input ids.</summary>
public static class InputIds
{
    /// <summary>"Everything this PC plays except WavWiz": Windows process loopback that EXCLUDES the WavWiz Player's own process tree (Windows 10 2004+).</summary>
    public const string ProcessLoopback = "loopback:process";
}

/// <summary>
/// 0.7.2: the Player side of audio inputs. The server says "start input X" / "stop input X" (INPUT_CMD); this opens it with the provider and sends
/// the audio up as INPUT_AUDIO in about 20 ms pieces, stamped with server time when the clock is synced. Every capture stops when the
/// connection drops (<see cref="StopAll"/>), so an input never keeps a microphone open with nobody listening.
/// </summary>
public sealed class InputResponder : IDisposable
{
    private readonly IInputProvider _inputs; private readonly ClockModel _clock; private readonly IMonotonicClock _local;
    private readonly Func<byte[], Task> _send; private readonly Func<string, Task> _report; private readonly Action<string> _log;
    private readonly Dictionary<string, IDisposable> _running = new(); private readonly object _l = new();
    private uint _seq;
    // One sender, in order: capture callbacks only queue; a slow link drops the OLDEST pieces (~2 s kept), never blocks the capture thread.
    private readonly System.Threading.Channels.Channel<byte[]> _q = System.Threading.Channels.Channel.CreateBounded<byte[]>(
        new System.Threading.Channels.BoundedChannelOptions(100) { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest, SingleReader = true });
    private readonly CancellationTokenSource _cts = new();
    public InputResponder(IInputProvider inputs, ClockModel clock, IMonotonicClock local, Func<byte[], Task> send, Func<string, Task> report, Action<string>? log = null)
    {
        _inputs = inputs; _clock = clock; _local = local; _send = send; _report = report; _log = log ?? (_ => { });
        _ = Task.Run(async () => { try { await foreach (var m in _q.Reader.ReadAllAsync(_cts.Token)) { try { await _send(m); } catch { } } } catch (OperationCanceledException) { } });
    }

    public InputInfo[] SafeList() { try { return _inputs.List().ToArray(); } catch (Exception e) { _log("input list failed: " + e.Message); return Array.Empty<InputInfo>(); } }
    /// <summary>The Outputs "reason" that tells the server an input could not start: "input-error:&lt;id&gt;" newline "&lt;why&gt;" (ids may contain ':').</summary>
    public static string ErrorReason(string id, string why) => "input-error:" + id + "\n" + why;
    /// <summary>0.7.2 t2175u: "Sync with WavWiz" commands go to the Player's LocalSync (null in tests / headless = ignored).</summary>
    public Action<InputCmd>? LocalSync { get; set; }
    /// <summary>0.7.2 t2175u: the Player went back to Real time by itself: tell the server (it shows why and saves Real time).</summary>
    public Task ReportLocalSyncFallback(string inputId, string why) => _report(ErrorReason(inputId, LocalSyncRules.FallbackTag + why));
    public IReadOnlyCollection<string> Running { get { lock (_l) return _running.Keys.ToList(); } }

    public void Handle(InputCmd c)
    {
        switch (c.Action)
        {
            case "start" when c.InputId is { Length: > 0 } id: Start(id); break;
            case "stop" when c.InputId is { Length: > 0 } id: Stop(id); break;
            case "stop-all": StopAll(); break;
            case LocalSyncRules.On or LocalSyncRules.Off: LocalSync?.Invoke(c); break;
            case LocalSyncRules.SelfMuteOn or LocalSyncRules.SelfMuteOff: SelfMute?.Invoke(c.Action == LocalSyncRules.SelfMuteOn); break;   // 0.7.2 t2183u   // 0.7.2 t2175u: the Windows side (Player LocalSync)
        }
    }

    private void Start(string id)
    {
        lock (_l)
        {
            if (_running.ContainsKey(id)) return;
            try { _running[id] = _inputs.Start(id, (b, rate, ch) => OnBlock(id, b, rate, ch), why => { _log($"input {id} failed: {why}"); Stop(id); _ = _report(ErrorReason(id, why)); }); _log("input started: " + id); }
            catch (Exception e) { _log($"input {id} failed to start: {InputRules.Describe(e)}"); _ = _report(ErrorReason(id, InputRules.FailReason(e))); }   // 0.7.2 t2170u: privacy refusal in plain words
        }
    }

    private void Stop(string id) { IDisposable? d; lock (_l) { if (!_running.Remove(id, out d)) return; } try { d.Dispose(); } catch { } _log("input stopped: " + id); }

    /// <summary>Stop every running capture (connection lost, app closing).</summary>
    /// <summary>0.7.2 t2183u: the server says this PC's own sound is playing in this PC's zone in Real time: don't play the copy here.</summary>
    public Action<bool>? SelfMute;
    public void StopAll() { try { LocalSync?.Invoke(new InputCmd(LocalSyncRules.Off)); } catch { } try { SelfMute?.Invoke(false); } catch { } List<IDisposable> all;   // 0.7.2 t2175u: link lost / closing = Windows back on the speakers
         lock (_l) { all = _running.Values.ToList(); _running.Clear(); } foreach (var d in all) try { d.Dispose(); } catch { } while (_q.Reader.TryRead(out _)) { } }

    private void OnBlock(string id, float[] interleaved, int rate, int ch)
    {
        if (ch is not (1 or 2) || interleaved.Length == 0) return;
        lock (_l) if (!_running.ContainsKey(id)) return;
        long serverUs = _clock.IsValid ? _clock.ToServerUs(_local.NowUs) : 0;
        // keep each message well under the 1 MiB frame limit: at most ~100 ms per message
        int maxFrames = Math.Max(1, rate / 10), frames = interleaved.Length / ch;
        for (int at = 0; at < frames; at += maxFrames)
        {
            int n = Math.Min(maxFrames, frames - at);
            _q.Writer.TryWrite(Wire.EncodeInputAudio(Interlocked.Increment(ref _seq), id, rate, ch, serverUs, interleaved.AsSpan(at * ch, n * ch)));
        }
    }

    public void Dispose() { StopAll(); _cts.Cancel(); }
}

/// <summary>
/// 0.7.2: pure rules the Windows input provider uses (kept here so they are tested on Linux): which capture endpoints are Aux / S/PDIF / mic,
/// when process loopback is available, and the echo guard for the older "whole device" loopback.
/// </summary>
/// <summary>0.7.2 t2176u: thrown by an input provider only after Windows' microphone consent store was read and says Deny.</summary>
public sealed class MicPrivacyException(Exception inner) : UnauthorizedAccessException("Windows microphone privacy is set to Deny", inner);

public static class InputRules
{
    /// <summary>0.7.2 t2170u: the reason starts with this when Windows' microphone privacy setting refused capture (E_ACCESSDENIED).</summary>
    public const string PrivacyTag = "privacy:";
    public const string PrivacyText = "Windows is blocking the microphone. Turn on 'Microphone access' and 'Let desktop apps access your microphone' in Windows Settings > Privacy & security > Microphone, then press Play again.";
    public static bool IsAccessDenied(Exception e) =>
        e.HResult == unchecked((int)0x80070005) || e.Message.Contains("0x80070005", StringComparison.OrdinalIgnoreCase) || e is UnauthorizedAccessException;
    /// <summary>0.7.2 t2176u: E_ACCESSDENIED is the privacy switch ONLY when the provider checked Windows' consent store and it says Deny
    /// (<see cref="MicPrivacyException"/>); any other access denied shows the real error plainly (HRESULT + message), never a privacy claim
    /// that sends the user to a setting that is already on.</summary>
    public static string FailReason(Exception e)
    {
        if (e is MicPrivacyException) return PrivacyTag + PrivacyText;
        if (IsAccessDenied(e)) return $"Windows refused to open this input (access denied, 0x{e.HResult:X8}); microphone access is allowed, so this is not the privacy setting: {e.Message}";
        return e.Message;
    }
    /// <summary>0.7.2 t2176u: one log line with the HRESULT, type and the failing call (top stack frame).</summary>
    public static string Describe(Exception e)
    {
        var top = e.StackTrace?.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? "";
        return $"0x{e.HResult:X8} {e.GetType().Name}: {e.Message} {top}".TrimEnd();
    }

    public const string DeviceLoopback = "loopback:device";
    /// <summary>Windows 10 version 2004 (build 19041): process loopback (capture everything except one process tree).</summary>
    public const int ProcessLoopbackBuild = 19041;
    public const string EchoRefused = "WavWiz plays through these speakers too, so capturing them would play WavWiz back into itself. Choose another output for this PC in WavWiz, or update Windows (10 version 2004 or later) for echo-free capture.";

    /// <summary>Kind of a Windows capture endpoint from its name and PKEY_AudioEndpoint_FormFactor (2 LineLevel, 4 Microphone, 5 Headset,
    /// 6 Handset, 8 SPDIF). Returns null for capture devices that are really loopbacks of the PC's own output ("Stereo Mix", "What U Hear",
    /// "Wave Out Mix"): they would record WavWiz itself - "This PC · Speakers" covers that need without the echo.</summary>
    public static string? Classify(string name, int formFactor)
    {
        var n = (name ?? "").ToLowerInvariant();
        if (n.Contains("stereo mix") || n.Contains("what u hear") || n.Contains("wave out mix") || n.Contains("what you hear") || n.Contains("loopback")) return null;
        if (formFactor == 8 || n.Contains("s/pdif") || n.Contains("spdif") || n.Contains("optical") || n.Contains("coaxial") || n.Contains("digital in")) return "spdif";
        if (formFactor == 2 || n.Contains("line in") || n.Contains("line-in") || n.Contains("aux")) return "aux";
        return "mic";
    }

    public static bool ProcessLoopbackSupported(Version os) => os.Major > 10 || os.Major == 10 && os.Build >= ProcessLoopbackBuild;

    /// <summary>Echo guard for whole-device loopback (Windows before 2004): refuse when WavWiz's own active output on this PC is that device.
    /// Returns the reason to show, or null when it is safe.</summary>
    public static string? DeviceLoopbackRefusal(string renderEndpointId, string? wavwizActiveOutputId)
        => wavwizActiveOutputId != null && string.Equals(renderEndpointId, wavwizActiveOutputId, StringComparison.OrdinalIgnoreCase) ? EchoRefused : null;

    /// <summary>Any channel count to what the audio link carries (1 or 2): stereo keeps the first two channels (front left / right), mono stays mono.</summary>
    public static float[] ToStereoOrMono(ReadOnlySpan<float> interleaved, int channels, out int outChannels)
    {
        if (channels <= 2) { outChannels = Math.Max(1, channels); return interleaved.ToArray(); }
        int frames = interleaved.Length / channels; var o = new float[frames * 2]; outChannels = 2;
        for (int i = 0; i < frames; i++) { o[2 * i] = interleaved[i * channels]; o[2 * i + 1] = interleaved[i * channels + 1]; }
        return o;
    }

    /// <summary>PCM bytes in a capture format (32-bit float, or 16 / 24 / 32-bit integer) to floats.</summary>
    public static float[] ToFloat(ReadOnlySpan<byte> pcm, int bitsPerSample, bool isFloat)
    {
        if (isFloat && bitsPerSample == 32) return System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(pcm).ToArray();
        switch (bitsPerSample)
        {
            case 16: { var s = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, short>(pcm); var o = new float[s.Length]; for (int i = 0; i < s.Length; i++) o[i] = s[i] / 32768f; return o; }
            case 24: { int n = pcm.Length / 3; var o = new float[n]; for (int i = 0; i < n; i++) { int v = pcm[3 * i] | pcm[3 * i + 1] << 8 | (sbyte)pcm[3 * i + 2] << 16; o[i] = v / 8388608f; } return o; }
            case 32: { var s = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, int>(pcm); var o = new float[s.Length]; for (int i = 0; i < s.Length; i++) o[i] = s[i] / 2147483648f; return o; }
            default: throw new NotSupportedException($"unsupported capture format: {bitsPerSample}-bit");
        }
    }
}
