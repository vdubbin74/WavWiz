using System.Net;
using System.Text;
using System.Text.Json;
using WavWiz.Server.Library;
using WavWiz.Server.Media;
using WavWiz.Server.Net;
namespace WavWiz.Server.Tests;

/// <summary>0.1.3: ReplayGain (tags, modes, clipping protection), iTunSMPB gapless trim, NAS logon (encrypted, never listed), receiver health, network helper.</summary>
public class Release013Tests
{
    private static float[] ReadAll(IPcmDecoder d, int maxSec = 15)
    {
        var all = new List<float>(); var b = new float[1920]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!d.Finished && sw.Elapsed.TotalSeconds < maxSec) { int n = d.Read(b, 960); all.AddRange(b.Take(n * 2)); if (n == 0) Thread.Sleep(2); }
        return all.ToArray();
    }
    private static float[] ReadAll(QueueSource q)
    {
        var all = new List<float>(); var buf = new float[1920]; var sw = System.Diagnostics.Stopwatch.StartNew();
        while (!q.Ended && sw.Elapsed.TotalSeconds < 15) { int n = q.Read(buf, 960); all.AddRange(buf.Take(n * 2)); if (n == 0) Thread.Sleep(2); }
        return all.ToArray();
    }
    private static string Sine(TempDir t, string name, double sec, double amp, params string[] meta)
    {
        var a = new List<string> { "-f", "lavfi", "-i", $"sine=frequency=997:sample_rate=48000:duration={sec.ToString(System.Globalization.CultureInfo.InvariantCulture)}", "-af", $"volume={amp.ToString(System.Globalization.CultureInfo.InvariantCulture)}", "-ac", "2" };
        foreach (var m in meta) { a.Add("-metadata"); a.Add(m); }
        a.Add(t.File(name)); TestMedia.Run(a.ToArray()); return t.File(name);
    }

    [Fact]
    public void ReplayGain_tags_are_read_from_flac_mp3_and_R128_ogg()
    {
        using var t = new TempDir();
        var flac = Loudness.Read(Sine(t, "a.flac", 0.5, 0.5, "REPLAYGAIN_TRACK_GAIN=-6.50 dB", "REPLAYGAIN_TRACK_PEAK=0.500000", "REPLAYGAIN_ALBUM_GAIN=-4.00 dB", "REPLAYGAIN_ALBUM_PEAK=0.700000"));
        Assert.Equal(-6.5, flac.TrackGainDb!.Value, 2); Assert.Equal(0.5, flac.TrackPeak!.Value, 3); Assert.Equal(-4.0, flac.AlbumGainDb!.Value, 2); Assert.Equal(0.7, flac.AlbumPeak!.Value, 3);
        var mp3 = Loudness.Read(Sine(t, "b.mp3", 0.5, 0.5, "REPLAYGAIN_TRACK_GAIN=+2.25 dB", "REPLAYGAIN_TRACK_PEAK=0.400000"));
        Assert.Equal(2.25, mp3.TrackGainDb!.Value, 2); Assert.Equal(0.4, mp3.TrackPeak!.Value, 3);
        var ogg = Loudness.Read(Sine(t, "c.ogg", 0.5, 0.5, "R128_TRACK_GAIN=-1280"));
        Assert.Equal(0.0, ogg.TrackGainDb!.Value, 2);          // -5 dB vs -23 LUFS = 0 dB vs the ReplayGain reference
        var none = Loudness.Read(Sine(t, "d.flac", 0.5, 0.5));
        Assert.Null(none.TrackGainDb); Assert.Equal(1f, Loudness.Gain(none, "track", false));
        Assert.Equal(TrackTags.None, Loudness.Read(t.File("missing.flac")));
    }

    [Fact]
    public void Gain_modes_fall_back_and_never_push_the_peak_over_full_scale()
    {
        var t = new TrackTags(-6, 0.5, -3, 0.9, null, null);
        Assert.Equal(1f, Loudness.Gain(t, "off", true));
        Assert.Equal(Math.Pow(10, -6 / 20.0), Loudness.Gain(t, "track", true), 4);
        Assert.Equal(Math.Pow(10, -3 / 20.0), Loudness.Gain(t, "album", false), 4);
        Assert.Equal(Math.Pow(10, -3 / 20.0), Loudness.Gain(t, "auto", true), 4);       // auto + album context = album gain
        Assert.Equal(Math.Pow(10, -6 / 20.0), Loudness.Gain(t, "auto", false), 4);
        Assert.Equal(Math.Pow(10, -6 / 20.0), Loudness.Gain(t with { AlbumGainDb = null, AlbumPeak = null }, "album", true), 4);   // album falls back to track
        var loud = new TrackTags(10, 0.8, null, null, null, null);
        Assert.Equal(1 / 0.8, Loudness.Gain(loud, "track", false), 4);                 // +10 dB would clip: capped at 1/peak
        Assert.Equal("auto", Loudness.NormMode("bogus")); Assert.Equal("album", Loudness.NormMode("\"album\""));
        Assert.Equal(6.0, Loudness.R128("256")!.Value, 3); Assert.Null(Loudness.Db("loud"));
    }

    [Fact]
    public void Soft_limiter_bends_peaks_instead_of_clipping()
    {
        var s = new float[] { 0.5f, -0.5f, 0.95f, -0.95f, 2f };
        ShapedDecoder.Apply(s, 2f);
        Assert.All(s, v => Assert.InRange(v, -1f, 1f));
        Assert.True(s[0] > 0.89f && s[0] < s[4]); Assert.Equal(-s[0], s[1], 5);
    }

    [Fact]
    public void Gain_is_applied_and_a_slow_tag_read_never_blocks_playback()
    {
        using var t = new TempDir(); var f = Sine(t, "a.flac", 1, 0.5);
        var half = ReadAll(new ShapedDecoder(new FfmpegDecoder(TestMedia.Ffmpeg, f), 0.5f, null));
        var full = ReadAll(new FfmpegDecoder(TestMedia.Ffmpeg, f));
        Assert.Equal(full.Length, half.Length);
        Assert.Equal(full.Max() * 0.5, half.Max(), 3);
        var never = new TaskCompletionSource<(float, long?)>();
        var d = new ShapedDecoder(new FfmpegDecoder(TestMedia.Ffmpeg, f), never.Task, waitMs: 300);
        var b = new float[1920]; Assert.Equal(0, d.Read(b, 960));                       // waiting for tags
        var rest = ReadAll(d); Assert.Equal(full.Length, rest.Length);                  // then plays unadjusted
        Assert.Equal(full.Max(), rest.Max(), 3);
    }

    [Fact]
    public void ITunSMPB_end_padding_is_trimmed_for_gapless_aac()
    {
        using var t = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "aac", t.File("a.m4a"));
        using (var tf = TagLib.File.Create(t.File("a.m4a")))
        {
            var apple = (TagLib.Mpeg4.AppleTag)tf.GetTag(TagLib.TagTypes.Apple, true);
            apple.SetDashBox("com.apple.iTunes", "iTunSMPB", " 00000000 00000400 00000000 0000000000009600 00000000 00000000 00000000 00000000");   // 38400 valid samples = 0.8 s
            tf.Save();
        }
        var tags = Loudness.Read(t.File("a.m4a"));
        Assert.Equal(38400, tags.ValidSamples); Assert.Equal(48000, tags.SampleRate);
        Assert.Equal(38400, Loudness.ValidFrames(tags, 0)); Assert.Equal(38400 - 9600, Loudness.ValidFrames(tags, 200));
        var plain = ReadAll(new FfmpegDecoder(TestMedia.Ffmpeg, t.File("a.m4a")));
        Assert.True(plain.Length / 2 > 38400 + 100, "ffmpeg alone keeps the AAC end padding");
        var got = ReadAll(new ShapedDecoder(new FfmpegDecoder(TestMedia.Ffmpeg, t.File("a.m4a")), 1f, Loudness.ValidFrames(tags, 0)));
        Assert.Equal(38400, got.Length / 2);
        Assert.Equal((0x400, 0, 38400L), Loudness.ParseSmpb(" 00000000 00000400 00000000 0000000000009600"));
        Assert.Null(Loudness.ParseSmpb("junk"));
    }

    [Fact]
    public void Gapless_join_still_sample_exact_through_the_ReplayGain_wrapper()
    {
        using var t = new TempDir();
        TestMedia.Run("-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=2", "-ac", "2", t.File("whole.wav"));
        TestMedia.Run("-i", t.File("whole.wav"), "-t", "1", t.File("a.flac"));
        TestMedia.Run("-i", t.File("whole.wav"), "-ss", "1", "-t", "1", t.File("b.flac"));
        var items = new[] { new QueueItem(1, "track", t.File("a.flac"), "a", "", "Album", 1000, 1), new QueueItem(2, "track", t.File("b.flac"), "b", "", "Album", 1000, 2) };
        int opened = 0;
        using var q = new QueueSource(items, 0, 0, RepeatMode.Off, (it, ms) => { opened++; return new ShapedDecoder(new FfmpegDecoder(TestMedia.Ffmpeg, it.Location, ms), Task.Run(() => (1f, (long?)null))); });
        var got = ReadAll(q);
        Assert.Equal(96000, got.Length / 2); Assert.Equal(2, opened);
        Assert.Equal(48000, q.Boundaries[1].StartFrame);
        // the join itself: no discontinuity bigger than the sine's own slope
        double maxStep = 0; for (int i = 2; i < got.Length; i += 2) maxStep = Math.Max(maxStep, Math.Abs(got[i] - got[i - 2]));
        Assert.True(maxStep < 0.14, $"max step {maxStep}");
    }

    private sealed class FakeProt : ISecretProtector
    {
        public bool Available => true;
        public byte[] Protect(byte[] p) => p.Select(b => (byte)(b ^ 0x5A)).Reverse().ToArray();
        public byte[] Unprotect(byte[] b) => b.Reverse().Select(x => (byte)(x ^ 0x5A)).ToArray();
    }
    private sealed class FakeConn : IShareConnector
    {
        public List<(string Share, string User, string Pw)> Calls = new(); public string Good = "s3cret!pw";
        public int? Connect(string share, string user, string password) { Calls.Add((share, user, password)); return password == Good ? null : 1326; }
        public void Disconnect(string share) { }
    }

    [Fact]
    public void NAS_login_is_tested_before_saving_stored_encrypted_and_reused()
    {
        using var t = new TempDir(); var db = new Db(t.File("x.db")); db.Migrate();
        var conn = new FakeConn(); var nas = new NasLogon(db, new FakeProt(), conn);
        Assert.Equal(@"\\nas\music", NasLogon.ShareOf(@"\\nas\music\Rock\a.flac")); Assert.Null(NasLogon.ShareOf(@"D:\Music")); Assert.Null(NasLogon.ShareOf(@"\\nas"));
        Assert.Contains("not accepted", nas.Save(@"\\nas\music", "musicuser", "wrong"));
        Assert.Null(db.Setting(NasLogon.Key));                                           // a failing login is never saved
        Assert.Null(nas.Save(@"\\NAS\Music\Rock", "musicuser", conn.Good));
        var raw = db.Setting(NasLogon.Key)!;
        Assert.DoesNotContain(conn.Good, raw); Assert.DoesNotContain(Convert.ToBase64String(Encoding.UTF8.GetBytes(conn.Good)), raw);
        Assert.DoesNotContain("s3cret", JsonSerializer.Serialize(nas.List()));
        conn.Calls.Clear();
        Assert.Null(nas.EnsureFor(@"\\nas\music\Jazz\b.flac", force: true));
        Assert.Equal((@"\\NAS\Music", "musicuser", conn.Good), conn.Calls.Single());   // the share as saved
        Assert.Null(nas.EnsureFor(@"\\nas\music\x.flac")); Assert.Single(conn.Calls);     // rate-limited while connected
        Assert.Null(nas.EnsureFor(@"\\other\share\x.flac")); Assert.Single(conn.Calls);   // no saved login: nothing to do
        Assert.True(nas.Remove(@"\\nas\music")); Assert.Empty(nas.List());
    }

    [Fact]
    public async Task NAS_login_api_is_admin_only_and_never_appears_in_settings()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin)); var view = f.As(f.Token(Role.View));
        Assert.Equal(HttpStatusCode.Forbidden, (await view.GetAsync("/api/v1/library/nas")).StatusCode);
        var r = await admin.GetJson("/api/v1/library/nas"); Assert.Equal(OperatingSystem.IsWindows(), r.GetProperty("available").GetBoolean());
        var bad = await admin.PostAsJsonAsync("/api/v1/library/nas", new { share = "music", user = "x", password = "y" }); Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        f.Server.S.Db.SetSetting(NasLogon.Key, "[{\"Share\":\"\\\\\\\\nas\\\\m\",\"User\":\"u\",\"Secret\":\"AAAA\",\"SavedAt\":\"2026-01-01T00:00:00Z\"}]");
        var all = await (await admin.GetAsync("/api/v1/settings")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("nas", all); Assert.DoesNotContain("AAAA", all);
    }

    [Fact]
    public async Task ReplayGain_setting_is_validated_and_drives_the_conductor()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin));
        Assert.Equal("auto", f.Server.S.Conductor.ReplayGainMode());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["playback.replayGain"] = "loud" })).StatusCode);
        (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["playback.replayGain"] = "album" })).EnsureSuccessStatusCode();
        Assert.Equal("album", f.Server.S.Conductor.ReplayGainMode());
    }

    [Fact]
    public void LiveFeed_counts_dropouts_only_while_the_sender_is_sending()
    {
        var feed = new LiveFeed { TargetMs = 100 }; var dec = feed.OpenDecoder(); var b = new float[48000 * 2];
        feed.WriteFloat(new float[4800 * 2 * 2], 48000);                // 200 ms
        Assert.True(dec.Read(b, 48000) > 0);
        Assert.Equal(0, dec.Read(b, 48000)); Assert.Equal(1, feed.Underruns);   // ran dry while the sender is active = a drop-out
        Assert.True(feed.Reading); Assert.InRange(feed.DataAgeMs!.Value, 0, 1000);
    }

    [Fact]
    public async Task Receiver_health_lists_orphans_and_actions_are_admin_only()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin();
        var admin = f.As(f.Token(Role.Admin)); var view = f.As(f.Token(Role.View));
        var h = await view.GetJson("/api/v1/health/receivers");
        Assert.True(h.TryGetProperty("airplay", out var ap) && ap.TryGetProperty("feed", out var feed) && feed.TryGetProperty("underruns", out _));
        Assert.Equal(0, h.GetProperty("orphans").GetArrayLength());
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync("/api/v1/health/orphans/clear", new { })).StatusCode);
        var c = await (await admin.PostAsJsonAsync("/api/v1/health/orphans/clear", new { })).Json(); Assert.Equal(0, c.GetProperty("cleared").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await view.PostAsJsonAsync("/api/v1/health/airplay/restart", new { })).StatusCode);
    }

    [Fact]
    public void Network_helper_explains_a_vanished_address_a_public_network_and_loopback()
    {
        try
        {
            NetworkHelper.AdapterOverride = () => new[] { new NetworkHelper.Adapter("Wi-Fi", "Intel AX", "192.168.1.57", 24, true, "Wi-Fi", "Public", false), new NetworkHelper.Adapter("vEthernet (WSL)", "Hyper-V", "172.20.0.1", 20, false, "Virtual", "Unknown", false) };
            var gone = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.20" });
            Assert.False(gone.BindPresent); Assert.Equal("fail", gone.Status); Assert.Equal("192.168.1.57", gone.Suggested);
            Assert.Contains(gone.Problems, p => p.Contains("no longer has that address")); Assert.Contains(gone.Fixes, p => p.Contains("192.168.1.57"));
            var pub = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.57" });
            Assert.True(pub.BindPresent); Assert.Contains(pub.Fixes, p => p.Contains("Private")); Assert.Equal("fail", pub.Status);
            var loop = NetworkHelper.Check(new ServerConfig { BindAddress = "127.0.0.1" });
            Assert.Contains(loop.Problems, p => p.Contains("only listens on this PC"));
            NetworkHelper.AdapterOverride = () => new[] { new NetworkHelper.Adapter("Ethernet", "Realtek", "192.168.1.20", 24, true, "Ethernet", "Private", false) };
            var ok = NetworkHelper.Check(new ServerConfig { BindAddress = "192.168.1.20" });
            Assert.Equal("ok", ok.Status); Assert.Empty(ok.Problems); Assert.Null(ok.Suggested);
        }
        finally { NetworkHelper.AdapterOverride = null; }
        Assert.True(NetworkHelper.IsHomeAddress(IPAddress.Parse("10.0.0.5"))); Assert.False(NetworkHelper.IsHomeAddress(IPAddress.Parse("8.8.8.8")));
    }

    [Fact]
    public void SaveBind_rewrites_only_bindAddress_in_server_json()
    {
        using var t = new TempDir(); var cfg = new ServerConfig { DataDir = t.Path };
        File.WriteAllText(cfg.ConfigPath, "{\n  \"bindAddress\": \"192.168.1.20\",\n  \"httpPort\": 47800,\n  \"airPlay\": false\n}");
        NetworkHelper.SaveBind(cfg, "192.168.1.57");
        var j = JsonDocument.Parse(File.ReadAllText(cfg.ConfigPath)).RootElement;
        Assert.Equal("192.168.1.57", j.GetProperty("bindAddress").GetString()); Assert.Equal(47800, j.GetProperty("httpPort").GetInt32()); Assert.False(j.GetProperty("airPlay").GetBoolean());
    }
}
