using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#11e: a phone that comes back under a new web id (new Home Screen install) replaces its offline twin.</summary>
public class WebTwinTests
{
    [Fact]
    public void Same_phone_same_address_offline_is_the_twin()
    {
        var known = new[] { ("web-aaa", "iPhone", (string?)"192.168.1.40", false), ("web-bbb", "iPhone", (string?)"192.168.1.41", false), ("web-ccc", "Chrome on Windows", (string?)"192.168.1.40", false) };
        Assert.Equal("web-aaa", ZoneManager.WebTwin("web-new", "iPhone", "192.168.1.40", known));
    }

    [Fact]
    public void Online_ambiguous_pc_browsers_or_unknown_address_are_left_alone()
    {
        Assert.Null(ZoneManager.WebTwin("web-new", "iPhone", "192.168.1.40", new[] { ("web-aaa", "iPhone", (string?)"192.168.1.40", true) }));
        Assert.Null(ZoneManager.WebTwin("web-new", "iPhone", "192.168.1.40", new[] { ("web-aaa", "iPhone", (string?)"192.168.1.40", false), ("web-bbb", "iPhone", (string?)"192.168.1.40", false) }));
        Assert.Null(ZoneManager.WebTwin("web-new", "Chrome on Windows", "192.168.1.40", new[] { ("web-aaa", "Chrome on Windows", (string?)"192.168.1.40", false) }));
        Assert.Null(ZoneManager.WebTwin("web-new", "iPhone", "192.168.1.40", new[] { ("web-aaa", "iPhone", (string?)null, false) }));
    }
}
