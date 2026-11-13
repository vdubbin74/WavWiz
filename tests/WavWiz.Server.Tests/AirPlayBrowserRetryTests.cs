using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Discovery;
using WavWiz.Server.AirPlay;
using WavWiz.Server.Api;
using Xunit;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #22b (t1860): the AirPlay browse retries with backoff when it fails to start or its socket dies, logs why, and reports 'retrying'.</summary>
public class AirPlayBrowserRetryTests
{
    static readonly IPAddress Lan = IPAddress.Parse("192.0.2.10");   // never really bound: Open is the test seam
    static Socket Udp() { var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.Bind(new IPEndPoint(IPAddress.Loopback, 0)); return s; }
    static async Task Until(Func<bool> ok, int ms = 8000) { var end = DateTime.UtcNow.AddMilliseconds(ms); while (!ok() && DateTime.UtcNow < end) await Task.Delay(20); Assert.True(ok(), "timed out"); }

    [Fact]
    public void Backoff_is_5_15_30_then_every_60_seconds()
    {
        Assert.Equal(new[] { 5, 15, 30, 60, 60, 60 }, Enumerable.Range(1, 6).Select(n => (int)AirPlayBrowser.RetryDelay(n).TotalSeconds));
    }

    [Fact]
    public async Task A_failed_start_is_retried_until_it_works_and_every_step_is_logged()
    {
        var log = new ConcurrentQueue<string>(); int tries = 0;
        using var b = new AirPlayBrowser(log.Enqueue)
        {
            Port = 5399, QueryTo = IPAddress.Loopback, Delay = _ => TimeSpan.FromMilliseconds(40),
            Open = (_, _) => ++tries < 3 ? throw new SocketException((int)SocketError.AddressAlreadyInUse) : Udp(),
        };
        b.Start(Lan);
        Assert.False(b.Running); Assert.Equal("retrying", b.Status); Assert.NotNull(b.LastError); Assert.NotNull(b.NextRetry);
        await Until(() => b.Running);
        Assert.Equal("running", b.Status); Assert.Null(b.LastError); Assert.Null(b.Problem); Assert.Null(b.NextRetry); Assert.Equal(3, b.Attempts);
        var all = string.Join("\n", log);
        Assert.Contains("AirPlay browse: couldn't start on 192.0.2.10:5399", all);
        Assert.Contains("trying again in", all);
        Assert.Contains("AirPlay browse: started on 192.0.2.10:5399", all);
        Assert.Contains("after 3 tries", all);
    }

    [Fact]
    public void While_it_keeps_failing_the_status_is_retrying_with_the_last_error()
    {
        var log = new ConcurrentQueue<string>();
        using var b = new AirPlayBrowser(log.Enqueue) { Port = 5398, Delay = _ => TimeSpan.FromMinutes(10), Open = (_, _) => throw new InvalidOperationException("access forbidden by its access permissions") };
        b.Start(Lan);
        Assert.False(b.Running); Assert.Equal("retrying", b.Status);
        Assert.Contains("access forbidden", b.LastError);
        Assert.Contains("access forbidden", b.Problem);
        Assert.True(b.NextRetry > DateTimeOffset.Now.AddMinutes(9));
        Assert.Contains(log, l => l.Contains("trying again in 600 s"));
    }

    [Fact]
    public async Task A_socket_that_dies_is_reopened_with_backoff()
    {
        var log = new ConcurrentQueue<string>(); var opened = new ConcurrentQueue<Socket>();
        using var b = new AirPlayBrowser(log.Enqueue)
        {
            Port = 5397, QueryTo = IPAddress.Loopback, Delay = _ => TimeSpan.FromMilliseconds(40),
            Open = (_, _) => { var s = Udp(); opened.Enqueue(s); return s; },
        };
        b.Start(Lan);
        Assert.True(b.Running);
        opened.First().Dispose();                       // the socket dies under the browse (adapter gone, sleep, ...)
        b.QueryNow();
        await Until(() => opened.Count >= 2 && b.Running);
        Assert.Equal("running", b.Status);
        Assert.Contains(log, l => l.Contains("stopped:"));
        Assert.Equal(2, log.Count(l => l.Contains("started on")));
    }

    [Fact]
    public async Task Loopback_is_off_and_never_retried()
    {
        var log = new ConcurrentQueue<string>(); int tries = 0;
        using var b = new AirPlayBrowser(log.Enqueue) { Delay = _ => TimeSpan.FromMilliseconds(10), Open = (_, _) => { tries++; return Udp(); } };
        b.Start(IPAddress.Loopback);
        await Task.Delay(100);
        Assert.Equal("off", b.Status); Assert.False(b.Running); Assert.Equal(0, tries); Assert.Null(b.NextRetry);
        Assert.Contains("loopback", b.Problem);
        Assert.Contains(log, l => l.Contains("not started"));
    }

