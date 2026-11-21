using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using WavWiz.Core.Protocol;
using WavWiz.Server.Announce;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.7.2 C: Announce (hold-to-talk). The music is ducked 12 dB - never paused, stopped or skipped - a chime plays first (on by default),
/// then the voice; the music fades back when the talker lets go. Control may announce, View may not. The browser microphone itself is not testable here.</summary>
public class Release072AnnounceTests
{
    // ---------------- mixer ----------------
    private static float[] Music(int frames, float level = 0.5f) { var b = new float[frames * 2]; Array.Fill(b, level); return b; }
    /// <summary>Runs the mixer over constant "music" 20 ms at a time and returns the left channel.</summary>
    private static List<float> Run(AnnounceMixer m, int ms, int rate = 48000, float level = 0.5f)
    {
        var o = new List<float>(); int f = rate / 50;
        for (int t = 0; t < ms; t += 20) { var b = Music(f, level); m.Mix(b, f, rate); for (int i = 0; i < f; i++) o.Add(b[i * 2]); }
        return o;
    }

    [Fact]
    public void Music_is_ducked_12_dB_never_paused_and_fades_back_after_release()
    {
        var m = new AnnounceMixer(chime: false);
        Assert.Equal(Math.Pow(10, -12 / 20.0), m.DuckGain, 6);
        m.Push(new float[48000]);                                    // one second of (silent) voice, so only the music level is measured
        var during = Run(m, 800);
        Assert.All(during, x => Assert.True(x >= 0.5 * m.DuckGain - 1e-4, "the music must never go below -12 dB (never paused or muted)"));
        Assert.InRange(during[^1], 0.5 * m.DuckGain - 1e-3, 0.5 * m.DuckGain + 1e-3);
        Assert.InRange(during[AnnounceMixer.DuckDownMs * 48 / 2], 0.5 * m.DuckGain + 0.05, 0.49);   // half-way down the 200 ms duck ramp: a smooth dip, not a cut
        m.End(); Assert.False(m.Done);
        var after = Run(m, 200 + AnnounceMixer.TailMs + AnnounceMixer.FadeBackMs + 200);
        Assert.True(m.Done); Assert.InRange(after[^1], 0.499, 0.501);
        for (int i = 1; i < after.Count; i++) Assert.True(after[i] >= after[i - 1] - 1e-6, "fading back only goes up");
        var rest = Run(m, 100); Assert.All(rest, x => Assert.Equal(0.5f, x, 5));                    // done: the stream is untouched
    }

    [Fact]
    public void The_chime_plays_first_by_default_then_the_voice()
    {
        var ch = AnnounceMixer.Chime();
        Assert.InRange(ch.Length, 48000 * 8 / 10, 48000);                                           // ~0.9 s ding-dong
        Assert.InRange(ch.Max(Math.Abs), 0.15f, 0.35f);
        var m = new AnnounceMixer();                                                                // chime on
        Assert.Equal(ch.Length, m.Queued);
        var voice = new float[4800]; Array.Fill(voice, 0.2f); m.Push(voice);
        var o = Run(m, 1200, level: 0);
        Assert.True(o.Take(ch.Length).Max(Math.Abs) > 0.15f, "chime first");
        Assert.InRange(o[ch.Length + 100], 0.19f, 0.21f);                                           // then the voice, as sent
        Assert.Equal(0, m.Queued);
        Assert.Equal(0, new AnnounceMixer(chime: false).Queued);
    }

    [Fact]
    public void A_96_kHz_stream_holds_each_voice_sample_for_two_outputs()
    {
        var m = new AnnounceMixer(chime: false); var v = new float[4800]; for (int i = 0; i < v.Length; i++) v[i] = i % 2 == 0 ? 0.1f : -0.1f; m.Push(v); m.End();
        var o = Run(m, 200, rate: 96000, level: 0);
        Assert.Equal(0.1f, o[0], 4); Assert.Equal(0.1f, o[1], 4); Assert.Equal(-0.1f, o[2], 4); Assert.Equal(-0.1f, o[3], 4);
        Assert.Equal(0f, o[9600 + 10], 4);                                                         // 4800 voice samples = 100 ms = 9600 outputs at 96 kHz
    }

    [Fact]
    public void Loud_music_plus_voice_is_limited_and_pcm16_is_resampled_to_48k()
    {
        var m = new AnnounceMixer(chime: false, duckDb: 0); var v = new float[9600]; Array.Fill(v, 0.95f); m.Push(v);
        var o = Run(m, 200, level: 0.95f); Assert.All(o, x => Assert.True(Math.Abs(x) <= 1f));
        var pcm = new byte[1600 * 2]; for (int i = 0; i < 1600; i++) { short s = 16384; pcm[i * 2] = (byte)s; pcm[i * 2 + 1] = (byte)(s >> 8); }
        var x48 = AnnounceMixer.FromPcm16(pcm, 16000); Assert.Equal(4800, x48.Length); Assert.All(x48, x => Assert.Equal(0.5f, x, 3));
        Assert.Equal(1600, AnnounceMixer.FromPcm16(pcm, 48000).Length);
    }

