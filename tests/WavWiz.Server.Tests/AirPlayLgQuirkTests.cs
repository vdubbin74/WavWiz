using WavWiz.Core.AirPlay;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 t1956: ConnectAp2Async uses <see cref="AirPlayQuirks.UseBuffered"/> so an LG webOS TV
/// is realtime ALAC while the global AirPlay 2 buffered setting stays on for everyone else.</summary>
public class AirPlayLgQuirkTests
{
    const string Ffmpeg = "ffmpeg";

    [Fact]
    public void Lg_device_is_realtime_when_global_buffered_is_on()
    {
        var q = AirPlayQuirks.For("43QNED70AUA", "LG Electronics", "[LG] webOS TV QNED70AUA");
        Assert.False(AirPlayQuirks.UseBuffered(true, q, Ffmpeg));
        Assert.Equal("LG webOS TV", q.Label);
    }

    [Fact]
    public void Non_lg_device_stays_buffered_when_global_buffered_is_on()
    {
        var q = AirPlayQuirks.For("Sonos Era 100");
        Assert.True(AirPlayQuirks.UseBuffered(true, q, Ffmpeg));
        var other = AirPlayQuirks.For("Unknown9,1", "Acme", "Kitchen speaker");
        Assert.True(AirPlayQuirks.UseBuffered(true, other, Ffmpeg));
        Assert.Equal(AirPlayQuirks.Default.Label, other.Label);
    }
}
