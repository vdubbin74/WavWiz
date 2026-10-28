using System.Net;
using WavWiz.Core.AirPlay;
using WavWiz.Core.Discovery;
using Xunit;
namespace WavWiz.Core.Tests;

/// <summary>0.5.0 AirPlay sender stage 1. TXT values are realistic samples in the shapes published by the unofficial AirPlay spec / pyatv docs
/// and by WavWiz's own receiver (no real hardware capture yet; Sonos Era 100 capture pending).</summary>
public class AirPlayDiscoveryTests
{
    static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-10-23T10:00:00Z");
    static DnsWire.Message Msg(params DnsWire.Record[] r) { DnsWire.TryParse(DnsWire.Response(r), out var m); return m!; }
    static DnsWire.Record[] Group(string svc, string inst, string host, IPAddress ip, int port, params string[] txt)
        => new[] { DnsWire.Ptr(svc, inst + "." + svc), DnsWire.Srv(inst + "." + svc, host, port), DnsWire.Txt(inst + "." + svc, txt), DnsWire.A(host, ip) };

    static readonly string[] ApxRaop = { "txtvers=1", "ch=2", "cn=0,1", "et=0,4", "sv=false", "ek=1", "sr=44100", "ss=16", "pw=false", "vn=65537", "tp=UDP", "md=0,1,2", "vs=105.1", "am=AirPort10,115", "ft=0x445F8A00,0x1C340", "sf=0x4" };
    static readonly string[] HpAir = { "acl=0", "deviceid=D4:A3:3D:11:22:33", "features=0x4A7FDFD5,0xBC157FDE", "flags=0x18644", "gid=5F5F6E0B-AAAA-BBBB-CCCC-0123456789AB", "igl=1", "gcgl=1", "model=AudioAccessory5,1", "protovers=1.1", "pi=2e388006-13ba-4041-9a67-25dd4a43d536", "srcvers=770.8.1", "pk=59dab8f6fa3d07c9b1d9bfb0eb6f8a6fb6e3b0f0f74d3b2f0b4b0d1a2c3e4f50", "vv=2" };
    static readonly string[] HpRaop = { "cn=0,1,2,3", "da=true", "et=0,3,5", "ft=0x4A7FDFD5,0xBC157FDE", "sf=0x18644", "md=0,1,2", "am=AudioAccessory5,1", "pk=59dab8f6", "tp=UDP", "vn=65537", "vs=770.8.1", "ov=17.0" };
    static readonly string[] SpsAir = { "srcvers=366.0", "deviceid=0A:1B:2C:3D:4E:5F", "features=0x405FCA00,0x1C340", "flags=0x4", "model=Shairport Sync", "manufacturer=https://github.com/mikebrady", "protovers=1.1", "acl=0", "rsf=0x0", "fv=p20.4.5", "pi=aaaa", "gid=aaaa", "gcgl=0", "pk=00" };
    static readonly string[] WwRaop = { "txtvers=1", "ch=2", "cn=0,1", "et=0,1", "sv=false", "da=true", "sr=44100", "ss=16", "pw=false", "vn=3", "tp=TCP,UDP", "md=0,1,2", "vs=130.14", "sm=false", "ek=1", "am=WavWiz" };

    [Fact]
    public void Features_parse_two_words()
    {
        var f = AirPlayFeatures.Parse("0x4A7FDFD5,0xBC157FDE");
        Assert.Equal(0xBC157FDE4A7FDFD5UL, f);
        Assert.True(AirPlayFeatures.Has(f, AirPlayFeatures.Audio)); Assert.True(AirPlayFeatures.Has(f, AirPlayFeatures.BufferedAudio)); Assert.True(AirPlayFeatures.Has(f, AirPlayFeatures.Ptp));
        Assert.Equal(0x445F8A00UL, AirPlayFeatures.Parse("0x445F8A00")); Assert.Equal(0UL, AirPlayFeatures.Parse("")); Assert.Equal(1234UL, AirPlayFeatures.Parse("1234"));
        Assert.Contains("PTP", AirPlayFeatures.Names(f));
    }

