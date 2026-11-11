using System.Net;
using WavWiz.Core.Clock;
using WavWiz.PlayerCore.Linux;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 Linux/Pi local audio output (ALSA). Parsing uses real /proc/asound samples (Pi 4, Pi 5, USB DAC, x64 HDA). The sink and the
/// end-to-end test use the ALSA "null" and "file" plugins from alsa-lib's own alsa.conf (no sound card on the box; snd-aloop not loaded).
/// NOT proven here: a real jack/HDMI/USB DAC, real snd_pcm_delay values, hot-plug of a real USB DAC.</summary>
[Collection("serial")]
public class LocalAudio070Tests
{
    const string Pi4Cards = " 0 [Headphones     ]: bcm2835_headpho - bcm2835 Headphones\n                      bcm2835 Headphones\n 1 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0\n                      vc4-hdmi-0\n 2 [vc4hdmi1       ]: vc4-hdmi - vc4-hdmi-1\n                      vc4-hdmi-1\n 3 [Device         ]: USB-Audio - USB Audio Device\n                      C-Media Electronics Inc. USB Audio Device at usb-0000:01:00.0-1.3, full speed\n";
    const string Pi4Pcm = "00-00: bcm2835 Headphones : bcm2835 Headphones : playback 8\n01-00: MAI PCM i2s-hifi-0 : MAI PCM i2s-hifi-0 : playback 1\n02-00: MAI PCM i2s-hifi-0 : MAI PCM i2s-hifi-0 : playback 1\n03-00: USB Audio : USB Audio : playback 1 : capture 1\n";
    const string X64Cards = " 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n                      HDA Intel PCH at 0xf7f10000 irq 32\n";
    const string X64Pcm = "00-00: ALC892 Analog : ALC892 Analog : playback 1 : capture 1\n00-01: ALC892 Digital : ALC892 Digital : playback 1\n00-02: ALC892 Alt Analog : ALC892 Alt Analog : capture 1\n00-03: HDMI 0 : HDMI 0 : playback 1\n";

    [Fact]
    public void Aplay_l_equivalent_lists_jack_hdmi_and_usb_with_stable_ids_and_kinds()
    {
        var d = AlsaDevices.Build(Pi4Cards, Pi4Pcm, i => i == 3, includeDefault: true);
        Assert.Equal(new[] { "alsa:default", "alsa:hw:Headphones,0", "alsa:hw:vc4hdmi0,0", "alsa:hw:vc4hdmi1,0", "alsa:hw:Device,0" }, d.Select(x => x.EndpointId));
        Assert.Equal(new[] { "other", "analog", "hdmi", "hdmi", "usb" }, d.Select(x => x.Kind));
        Assert.Equal(new[] { "System default output", "bcm2835 Headphones", "HDMI 1", "HDMI 2", "USB Audio Device" }, d.Select(x => x.Name));
        Assert.Equal("plughw:CARD=vc4hdmi1,DEV=0", d[3].OpenName);          // plug layer: rate/format/channel conversion for the card
        // x64: capture-only PCMs skipped; several PCMs on one card get their PCM name; HDMI on an HDA card is hdmi
        var x = AlsaDevices.Build(X64Cards, X64Pcm, _ => false, includeDefault: false, extraNames: new[] { "softvol", " " });
        Assert.Equal(new[] { "alsa:hw:PCH,0", "alsa:hw:PCH,1", "alsa:hw:PCH,3", "alsa:pcm:softvol" }, x.Select(v => v.EndpointId));
        Assert.Equal(new[] { "analog", "spdif", "hdmi", "other" }, x.Select(v => v.Kind));
        Assert.Equal("HDA Intel PCH - ALC892 Digital", x[1].Name);
        Assert.Empty(AlsaDevices.Build("--- no soundcards ---\n", "", _ => false, includeDefault: false));
    }

