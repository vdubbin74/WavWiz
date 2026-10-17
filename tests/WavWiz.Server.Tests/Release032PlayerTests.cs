using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.3.2 F3 mini player placement / address and F14 WebView2 re-layout triggers (pure parts of the Windows Player).</summary>
public class Release032PlayerTests
{
    [Fact]
    public void Mini_player_loads_mini_html_on_the_same_server_and_has_the_two_sizes()
    {
        Assert.Equal("http://192.168.1.50:47800/mini.html", MiniPlayer.Url("http://192.168.1.50:47800/?player=1"));
        Assert.Equal("", MiniPlayer.Url("")); Assert.Equal("", MiniPlayer.Url("not a url"));
        Assert.Equal((420, 138), (MiniPlayer.Width, MiniPlayer.Height)); Assert.Equal((300, 48), (MiniPlayer.SlimWidth, MiniPlayer.SlimHeight));
    }

    [Fact]
    public void Mini_player_keeps_a_saved_spot_on_screen_else_parks_top_center_and_snaps_to_the_top()
    {
        var work = (0, 0, 1920, 1040);
        Assert.Equal((100, 300), MiniPlayer.Place(work, 420, 72, 100, 300));
        Assert.Equal((750, 8), MiniPlayer.Place(work, 420, 72, null, null));
        Assert.Equal((750, 8), MiniPlayer.Place(work, 420, 72, 5000, 300));   // the monitor it was on is gone
        var two = new[] { (0, 0, 1920, 1040), (1920, 0, 2560, 1400) };
        Assert.Equal((2500, 200), MiniPlayer.Place(work, 420, 72, 2500, 200, two));
        Assert.Equal(0, MiniPlayer.SnapTop(work, 20)); Assert.Equal(60, MiniPlayer.SnapTop(work, 60));
    }

    [Fact]
    public void WebView_is_relaid_out_after_size_move_snap_dpi_and_display_changes_only()
    {
        foreach (var m in new[] { WebViewSync.WM_SIZE, WebViewSync.WM_MOVE, WebViewSync.WM_WINDOWPOSCHANGED, WebViewSync.WM_DPICHANGED, WebViewSync.WM_DISPLAYCHANGE, WebViewSync.WM_EXITSIZEMOVE })
            Assert.True(WebViewSync.Needs(m));
        Assert.False(WebViewSync.Needs(0x0200)); Assert.False(WebViewSync.Needs(0x000F));   // mouse move, paint
    }
}