    [Fact]
    public void Voice_past_the_limit_is_cut_and_ends_the_announcement()
    {
        var m = new AnnounceMixer(chime: false);
        for (int i = 0; i < AnnounceMixer.MaxVoiceSeconds; i++) m.Push(new float[48000]);
        Assert.False(m.Ended); m.Push(new float[480]); Assert.True(m.Ended);
    }

    // ---------------- conductor ----------------
    private static (Conductor C, TempDir T) Make() { var t = new TempDir(); var db = new Db(t.File("u.db")); db.Migrate(); return (new Conductor(db, new EventHub(), TestMedia.Ffmpeg) { LeadMs = 300 }, t); }
    private static float Peak(Recorder r, int from = 0)
    {
        float p = 0; List<byte[]> ms; lock (r.Messages) ms = r.Messages.Skip(from).ToList();
        foreach (var m in ms) if (m.Length > Wire.HeaderSize && (MsgType)m[5] == MsgType.Audio && Wire.TryDecodeAudio(m.AsSpan(Wire.HeaderSize), out var f, out _)) p = Math.Max(p, f!.Samples.Max(Math.Abs));
        return p;
    }
    private static async Task Until(Func<bool> ok, string what, int ms = 8000) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (sw.ElapsedMilliseconds < ms) { if (ok()) return; await Task.Delay(20); } Assert.Fail(what); }

    [Fact]
    public async Task Announcing_while_stopped_plays_the_voice_and_leaves_the_queue_and_state_alone()
    {
        var (c, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 3, 440, "A");
        c.PlayItems(new[] { new QueueItem(0, "track", t.File("a.flac"), "A", "", "", 3000, 1) }); c.Stop();
        var rec = new Recorder(); c.Subscribe(rec); await Task.Delay(200); int start = rec.Messages.Count;
        var m = new AnnounceMixer(chime: true); c.BeginAnnounce(m);
        Assert.True(c.Announcing); Assert.Equal("stopped", c.Now().State);
        var v = new float[9600]; Array.Fill(v, 0.3f); m.Push(v); m.End();
        await Until(() => !c.Announcing, "the announcement did not finish");
        Assert.True(Peak(rec, start) > 0.15f, "the chime and the voice were sent");
        Assert.Equal("stopped", c.Now().State); Assert.Single(c.Queue()); Assert.Equal(0, c.Now().Index);
        await Until(() => c.IsIdle, "the voice-only stream did not stop");
    }

    [Fact]
    public async Task Announcing_over_music_keeps_it_playing_in_the_same_epoch_and_position()
    {
        var (c, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 8, 440, "A");
        var rec = new Recorder(); c.Subscribe(rec);
        c.PlayItems(new[] { new QueueItem(0, "track", t.File("a.flac"), "A", "", "", 8000, 1) }); await Task.Delay(700);
        int epochs = rec.Count(MsgType.Epoch); long pos = c.Now().PositionMs;
        var m = new AnnounceMixer(chime: false); c.BeginAnnounce(m); m.Push(new float[24000]); await Task.Delay(500); m.End();
        Assert.Equal("playing", c.Now().State); Assert.True(c.Now().PositionMs > pos);
        await Until(() => !c.Announcing, "the announcement did not finish");
        Assert.Equal("playing", c.Now().State); Assert.Equal(epochs, rec.Count(MsgType.Epoch)); Assert.Equal(0, rec.Count(MsgType.StopAt));   // never paused, never restarted
    }

    [Fact]
    public async Task Announcing_while_paused_keeps_the_pause_position_and_resume_still_works()
    {
        var (c, t) = Make(); using var _ = t; using var __ = c;
        TestMedia.Tone(t.File("a.flac"), 8, 440, "A"); var rec = new Recorder(); c.Subscribe(rec);
        c.PlayItems(new[] { new QueueItem(0, "track", t.File("a.flac"), "A", "", "", 8000, 1) }); await Task.Delay(900); c.Pause(); await Task.Delay(400);
        long pos = c.Now().PositionMs;
        var m = new AnnounceMixer(chime: false); c.BeginAnnounce(m); m.Push(new float[9600]); m.End();
        await Until(() => !c.Announcing, "the announcement did not finish");
        Assert.Equal("paused", c.Now().State); Assert.Equal(pos, c.Now().PositionMs);
        c.Resume(); await Task.Delay(400); Assert.Equal("playing", c.Now().State); Assert.True(c.Now().PositionMs >= pos);
    }

    // ---------------- end to end ----------------
    private static Uri Ws(ServerFixture f, string path) => new(f.Base.Replace("http", "ws") + path);
    private static async Task<JsonElement> Recv(ClientWebSocket ws)
    {
        var buf = new byte[4096]; using var to = new CancellationTokenSource(5000);
        var r = await ws.ReceiveAsync(buf, to.Token); return JsonDocument.Parse(Encoding.UTF8.GetString(buf, 0, r.Count)).RootElement.Clone();
    }
    private static async Task<ClientWebSocket> Talk(ServerFixture f, string token, string q)
    {
        var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + token);
        await ws.ConnectAsync(Ws(f, "/ws/announce" + q), CancellationToken.None); return ws;
    }
    private static byte[] Pcm16Tone(int n, double f = 500, double amp = 0.5)
    { var b = new byte[n * 2]; for (int i = 0; i < n; i++) { short s = (short)(amp * 32767 * Math.Sin(2 * Math.PI * f * i / 48000)); b[i * 2] = (byte)s; b[i * 2 + 1] = (byte)(s >> 8); } return b; }

    [Fact]
    public async Task Control_announces_to_the_speakers_view_cannot_and_one_talker_at_a_time()
    {
        await using var f = await ServerFixture.StartAsync();
        await using var pc = await FakePc.StartAsync(f, "pc-a", "Kitchen"); await pc.WaitConnected();
        await Until(() => f.Server.S.Zones.Zones().Count == 1 && f.Server.S.Zones.Zones()[0].Outputs.Count == 1, "zone + output");
        f.JoinEverywhere();
        await Until(() => f.Server.S.Conductor.Subscribers().Count > 0, "the speaker did not subscribe");
        // View: refused before the socket opens
        var view = new ClientWebSocket(); view.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View, "v"));
        await Assert.ThrowsAnyAsync<WebSocketException>(() => view.ConnectAsync(Ws(f, "/ws/announce"), CancellationToken.None));
        var st0 = await f.As(f.Token(Role.View, "v2")).GetJson("/api/v1/announce");
        Assert.False(st0.GetProperty("active").GetBoolean()); Assert.True(st0.GetProperty("chime").GetBoolean()); Assert.Equal(-12, st0.GetProperty("duckDb").GetDouble());

        float before = pc.MaxPeak;
        using var ws = await Talk(f, f.Token(Role.Control, "Dad"), "?chime=0&rate=48000");
        Assert.Equal("ready", (await Recv(ws)).GetProperty("type").GetString());
        var st = await f.As(f.Token(Role.View, "v3")).GetJson("/api/v1/announce");
        Assert.True(st.GetProperty("active").GetBoolean()); Assert.Equal("Dad", st.GetProperty("by").GetString());
        using (var other = await Talk(f, f.Token(Role.Control, "Mom"), ""))
        {
            var e = await Recv(other); Assert.Equal("error", e.GetProperty("type").GetString()); Assert.Contains(AnnounceService.BusyText, e.GetProperty("message").GetString());
        }
        for (int i = 0; i < 30; i++) { await ws.SendAsync(Pcm16Tone(960), WebSocketMessageType.Binary, true, CancellationToken.None); await Task.Delay(20); }
        await ws.SendAsync(Encoding.UTF8.GetBytes("end"), WebSocketMessageType.Text, true, CancellationToken.None);
        Assert.Equal("done", (await Recv(ws)).GetProperty("type").GetString());
        await Until(() => pc.MaxPeak > before + 0.01f, "the speaker never played the voice");
        await Until(() => !f.Server.S.Conductor.Announcing, "the announcement did not finish");
        Assert.Equal("stopped", f.Server.S.Conductor.Now().State);
        // the next talker can go now
        using var again = await Talk(f, f.Token(Role.Control, "Mom"), "?zone=everywhere");
        Assert.Equal("ready", (await Recv(again)).GetProperty("type").GetString());
    }

    [Fact]
    public async Task Announce_refuses_an_unknown_zone_and_the_chime_setting_is_a_switch()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin, "a"));
        using var ws = await Talk(f, f.Token(Role.Control, "c"), "?zone=g:999");
        Assert.Equal("error", (await Recv(ws)).GetProperty("type").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["announce.chime"] = "no" })).StatusCode);
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["announce.chime"] = false })).EnsureSuccessStatusCode();
        Assert.False((await admin.GetJson("/api/v1/announce")).GetProperty("chime").GetBoolean());
        Assert.False(f.Server.S.Announce!.ChimeDefault());
        Assert.Equal(AnnounceMixer.VoiceRate, Api.AnnounceApi.CleanRate("abc")); Assert.Equal(16000, Api.AnnounceApi.CleanRate("16000")); Assert.Null(Api.AnnounceApi.CleanChime("x")); Assert.True(Api.AnnounceApi.CleanChime("1"));
    }
}
