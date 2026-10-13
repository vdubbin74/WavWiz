namespace WavWiz.PlayerCore;

/// <summary>0.3.2 F3: the mini player window (replaces Remote mode). Pure placement / address helpers so they can be tested off Windows.</summary>
public static class MiniPlayer
{
    public const int Width = 420, Height = 72, SlimWidth = 300, SlimHeight = 48;
    /// <summary>The page the mini window loads: /mini.html on the same server as the full window.</summary>
    public static string Url(string uiAddress)
    {
        if (string.IsNullOrWhiteSpace(uiAddress)) return "";
        try { return new Uri(new Uri(uiAddress), "/mini.html").ToString(); } catch { return ""; }
    }
    /// <summary>Where the window goes: the saved spot if it is still (mostly) on a screen, else parked top-center of the work area.
    /// Rects are (x, y, w, h) in physical pixels.</summary>
    public static (int X, int Y) Place((int X, int Y, int W, int H) work, int w, int h, int? savedX, int? savedY, IEnumerable<(int X, int Y, int W, int H)>? screens = null)
    {
        var all = (screens ?? new[] { work }).ToList();
        if (savedX is int sx && savedY is int sy && all.Any(s => sx + w / 2 >= s.X && sx + w / 2 < s.X + s.W && sy >= s.Y && sy + h / 2 < s.Y + s.H)) return (sx, sy);
        return Park(work, w);
    }
    /// <summary>Parked at the top of the desktop, centered.</summary>
    public static (int X, int Y) Park((int X, int Y, int W, int H) work, int w) => (work.X + Math.Max(0, (work.W - w) / 2), work.Y + 8);
    /// <summary>Snap to the top edge when dropped within 24 px of it ("parks at top of desktop").</summary>
    /// <summary>0.3.3 G4b: window opacity is kept between 0.3 and 1 (NaN / out of range -> 1 = opaque).</summary>
    public const double MinOpacity = 0.3;
    public static double ClampOpacity(double v) => double.IsFinite(v) && v > 0 ? Math.Clamp(v, MinOpacity, 1.0) : 1.0;
    public static int SnapTop((int X, int Y, int W, int H) work, int y) => Math.Abs(y - work.Y) <= 24 ? work.Y : y;
}

/// <summary>0.3.2 F14: window events after which the WebView2 must be re-laid out (bounds + NotifyParentWindowPositionChanged), so a
/// snapped / maximized / moved-to-another-DPI window never shows a black page.</summary>
public static class WebViewSync
{
    public const int WM_SIZE = 0x0005, WM_MOVE = 0x0003, WM_WINDOWPOSCHANGED = 0x0047, WM_DPICHANGED = 0x02E0, WM_DISPLAYCHANGE = 0x007E, WM_EXITSIZEMOVE = 0x0232, WM_SYSCOMMAND = 0x0112, WM_SETTINGCHANGE = 0x001A;
    public static bool Needs(int msg) => msg is WM_SIZE or WM_MOVE or WM_WINDOWPOSCHANGED or WM_DPICHANGED or WM_DISPLAYCHANGE or WM_EXITSIZEMOVE or WM_SETTINGCHANGE;
}
