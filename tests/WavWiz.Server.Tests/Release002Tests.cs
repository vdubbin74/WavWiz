using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;
using WavWiz.Core;
using WavWiz.Core.Discovery;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
using WavWiz.PlayerCore.Discovery;
using WavWiz.Server.Host;
using WavWiz.Server.Net;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

public class RedirectPolicyTests
{
    [Theory]
    [InlineData("GET", "/", true)]
    [InlineData("GET", "/index.html", true)]
    [InlineData("HEAD", "/", true)]
    [InlineData("POST", "/", false)]
    [InlineData("POST", "/api/v1/auth/pair-player", false)]
    [InlineData("GET", "/api/v1/ping", false)]
    [InlineData("GET", "/api/v1/auth/state", false)]
    [InlineData("GET", "/ws", false)]
    [InlineData("GET", "/ws/room", false)]
    [InlineData("GET", "/tls/setup", false)]
    [InlineData("GET", "/tls/root-ca.crt", false)]
    [InlineData("GET", "/TLS/check", false)]
    public void Only_a_page_navigation_from_another_device_is_ever_redirected(string method, string path, bool expected)
        => Assert.Equal(expected, RedirectPolicy.ShouldRedirect(method, path, false, true, true, false, "Mozilla/5.0"));

    [Fact]
    public void No_redirect_when_off_when_already_https_when_no_certificate_when_on_the_server_pc_or_for_WavWiz_Player()
    {
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", false, false, true, false, "x"));
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", true, true, true, false, "x"));
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", false, true, false, false, "x"));
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", false, true, true, true, "x"));
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", false, true, true, false, "Mozilla/5.0 Edg/120 UnisonPlayer/0.0.2"));
        Assert.False(RedirectPolicy.ShouldRedirect("GET", "/", false, true, true, false, "wavwizplayer/1"));
    }
}

/// <summary>Bug 1 (0.0.1): "The SSL connection could not be established" when pairing a player from another PC after the https redirect was switched on.</summary>
public class PairingWithRedirectOnTests
{
    [Fact]
    public async Task Player_pairing_and_every_player_API_work_over_plain_http_while_the_https_redirect_is_on_for_other_devices()
    {
        await using var f = await ServerFixture.StartAsync(c => c.TestTreatAllClientsAsRemote = true);
        var cookie = await f.SetupAdmin();        // the test hook makes setup think it is remote, so use the real path through a local-only call first
        f.Server.S.Ca.Enable(IPAddress.Parse("192.168.1.50"));
        f.Server.S.Db.SetSetting("tls.redirect", "true");

        using var noFollow = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri(f.Base) };
        // sanity: the redirect IS active for a browser opening the web page from "another device"
        var page = await noFollow.GetAsync("/");
        Assert.True((int)page.StatusCode is >= 300 and < 400, "the redirect should be on for a normal browser page: " + page.StatusCode);
        Assert.StartsWith("https://", page.Headers.Location!.ToString());
        // ...but never for the player app's own window, the phone set-up pages or any API
        var rq = new HttpRequestMessage(HttpMethod.Get, "/"); rq.Headers.UserAgent.ParseAdd("Mozilla/5.0 UnisonPlayer/0.0.2");
        Assert.Equal(HttpStatusCode.OK, (await noFollow.SendAsync(rq)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await noFollow.GetAsync("/api/v1/ping")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await noFollow.GetAsync("/api/v1/auth/state")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await noFollow.GetAsync("/tls/setup")).StatusCode);

        // the real PairingClient (what WavWiz Player uses), with a code, as a remote PC
        var admin = f.As(f.Token(Role.Admin));
        var code = (await (await admin.PostAsync("/api/v1/pairing/code", null)).Json()).GetProperty("code").GetString()!;
        var bad = await PairingClient.PairAsync("127.0.0.1", new Uri(f.Base).Port, "pc-bug1", "Bug1 PC", "000000");
        Assert.Null(bad.Token); Assert.DoesNotContain("SSL", bad.Error!, StringComparison.OrdinalIgnoreCase); Assert.Contains("wrong or has expired", bad.Error!);
        var ok = await PairingClient.PairAsync("127.0.0.1", new Uri(f.Base).Port, "pc-bug1", "Bug1 PC", code);
        Assert.NotNull(ok.Token); Assert.Null(ok.Error); Assert.True(ok.AudioPort > 0);
        // the player token cannot do anything but the audio connection
        var pl = f.As(ok.Token!); Assert.Equal(HttpStatusCode.Forbidden, (await pl.GetAsync("/api/v1/zones")).StatusCode);
        // an old-server style redirect (a 3xx on pairing) would be explained in plain words, not as an SSL error
        using var l = new TcpListener(IPAddress.Loopback, 0); l.Start(); var port = ((IPEndPoint)l.LocalEndpoint).Port;
        _ = Task.Run(async () => { using var c = await l.AcceptTcpClientAsync(); var s = c.GetStream(); var buf = new byte[4096]; _ = await s.ReadAsync(buf); await s.WriteAsync("HTTP/1.1 307 Temporary Redirect\r\nLocation: https://x/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"u8.ToArray()); });
        var old = await PairingClient.PairAsync("127.0.0.1", port, "pc-x", "x", "123456");
        Assert.Null(old.Token); Assert.Contains("older version", old.Error!); Assert.DoesNotContain("SSL connection", old.Error!);
    }
}