    [Fact]
    public void Raop_only_airport_express()
    {
        var st = new AirPlayBrowseState();
        Assert.True(st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "00112233AABB@Kitchen Express", "Kitchen-Express.local", IPAddress.Parse("192.168.1.40"), 7000, ApxRaop)), T0));
        var d = Assert.Single(st.Devices(T0));
        Assert.Equal("00112233AABB", d.Id); Assert.Equal("Kitchen Express", d.Name); Assert.Equal(7000, d.RaopPort); Assert.Equal(0, d.AirPlayPort);
        Assert.Equal(new[] { "192.168.1.40" }, d.Addresses); Assert.Equal(new[] { 0, 1 }, d.Codecs); Assert.Equal(new[] { 0, 4 }, d.Encryption);
        Assert.Equal("AirPort10,115", d.Model); Assert.Equal("PCM, ALAC", d.CodecNames); Assert.Equal("raop", d.Route); Assert.False(d.PasswordRequired);
    }

    [Fact]
    public void HomePod_merges_raop_and_airplay_records()
    {
        var st = new AirPlayBrowseState(); var ip = IPAddress.Parse("192.168.1.51");
        st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "D4A33D112233@Living Room", "Living-Room.local", ip, 7000, HpRaop)), T0);
        st.Ingest(Msg(Group(AirPlayBrowseState.AirPlay, "Living Room", "Living-Room.local", ip, 7000, HpAir)), T0.AddMilliseconds(30));
        var d = Assert.Single(st.Devices(T0.AddSeconds(1)));
        Assert.Equal("D4A33D112233", d.Id); Assert.True(d.Raop); Assert.True(d.AirPlay2Service); Assert.True(d.SupportsAirPlay2);
        Assert.Equal("AudioAccessory5,1", d.Model); Assert.Equal("airplay2-ptp", d.Route); Assert.Equal("5F5F6E0B-AAAA-BBBB-CCCC-0123456789AB", d.GroupId);
        Assert.Equal("PCM, ALAC, AAC, AAC-ELD", d.CodecNames); Assert.Equal(new[] { 0, 3, 5 }, d.Encryption);
    }

    [Fact]
    public void Shairport_ap2_and_wavwiz_zone_receivers_are_separate_devices()
    {
        var st = new AirPlayBrowseState(); var host = "PC-HMS.local"; var ip = IPAddress.Parse("192.168.1.20");
        st.Ingest(Msg(Group(AirPlayBrowseState.AirPlay, "Bench", host, ip, 7000, SpsAir)), T0);
        st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "0A1B2C3D4E5F@Bench", host, ip, 7000, "cn=0,1", "et=0,4", "am=Shairport Sync", "ft=0x405FCA00,0x1C340")), T0);
        st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "020000000001@WavWiz – Kitchen", "TV-PC.local", IPAddress.Parse("192.168.1.30"), 5001, WwRaop)), T0);
        st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "020000000002@WavWiz – Everywhere", "TV-PC.local", IPAddress.Parse("192.168.1.30"), 5002, WwRaop)), T0);
        var all = st.Devices(T0.AddSeconds(1)); Assert.Equal(3, all.Count);
        var b = all.Single(x => x.Name == "Bench"); Assert.True(b.SupportsAirPlay2); Assert.Equal("Shairport Sync", b.Model); Assert.Equal("https://github.com/mikebrady", b.Manufacturer); Assert.Equal("airplay2-ptp", b.Route);
        var k = all.Single(x => x.Name == "WavWiz – Kitchen"); Assert.Equal(5001, k.RaopPort); Assert.Equal("WavWiz", k.Model); Assert.False(k.SupportsAirPlay2); Assert.Equal("raop", k.Route);
        Assert.Equal(new[] { "192.168.1.30" }, all.Single(x => x.Name == "WavWiz – Everywhere").Addresses);
    }

    [Fact]
    public void Goodbye_and_expiry_remove_devices_and_unrelated_services_are_ignored()
    {
        var st = new AirPlayBrowseState(); var g = Group(AirPlayBrowseState.Raop, "00112233AABB@Den", "Den.local", IPAddress.Parse("10.0.0.5"), 7000, ApxRaop);
        st.Ingest(Msg(g), T0); Assert.Single(st.Devices(T0));
        Assert.False(st.Ingest(Msg(DnsWire.Ptr("_spotify-connect._tcp.local", "x._spotify-connect._tcp.local")), T0));
        st.Ingest(Msg(g[0] with { Ttl = 0 }, g[1] with { Ttl = 0 }), T0.AddSeconds(2)); Assert.Empty(st.Devices(T0.AddSeconds(2)));
        st.Ingest(Msg(g), T0); Assert.Empty(st.Devices(T0.AddSeconds(5000)));        // PTR TTL 4500 s passed
    }

    [Fact]
    public void Status_flags_password_and_pin()
    {
        var st = new AirPlayBrowseState();
        st.Ingest(Msg(Group(AirPlayBrowseState.AirPlay, "Locked TV", "tv.local", IPAddress.Parse("10.0.0.9"), 7000, "deviceid=AA:BB:CC:DD:EE:FF", "features=0x5A7FFFF7,0x1E", "flags=0x88", "model=AppleTV6,2")), T0);
        var d = Assert.Single(st.Devices(T0)); Assert.True(d.PinRequired); Assert.True(d.PasswordRequired); Assert.Equal("AABBCCDDEEFF", d.Id);
    }

    [Fact]
    public void Query_has_both_ptr_questions_and_parses()
    {
        Assert.True(DnsWire.TryParse(AirPlayBrowseState.Query(false), out var m));
        Assert.False(m!.IsResponse); Assert.Equal(new[] { AirPlayBrowseState.Raop, AirPlayBrowseState.AirPlay }, m.Questions.Select(q => q.Name));
        Assert.All(m.Questions, q => { Assert.Equal(DnsWire.TypePtr, q.Type); Assert.False(q.UnicastResponse); });
    }

    [Fact]
    public void Real_wire_with_compression_pointers()
    {
        var b = new List<byte> { 0, 0, 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 0 };
        void Name(params string[] l) { foreach (var x in l) { var e = System.Text.Encoding.UTF8.GetBytes(x); b.Add((byte)e.Length); b.AddRange(e); } b.Add(0); }
        void Hdr(ushort type, int len) { b.AddRange(new byte[] { (byte)(type >> 8), (byte)type, 0x80, 1, 0, 0, 0x11, 0x94, (byte)(len >> 8), (byte)len }); }
        int svcAt = b.Count; Name("_raop", "_tcp", "local"); Hdr(12, 0); int lenAt = b.Count - 2; int rd = b.Count;
        int instAt = b.Count; var lab = System.Text.Encoding.UTF8.GetBytes("AABBCCDDEEFF@Porch"); b.Add((byte)lab.Length); b.AddRange(lab); b.Add((byte)(0xC0 | svcAt >> 8)); b.Add((byte)svcAt);
        b[lenAt] = 0; b[lenAt + 1] = (byte)(b.Count - rd);
        b.Add((byte)(0xC0 | instAt >> 8)); b.Add((byte)instAt); Hdr(33, 0); lenAt = b.Count - 2; rd = b.Count; b.AddRange(new byte[] { 0, 0, 0, 0, 0x1B, 0x58 }); Name("porch", "local"); b[lenAt + 1] = (byte)(b.Count - rd);
        b.Add((byte)(0xC0 | instAt >> 8)); b.Add((byte)instAt); var txt = DnsWire.Txt("x", new[] { "cn=1", "et=0" }).Data; Hdr(16, txt.Length); b.AddRange(txt);
        Assert.True(DnsWire.TryParse(b.ToArray(), out var m));
        var st = new AirPlayBrowseState(); st.Ingest(m!, T0);
        var d = Assert.Single(st.Devices(T0)); Assert.Equal("Porch", d.Name); Assert.Equal(7000, d.RaopPort); Assert.Equal("porch.local", d.Host); Assert.Equal(new[] { 1 }, d.Codecs);
    }

    /// <summary>Captured 2026-10-23 from shairport-sync 4.3.7 (Debian, AirPlay 1 build) on the box via avahi-browse.</summary>
    [Fact]
    public void Captured_shairport_sync_437_raop()
    {
        string[] txt = { "pw=false", "txtvers=1", "ch=2", "cn=0,1", "ek=1", "et=0,1", "sv=false", "da=true", "sr=44100", "ss=16", "md=0,1,2", "vn=65537", "tp=TCP,UDP", "vs=105.1", "am=ShairportSync", "fv=4.3.7", "sf=0x4" };
        var st = new AirPlayBrowseState();
        st.Ingest(Msg(Group(AirPlayBrowseState.Raop, "967BDF9D9D3B@Bench", "grok-bot-vm-413179329.local", IPAddress.Parse("172.30.0.2"), 5000, txt)), T0);
        var d = Assert.Single(st.Devices(T0));
        Assert.Equal("967BDF9D9D3B", d.Id); Assert.Equal("Bench", d.Name); Assert.Equal(5000, d.RaopPort); Assert.Equal("ShairportSync", d.Model);
        Assert.Equal(new[] { 0, 1 }, d.Encryption); Assert.Equal("raop", d.Route); Assert.False(d.SupportsAirPlay2); Assert.Equal(4u, d.StatusFlags); Assert.False(d.PinRequired);
    }
}
