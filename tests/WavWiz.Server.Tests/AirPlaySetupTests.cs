using WavWiz.Core.AirPlay;
using WavWiz.Core.Protocol;
using WavWiz.Server.AirPlay;
using WavWiz.Server.Api;
using WavWiz.Server.Receivers;
using Xunit;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#14: AirPlay setup helpers - error classes, self detection, the test chime, the metadata plan and what can be added.</summary>
public class AirPlaySetupTests
{
    [Theory]
    [InlineData("speaker not found; search again", "discovery")]
    [InlineData("Connection refused 192.168.1.9:7000", "discovery")]
    [InlineData("The operation has timed out.", "discovery")]
    [InlineData("pair-setup M1: 403 Forbidden", "denied")]
    [InlineData("pair-setup M2 error 3", "denied")]
    [InlineData("ANNOUNCE failed: 401 Unauthorized", "auth")]
    [InlineData("SETUP failed: 470 Connection Authorization Required", "auth")]
    [InlineData("pair-setup M4 error 2 (wrong code or not transient-capable)", "auth")]
    [InlineData("AirPlay 2 with NTP timing is not supported", "transport")]
    [InlineData("AirPlay 2 speakers are experimental: switch them on in AirPlay settings", "transport")]
    [InlineData("route raop-mfi not supported", "transport")]
    [InlineData("this is WavWiz's own AirPlay receiver (audio loop)", "transport")]
    public void Errors_are_sorted_into_four_separate_classes(string msg, string code)
    {
        var p = AirPlaySetup.Classify(msg, "Living Room TV");
        Assert.Equal(code, p.Code);
        Assert.Contains("Living Room TV", p.Text);
        if (code == "denied") { Assert.True(p.Retry); Assert.Contains("Allow", p.Text); }
    }

    [Fact]
    public void Own_receiver_is_recognised_only_on_this_pc()
    {
        var local = new[] { "192.168.1.20", "10.0.0.2", "MYPC", "MYPC.local" };
        Assert.True(AirPlaySetup.IsSelf("WavWiz – Everywhere", new[] { "192.168.1.20" }, null, local));
        Assert.True(AirPlaySetup.IsSelf("WavWiz - Kitchen", new string[0], "mypc.local.", local));
        Assert.False(AirPlaySetup.IsSelf("WavWiz – Everywhere", new[] { "192.168.1.77" }, "otherpc.local", local));   // another WavWiz server
        Assert.False(AirPlaySetup.IsSelf("Kitchen Sonos", new[] { "192.168.1.20" }, null, local));
        // A 0.0.0.0 A-record (wildcard bind advertised as-is) is not a local address; name alone is not enough
        Assert.False(AirPlaySetup.IsSelf("WavWiz – Basement", new[] { "0.0.0.0" }, "0000.local", local));
        // but the wwid TXT marker, or our own RAOP port, still recognises it
        Assert.True(AirPlaySetup.IsSelf("WavWiz – Basement", new[] { "0.0.0.0" }, "0000.local", local, wwid: "abc123", serverId: "abc123"));
        Assert.False(AirPlaySetup.IsSelf("WavWiz – Everywhere", new[] { "192.168.1.77" }, "otherpc.local", local, wwid: "other", serverId: "abc123"));
        Assert.True(AirPlaySetup.IsSelf("WavWiz – Everywhere", new[] { "0.0.0.0" }, "0000.local", local, raopPort: 5000, ownPorts: new[] { 5000 }));
        Assert.Equal("192.168.1.20", AirPlaySetup.DisplayAddress(new[] { "0.0.0.0", "192.168.1.20" }, "0000.local"));
        Assert.Null(AirPlaySetup.DisplayAddress(new[] { "0.0.0.0" }, "0000.local"));
        Assert.Contains("wwid=abc123", AirPlayReceiver.TxtKeys("abc123"));
        Assert.DoesNotContain(AirPlayReceiver.TxtKeys(null), s => s.StartsWith("wwid="));
    }

    [Fact]
    public void Chime_is_one_epoch_of_audio_frames_ending_with_stop_at()
    {
        var m = AirPlaySetup.Chime(5_000_000, 0xC0DE0001);
        Assert.True(Wire.TryReadHeader(m[0], out var h0, out _)); Assert.Equal(MsgType.Epoch, h0.Type);
        Assert.True(Wire.TryReadHeader(m[^1], out var hn, out _)); Assert.Equal(MsgType.StopAt, hn.Type);
        Assert.Equal(58, m.Count);
        Assert.True(Wire.TryReadHeader(m[1], out var h1, out _)); Assert.Equal(MsgType.Audio, h1.Type);
        Assert.True(Wire.TryDecodeAudio(m[1].AsSpan(Wire.HeaderSize, (int)h1.PayloadLen), out var f, out _));
        Assert.Equal(5_000_000, f!.PlayAtUs); Assert.Equal(0xC0DE0001u, f.Epoch);
    }