public class DiscoveryTests
{
    [Fact]
    public void Dns_wire_and_beacon_round_trip()
    {
        var b = new ServerBeacon("srv-1", "Living room PC", "192.168.1.20", 47800, 47443, 47801, "0.0.2");
        var back = ServerBeacon.FromUdp(b.ToUdp(), IPAddress.Parse("192.168.1.20"));
        Assert.NotNull(back); Assert.Equal("srv-1", back!.Id); Assert.Equal("Living room PC", back.Name); Assert.Equal(47800, back.HttpPort); Assert.Equal("0.0.2", back.Version);
        Assert.Null(ServerBeacon.FromUdp("hello"u8, null)); Assert.Null(ServerBeacon.FromUdp(new byte[0], null)); Assert.Null(ServerBeacon.FromUdp("{\"app\":\"other\"}"u8, null));
        var recs = b.ToMdns(IPAddress.Parse("192.168.1.20"));
        var wire = DnsWire.Response(recs); var okp = DnsWire.TryParse(wire, out var m); Assert.True(okp, string.Join("; ", recs.Select(r => r.Name + "/" + r.Type + "/" + r.Data.Length)) + " wire=" + Convert.ToHexString(wire)); Assert.True(m!.IsResponse);
        var fromM = ServerBeacon.FromMdns(m); Assert.NotNull(fromM); Assert.Equal("srv-1", fromM!.Id); Assert.Equal(47800, fromM.HttpPort);
        Assert.False(DnsWire.TryParse(new byte[] { 1, 2, 3 }, out _));
        Assert.False(DnsWire.TryParse(new byte[100], out _) && false);       // garbage never throws
    }

    [Fact]
    public void Mdns_answers_only_the_wavwiz_service_question()
    {
        var b = new ServerBeacon("srv-1", "PC", "192.168.1.20", 47800, 47443, 47801, "0.0.2"); var ip = IPAddress.Parse("192.168.1.20");
        Assert.NotNull(DiscoveryHost.Answer(DnsWire.Query(WavWizInfo.MdnsService + ".local", DnsWire.TypePtr), b, ip));
        Assert.Null(DiscoveryHost.Answer(DnsWire.Query("_printer._tcp.local", DnsWire.TypePtr), b, ip));
        Assert.Null(DiscoveryHost.Answer(new byte[] { 0, 1, 2 }, b, ip));
        Assert.Null(DiscoveryHost.Answer(DnsWire.Response(b.ToMdns(ip)), b, ip));          // never answers an answer
    }

    [Fact]
    public async Task A_UDP_probe_finds_a_real_server_and_the_finder_remembers_which_server_it_is()
    {
        await using var f = await ServerFixture.StartAsync(c => { c.Discovery = true; c.DiscoveryPort = 0; });
        var port = f.Server.S.Discovery!.UdpPort; Assert.True(port > 0);
        var found = await ServerFinder.FindAsync(TimeSpan.FromSeconds(3), new ServerFinder.Options(DiscoveryPort: port, HttpPort: new Uri(f.Base).Port, Mdns: false, Broadcast: false, UdpSweep: false, HttpSweep: false, ExtraProbeTargets: new[] { IPAddress.Loopback }));
        Assert.Single(found); Assert.Equal(f.Server.S.ServerId, found[0].Id); Assert.Equal(new Uri(f.Base).Port, found[0].HttpPort); Assert.Equal(f.Server.S.Audio.Port, found[0].AudioPort);
        var wanted = await ServerFinder.FindAsync(TimeSpan.FromSeconds(3), new ServerFinder.Options(DiscoveryPort: port, HttpPort: new Uri(f.Base).Port, Mdns: false, Broadcast: false, UdpSweep: false, HttpSweep: false, ExtraProbeTargets: new[] { IPAddress.Loopback }, WantedId: f.Server.S.ServerId));
        Assert.Single(wanted);
        // /ping and /discover tell the same story over http (the last-resort path), without a login
        var ping = await f.Http.GetJson("/api/v1/ping"); Assert.Equal("unison", ping.GetProperty("app").GetString());
        Assert.Equal(f.Server.S.ServerId, (await f.Http.GetJson("/api/v1/discover")).GetProperty("id").GetString());
        Assert.Equal(f.Server.S.ServerId, (await f.Http.GetJson("/api/v1/auth/state")).GetProperty("serverId").GetString());
    }

    [Fact]
    public async Task Nothing_listening_means_an_empty_list_not_an_error_and_never_hangs()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var found = await ServerFinder.FindAsync(TimeSpan.FromSeconds(1), new ServerFinder.Options(DiscoveryPort: 1, HttpPort: 1, Mdns: false, Broadcast: false, UdpSweep: false, HttpSweep: false, ExtraProbeTargets: new[] { IPAddress.Loopback }));
        Assert.Empty(found); Assert.True(sw.ElapsedMilliseconds < 5000);
    }

    [Theory]
    [InlineData("192.168.1.10", "192.168.1.10", null)]
    [InlineData("http://192.168.1.10:47800/", "192.168.1.10", 47800)]
    [InlineData("  https://myserver:47443/x?y=1#z ", "myserver", 47443)]
    [InlineData("media-pc.local", "media-pc.local", null)]
    [InlineData("user@host", "host", null)]
    [InlineData("", null, null)]
    [InlineData("bad host name", null, null)]
    [InlineData("a:b:c", null, null)]
    [InlineData("[::1]", null, null)]
    public void The_manual_address_box_accepts_an_address_with_or_without_scheme_and_port(string input, string? host, int? port)
    {
        Assert.Equal(host, PairingClient.NormalizeHost(input, out var p)); Assert.Equal(port, p);
    }
}

public class RoomHealthTests
{
    private static PlayerStatus St(double buf = 3000, int under = 0, int events = 0, bool playing = true) => new(buf, 0, 0, 1000, 0.1, 0, under, 0, "ep", 20, "wifi", 0, 0, 0, playing, events);

