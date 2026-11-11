using WavWiz.Core;
using WavWiz.Core.Clock;
using WavWiz.PlayerCore;
using WavWiz.PlayerCore.Linux;
using WavWiz.Server.Api;
namespace WavWiz.Server.Host;

/// <summary>
/// 0.7.0: a Linux / Raspberry Pi server is also a speaker. Runs one in-process WavWiz player (the same PlayerClient a Windows PC runs) whose outputs are this
/// machine's ALSA devices (headphone jack, HDMI, USB DAC, "default" = PipeWire/PulseAudio/dmix). It joins over the normal audio port on loopback with a
/// player-only token, so it IS an ordinary zone: volume, mute, per-speaker delay/calibration, EQ, sync, output switching and the HDMI/USB/ANALOG tags
/// all come from the existing model. Nothing runs on Windows (the WavWiz Player app does this there).
/// </summary>
public sealed class LocalAudioHost : IAsyncDisposable
{
    public const string PlayerIdSetting = "localaudio.playerId";
    private readonly PlayerClient _client; private readonly AlsaOutputProvider _outputs; private readonly CancellationTokenSource _cts = new(); private readonly Task _run;
    public string PlayerId => _client.PlayerId;
    public PlayerClient Client => _client;
    public AlsaOutputProvider Outputs => _outputs;
    public static string? LastDecision { get; private set; }

    /// <summary>Pure decision (unit-tested): should the in-server ALSA player run, and why (shown in Diagnostics).</summary>
    public static (bool On, string Why) Decide(string? setting, bool isWindows, bool alsaLoads, bool devSnd, bool extraDevices)
    {
        var v = (setting ?? "auto").Trim().ToLowerInvariant();
        if (isWindows) return (false, "Windows: local speakers are played by the WavWiz Player app.");
        if (v is "off" or "0" or "false" or "no") return (false, "Local audio output is switched off (localAudio / WAVWIZ_LOCAL_AUDIO = off).");
        if (!alsaLoads) return (false, "ALSA (libasound.so.2) is not installed. Install it (sudo apt install libasound2t64, or libasound2 on older systems) and restart WavWiz.");
        bool force = v is "on" or "1" or "true" or "yes";
        if (!devSnd && !extraDevices) return (false, force ? "Local audio is on, but there is no /dev/snd (no sound card, or Docker without --device /dev/snd)." : "No sound devices (/dev/snd is missing). In Docker add --device /dev/snd.");
        return (true, "Local audio output: this machine's ALSA devices are a WavWiz speaker.");
    }

    private LocalAudioHost(PlayerClient client, AlsaOutputProvider outputs)
    {
        _client = client; _outputs = outputs;
        _outputs.DevicesChanged += () => { try { _ = _client.SendOutputsAsync("devices"); } catch { } };
        _run = Task.Run(() => _client.RunAsync(_cts.Token));
    }

    /// <summary>Starts the local player when <see cref="Decide"/> says so; null otherwise. Host = the bind address (loopback when it is a wildcard).</summary>
    public static LocalAudioHost? TryStart(Services s, Action<string> log)
    {
        var extra = s.Cfg.AlsaDevices ?? Array.Empty<string>(); var procAsound = s.Cfg.TestProcAsound;
        var (on, why) = Decide(s.Cfg.LocalAudio, OperatingSystem.IsWindows(), !OperatingSystem.IsWindows() && AlsaSink.LibraryAvailable, Directory.Exists("/dev/snd") || procAsound != null, extra.Length > 0);
        LastDecision = why; log("local audio: " + why);
        if (!on) return null;
        var pid = s.Db.Setting(PlayerIdSetting) is string j && j.Length > 4 ? System.Text.Json.JsonSerializer.Deserialize<string>(j)! : null;
        if (pid == null) { pid = "local-" + Guid.NewGuid().ToString("N")[..12]; s.Db.SetSetting(PlayerIdSetting, System.Text.Json.JsonSerializer.Serialize(pid)); }
        string name = Environment.MachineName;
        s.Db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", pid));         // same rule as /auth/pair-player: one live token per player
        var token = s.Auth.CreateToken("Player " + name + " (this server)", Role.Player, pid);
        var host = ConnectHost(s.Cfg.BindAddress);
        var outputs = new AlsaOutputProvider(new StopwatchClock(), procAsound ?? "/proc/asound", extra);
        var client = new PlayerClient(new PlayerClientOptions
        {
            Host = host, AudioPort = s.Audio.Port, PlayerId = pid, Name = name, LinkType = "ethernet", Token = () => token, Outputs = outputs,
            CacheFile = Path.Combine(s.Cfg.DataDir, "local-audio-cache.json"),
        });
        client.Log += m => log("local audio: " + m);
        log($"local audio: player {pid} ({name}) -> {host}:{s.Audio.Port}; outputs: {string.Join(", ", outputs.List().Select(o => $"{o.Name} [{o.Kind}]"))}");
        return new LocalAudioHost(client, outputs);
    }

    /// <summary>A wildcard bind is a listen address, never one to dial: use loopback.</summary>
    public static string ConnectHost(string bind)
    {
        var b = bind.Trim('[', ']');
        return b switch { "0.0.0.0" => "127.0.0.1", "::" => "::1", _ => b };
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        try { await _run.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        try { await _client.DisposeAsync(); } catch { }
        _outputs.Dispose(); _cts.Dispose();
    }
}
