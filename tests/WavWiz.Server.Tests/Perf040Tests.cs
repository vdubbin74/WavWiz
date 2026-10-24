using System.Diagnostics;
using System.Net.Http.Json;
using WavWiz.Core.Protocol;
using WavWiz.Server.Api;
using WavWiz.Core.Stream;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.4.0 Stage 1 perf harness (opt-in: WAVWIZ_PERF=1, results appended to WAVWIZ_PERF_OUT). Real ffmpeg decode + the real StreamEngine; subscribers are in-memory counters, so network cost is not included.</summary>
public class Perf040Tests
{
    private sealed class Sub : IStreamSubscriber
    {
        public Sub(string id) { Id = id; } public string Id { get; } public int BufferDepthMs => 3000; public long Bytes; public void Send(byte[] m) { Interlocked.Add(ref Bytes, m.Length); }
    }
    internal static (double CpuPct, double RssMb) Measure(Action? during, int ms)
    {
        var p = Process.GetCurrentProcess(); GC.Collect(); GC.WaitForPendingFinalizers(); p.Refresh();
        var cpu0 = p.TotalProcessorTime + Ff(); var sw = Stopwatch.StartNew(); during?.Invoke(); Thread.Sleep(ms); p.Refresh();
        double cpu = (p.TotalProcessorTime + Ff() - cpu0).TotalMilliseconds / sw.Elapsed.TotalMilliseconds * 100.0;   // 100 = one full core; includes live ffmpeg decoder children (cheaper than counting exits)
        return (cpu, (p.WorkingSet64 + FfRss()) / 1048576.0);
    }
    private static TimeSpan Ff() { var t = TimeSpan.Zero; foreach (var q in Process.GetProcessesByName("ffmpeg")) { try { t += q.TotalProcessorTime; } catch { } } return t; }
    private static long FfRss() { long t = 0; foreach (var q in Process.GetProcessesByName("ffmpeg")) { try { t += q.WorkingSet64; } catch { } } return t; }
    public static bool On => Environment.GetEnvironmentVariable("WAVWIZ_PERF") == "1";
    internal static void Report(string line) { var f = Environment.GetEnvironmentVariable("WAVWIZ_PERF_OUT"); if (f != null) File.AppendAllText(f, line + Environment.NewLine); Console.WriteLine(line); }