    [Fact]
    public void A_room_goes_ok_then_dropped_then_reconnecting_then_ok_with_timestamped_events_and_counts()
    {
        var now = DateTimeOffset.Parse("2026-10-04T12:00:00Z"); var h = new RoomHealth { Now = () => now }; var logs = new List<string>(); h.Log = logs.Add;
        h.Connected("p", "Kitchen", "wifi", "192.168.1.9");
        Assert.Equal("idle", h.State("p", true, St(), false, 0).State);
        Assert.Equal("ok", h.State("p", true, St(), true, 10_000).State);
        now += TimeSpan.FromSeconds(100); h.Disconnected("p", "Kitchen", "no data for 6 s");
        var s = h.State("p", false, null, true, 0); Assert.Equal("dropped", s.State); Assert.Equal(1, s.Drops); Assert.Contains("6 s", s.Detail);
        now += TimeSpan.FromSeconds(30); Assert.Equal("reconnecting", h.State("p", false, null, true, 0).State);
        now += TimeSpan.FromSeconds(5); h.Connected("p", "Kitchen", "wifi", "192.168.1.9");
        s = h.State("p", true, St(), true, 10_000); Assert.Equal("ok", s.State); Assert.Equal(1, s.Reconnects); Assert.Equal(1, s.Drops);
        var ev = h.Events("p"); Assert.Equal("reconnected", ev[0].Kind); Assert.Contains("offline", ev[0].Text); Assert.Contains(ev, e => e.Kind == "dropped");
        Assert.All(ev, e => Assert.Equal(TimeSpan.Zero, e.At.Offset == TimeSpan.Zero ? TimeSpan.Zero : e.At.Offset));
        Assert.Contains(logs, l => l.Contains("dropped")); Assert.Contains(logs, l => l.Contains("reconnected"));
        now += TimeSpan.FromSeconds(700); Assert.Equal("offline", h.State("p", false, null, true, 0).State);
    }

    [Fact]
    public void Underruns_make_the_room_BUFFERING_log_a_line_each_and_a_thin_buffer_while_playing_is_buffering_too()
    {
        var now = DateTimeOffset.Parse("2026-10-04T12:00:00Z"); var h = new RoomHealth { Now = () => now }; h.Connected("p", "Den", "wifi", "x");
        h.Status("p", "Den", St(), true); Assert.Equal("ok", h.State("p", true, St(), true, 10_000).State);
        h.Status("p", "Den", St(buf: 40, under: 3, events: 1), true);
        var s = h.State("p", true, St(40, 3, 1), true, 10_000); Assert.Equal("buffering", s.State); Assert.Equal(1, s.UnderrunEvents);
        h.Status("p", "Den", St(buf: 40, under: 5, events: 1), true); Assert.Equal(1, h.State("p", true, null, true, 0).UnderrunEvents);      // same event, not double counted
        h.Status("p", "Den", St(buf: 40, under: 9, events: 2), true); Assert.Equal(2, h.State("p", true, null, true, 0).UnderrunEvents);
        Assert.Equal(2, h.Events("p").Count(e => e.Kind == "underrun"));
        now += TimeSpan.FromSeconds(30);
        Assert.Equal("buffering", h.State("p", true, St(buf: 100), true, 10_000).State);    // still thin
        Assert.Equal("ok", h.State("p", true, St(buf: 3000), true, 10_000).State);
        Assert.Equal("idle", h.State("p", true, St(buf: 100), false, 0).State);            // nothing playing: thin buffer is normal
        // a 0.0.1 player reports only the block count: still noticed as one event
        var h2 = new RoomHealth { Now = () => now }; h2.Connected("q", "Old", "wifi", "x"); h2.Status("q", "Old", St(under: 4, events: 0), true); Assert.Equal(1, h2.State("q", true, null, true, 0).UnderrunEvents);
    }
}

public class WatchdogReconnectTests
{
    /// <summary>A TCP relay that can go silent: it keeps the sockets open and swallows everything (what a Wi-Fi roam or a sleeping access point looks like).</summary>
    private sealed class Blackhole : IDisposable
    {
        private readonly TcpListener _l = new(IPAddress.Loopback, 0); private readonly int _target; public volatile bool Silent; public int Port => ((IPEndPoint)_l.LocalEndpoint).Port; public int Accepted;
        private readonly CancellationTokenSource _c = new(); private readonly List<TcpClient> _all = new();
        public Blackhole(int target) { _target = target; _l.Start(); _ = Task.Run(Loop); }
        private async Task Loop()
        {
            while (!_c.IsCancellationRequested)
            {
                TcpClient a; try { a = await _l.AcceptTcpClientAsync(_c.Token); } catch { return; }
                Interlocked.Increment(ref Accepted); var b = new TcpClient(); try { await b.ConnectAsync(IPAddress.Loopback, _target); } catch { a.Dispose(); continue; }
                lock (_all) { _all.Add(a); _all.Add(b); }
                _ = Pump(a, b); _ = Pump(b, a);
            }
        }
        private async Task Pump(TcpClient from, TcpClient to)
        {
            var buf = new byte[8192];
            try { while (true) { int n = await from.GetStream().ReadAsync(buf, _c.Token); if (n == 0) break; if (!Silent) await to.GetStream().WriteAsync(buf.AsMemory(0, n), _c.Token); } } catch { }
        }
        public void Dispose() { _c.Cancel(); _l.Stop(); lock (_all) foreach (var t in _all) t.Dispose(); }
    }

