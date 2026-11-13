using WavWiz.Server.AirPlay;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 t1960: AirPlay SET_PARAMETER art for radio uses the saved logo or the WavWiz placeholder, never image/none.
/// ArtFor is shared by realtime and buffered sessions.</summary>
public class AirPlayArtTests
{
    static readonly byte[] Logo = "logo-jpeg"u8.ToArray();
    static readonly byte[] Live = "live-jpeg"u8.ToArray();
    static readonly byte[] Place = "place-jpeg"u8.ToArray();
    static readonly byte[] Track = "track-jpeg"u8.ToArray();

    static QueueItem Radio(string? logoUrl = "https://example.com/logo.png", long id = 12) =>
        new(1, "radio", "http://stream.example/x", "Springtime Chill", "Internet radio", "", 0, id, null, null, logoUrl);

    static QueueItem TrackItem() => new(2, "track", "/m/a.flac", "Song A", "Band", "Album", 180_000, 99);

    static Task<byte[]?> Remote(Dictionary<string, byte[]> map, string? url, CancellationToken _) =>
        Task.FromResult(url != null && map.TryGetValue(url, out var b) ? b : null);

    static Task<byte[]?> TrackArt(QueueItem it, CancellationToken _) =>
        Task.FromResult(it.Kind == "track" ? Track : null);

    [Fact]
    public async Task Radio_with_a_saved_logo_sends_the_fetched_jpeg()
    {
        var got = await AirPlayArt.BytesAsync(Radio(), TrackArt, (u, c) => Remote(new() { ["https://example.com/logo.png"] = Logo }, u, c), null, Place, default);
        Assert.Same(Logo, got);
    }

    [Fact]
    public async Task Radio_falls_back_to_the_wavwiz_placeholder_when_the_logo_is_missing_or_the_fetch_fails()
    {
        var noUrl = await AirPlayArt.BytesAsync(Radio(logoUrl: null), TrackArt, (u, c) => Remote(new(), u, c), null, Place, default);
        Assert.Same(Place, noUrl);
        var failed = await AirPlayArt.BytesAsync(Radio(), TrackArt, (u, c) => Remote(new(), u, c), null, Place, default);
        Assert.Same(Place, failed);
    }

    [Fact]
    public async Task Radio_prefers_a_live_song_picture_over_the_station_logo()
    {
        var map = new Dictionary<string, byte[]> { ["https://example.com/logo.png"] = Logo, ["https://art.example/song.jpg"] = Live };
        var got = await AirPlayArt.BytesAsync(Radio(), TrackArt, (u, c) => Remote(map, u, c), "https://art.example/song.jpg", Place, default);
        Assert.Same(Live, got);
    }

    [Fact]
    public async Task A_library_track_still_uses_embedded_or_folder_art_and_ignores_the_radio_placeholder()
    {
        var got = await AirPlayArt.BytesAsync(TrackItem(), TrackArt, (u, c) => Remote(new() { ["https://example.com/logo.png"] = Logo }, u, c), "https://art.example/song.jpg", Place, default);
        Assert.Same(Track, got);
        var none = await AirPlayArt.BytesAsync(TrackItem(), (_, _) => Task.FromResult<byte[]?>(null), (u, c) => Remote(new(), u, c), null, Place, default);
        Assert.Null(none);
    }

    [Fact]
    public async Task Radio_still_gets_the_placeholder_when_the_logo_fetch_is_cancelled()
    {
        var got = await AirPlayArt.BytesAsync(Radio(), TrackArt,
            (_, _) => Task.FromException<byte[]?>(new OperationCanceledException()), null, Place, default);
        Assert.Same(Place, got);
    }

    [Fact]
    public void Icy_title_change_resends_text_and_art_so_the_logo_is_not_cleared()
    {
        var item = Radio();
        NowPlaying n(string? live) => new("playing", 0, 0, 0, item, live, null, false, "off", 1);
        AirPlaySetup.MetaState st(NowPlaying x, long at) => new(AirPlaySetup.ItemKey(x), x.State, x.PositionMs, x.DurationMs, at);
        var before = n(null); var after = n("Springtime Chill / Florito");
        Assert.NotEqual(AirPlaySetup.ItemKey(before), AirPlaySetup.ItemKey(after));
        var plan = AirPlaySetup.Plan(st(before, 0), st(after, 1000));
        Assert.True(plan.HasFlag(AirPlaySetup.MetaSend.Text));
        Assert.True(plan.HasFlag(AirPlaySetup.MetaSend.Art)); // ArtFor must return logo/placeholder; image/none would show the TV's note
    }

    [Fact]
    public void Embedded_radio_placeholder_is_a_png()
    {
        var raw = AirPlayArt.LoadPlaceholder();
        Assert.NotNull(raw);
        Assert.True(raw!.Length > 32);
        Assert.Equal(0x89, raw[0]); Assert.Equal((byte)'P', raw[1]); Assert.Equal((byte)'N', raw[2]); Assert.Equal((byte)'G', raw[3]);
    }
}