    [Fact]
    public async Task Dispose_stops_the_retries()
    {
        int tries = 0;
        var b = new AirPlayBrowser { Delay = _ => TimeSpan.FromMilliseconds(30), Open = (_, _) => { Interlocked.Increment(ref tries); throw new SocketException((int)SocketError.AccessDenied); } };
        b.Start(Lan); await Task.Delay(120); b.Dispose(); var n = Volatile.Read(ref tries); await Task.Delay(200);
        Assert.Equal(n, Volatile.Read(ref tries)); Assert.Equal("off", b.Status);
    }
}

/// <summary>0.6.9 #22b: the browse logs a VPN bind; the discovery probe no longer tries to bind the broadcast address on Windows.</summary>
public class AirPlayBrowseBindTests
{
    [Fact]
    public void Tailscale_addresses_are_recognised_as_vpn()
    {
        Assert.True(AirPlayBrowser.IsVpnAddress(IPAddress.Parse("100.101.102.103")));
        Assert.False(AirPlayBrowser.IsVpnAddress(IPAddress.Parse("192.168.1.169")));
        Assert.False(AirPlayBrowser.IsVpnAddress(IPAddress.Parse("100.128.0.1")));
    }

    [Fact]
    public void Start_log_names_the_bind_and_warns_on_a_vpn_address()
    {
        var log = new ConcurrentQueue<string>();
        using var b = new AirPlayBrowser(log.Enqueue) { Port = 5396, QueryTo = IPAddress.Loopback, Open = (_, _) => { var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.Bind(new IPEndPoint(IPAddress.Loopback, 0)); return s; } };
        b.Start(IPAddress.Parse("100.90.1.2"));
        Assert.Contains(log, l => l.StartsWith("AirPlay browse: started on 100.90.1.2:5396 ("));
        Assert.Contains(log, l => l.Contains("looks like a VPN"));
    }

    [Fact]
    public void Discovery_skips_the_broadcast_bind_on_windows_only()
    {
        var lan = IPAddress.Parse("192.168.1.169");
        Assert.Equal(new[] { lan }, WavWiz.Server.Net.DiscoveryHost.BindTargets(lan, lan, windows: true));
        var linux = WavWiz.Server.Net.DiscoveryHost.BindTargets(lan, lan, windows: false);
        Assert.Equal(lan, linux[0]);
        Assert.True(linux.Count == 1 || linux[1].ToString().EndsWith(".255"));   // the broadcast socket only where the adapter's mask is known
    }

    [Fact]
    public async Task An_lg_tv_airplay_tcp_advert_is_logged_with_name_model_address_and_interface_and_is_not_filtered()
    {
        var log = new ConcurrentQueue<string>(); Socket? sock = null;
        using var b = new AirPlayBrowser(log.Enqueue) { Port = 5395, QueryTo = IPAddress.Loopback, Open = (_, _) => { var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp); s.Bind(new IPEndPoint(IPAddress.Loopback, 0)); return sock = s; } };
        b.Start(IPAddress.Parse("192.0.2.10"));
        var svc = AirPlayBrowseState.AirPlay; var inst = "[LG] webOS TV OLED65C1PUB." + svc;
        var pkt = DnsWire.Response(new[] { DnsWire.Ptr(svc, inst), DnsWire.Srv(inst, "LG-webOS-TV.local", 7000),
            DnsWire.Txt(inst, new[] { "deviceid=A8:23:FE:12:34:56", "features=0x7F8AD0,0x38BCB46", "flags=0x244", "model=OLED65C1PUB", "manufacturer=LG Electronics", "srcvers=377.17.24.6" }),
            DnsWire.A("LG-webOS-TV.local", IPAddress.Parse("192.168.1.57")) });
        using (var tx = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp)) tx.SendTo(pkt, sock!.LocalEndPoint!);
        var end = DateTime.UtcNow.AddSeconds(5); while (!log.Any(l => l.Contains("seen [LG]")) && DateTime.UtcNow < end) await Task.Delay(20);
        var line = Assert.Single(log, l => l.Contains("seen [LG]"));
        Assert.Contains("model OLED65C1PUB", line); Assert.Contains("LG Electronics", line); Assert.Contains("192.168.1.57", line);
        Assert.Contains("_airplay._tcp", line); Assert.Contains("on 192.0.2.10 (", line);
        var d = Assert.Single(b.State.Devices(DateTimeOffset.Now));
        Assert.True(AirPlaySenderApi.IsTv(d));                                           // shown as a TV, never filtered out
        Assert.False(AirPlaySetup.IsSelf(d.Name, d.Addresses, d.Host, AirPlaySetup.LocalAddresses(), null, "srv-1", d.RaopPort, new[] { 7000 }));
    }
}