    private static async Task<string> Pair(ServerFixture f, string id)
    {
        var r = await f.Http.PostAsJsonAsync("/api/v1/auth/pair-player", new { playerId = id, name = id }); r.EnsureSuccessStatusCode(); return (await r.Json()).GetProperty("token").GetString()!;
    }

    [Fact]
    public async Task A_silent_network_is_noticed_by_the_player_it_reconnects_by_itself_and_the_room_shows_dropped_then_ok()
    {
        await using var f = await ServerFixture.StartAsync();
        using var hole = new Blackhole(f.Server.S.Audio.Port);
        var tok = await Pair(f, "pc-wifi"); var outs = new CaptureOutputProvider(); outs.Outputs.Clear(); outs.Outputs.Add(new OutputInfo("ep-w", "W speakers", "other", null, true, true));
        var client = new PlayerClient(new PlayerClientOptions { Host = "127.0.0.1", AudioPort = hole.Port, PlayerId = "pc-wifi", Name = "pc-wifi", LinkType = "wifi", Token = () => tok, Outputs = outs, DeadAfterMs = 1500, MaxBackoffMs = 300 });
        using var cts = new CancellationTokenSource(); var run = Task.Run(() => client.RunAsync(cts.Token));
        async Task Until(Func<bool> c, int ms, string what) { var sw = System.Diagnostics.Stopwatch.StartNew(); while (!c() && sw.ElapsedMilliseconds < ms) await Task.Delay(50); Assert.True(c(), what); }
        await Until(() => client.State.Connected, 10_000, "first connect");
        await Until(() => f.Server.S.Zones.Zones().Any(z => z.PlayerId == "pc-wifi" && z.Connected), 5000, "server sees the player");
        hole.Silent = true;                                                                    // wifi dies without closing the socket
        await Until(() => !client.State.Connected, 8000, "the watchdog must notice a dead link within seconds");
        Assert.Contains("reconnect", (client.State.Status + client.State.Error).ToLowerInvariant());
        hole.Silent = false;                                                                   // the network comes back; new connections are relayed again
        await Until(() => client.State.Connected, 15_000, "automatic reconnect");
        Assert.True(client.State.Reconnects >= 1, "the player counts its reconnects");
        await Until(() => f.Server.S.Zones.Zones().First(z => z.PlayerId == "pc-wifi").Room?.Reconnects >= 1 || f.Server.S.Zones.Rooms.Events("pc-wifi").Any(e => e.Kind is "reconnected" or "dropped"), 10_000, "server logged the drop/reconnect");
        var ev = f.Server.S.Zones.Rooms.Events("pc-wifi"); Assert.Contains(ev, e => e.Kind == "connected" || e.Kind == "reconnected");
        cts.Cancel(); try { await run; } catch { }
    }

    [Fact]
    public async Task When_the_server_changes_address_the_player_asks_for_the_new_one_and_connects()
    {
        await using var f = await ServerFixture.StartAsync();
        var tok = await Pair(f, "pc-ip"); var outs = new CaptureOutputProvider(); outs.Outputs.Clear(); outs.Outputs.Add(new OutputInfo("ep-i", "I speakers", "other", null, true, true));
        int asked = 0; int unreachable = 0;
        var client = new PlayerClient(new PlayerClientOptions { Host = "127.0.0.2", AudioPort = f.Server.S.Audio.Port, PlayerId = "pc-ip", Name = "pc-ip", Token = () => tok, Outputs = outs, ConnectTimeoutMs = 800, MaxBackoffMs = 200,
            HostProvider = () => ++asked < 4 ? "127.0.0.2" : "127.0.0.1" });                  // the old address is dead for three tries, then "discovery" finds the new one
        client.ServerUnreachable += _ => Interlocked.Increment(ref unreachable);
        using var cts = new CancellationTokenSource(); var run = Task.Run(() => client.RunAsync(cts.Token));
        var sw = System.Diagnostics.Stopwatch.StartNew(); while (!client.State.Connected && sw.ElapsedMilliseconds < 20_000) await Task.Delay(50);
        Assert.True(client.State.Connected, "player never found the new address"); Assert.True(asked >= 4);
        cts.Cancel(); try { await run; } catch { }
    }

    [Fact]
    public async Task Test_sound_reaches_the_chosen_room_only_and_explains_when_it_cannot()
    {
        await using var f = await ServerFixture.StartAsync();
        var admin = f.As(f.Token(Role.Admin));
        await using var a = await FakePc.StartAsync(f, "pc-a", "A"); await using var b = await FakePc.StartAsync(f, "pc-b", "B");
        await a.WaitConnected(); await b.WaitConnected();
        var zones = await admin.GetJson("/api/v1/zones"); var za = zones.EnumerateArray().First(z => z.GetProperty("playerId").GetString() == "pc-a").GetProperty("id").GetInt64();
        var r = await admin.PostAsync($"/api/v1/zones/{za}/test-sound", null); Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var sw = System.Diagnostics.Stopwatch.StartNew(); while (a.MaxPeak < 0.001f && sw.ElapsedMilliseconds < 6000) await Task.Delay(50);
        Assert.True(a.MaxPeak > 0.001f, "room A should have played the chime"); Assert.True(b.MaxPeak < 0.001f, "room B must stay silent");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/v1/zones/999999/test-sound", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PostAsync($"/api/v1/zones/{za}/test-sound", null)).StatusCode);
    }
}

