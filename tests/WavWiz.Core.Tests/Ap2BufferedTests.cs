using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using WavWiz.Core.AirPlay;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 stage 9: AirPlay 2 buffered (type 103) with live AAC via ffmpeg. Offline tests need ffmpeg
/// (WAVWIZ_FFMPEG or /usr/bin/ffmpeg; skipped if absent). Live: WW_AIRPLAY2_BENCH + WW_AIRPLAY2_LOCAL.</summary>
public class Ap2BufferedTests
{
    static string? Ff() { var f = Environment.GetEnvironmentVariable("WAVWIZ_FFMPEG"); if (!string.IsNullOrEmpty(f) && File.Exists(f)) return f; return File.Exists("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : null; }

    [Fact]
    public async Task Aac_encoder_round_trips_a_tone_with_priming_removed()
    {
        var ff = Ff(); if (ff == null) return;
        long k = 0; // linear chirp 200 Hz -> 4 kHz: no periodic ambiguity when matching lag
        Func<short[], int> tone = b => { for (int i = 0; i < b.Length / 2; i++, k++) { double t = k / 44100.0; short v = (short)(8000 * Math.Sin(2 * Math.PI * (200 * t + 950 * t * t))); b[2 * i] = b[2 * i + 1] = v; } return b.Length / 2; };
        var input = new List<short>();
        var aus = new List<byte[]>();
        await using (var enc = new AacLiveEncoder(ff))
        {
            var pcm = new short[2048];
            for (int i = 0; i < 44; i++) { tone(pcm); input.AddRange(pcm); await enc.WriteAsync(pcm); }
            var rd = Task.Run(async () => { await foreach (var a in enc.Frames.ReadAllAsync()) aus.Add(a); });
            await enc.DisposeAsync(); await rd.WaitAsync(TimeSpan.FromSeconds(10));
        }
        Assert.True(aus.Count is >= 44 and <= 47, $"AUs {aus.Count}");
        // decode everything after the priming unit and compare phase with the input
        var adts = aus.Skip(1).SelectMany(a => AacLiveEncoder.Adts(a)).ToArray();
        var psi = new ProcessStartInfo(ff) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in "-hide_banner -loglevel error -f aac -i pipe:0 -f s16le -ac 2 -ar 44100 pipe:1".Split(' ')) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var outTask = Task.Run(() => { var ms = new MemoryStream(); p.StandardOutput.BaseStream.CopyTo(ms); return ms.ToArray(); });
        await p.StandardInput.BaseStream.WriteAsync(adts); p.StandardInput.Close();
        var raw = await outTask; var dec = new short[raw.Length / 2]; Buffer.BlockCopy(raw, 0, dec, 0, raw.Length);
        Assert.True(dec.Length > 40000);
        // best lag between decoded and input (left channel) should be ~0 frames once priming is dropped
        int best = 0; double bestErr = double.MaxValue;
        for (int lag = -1100; lag <= 1100; lag++)
        {
            double e = 0; int n = 0;
            for (int i = 22000; i < 30000; i += 3) { int j = i + lag; if (j < 0 || j >= input.Count / 2) continue; double d = dec[2 * i] - input[2 * j]; e += d * d; n++; }
            e /= Math.Max(1, n); if (e < bestErr) { bestErr = e; best = lag; }
        }
        Assert.InRange(best, -2, 2); // priming dropped: decoded audio lines up with the input within 2 frames
        Assert.True(bestErr < 1e5, $"residual {bestErr}");
    }

    [Fact]
    public async Task Buffered_packets_decrypt_and_carry_24bit_seq()
    {
        await using var s = new Ap2Session(new Ap2Options { Endpoint = new IPEndPoint(IPAddress.Loopback, 7000), Timing = Ap2Timing.Ntp, Buffered = true }, null);
        typeof(Ap2Session).GetField("_aead", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.SetValue(s, new ChaCha20Poly1305(s.Shk));
        var au = RandomNumberGenerator.GetBytes(371);
        var b = s.BufferedPacket(0xABCDEF, 123456, 7, au);
        Assert.Equal(b.Length, Rtp.Rd16(b, 0)); Assert.Equal(0xAB, b[3]); Assert.Equal(0xEF, b[5]); Assert.Equal(123456u, Rtp.Rd32(b, 6));
        var p = b.AsSpan(2).ToArray(); var n12 = new byte[12]; Array.Copy(p, p.Length - 8, n12, 4, 8);
        var plain = new byte[au.Length];
        using var c = new ChaCha20Poly1305(s.Shk);
        c.Decrypt(n12, p.AsSpan(12, au.Length), p.AsSpan(12 + au.Length, 16), plain, p.AsSpan(4, 8));
        Assert.Equal(au, plain);
    }

    /// <summary>Live buffered run: 15 s 1 kHz, pause 3 s, resume 10 s, seek (source switches to 440 Hz) 10 s.
    /// Timing of each step goes to WW_AIRPLAY_OUT/ap2-s9-events.txt for comparison with the pipe monitor.</summary>
    [Fact]
    public async Task Live_buffered_aac_with_instant_pause_and_seek()
    {
        var bench = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH"); var local = Environment.GetEnvironmentVariable("WW_AIRPLAY2_LOCAL"); var ff = Ff();
        if (string.IsNullOrEmpty(bench) || string.IsNullOrEmpty(local) || ff == null) return;
        var ev = new List<string>(); void E(string m) => ev.Add($"{DateTime.Now:HH:mm:ss.fff} {m}");
        using var ptp = new PtpMaster(IPAddress.Parse(local)); ptp.Start();
        await using var s = new Ap2Session(new Ap2Options { Endpoint = IPEndPoint.Parse(bench), Name = "WavWiz test", VolumeDb = -6, Buffered = true }, ptp);
        await s.ConnectAsync(); E($"connected dataPort={s.DataPort} audioBufferSize={s.AudioBufferSize}");
        var hz = 1000.0; var t1k = RaopStreamer.Tone(1000); var t440 = RaopStreamer.Tone(440);
        await using (var st = new Ap2BufferedStreamer(s, ptp, pcm => hz == 1000 ? t1k(pcm) : t440(pcm), ff))
        {
            await st.StartAsync(); E($"start anchor rtp={st.AnchorRtp}");
            await Task.Delay(15000);
            await st.PauseAsync(); E("pause");
            await Task.Delay(3000);
            await st.ResumeAsync(); E("resume");
            await Task.Delay(10000);
            await st.PauseAsync(); hz = 440; await Task.Delay(200); await st.ResumeAsync(); E("seek (440 Hz)");
            await Task.Delay(10000);
            E($"packets={st.PacketsSent} flushes={st.Flushes}");
            Assert.True(st.PacketsSent > 30 * 40);
        }
        Assert.True(s.Feedbacks > 10);
        await s.TeardownAsync();
        var outDir = Environment.GetEnvironmentVariable("WW_AIRPLAY_OUT");
        if (outDir != null) { File.WriteAllLines(Path.Combine(outDir, "ap2-s9-events.txt"), ev); File.WriteAllLines(Path.Combine(outDir, "ap2-s9-transcript.txt"), s.Rtsp.Transcript); }
    }

    /// <summary>Live: two AP2 receivers (WW_AIRPLAY2_BENCH and WW_AIRPLAY2_BENCH_B) share one WavWiz PTP timeline and anchor;
    /// each receiver's own statistics report its sync error against that timeline. WW_AIRPLAY_SECONDS (default 60).</summary>
    [Fact]
    public async Task Live_two_buffered_speakers_one_timeline()
    {
        var a = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH"); var b = Environment.GetEnvironmentVariable("WW_AIRPLAY2_BENCH_B");
        var local = Environment.GetEnvironmentVariable("WW_AIRPLAY2_LOCAL"); var ff = Ff();
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b) || string.IsNullOrEmpty(local) || ff == null) return;
        int secs = int.TryParse(Environment.GetEnvironmentVariable("WW_AIRPLAY_SECONDS"), out var x) ? x : 60;
        using var ptp = new PtpMaster(IPAddress.Parse(local)); ptp.Start();
        await using var sa = new Ap2Session(new Ap2Options { Endpoint = IPEndPoint.Parse(a), Name = "WavWiz A", VolumeDb = -6, Buffered = true }, ptp);
        await using var sb = new Ap2Session(new Ap2Options { Endpoint = IPEndPoint.Parse(b), Name = "WavWiz B", VolumeDb = -6, Buffered = true }, ptp);
        await sa.ConnectAsync(); await sb.ConnectAsync();
        await using var ta = new Ap2BufferedStreamer(sa, ptp, RaopStreamer.Tone(1000), ff);
        await using var tb = new Ap2BufferedStreamer(sb, ptp, RaopStreamer.Tone(1000), ff);
        ulong at = ptp.NowNs + 1_500_000_000;
        await ta.StartAtAsync(at); await tb.StartAtAsync(at);
        await Task.Delay(TimeSpan.FromSeconds(secs));
        Assert.True(ta.PacketsSent > secs * 40 && tb.PacketsSent > secs * 40);
        await sa.TeardownAsync(); await sb.TeardownAsync();
    }
}
