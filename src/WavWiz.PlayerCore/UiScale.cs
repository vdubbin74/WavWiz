namespace WavWiz.PlayerCore;

/// <summary>
/// UI-size setting of WavWiz Player (0.0.3), kept free of any Windows types so it can be unit-tested for 100/150/200/250/300 % screens.
/// "Auto" (0) follows the Windows display scale of the monitor the window is on. A fixed percentage (100-300) multiplies the layout and the web page on top of Windows' own scaling
/// (so the person can make everything bigger on a TV that Windows reports at 100 %).
/// </summary>
public static class UiScale
{
    public const int Auto = 0, Min = 100, Max = 300;
    public static readonly int[] Choices = { Auto, 100, 125, 150, 175, 200, 250, 300 };

    /// <summary>Anything that is not Auto is clamped to 100..300 and rounded to a multiple of 5.</summary>
    public static int Normalize(int percent) => percent <= 0 ? Auto : Math.Clamp((int)Math.Round(percent / 5.0) * 5, Min, Max);

    public static string Label(int percent) => Normalize(percent) == Auto ? "Auto (follow Windows)" : $"{Normalize(percent)} %";

    /// <summary>Extra multiplier on top of what Windows already applies. Auto = 1 (Windows scaling is already in effect with PerMonitorV2 DPI awareness).</summary>
    public static double ExtraFactor(int percent) => Normalize(percent) == Auto ? 1.0 : Normalize(percent) / 100.0;

    /// <summary>Scale factor for the web page (WebView2 ZoomFactor). With DPI awareness the page is already drawn at the monitor's scale, so Auto = 1.0; a fixed value is a plain zoom.</summary>
    public static double WebZoom(int percent) => Math.Clamp(ExtraFactor(percent), 1.0, 3.0);

    /// <summary>Scale factor for the native dialogs: Windows DPI scale (dpi / 96) times the extra factor. Never below 1 and never above 4.</summary>
    public static double FormFactor(int percent, int dpi) => Math.Clamp((dpi <= 0 ? 96 : dpi) / 96.0 * ExtraFactor(percent), 1.0, 4.0);

    /// <summary>Size of a native window in pixels: a size designed for 96 dpi, scaled, but never larger than the working area (minus a margin) so nothing is cut off on a small or heavily scaled screen.</summary>
    public static (int W, int H) FitWindow(int designW, int designH, double factor, int workW, int workH, int margin = 24)
    {
        int w = (int)Math.Round(designW * factor), h = (int)Math.Round(designH * factor);
        return (Math.Min(w, Math.Max(320, workW - margin)), Math.Min(h, Math.Max(240, workH - margin)));
    }

    /// <summary>Effective CSS viewport the web page sees for a screen of the given physical size at a given total scale: this is what the layout has to cope with (3840x2160 at 200 % is 1920x1080 CSS px).</summary>
    public static (int W, int H) CssViewport(int physicalW, int physicalH, double totalScale) => ((int)Math.Round(physicalW / totalScale), (int)Math.Round(physicalH / totalScale));
}