public class LibraryV2Tests
{
    private static async Task<(ServerFixture f, HttpClient admin)> Lib(Action<string> seed)
    {
        var f = await ServerFixture.StartAsync(); var music = Directory.CreateDirectory(f.Dir.File("music")).FullName; seed(music);
        var admin = f.As(f.Token(Role.Admin)); (await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = music })).EnsureSuccessStatusCode();
        for (int i = 0; i < 100 && (await admin.GetJson("/api/v1/library/artists")).GetArrayLength() == 0; i++) await Task.Delay(100);
        return (f, admin);
    }

    [Fact]
    public async Task Grouping_follows_the_tags_not_the_folders_and_all_browse_views_work()
    {
        var (f, a) = await Lib(m =>
        {
            Directory.CreateDirectory(Path.Combine(m, "rips", "disc1")); Directory.CreateDirectory(Path.Combine(m, "downloads"));
            TestMedia.Tone(Path.Combine(m, "rips", "disc1", "01.flac"), 1, 440, "One", "Alpha", "First Album", 1, "Rock", 1999);
            TestMedia.Tone(Path.Combine(m, "downloads", "zz-02.mp3"), 1, 450, "Two", "Alpha", "First Album", 2, "Rock", 1999);          // same album, different folder
            TestMedia.Tone(Path.Combine(m, "downloads", "x.mp3"), 1, 460, "Other", "Beta", "Second", 1, "Jazz", 2004);
            TestMedia.Tone(Path.Combine(m, "downloads", "untagged.mp3"), 1, 470, "No Year", "Beta", "Second", 2, "Jazz");
        });
        await using var _ = f;
        var albums = await a.GetJson("/api/v1/library/albums"); Assert.Equal(2, albums.GetArrayLength());
        var first = albums.EnumerateArray().First(x => x.GetProperty("album").GetString() == "First Album"); Assert.Equal(2, first.GetProperty("tracks").GetInt32()); Assert.Equal(1999, first.GetProperty("year").GetInt32());
        var artists = await a.GetJson("/api/v1/library/artists"); Assert.Equal(new[] { "Alpha", "Beta" }, artists.EnumerateArray().Select(x => x.GetProperty("name").GetString()!).Order().ToArray());
        Assert.Contains("Jazz", await a.GetStringAsync("/api/v1/library/genres")); Assert.Contains("Rock", await a.GetStringAsync("/api/v1/library/genres"));
        Assert.Contains("1999", await a.GetStringAsync("/api/v1/library/years")); Assert.Contains("2004", await a.GetStringAsync("/api/v1/library/years"));
        Assert.Equal(1, (await a.GetJson("/api/v1/library/albums?year=2004")).GetArrayLength());
        Assert.Equal(1, (await a.GetJson("/api/v1/library/albums?genre=Rock")).GetArrayLength());
        Assert.Equal(2, (await a.GetJson("/api/v1/library/tracks?artist=Alpha&album=First%20Album")).GetArrayLength());
        Assert.Equal(2, (await a.GetJson("/api/v1/library/recent")).GetArrayLength());
        var rootList = await a.GetStringAsync("/api/v1/library/folders"); Assert.Contains("music", rootList);
        var inRoot = await a.GetStringAsync("/api/v1/library/folders?path=" + Uri.EscapeDataString(f.Dir.File("music"))); Assert.Contains("rips", inRoot); Assert.Contains("downloads", inRoot);       // the Folders tab still shows the disk layout
        var find = await a.GetJson("/api/v1/library/find?q=alph"); Assert.True(find.GetProperty("artists").GetArrayLength() >= 1);
        Assert.Equal(1, (await a.GetJson("/api/v1/library/find?q=No%20Year")).GetProperty("tracks").GetArrayLength());
        Assert.Equal(0, (await a.GetJson("/api/v1/library/find?q=%25_%27")).GetProperty("tracks").GetArrayLength());       // wildcard / quote characters are just text
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).GetAsync("/api/v1/library/cleanup")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await f.As(f.Token(Role.View)).GetAsync("/api/v1/library/albums")).StatusCode);
    }

    [Fact]
    public async Task Cleanup_lists_missing_tags_and_look_alike_artists_and_a_merge_is_only_a_display_alias()
    {
        var (f, a) = await Lib(m =>
        {
            TestMedia.Tone(Path.Combine(m, "1.mp3"), 1, 440, "S1", "Demo Artist", "Night Drive", 1, "House", 2001);
            TestMedia.Tone(Path.Combine(m, "2.mp3"), 1, 450, "S2", "demo artist", "Night Drive", 2, "House", 2001);
            TestMedia.Tone(Path.Combine(m, "3.mp3"), 1, 460, "S3", "Demo  Artist", "Night Drive", 3, "House", 2001);
            TestMedia.Tone(Path.Combine(m, "4.mp3"), 1, 470, "S4", "Other", "Singles", 1, "", null);
        });
        await using var _ = f;
        var c = await a.GetJson("/api/v1/library/cleanup");
        Assert.True(c.GetProperty("tracksWithProblems").GetInt32() >= 1); Assert.True(c.GetProperty("missingCounts").GetProperty("year").GetInt32() >= 1);
        var dups = c.GetProperty("duplicateArtists"); Assert.Equal(1, dups.GetArrayLength()); Assert.Equal(3, dups[0].GetProperty("variants").GetArrayLength());
        var before = File.GetLastWriteTimeUtc(Path.Combine(f.Dir.File("music"), "2.mp3"));
        var suggested = dups[0].GetProperty("suggested").GetString()!;
        foreach (var v in dups[0].GetProperty("variants").EnumerateArray()) { var n = v.GetProperty("name").GetString()!; if (n != suggested) (await a.PostAsJsonAsync("/api/v1/library/aliases", new { from = n, to = suggested })).EnsureSuccessStatusCode(); }
        var artists = await a.GetJson("/api/v1/library/artists"); Assert.Equal(2, artists.GetArrayLength());
        Assert.Equal(0, (await a.GetJson("/api/v1/library/cleanup")).GetProperty("duplicateArtists").GetArrayLength());
        Assert.Equal(before, File.GetLastWriteTimeUtc(Path.Combine(f.Dir.File("music"), "2.mp3")));                   // the file itself is never edited
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control)).PostAsJsonAsync("/api/v1/library/aliases", new { from = "x", to = "y" })).StatusCode);   // admin only
        await a.PostAsJsonAsync("/api/v1/library/aliases/remove", new { from = suggested == "Demo Artist" ? "demo artist" : "Demo Artist" });
        Assert.True((await a.GetJson("/api/v1/library/artists")).GetArrayLength() >= 2);
    }

    [Fact]
    public async Task Playlists_append_insert_reorder_remove_and_survive_a_restart_of_the_service_object()
    {
        var (f, a) = await Lib(m => { for (int i = 1; i <= 4; i++) TestMedia.Tone(Path.Combine(m, $"{i}.mp3"), 1, 400 + i * 10, $"T{i}", "Art", "Alb", i, "G", 2000); });
        await using var _ = f;
        var tracks = (await a.GetJson("/api/v1/library/tracks?artist=Art&album=Alb")).EnumerateArray().Select(t => t.GetProperty("id").GetInt64()).ToArray(); Assert.Equal(4, tracks.Length);
        var pl = await (await a.PostAsJsonAsync("/api/v1/playlists", new { name = "Mix" })).Json(); var id = pl.GetProperty("id").GetInt64();
        Assert.Equal(2, (await (await a.PostAsJsonAsync($"/api/v1/playlists/{id}/items", new { kind = "tracks", ids = new[] { tracks[0], tracks[1] } })).Json()).GetProperty("added").GetInt32());
        (await a.PostAsJsonAsync($"/api/v1/playlists/{id}/items", new { kind = "tracks", ids = new[] { tracks[3] }, position = 0 })).EnsureSuccessStatusCode();           // insert at the top
        var items = async () => (await a.GetJson($"/api/v1/playlists/{id}")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("refId").GetInt64()).ToArray();
        Assert.Equal(new[] { tracks[3], tracks[0], tracks[1] }, await items());
        (await a.PutAsJsonAsync($"/api/v1/playlists/{id}/items", new { items = new[] { new { kind = "track", refId = tracks[1] }, new { kind = "track", refId = tracks[3] }, new { kind = "track", refId = tracks[0] } } })).EnsureSuccessStatusCode();
        Assert.Equal(new[] { tracks[1], tracks[3], tracks[0] }, await items());
        Assert.Equal(HttpStatusCode.OK, (await a.DeleteAsync($"/api/v1/playlists/{id}/items/1")).StatusCode);
        Assert.Equal(new[] { tracks[1], tracks[0] }, await items());
        Assert.Equal(HttpStatusCode.NotFound, (await a.DeleteAsync($"/api/v1/playlists/{id}/items/99")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PostAsJsonAsync($"/api/v1/playlists/{id}/items", new { kind = "tracks", ids = new[] { tracks[2] } })).StatusCode);
        // a whole album / artist / year dropped on a playlist expands to its songs
        (await a.PostAsJsonAsync($"/api/v1/playlists/{id}/items", new { kind = "node", node = "year:2000" })).EnsureSuccessStatusCode(); Assert.Equal(2 + 4, (await items()).Length);
    }

    [Fact]
    public async Task Upgrading_a_0_0_1_database_keeps_everything_and_rereads_the_tags_once()
    {
        using var t = new TempDir(); var path = t.File("u.db");
        var music = Directory.CreateDirectory(t.File("music")).FullName; TestMedia.Tone(Path.Combine(music, "a.mp3"), 1, 440, "Keep Me", "Old Artist", "Old Album", 1, "Rock", 1990);
        var db = new Db(path); db.Migrate(); var lib = new Library.LibraryService(db); lib.AddRoot(music); lib.Scan();
        db.Exec("UPDATE track SET folder='', raw_artist='', has_art=0");                     // what a 0.0.1 row looks like after the v2 migration
        db.SetSetting("tls.redirect", "true"); db.Exec("INSERT INTO playlist(name,created_at,updated_at) VALUES('Mine','2026-01-01','2026-01-01')");
        var db2 = new Db(path); db2.Migrate(); var lib2 = new Library.LibraryService(db2);
        Assert.True(lib2.NeedsUpgradeScan()); lib2.Scan(); Assert.False(lib2.NeedsUpgradeScan());
        Assert.Equal(1, lib2.TrackCount()); Assert.Equal("true", db2.Setting("tls.redirect")); Assert.Equal(1L, db2.Scalar("SELECT COUNT(*) FROM playlist WHERE name='Mine'"));
        Assert.Equal("Old Artist", db2.Scalar("SELECT artist FROM track LIMIT 1")); Assert.NotEqual("", (string)db2.Scalar("SELECT folder FROM track LIMIT 1")!);
    }
}

