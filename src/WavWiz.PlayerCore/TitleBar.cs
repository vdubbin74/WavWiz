using System.Text.Json;
namespace WavWiz.PlayerCore;

/// <summary>0.6.8-#16: the themed in-page title bar of the Windows app (WavWiz Player's WebView2 window, not an Electron app).
/// The window keeps its WS_CAPTION / WS_THICKFRAME styles (Aero Snap, Win+Z, drag-to-edge snapping, side and bottom resize, the shadow) and only
/// its caption strip is removed (WM_NCCALCSIZE); the page draws the bar (wordmark, menus, min / max-restore / close) and marks it
/// <c>app-region: drag</c>, which WebView2 turns into a real caption (move, double-click maximize, right-click system menu) once
/// <c>CoreWebView2Settings.IsNonClientRegionSupportEnabled</c> is on. Pure helpers so the protocol is tested on any OS.</summary>
public static class TitleBar
{
    /// <summary>Added to the user agent when the custom bar is on: the page only draws its window buttons when this token is present.</summary>
    public const string UaToken = "WavWizChrome/1";
    /// <summary>CSS variable the page sets to the caption-button strip width (<c>--wtb-ctl-w</c>) so the top bar reserves that space at every width.</summary>
    public const string CtlWidthCss = "--wtb-ctl-w";
    /// <summary>Default caption strip width in CSS pixels (3 × 46 px buttons) when the page has not measured yet.</summary>
    public const int DefaultCtlWidthPx = 138;
    public enum Act { None, Minimize, MaximizeRestore, Close, Ready }

    /// <summary>A page message <c>{"cmd":"win","act":"min|max|close|ready"}</c> (anything else = None).</summary>
    public static Act Parse(string? json)
    {
        if (string.IsNullOrEmpty(json) || !json.Contains("\"win\"", StringComparison.Ordinal)) return Act.None;
        try
        {
            using var d = JsonDocument.Parse(json); var r = d.RootElement;
            if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("cmd", out var c) || c.GetString() != "win" || !r.TryGetProperty("act", out var a)) return Act.None;
            return a.GetString() switch { "min" => Act.Minimize, "max" => Act.MaximizeRestore, "close" => Act.Close, "ready" => Act.Ready, _ => Act.None };
        }
        catch (JsonException) { return Act.None; }
    }

    /// <summary>The host's answer so the page shows Maximize or Restore: <c>{"cmd":"win","state":"max|normal"}</c>.</summary>
    public static string StateJson(bool maximized) => JsonSerializer.Serialize(new { cmd = "win", state = maximized ? "max" : "normal" });

    /// <summary>Top of the client area after WM_NCCALCSIZE, given the proposed window top: the caption is dropped (top = window top); a maximized
    /// window hangs its frame off the work-area edge, so the client then starts that far down or the bar would be cut off.</summary>
    public static int ClientTop(int windowTop, bool maximized, int frameY, int paddedBorder) => windowTop + (maximized ? frameY + paddedBorder : 0);

    /// <summary>True when the proposed window top hangs a full frame+padded-border off the work-area top (maximized or top-snapped).
    /// Use this in WM_NCCALCSIZE instead of <c>Form.WindowState</c>: on restore, that message is sent for the restored rect while
    /// WindowState can still report Maximized, which would leave a padded non-client strip (the Windows accent color) until the next resize.</summary>
    public static bool TopFrameHangsOff(int windowTop, int workTop, int frameY, int paddedBorder)
    {
        var pad = frameY + paddedBorder;
        return pad > 0 && workTop - windowTop >= pad;
    }

    /// <summary>Client top from the proposed window and work-area tops. Does not use WindowState (unreliable during WM_NCCALCSIZE on restore).</summary>
    public static int ClientTop(int windowTop, int workTop, int frameY, int paddedBorder)
        => ClientTop(windowTop, TopFrameHangsOff(windowTop, workTop, frameY, paddedBorder), frameY, paddedBorder);
}
