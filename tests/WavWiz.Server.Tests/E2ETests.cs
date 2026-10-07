using System.Net;
using System.Text.Json;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>A pretend PC: the real PlayerClient with a capture "sound card" that remembers what it played and when it would be HEARD (DAC time + a hidden delay the PC does not know about).</summary>
public sealed class FakePc : IAsyncDisposable
{
    public PlayerClient Client = null!; public CaptureOutputProvider Outputs = new(); public double HiddenMs;
    private readonly CancellationTokenSource _cts = new(); private Task _run = Task.CompletedTask;
    private readonly List<(long Us, float[] Mono)> _blocks = new(); private readonly object _l = new();
    public string Id = ""; public float MaxPeak;

    public static async Task<FakePc> StartAsync(ServerFixture f, string id, string name, double hiddenMs = 0, string kind = "other", string? bt = null)
    {
        var pc = new FakePc { HiddenMs = hiddenMs, Id = id };
        pc.Outputs.Outputs.Clear(); pc.Outputs.Outputs.Add(new OutputInfo("ep-" + id, name + " speakers", kind, bt, true, true));
        pc.Outputs.OnBlock = (buf, frames, dac) =>
        {
            var mono = new float[frames]; float peak = 0; for (int i = 0; i < frames; i++) { mono[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5f; peak = Math.Max(peak, Math.Abs(mono[i])); }
            pc.MaxPeak = Math.Max(pc.MaxPeak, peak);
            lock (pc._l) { pc._blocks.Add((dac + (long)(pc.HiddenMs * 1000), mono)); while (pc._blocks.Count > 3000) pc._blocks.RemoveAt(0); }
        };
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = id, name }); r.EnsureSuccessStatusCode();
        var tok = (await r.Json()).GetProperty("token").GetString()!;
        pc.Client = new PlayerClient(new PlayerClientOptions { Host = "127.0.0.1", AudioPort = f.Server.S.Audio.Port, PlayerId = id, Name = name, LinkType = "ethernet", Token = () => tok, Outputs = pc.Outputs });
        pc._run = Task.Run(() => pc.Client.RunAsync(pc._cts.Token));
        return pc;
    }

    public async Task WaitConnected(int ms = 10000) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!Client.State.Connected && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(Client.State.Connected, "player did not connect"); }

    /// <summary>Times (server clock, µs) at which clicks (samples above 0.001 - volume taper makes them quiet) were heard.</summary>
    public List<long> Clicks(long sinceUs = 0)
    {
        var res = new List<long>(); long last = -1_000_000_000_000L;
        lock (_l) foreach (var (us, m) in _blocks) for (int i = 0; i < m.Length; i++) if (Math.Abs(m[i]) > 0.001f) { long t = us + (long)(i * 1e6 / 48000); if (t >= sinceUs && t - last > 200_000) { res.Add(t); last = t; } }
        return res;
    }

    /// <summary>Synthesise what a phone microphone would record: everything this PC played, placed at the time it was heard + the phone's own input delay.</summary>
    public void MixInto(float[] rec, long startUs, double micDelayMs, float gain = 0.5f)
    {
        lock (_l) foreach (var (us, m) in _blocks)
        {
            long idx0 = (long)Math.Round((us + micDelayMs * 1000 - startUs) * 48000 / 1e6);
            for (int i = 0; i < m.Length; i++) { long k = idx0 + i; if (k >= 0 && k < rec.Length) rec[k] += m[i] * gain; }
        }
    }

    public async ValueTask DisposeAsync() { _cts.Cancel(); try { await Task.WhenAny(_run, Task.Delay(2000)); } catch { } await Client.DisposeAsync(); }
}

