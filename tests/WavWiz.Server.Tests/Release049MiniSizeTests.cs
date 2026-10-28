using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F75: the standalone mini player window is sized from the content's CSS size x the window's scale, never below the design width.</summary>
public class Release049MiniSizeTests
{
    [Theory]
    [InlineData(210, 145, false, 420, 145)]   // window opened at 420 device px on a 200 % screen = 210 CSS px: must grow back
    [InlineData(420, 145, false, 420, 145)]
    [InlineData(436, 150, false, 436, 150)]   // content that really needs more keeps it
    [InlineData(150, 30, true, 300, 48)]
    public void Content_size_never_below_design(double w, double h, bool slim, double ew, double eh)
    { var (W, H) = MiniPlayer.ContentSize(w, h, slim); Assert.Equal(ew, W); Assert.Equal(eh, H); }

    [Theory]
    [InlineData(1.0, 420, 145)] [InlineData(1.5, 630, 218)] [InlineData(2.0, 840, 290)]
    public void Device_pixels_at_100_150_200_percent(double scale, int ew, int eh)
    { var (cw, ch) = MiniPlayer.ContentSize(210, 145, false); Assert.Equal((ew, eh), MiniPlayer.SizeFor(cw, ch, scale)); }

    // 0.4.9 F86: the two-row Player (89 CSS px) is 89 / 178 device px tall at 100 / 200 %, and the window opens at about that height
    [Theory] [InlineData(1.0, 420, 89)] [InlineData(2.0, 840, 178)]
    public void Two_row_player_height(double scale, int ew, int eh) { var (cw, ch) = MiniPlayer.ContentSize(420, 89, false); Assert.Equal((ew, eh), MiniPlayer.SizeFor(cw, ch, scale)); Assert.InRange(MiniPlayer.Height, 89, 100); }

    [Fact] public void Nan_report_falls_back_to_design_width() => Assert.Equal(420, MiniPlayer.ContentSize(double.NaN, 145, false).W);
    // 0.5.0: size with the page's devicePixelRatio (what WebView2 renders at); DeviceDpi only as fallback
    [Theory, InlineData(2.0, 144, 2.0), InlineData(1.0, 192, 1.0), InlineData(0, 192, 2.0), InlineData(double.NaN, 144, 1.5), InlineData(9.0, 96, 1.0)]
    public void Scale_prefers_page_dpr(double dpr, int dpi, double e) => Assert.Equal(e, MiniPlayer.ScaleFor(dpr, dpi));
    [Fact] public void Two_rows_at_200_with_stale_150_dpi_not_clipped() { var (cw, ch) = MiniPlayer.ContentSize(420, 89, false); Assert.Equal((840, 178), MiniPlayer.SizeFor(cw, ch, MiniPlayer.ScaleFor(2.0, 144))); }
}