    [Fact]
    public void Metadata_plan_sends_text_and_art_on_start_and_track_change_progress_on_pause_and_seek()
    {
        AirPlaySetup.MetaState S(string k, string st, long pos, long at) => new(k, st, pos, 200_000, at);
        var all = AirPlaySetup.MetaSend.Text | AirPlaySetup.MetaSend.Art | AirPlaySetup.MetaSend.Progress;
        Assert.Equal(all, AirPlaySetup.Plan(null, S("a", "playing", 0, 0)));
        Assert.Equal(AirPlaySetup.MetaSend.None, AirPlaySetup.Plan(S("a", "playing", 0, 0), S("a", "playing", 1000, 1000)));
        Assert.Equal(AirPlaySetup.MetaSend.Progress, AirPlaySetup.Plan(S("a", "playing", 1000, 1000), S("a", "paused", 1100, 1100)));
        Assert.Equal(AirPlaySetup.MetaSend.Progress, AirPlaySetup.Plan(S("a", "playing", 1000, 1000), S("a", "playing", 60_000, 2000)));   // seek
        Assert.Equal(all, AirPlaySetup.Plan(S("a", "playing", 9000, 9000), S("b", "playing", 0, 10_000)));
        Assert.Equal(AirPlaySetup.MetaSend.None, AirPlaySetup.Plan(S("a", "playing", 0, 0), S("a", "stopped", 0, 10)));
        var (st, cur, end) = AirPlaySetup.Progress(1_000_000, 10_000, 60_000);
        Assert.Equal(1_000_000u - 441_000u, st); Assert.Equal(1_000_000u, cur); Assert.Equal(st + 2_646_000u, end);
    }

    static AirPlayDevice Dev(string model, string route = "raop", bool pw = false, bool pin = false)
    {
        var d = new AirPlayDevice { Id = "AA", Name = "X", Model = model, RaopPort = 5000, PasswordRequired = pw, PinRequired = pin };
        if (route == "raop") d.Encryption.Add(0);
        if (route == "airplay2-ptp") { d.AirPlayPort = 7000; d.Features = (1UL << AirPlayFeatures.AudioFormat2) | (1UL << AirPlayFeatures.AudioFormat3) | (1UL << AirPlayFeatures.BufferedAudio) | (1UL << AirPlayFeatures.Ptp); d.RaopPort = 0; }
        return d;
    }

    [Fact]
    public void Only_what_WavWiz_implements_can_be_added()
    {
        Assert.Null(AirPlaySenderApi.Block(Dev("AirPort10,115"), false));
        Assert.StartsWith("auth|", AirPlaySenderApi.Block(Dev("AudioAccessory5,1"), true));
        Assert.StartsWith("auth|", AirPlaySenderApi.Block(Dev("AppleTV14,1"), true));
        Assert.StartsWith("auth|", AirPlaySenderApi.Block(Dev("Generic", pw: true), true));
        Assert.StartsWith("auth|", AirPlaySenderApi.Block(Dev("Generic", pin: true), true));
        var ap2 = Dev("Sonos", "airplay2-ptp"); Assert.Equal("airplay2-ptp", ap2.Route);
        Assert.StartsWith("transport|", AirPlaySenderApi.Block(ap2, false));   // AirPlay 2 off -> explained, not offered
        Assert.Null(AirPlaySenderApi.Block(ap2, true));
    }

    [Fact]
    public void Ptp_no_followers_hint_matches_title_without_audio()
    {
        Assert.Null(AirPlaySetup.PtpNoFollowersHint(0, 0));          // clock not sending yet
        Assert.Null(AirPlaySetup.PtpNoFollowersHint(12, 1));         // TV has called back
        Assert.Null(AirPlaySetup.PtpNoFollowersHint(12, 4));
        var hint = AirPlaySetup.PtpNoFollowersHint(24, 0);           // Syncs leaving, no Delay_Req (typical blocked UDP 319/320)
        Assert.NotNull(hint);
        Assert.Contains("timing clock (PTP)", hint);
        Assert.Contains("progress bar stays at 0", hint);
        Assert.Contains("319", hint);
        Assert.Contains("320", hint);
        Assert.Contains("firewall", hint, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AirPlay_PTP_firewall_diag_warns_when_the_rule_is_missing()
    {
        var missing = DiagnosticsApi.AirPlayPtpFirewallFrom(null);
        Assert.Equal("airplay-firewall", missing.Id);
        Assert.Equal("warn", missing.Status);
        Assert.Contains("319-320", missing.Detail);
        Assert.Contains("title", missing.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.NotNull(missing.Fix);
        Assert.Contains("AirPlay speakers", missing.Fix);

        var none = DiagnosticsApi.AirPlayPtpFirewallFrom("No rules match the specified criteria.");
        Assert.Equal("warn", none.Status);

        var ok = DiagnosticsApi.AirPlayPtpFirewallFrom("Rule Name: WavWiz AirPlay speakers (PTP)\nEnabled: Yes\nLocalPort: 319-320");
        Assert.Equal("ok", ok.Status);
        Assert.Null(ok.Fix);
        Assert.Contains("319-320", ok.Detail);
    }
}
