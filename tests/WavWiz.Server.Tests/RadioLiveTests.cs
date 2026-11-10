using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#8: station metadata -> artist + title (+ song picture).</summary>
public class RadioLiveTests
{
    [Fact]
    public void IHeart_key_value_title_is_split_and_art_kept()
    {
        var raw = RadioDecoder.ParseStreamTitle("StreamTitle='Nirvana - text=\"Something In The Way\" song_spot=\"M\" MediaBaseId=\"1234\" amgArtworkURL=\"http://image.iheart.com/x/abc.jpg\" length=\"00:03:52\" unsID=\"-1\"';StreamUrl='';");
        var l = RadioLive.Parse(raw)!;
        Assert.Equal("Nirvana", l.Artist);
        Assert.Equal("Something In The Way", l.Title);
        Assert.Equal("Nirvana - Something In The Way", l.Display);
        Assert.Equal("http://image.iheart.com/x/abc.jpg", l.ArtUrl);
    }

    [Fact]
    public void Empty_or_bad_art_url_means_station_art()
    {
        Assert.Null(RadioLive.Parse("Foo - text=\"Bar\" amgArtworkURL=\"\"")!.ArtUrl);
        Assert.Null(RadioLive.Parse("Foo - text=\"Bar\" amgArtworkURL=\"javascript:x\"")!.ArtUrl);
    }

    [Fact]
    public void Plain_artist_dash_title_still_works()
    {
        var l = RadioLive.Parse("Daft Punk - One More Time")!;
        Assert.Equal(("Daft Punk", "One More Time", "Daft Punk - One More Time"), (l.Artist, l.Title, l.Display));
        Assert.Null(l.ArtUrl);
        var j = RadioLive.Parse("Station jingle")!;
        Assert.Null(j.Artist); Assert.Equal("Station jingle", j.Title);
        Assert.Null(RadioLive.Parse("  "));
    }
}