    [Fact]
    public void Output_provider_reads_procfs_and_marks_usb_cards_by_usbid()
    {
        using var t = new TempDir();
        File.WriteAllText(Path.Combine(t.Path, "cards"), Pi4Cards); File.WriteAllText(Path.Combine(t.Path, "pcm"), Pi4Pcm);
        Directory.CreateDirectory(Path.Combine(t.Path, "card3")); File.WriteAllText(Path.Combine(t.Path, "card3", "usbid"), "0d8c:0014");
        using var p = new AlsaOutputProvider(new StopwatchClock(), t.Path, poll: false);
        var l = p.List();
        Assert.Equal("alsa:default", p.DefaultEndpointId);
        Assert.Equal("usb", l.Single(o => o.EndpointId == "alsa:hw:Device,0").Kind);
        Assert.All(l, o => Assert.True(o.Connected));
        // no cards at all -> no "default" either (Docker without --device /dev/snd)
        using var e = new TempDir(); File.WriteAllText(Path.Combine(e.Path, "cards"), "--- no soundcards ---\n");
        using var p2 = new AlsaOutputProvider(new StopwatchClock(), e.Path, poll: false);
        Assert.Empty(p2.List()); Assert.Null(p2.DefaultEndpointId);
    }

    [Fact]
    public void Decision_matrix_is_honest()
    {
        Assert.False(LocalAudioHost.Decide("auto", isWindows: true, true, true, false).On);
        Assert.False(LocalAudioHost.Decide("off", false, true, true, false).On);
        var noLib = LocalAudioHost.Decide("auto", false, alsaLoads: false, true, false); Assert.False(noLib.On); Assert.Contains("libasound2", noLib.Why);
        var docker = LocalAudioHost.Decide("auto", false, true, devSnd: false, false); Assert.False(docker.On); Assert.Contains("--device /dev/snd", docker.Why);
        Assert.True(LocalAudioHost.Decide(null, false, true, true, false).On);
        Assert.True(LocalAudioHost.Decide("on", false, true, devSnd: false, extraDevices: true).On);
        Assert.Equal("127.0.0.1", LocalAudioHost.ConnectHost("0.0.0.0")); Assert.Equal("::1", LocalAudioHost.ConnectHost("[::]")); Assert.Equal("192.168.1.9", LocalAudioHost.ConnectHost("192.168.1.9"));
    }

    [Fact]
    public void Dac_time_follows_the_device_delay_or_the_wall_clock_schedule()
    {
        Assert.Equal(1_000_000 + 100_000, AlsaSink.DacTime(1_000_000, deviceClocked: true, delayFrames: 4800, t0Us: 0, written: 0, rate: 48000));
        Assert.Equal(500_000 + 1_000_000, AlsaSink.DacTime(1_000_000, false, 0, t0Us: 500_000, written: 48000, rate: 48000));
        Assert.Equal(2_000_000, AlsaSink.DacTime(2_000_000, false, 0, t0Us: 0, written: 480, rate: 48000));   // never in the past
    }

    [Fact]
    public async Task Sink_on_the_alsa_null_device_renders_in_real_time_with_rising_dac_times()
    {
        if (!AlsaSink.LibraryAvailable) return;   // platform-skip: no libasound.so.2 on this machine
        var dacs = new List<long>(); var clock = new StopwatchClock();
        using var s = new AlsaSink("null", (dst, frames, dac) => { lock (dacs) dacs.Add(dac); dst.Fill(0.25f); return frames; }, clock);
        Assert.Equal(48000, s.MixRate);
        s.Start(); await Task.Delay(1500);
        long written = s.FramesWritten; bool paced = s.WallPaced;
        Assert.True(paced, "the null PCM never blocks: the sink must pace itself by the wall clock");
        Assert.InRange(written, 48000 * 1.0, 48000 * 1.8);                  // ~1.5 s of audio + at most one 100 ms buffer ahead
        lock (dacs) { Assert.True(dacs.Count > 50); for (int i = 1; i < dacs.Count; i++) Assert.True(dacs[i] >= dacs[i - 1], "DAC time went backwards"); Assert.True(dacs[^1] > clock.NowUs - 50_000); }
    }

    [Fact]
    public async Task Sink_writes_s32_stereo_through_the_alsa_file_plugin()
    {
        if (!AlsaSink.LibraryAvailable) return;
        using var t = new TempDir(); var raw = Path.Combine(t.Path, "out.raw");
        using (var s = new AlsaSink($"file:'{raw}',raw", (dst, frames, dac) => { for (int i = 0; i < frames; i++) { dst[2 * i] = 0.5f; dst[2 * i + 1] = -0.5f; } return frames; }, new StopwatchClock()))
        { s.Start(); await Task.Delay(600); }
        var b = await File.ReadAllBytesAsync(raw);
        Assert.True(b.Length >= 8 * 48000 * 4 / 10, $"only {b.Length} bytes");
        Assert.Equal(1073741823, BitConverter.ToInt32(b, 0)); Assert.Equal(-1073741823, BitConverter.ToInt32(b, 4));
    }