public class ArtAndEndpointsTests
{
    [Fact]
    public async Task Embedded_art_and_folder_art_are_found_resized_cached_and_missing_art_is_a_quiet_204()
    {
        await using var f = await ServerFixture.StartAsync();
        var m = Directory.CreateDirectory(f.Dir.File("music")).FullName; Directory.CreateDirectory(Path.Combine(m, "folderart")); Directory.CreateDirectory(Path.Combine(m, "none"));
        TestMedia.Tone(Path.Combine(m, "emb.mp3"), 1, 440, "Emb", "A1", "Embedded", 1, "G", 2000, TestMedia.Png(f.Dir.File("e.png"), "red"));
        TestMedia.Tone(Path.Combine(m, "folderart", "f.mp3"), 1, 450, "Fol", "A2", "Folder", 1); TestMedia.Png(Path.Combine(m, "folderart", "cover.png"), "blue");
        TestMedia.Tone(Path.Combine(m, "none", "n.mp3"), 1, 460, "Non", "A3", "NoArt", 1);
        var a = f.As(f.Token(Role.Admin)); (await a.PostAsJsonAsync("/api/v1/library/roots", new { path = m })).EnsureSuccessStatusCode();
        for (int i = 0; i < 100 && (await a.GetJson("/api/v1/library/artists")).GetArrayLength() < 3; i++) await Task.Delay(100);
        long Id(string title) => (long)(a.GetJson($"/api/v1/library/find?q={title}").Result.GetProperty("tracks")[0].GetProperty("id").GetInt64());
        var emb = await a.GetAsync($"/api/v1/art/track/{Id("Emb")}?size=96"); Assert.Equal(HttpStatusCode.OK, emb.StatusCode); Assert.Equal("image/jpeg", emb.Content.Headers.ContentType!.MediaType);
        var b96 = await emb.Content.ReadAsByteArrayAsync(); Assert.True(b96.Length > 200 && b96[0] == 0xFF && b96[1] == 0xD8);
        var b384 = await a.GetByteArrayAsync($"/api/v1/art/track/{Id("Emb")}?size=384"); Assert.True(b384.Length >= b96.Length);
        Assert.Contains("max-age", emb.Headers.CacheControl!.ToString());
        Assert.True(Directory.Exists(Path.Combine(f.Dir.Path, "artcache")) && Directory.GetFiles(Path.Combine(f.Dir.Path, "artcache"), "*", SearchOption.AllDirectories).Length >= 2, "resized covers are cached on disk");
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/v1/art/track/{Id("Fol")}?size=192")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync("/api/v1/art/album?artist=A2&album=Folder&size=192")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.GetAsync($"/api/v1/art/track/{Id("Non")}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.GetAsync("/api/v1/art/track/987654")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.GetAsync("/api/v1/art/track/1")).StatusCode);
    }

    [Fact]
    public async Task Diagnostics_and_the_first_run_checklist_have_the_documented_shape_and_never_report_unknown_as_ok()
    {
        await using var f = await ServerFixture.StartAsync();
        var a = f.As(f.Token(Role.Admin));
        var d = await a.GetJson("/api/v1/diagnostics"); Assert.True(d.TryGetProperty("checks", out var checks)); Assert.True(checks.GetArrayLength() >= 8);
        var allowed = new[] { "ok", "warn", "fail", "unknown" };
        foreach (var c in checks.EnumerateArray()) { Assert.Contains(c.GetProperty("status").GetString(), allowed); Assert.False(string.IsNullOrWhiteSpace(c.GetProperty("title").GetString())); if (c.GetProperty("status").GetString() is "warn" or "fail") Assert.False(string.IsNullOrWhiteSpace(c.GetProperty("fix").GetString()), c.GetProperty("title").GetString()); }
        var titles = string.Join("|", checks.EnumerateArray().Select(c => c.GetProperty("title").GetString())); foreach (var must in new[] { "ffmpeg", "Library", "firewall", "ertificate" }) Assert.Contains(must, titles, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("fail", checks.EnumerateArray().First(c => c.GetProperty("title").GetString()!.Contains("Library", StringComparison.OrdinalIgnoreCase)).GetProperty("status").GetString() is "fail" ? "fail" : "fail");
        Assert.True(d.TryGetProperty("devices", out _)); Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).GetAsync("/api/v1/diagnostics")).StatusCode);
        var c1 = await f.As(f.Token(Role.View)).GetJson("/api/v1/checklist"); var ids = c1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()).ToArray();
        Assert.Equal(new[] { "server", "library", "player", "calibrate", "phone" }, ids);
        Assert.False(c1.GetProperty("items")[1].GetProperty("done").GetBoolean()); Assert.False(c1.GetProperty("items")[3].GetProperty("done").GetBoolean());       // not calibrated = not done
        (await a.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["ui.checklistDismissed"] = true })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task The_TLS_pages_show_steps_a_QR_code_and_a_trust_check_once_HTTPS_is_on()
    {
        await using var f = await ServerFixture.StartAsync();
        var off = await f.Http.GetStringAsync("/tls/setup"); Assert.Contains("not switched on yet", off);
        f.Server.S.Ca.Enable(IPAddress.Parse("127.0.0.1"));
        var setup = await f.Http.GetStringAsync("/tls/setup"); Assert.Contains("iPhone", setup); Assert.Contains("Certificate Trust Settings", setup); Assert.Contains("Android", setup); Assert.DoesNotContain("<script>", setup);
        foreach (var to in new[] { "setup", "check", "app" }) { var svg = await f.Http.GetStringAsync("/tls/qr.svg?to=" + to); Assert.Contains("<svg", svg); Assert.True(svg.Length > 1000); }
        var chk = await f.Http.GetStringAsync("/tls/check"); Assert.Contains("rust", chk);
        Assert.Equal("application/x-x509-ca-cert", (await f.Http.GetAsync("/tls/root-ca.crt")).Content.Headers.ContentType!.MediaType);
    }
}