public class E2ETests
{
    private static async Task<long> AddClickTrack(ServerFixture f, HttpClient admin, int seconds = 12)
    {
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        TestMedia.Run("-f", "lavfi", "-i", $"aevalsrc=if(lt(mod(t\\,0.5)\\,0.002)\\,0.8\\,0):s=48000:d={seconds}", "-ac", "2", "-metadata", "title=Clicks", "-metadata", "artist=Test", Path.Combine(music, "clicks.flac"));
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music });
        for (int i = 0; i < 100; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 1) break; await Task.Delay(100); }
        return (await admin.GetJson("/api/v1/library/search?q=clicks"))[0].GetProperty("id").GetInt64();
    }

    public static Func<string>? Diag;
    static string ReadLog(string dir) { try { var d = Path.Combine(dir, "logs"); var fl = Directory.Exists(d) ? Directory.GetFiles(d) : Array.Empty<string>(); return fl.Length == 0 ? "(no log files in " + d + ")" : string.Join("\n", File.ReadAllLines(fl[0]).TakeLast(15)); } catch (Exception e) { return "(log unreadable: " + e.Message + ")"; } }
    private static async Task WaitUntil(Func<bool> cond, int ms = 15000, string what = "condition") { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!cond() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(cond(), "timed out waiting for " + what + (Diag != null ? "\n" + Diag() : "")); }

    private static double MaxClickSkewMs(FakePc a, FakePc b)
    {
        var ca = a.Clicks(); var cb = b.Clicks(); double worst = 0; int n = 0;
        foreach (var t in ca) { var m = cb.OrderBy(x => Math.Abs(x - t)).FirstOrDefault(); if (m != 0 && Math.Abs(m - t) < 100_000) { worst = Math.Max(worst, Math.Abs(m - t) / 1000.0); n++; } }
        Assert.True(n >= 4, $"only {n} clicks matched");
        return worst;
    }

    [Fact]
    public async Task Two_players_connect_get_zones_play_the_same_music_in_sync_and_zone_controls_work()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "Living room"); await using var b = await FakePc.StartAsync(f, "pc-b", "Kitchen");
        await a.WaitConnected(); await b.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 2 && f.Server.S.Zones.Zones().All(z => z.Outputs.Count == 1), what: "zones + outputs");
        var zones = await admin.GetJson("/api/v1/zones"); Assert.Equal(2, zones.GetArrayLength());
        Assert.All(zones.EnumerateArray(), z => { Assert.Equal("uncalibrated", z.GetProperty("badge").GetString()); Assert.True(z.GetProperty("connected").GetBoolean()); });
        var o = zones[0].GetProperty("outputs")[0]; Assert.True(o.GetProperty("notCalibrated").GetBoolean()); Assert.Contains("not calibrated", o.GetProperty("label").GetString());   // honest label: never silently zero

        Diag = () => $"A: {a.Client.State}\nB: {b.Client.State}\nnow: {f.Server.S.Conductor.Now()}\nsessA: {f.Server.S.Audio.Get("pc-a")?.Status}\nlog:\n{ReadLog(f.Dir.Path)}\nblocks A={a.Outputs.LastSink?.Blocks} maxpeak={a.MaxPeak} clicks={a.Clicks().Count}\nengine: {a.Client.Engine.GetType().Name}";
        long tid = await AddClickTrack(f, admin);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } })).StatusCode);
        await WaitUntil(() => a.Clicks().Count >= 6 && b.Clicks().Count >= 6, 20000, "both players to play clicks");
        double skew = MaxClickSkewMs(a, b); Assert.True(skew < 2.0, $"click skew {skew:F2} ms");
        var now = await admin.GetJson("/api/v1/stream"); Assert.Equal("playing", now.GetProperty("now").GetProperty("state").GetString()); Assert.Equal("Clicks", now.GetProperty("now").GetProperty("item").GetProperty("title").GetString());

        // volume + mute reach the player; disabling a room silences just that room, enabling brings it back in sync
        var zid = zones.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-b").GetProperty("id").GetInt64();
        await admin.PatchAsJsonAsync($"/api/v1/zones/{zid}", new { volume = 33, name = "Kitchen!" });
        await WaitUntil(() => Math.Abs(b.Client.State.Volume - 33) < 0.01, what: "volume to reach the player");
        await admin.PatchAsJsonAsync($"/api/v1/zones/{zid}", new { enabled = false });
        await WaitUntil(() => !b.Client.State.ZoneEnabled, what: "zone off"); int before = b.Clicks().Count; await Task.Delay(2500); Assert.True(b.Clicks().Count - before <= 1, "disabled room kept playing");
        int aBefore = a.Clicks().Count; await Task.Delay(1200); Assert.True(a.Clicks().Count > aBefore, "the other room must keep playing");
        await admin.PatchAsJsonAsync($"/api/v1/zones/{zid}", new { enabled = true });
        long since = f.Server.S.Conductor.Clock.NowUs + 500_000;
        await WaitUntil(() => b.Clicks(since).Count >= 3 || f.Server.S.Conductor.State != WavWiz.Server.Playback.PlayState.Playing, 15000, "room b to rejoin");
        if (f.Server.S.Conductor.State == WavWiz.Server.Playback.PlayState.Playing) { Assert.True(MaxClickSkewMsSince(a, b, since, 2) < 2.5, "rejoined room not in sync"); }

        // transport: pause stops both, resume restarts
        await admin.PostAsync("/api/v1/stream/pause", null); await Task.Delay(800); int p1 = a.Clicks().Count; await Task.Delay(1500); Assert.Equal(p1, a.Clicks().Count);
        Assert.Equal("paused", (await admin.GetJson("/api/v1/stream")).GetProperty("now").GetProperty("state").GetString());
        await admin.PostAsync("/api/v1/stream/resume", null); await WaitUntil(() => a.Clicks().Count > p1 + 2, 10000, "resume");
    }

    private static double MaxClickSkewMsSince(FakePc a, FakePc b, long sinceUs, int atLeast)
    {
        var ca = a.Clicks(sinceUs); var cb = b.Clicks(sinceUs); Assert.True(ca.Count >= atLeast && cb.Count >= atLeast, $"clicks since: a={ca.Count} b={cb.Count}");
        double worst = 0; foreach (var t in ca.Take(Math.Min(ca.Count, cb.Count))) worst = Math.Max(worst, cb.Min(x => Math.Abs(x - t)) / 1000.0);
        return worst;
    }

    [Fact]
    public async Task Phone_calibration_end_to_end_measures_a_hidden_80ms_bluetooth_style_delay_and_the_rooms_then_line_up()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-ref", "Reference", hiddenMs: 0); await using var b = await FakePc.StartAsync(f, "pc-bt", "BT speaker", hiddenMs: 80, kind: "bluetooth", bt: "AA:BB:CC:00:11:22");
        await a.WaitConnected(); await b.WaitConnected();
        await WaitUntil(() => f.Server.S.Zones.Zones().Count == 2 && f.Server.S.Zones.Zones().All(z => z.Outputs.Count == 1), what: "zones");
        var zones = f.Server.S.Zones.Zones(); long refId = zones.First(z => z.PlayerId == "pc-ref").Id, btId = zones.First(z => z.PlayerId == "pc-bt").Id;
        var bt = zones.First(z => z.Id == btId).Outputs[0]; Assert.Equal("bt:aabbcc001122", bt.DeviceId); Assert.True(bt.NotCalibrated); Assert.Equal(200, bt.LatencyMs);       // BT default guess, flagged

        var sess = await (await admin.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = refId, micSource = "phone-test", micProcessing = "raw" })).Json();
        string sid = sess.GetProperty("id").GetString()!; const double micDelayMs = 63;                // the phone's own input delay: unknown to the server, must cancel out
        async Task<JsonElement> Run(string kind, long zoneId)
        {
            var play = await (await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/play", new { kind, zoneId, distanceM = 0 })).Json();
            long at = play.GetProperty("atUs").GetInt64(); long start = at - 1_000_000; var rec = new float[48000 * 6];
            await WaitUntil(() => f.Server.S.Conductor.Clock.NowUs > start + 6_300_000, 15000, "recording window");
            a.MixInto(rec, start, micDelayMs); b.MixInto(rec, start, micDelayMs);
            var rnd = new Random(1); for (int i = 0; i < rec.Length; i++) rec[i] += (float)(rnd.NextDouble() - 0.5) * 0.01f;                       // room noise
            var bytes = new byte[rec.Length * 4]; Buffer.BlockCopy(rec, 0, bytes, 0, bytes.Length);
            var resp = await admin.PostAsync($"/api/v1/calibration/sessions/{sid}/capture?zoneId={(kind == "dev" ? zoneId : refId)}&kind={kind}&rate=48000&startServerUs={start}", new ByteArrayContent(bytes));
            return await resp.Json();
        }
        for (int i = 0; i < 3; i++) { var r = await Run("ref", refId); Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString()); }
        for (int i = 0; i < 3; i++) { var r = await Run("dev", btId); Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString()); }
        var re = await Run("ref-end", refId); Assert.True(re.GetProperty("ok").GetBoolean(), re.ToString());
        var fin = await (await admin.PostAsync($"/api/v1/calibration/sessions/{sid}/finish", null)).Json();
        var prop = fin.GetProperty("proposals").EnumerateArray().Single(); Assert.Equal(btId, prop.GetProperty("zoneId").GetInt64());
        double lat = prop.GetProperty("proposedLatencyMs").GetDouble(); Assert.InRange(lat, 77, 83);
        Assert.True(prop.GetProperty("confidence").GetDouble() >= 0.6, prop.ToString());
        await admin.PostAsJsonAsync($"/api/v1/calibration/sessions/{sid}/commit", new { });

        await WaitUntil(() => Math.Abs(b.Client.State.LatencyMs - lat) < 0.2 && !b.Client.State.NotCalibrated, what: "calibrated delay at the player");
        Assert.Equal("measured", b.Client.State.LatencySource);
        var z2 = f.Server.S.Zones.Zone(btId)!; Assert.Equal("synced", z2.Badge); Assert.Contains("measured", z2.Outputs[0].Label);

        // the proof: play clicks; what the room HEARS (DAC time + hidden 80 ms) now lines up
        long tid = await AddClickTrack(f, admin, 14); long since = f.Server.S.Conductor.Clock.NowUs;
        await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { tid } });
        await WaitUntil(() => a.Clicks(since).Count >= 8 && b.Clicks(since).Count >= 8, 25000, "clicks");
        double skew = MaxClickSkewMsSince(a, b, since, 8); Assert.True(skew < 3.0, $"rooms are {skew:F2} ms apart after calibration");

        // manual override + history/rollback
        var put = await admin.PutAsJsonAsync($"/api/v1/outputs/{Uri.EscapeDataString(bt.DeviceId)}/latency", new { latencyMs = 123, playerId = "pc-bt" }); Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        await WaitUntil(() => Math.Abs(b.Client.State.LatencyMs - 123) < 0.01, what: "manual delay"); Assert.Equal("manual", b.Client.State.LatencySource);
        var hist = await admin.GetJson($"/api/v1/outputs/{Uri.EscapeDataString(bt.DeviceId)}/calibrations"); Assert.True(hist.GetArrayLength() >= 2);
        var prev = hist.EnumerateArray().First(h => h.GetProperty("method").GetString() == "mic").GetProperty("id").GetInt64();
        await admin.PostAsync($"/api/v1/calibrations/{prev}/restore", null); await WaitUntil(() => Math.Abs(b.Client.State.LatencyMs - lat) < 0.2, what: "rollback");
    }
}