    [Fact]
    public async Task Server_on_linux_is_a_speaker_through_alsa_and_zone_controls_reach_it()
    {
        if (!AlsaSink.LibraryAvailable) return;
        using var proc = new TempDir(); File.WriteAllText(Path.Combine(proc.Path, "cards"), Pi4Cards); File.WriteAllText(Path.Combine(proc.Path, "pcm"), Pi4Pcm);
        var raw = Path.Combine(proc.Path, "pi-jack.raw");
        // the file PCM stands in for the jack; it is listed FIRST so it is this player's default (the fake procfs adds "default" only for a real card list)
        await using var f = await ServerFixture.StartAsync(c => { c.LocalAudio = "on"; c.AlsaDevices = new[] { $"file:'{raw}',raw" }; c.TestProcAsound = Path.Combine(proc.Path, "none"); });
        var admin = f.As(f.Token(Role.Admin));
        var la = f.Server.S.LocalAudio; Assert.NotNull(la);
        await Until(() => la!.Client.State.Connected && f.Server.S.Zones.Zones().Any(z => z.PlayerId == la.PlayerId && z.Outputs.Count > 0), "local player online");
        var zones = await admin.GetJson("/api/v1/zones");
        var z = zones.EnumerateArray().Single(x => x.GetProperty("playerId").GetString() == la!.PlayerId);
        Assert.True(z.GetProperty("connected").GetBoolean());
        Assert.Equal(Environment.MachineName, z.GetProperty("name").GetString());
        // silence before play (the sink runs from the start: silence is real zeros, no dither), then music reaches the ALSA device
        await Until(() => File.Exists(raw) && new FileInfo(raw).Length > 48000, "sink writing silence"); Assert.False(HasClick(raw), "noise before play");
        long tid = await E2ETests.AddClickTrack(f, admin, 6);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } })).StatusCode);
        await Until(() => File.Exists(raw) && HasClick(raw), "clicks in the ALSA output", 20000, () => $"raw={(File.Exists(raw) ? new FileInfo(raw).Length : -1)} peak={Peak(raw)} state={System.Text.Json.JsonSerializer.Serialize(la!.Client.State)} log={Log(f)}");
        // volume and per-speaker delay are the ordinary zone controls
        long zid = z.GetProperty("id").GetInt64();
        await admin.PatchAsJsonAsync($"/api/v1/zones/{zid}", new { volume = 41 });
        await Until(() => Math.Abs(la!.Client.State.Volume - 41) < 0.01, "volume reaches the local player");
        Assert.Contains(f.Server.S.Zones.Zones(), x => x.PlayerId == la!.PlayerId);
        // diagnostics shows the local speakers
        var diag = await admin.GetJson("/api/v1/diagnostics");
        var chk = diag.GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "local-audio");
        Assert.Equal("ok", chk.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Server_with_local_audio_off_has_no_local_player()
    {
        await using var f = await ServerFixture.StartAsync(c => c.LocalAudio = "off");
        Assert.Null(f.Server.S.LocalAudio);
        Assert.Contains("switched off", LocalAudioHost.LastDecision);
    }

    static long Peak(string raw) { try { var b = File.ReadAllBytes(raw); long m = 0; for (int i = 0; i + 4 <= b.Length; i += 4) m = Math.Max(m, Math.Abs((long)BitConverter.ToInt32(b, i))); return m; } catch { return -1; } }
    static bool HasClick(string raw)
    {
        try { using var fs = new FileStream(raw, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); var b = new byte[fs.Length - fs.Length % 4]; fs.ReadExactly(b); for (int i = 0; i + 4 <= b.Length; i += 4) if (Math.Abs((long)BitConverter.ToInt32(b, i)) > 20_000_000) return true; } catch { }
        return false;
    }
    static async Task Until(Func<bool> c, string what, int ms = 15000, Func<string>? diag = null) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!c() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(c(), "timed out: " + what + (diag != null ? "\n" + diag() : "")); }
    static string Log(ServerFixture f) { try { var d = Path.Combine(f.Dir.Path, "logs"); var fl = Directory.Exists(d) ? Directory.GetFiles(d) : Array.Empty<string>(); return fl.Length == 0 ? "(no log)" : string.Join("\n", File.ReadAllLines(fl[0]).TakeLast(25)); } catch (Exception e) { return e.Message; } }
}