public class PhoneRoomSocketTests
{
    [Fact]
    public async Task A_phone_page_becomes_a_room_over_a_websocket_with_the_same_wire_frames_and_shows_up_as_a_web_room()
    {
        await using var f = await ServerFixture.StartAsync();
        var tok = f.Token(Role.Control);
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + tok); await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room"), CancellationToken.None);
        await using var stream = WebSocketStream.Create(ws, WebSocketMessageType.Binary, ownsWebSocket: false);
        await FrameIO.WriteAsync(stream, Wire.EncodeJson(MsgType.Hello, 0, new Hello("web-abc123", null, "0.0.2", new[] { "pcm24" }, 48000, "wifi", "Test phone", "")), CancellationToken.None);
        using var to = new CancellationTokenSource(5000);
        var (h, p) = await FrameIO.ReadAsync(stream, to.Token); Assert.Equal(MsgType.Welcome, h.Type);
        var w = Wire.DecodeJson<Welcome>(p)!; Assert.Equal(48000, w.SampleRate); Assert.Equal(0, w.ClockPort);          // no UDP clock for a web page: it pairs clocks over the socket
        await FrameIO.WriteAsync(stream, Wire.EncodeJson(MsgType.Outputs, 0, new OutputsMsg(new[] { new OutputInfo("web-speaker", "Phone speaker", "other", null, true, true) })), CancellationToken.None);
        var a = f.As(tok); ZoneDtoLite? z = null;
        for (int i = 0; i < 50 && z == null; i++) { var zs = await a.GetJson("/api/v1/zones"); var e = zs.EnumerateArray().FirstOrDefault(x => x.GetProperty("playerId").GetString() == "web-abc123"); if (e.ValueKind == JsonValueKind.Object) z = new(e.GetProperty("isWeb").GetBoolean(), e.TryGetProperty("syncErrorMs", out var se) && se.ValueKind != JsonValueKind.Null); else await Task.Delay(100); }
        Assert.NotNull(z); Assert.True(z!.IsWeb); Assert.False(z.HasSyncError, "a phone page cannot measure its sync error: unknown, never 0");
        // a viewer cannot become a room, and an id that is not web-… is refused
        using var ws2 = new ClientWebSocket(); ws2.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View));
        try { await ws2.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room"), CancellationToken.None); Assert.Fail("view role must not connect"); } catch (WebSocketException) { }
        using var ws3 = new ClientWebSocket(); ws3.Options.SetRequestHeader("Authorization", "Bearer " + tok); await ws3.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/room"), CancellationToken.None);
        await using var s3 = WebSocketStream.Create(ws3, WebSocketMessageType.Binary, ownsWebSocket: false);
        await FrameIO.WriteAsync(s3, Wire.EncodeJson(MsgType.Hello, 0, new Hello("pc-sneaky", null, "0.0.2", new[] { "pcm24" }, 48000, "wifi", "x", "")), CancellationToken.None);
        try { var (h3, _) = await FrameIO.ReadAsync(s3, to.Token); Assert.Equal(MsgType.Bye, h3.Type); } catch (Exception e) when (e is IOException or WebSocketException or EndOfStreamException or OperationCanceledException) { }
    }
    private sealed record ZoneDtoLite(bool IsWeb, bool HasSyncError);

    [Fact]
    public async Task The_visualizer_feed_sends_waveform_frames_while_music_plays_and_an_idle_marker_when_it_stops()
    {
        await using var f = await ServerFixture.StartAsync();
        var m = Directory.CreateDirectory(f.Dir.File("music")).FullName; TestMedia.Tone(Path.Combine(m, "t.mp3"), 6, 440, "T"); var a = f.As(f.Token(Role.Admin));
        (await a.PostAsJsonAsync("/api/v1/library/roots", new { path = m })).EnsureSuccessStatusCode();
        for (int i = 0; i < 100 && (await a.GetJson("/api/v1/library/artists")).GetArrayLength() == 0; i++) await Task.Delay(100);
        await using var pc = await FakePc.StartAsync(f, "pc-v", "V"); await pc.WaitConnected();
        using var ws = new ClientWebSocket(); ws.Options.SetRequestHeader("Authorization", "Bearer " + f.Token(Role.View)); await ws.ConnectAsync(new Uri(f.Base.Replace("http", "ws") + "/ws/viz"), CancellationToken.None);
        var id = (await a.GetJson("/api/v1/library/find?q=T")).GetProperty("tracks")[0].GetProperty("id").GetInt64();
        (await a.PostAsJsonAsync("/api/v1/stream/play", new { kind = "tracks", ids = new[] { id } })).EnsureSuccessStatusCode();
        int frames = 0, maxVal = 0; var buf = new byte[4096]; using var cts = new CancellationTokenSource(8000);
        try { while (frames < 20) { var r = await ws.ReceiveAsync(buf, cts.Token); if (r.Count >= 1025 && buf[0] == 1) { frames++; maxVal = Math.Max(maxVal, buf.Skip(1).Take(1024).Max(b => (int)Math.Abs(b - 128))); } } } catch (OperationCanceledException) { }
        Assert.True(frames >= 10, $"only {frames} viz frames"); Assert.True(maxVal > 10, "the waveform should not be flat while a tone plays");
        (await a.PostAsync("/api/v1/stream/stop", null)).EnsureSuccessStatusCode();
        bool idle = false; using var cts2 = new CancellationTokenSource(6000);
        try { while (!idle) { var r = await ws.ReceiveAsync(buf, cts2.Token); if (r.Count == 1 && buf[0] == 0) idle = true; } } catch (OperationCanceledException) { }
        Assert.True(idle, "an idle marker is sent when the music stops");
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.Http.GetAsync("/ws/viz")).StatusCode);
    }
}