    [Fact]
    public void Baseline_single_conductor_idle_and_1_3_6_devices_playing()
    {
        if (!On) return;
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate();
        TestMedia.Tone(t.File("long.flac"), 120, 440, "L");
        using var c = new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 };
        Thread.Sleep(3000); var idle = Measure(null, 8000); Report($"[{Tag}] idle default group: cpu {idle.CpuPct:F2}% of one core, rss {idle.RssMb:F0} MB");
        var item = new QueueItem(0, "track", t.File("long.flac"), "L", "x", "y", 120000, 1);
        foreach (var n in new[] { 1, 3, 6 })
        {
            var subs = Enumerable.Range(0, n).Select(i => new Sub("d" + i)).ToList(); foreach (var s in subs) c.Subscribe(s);
            c.PlayItems(new[] { item }, 0); Thread.Sleep(3000);
            var m = Measure(null, 10000); Report($"[{Tag}] {n} device(s), one song (linked): cpu {m.CpuPct:F2}%, rss {m.RssMb:F0} MB, sent {subs.Sum(s => s.Bytes) / 1048576.0:F1} MB");
            c.Stop(); Thread.Sleep(1500); foreach (var s in subs) c.Unsubscribe(s.Id);
        }
        var idle2 = Measure(null, 5000); Report($"[{Tag}] idle after play: cpu {idle2.CpuPct:F2}%, rss {idle2.RssMb:F0} MB");
    }
    public static string Tag => Environment.GetEnvironmentVariable("WAVWIZ_PERF_TAG") ?? "BEFORE";

    [Fact]
    public void After_registry_idle_groups_linked_and_independent_zones()
    {
        if (!On) return;
        using var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); var ev = new EventHub();
        TestMedia.Tone(t.File("long.flac"), 120, 440, "L"); TestMedia.Tone(t.File("long2.flac"), 120, 550, "M");
        var d = new Conductor(db, ev, TestMedia.Ffmpeg) { LeadMs = 300 };
        using var r = new ConductorRegistry(d, id => new Conductor(db, ev, TestMedia.Ffmpeg, d.Clock, id) { LeadMs = 300 }, db, ev);
        Thread.Sleep(3000); var idle = Measure(null, 8000); Report($"[{Tag}] idle, 1 group: cpu {idle.CpuPct:F2}% of one core, rss {idle.RssMb:F0} MB");
        var item = new QueueItem(0, "track", t.File("long.flac"), "L", "x", "y", 120000, 1); var item2 = item with { Location = t.File("long2.flac") };
        var subs = Enumerable.Range(0, 6).Select(i => new Sub("d" + i)).ToList(); foreach (var s in subs) r.Subscribe(s);
        for (int i = 0; i < 6; i++) r.Split("d" + i);
        Thread.Sleep(500); var idle6 = Measure(null, 8000); Report($"[{Tag}] idle, 6 split groups (queues empty, none playing): cpu {idle6.CpuPct:F2}%, rss {idle6.RssMb:F0} MB, armed timers {r.Live().Count(c => c.PumpArmed)}");
        for (int i = 0; i < 6; i++) r.Link("d" + i);
        foreach (var n in new[] { 1, 3, 6 })
        {
            foreach (var s in subs) r.Unsubscribe(s.Id); for (int i = 0; i < n; i++) r.Subscribe(subs[i]);
            r.Default.PlayItems(new[] { item }, 0); Thread.Sleep(3000);
            var m = Measure(null, 10000); Report($"[{Tag}] {n} device(s), ONE song, linked (1 group): cpu {m.CpuPct:F2}%, rss {m.RssMb:F0} MB");
            r.Default.Stop(); Thread.Sleep(1500);
        }
        foreach (var s in subs) r.Unsubscribe(s.Id);
        foreach (var n in new[] { 1, 3, 6 })
        {
            for (int i = 0; i < 6; i++) r.Link("d" + i); foreach (var s in subs) r.Unsubscribe(s.Id);
            for (int i = 0; i < n; i++) { r.Split("d" + i); r.Subscribe(subs[i]); r.Get("p:d" + i)!.PlayItems(new[] { i % 2 == 0 ? item : item2 }, 0); }
            Thread.Sleep(3000); var m = Measure(null, 10000);
            Report($"[{Tag}] {n} device(s), {n} DIFFERENT songs (independent zones, {n} groups): cpu {m.CpuPct:F2}%, rss {m.RssMb:F0} MB, armed timers {r.Live().Count(c => c.PumpArmed)}");
            for (int i = 0; i < n; i++) r.Get("p:d" + i)!.Stop(); Thread.Sleep(1500);
        }
        Thread.Sleep(2000); var idle2 = Measure(null, 5000); Report($"[{Tag}] idle after play, 6 materialized groups: cpu {idle2.CpuPct:F2}%, rss {idle2.RssMb:F0} MB, armed timers {r.Live().Count(c => c.PumpArmed)}");
    }

    [Fact]
    public async Task Stage4_zone_receivers_idle_and_three_zones_receiving_live_audio()
    {
        if (!On) return;
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        var ids = new List<long>(); for (int i = 0; i < 6; i++) ids.Add((await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Zone " + i, deviceIds = new long[0] })).Json()).GetProperty("id").GetInt64());
        Thread.Sleep(2000); var idle0 = Measure(null, 6000); Report($"[{Tag}] server, 6 zones, no receivers: cpu {idle0.CpuPct:F2}%, rss {idle0.RssMb:F0} MB");
        var sw = Stopwatch.StartNew(); foreach (var id in ids) await admin.PutAsJsonAsync($"/api/v1/receivers/zones/{id}", new { airplay = true, spotify = true });
        Report($"[{Tag}] enabling AirPlay + Spotify on 6 zones took {sw.ElapsedMilliseconds} ms (receiver programs are not installed in the test host, so no child processes run)");
        Thread.Sleep(1500); var idle1 = Measure(null, 6000); Report($"[{Tag}] server, 6 zones with receivers enabled but nobody casting: cpu {idle1.CpuPct:F2}%, rss {idle1.RssMb:F0} MB, armed timers {S.Registry.Live().Count(c => c.PumpArmed)}");
        sw.Restart(); for (int i = 0; i < 20; i++) S.ZoneRecv!.Sync(); Report($"[{Tag}] ZoneReceivers.Sync x20 with 6 zones: {sw.ElapsedMilliseconds / 20.0:F2} ms each");
        // three zones receive a live 44.1 kHz stereo stream (what an AirPlay/Spotify decoder child process would push)
        using var cts = new CancellationTokenSource(); var feeders = new List<Task>(); var pcm = new byte[4410 * 4];
        for (int i = 0; i < 3; i++)
        {
            var ap = S.ZoneRecv!.AirPlayOf(ids[i])!; ap.OnLine("INIT 0 2 44100");
            feeders.Add(Task.Run(() => { var next = Stopwatch.StartNew(); long n = 0; while (!cts.IsCancellationRequested) { ap.Feed.WriteS16(pcm, 44100); n++; var due = n * 100 - next.ElapsedMilliseconds; if (due > 0) Thread.Sleep((int)due); } }));
        }
        Thread.Sleep(3000); var live = Measure(null, 10000);
        Report($"[{Tag}] 3 zones each receiving a live stream (AirPlay-style feeder), 3 groups pumping: cpu {live.CpuPct:F2}%, rss {live.RssMb:F0} MB, armed timers {S.Registry.Live().Count(c => c.PumpArmed)}");
        cts.Cancel(); await Task.WhenAll(feeders); for (int i = 0; i < 3; i++) S.ZoneRecv!.AirPlayOf(ids[i])!.OnLine("STOP");
        Thread.Sleep(2000); var idle2 = Measure(null, 5000); Report($"[{Tag}] after the streams ended: cpu {idle2.CpuPct:F2}%, rss {idle2.RssMb:F0} MB, armed timers {S.Registry.Live().Count(c => c.PumpArmed)}");
    }
}
