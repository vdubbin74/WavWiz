namespace WavWiz.PlayerCore;

/// <summary>0.2.2 T7: how WavWiz Player was launched. Only the sign-in auto-start (the installer's HKLM Run value "--autostart", the player's own
/// HKCU Run value "--background", or an explicit "--tray" / "--minimized") starts hidden in the tray. Any other launch (Start menu, desktop shortcut,
/// double-click, the installer's "Start WavWiz Player now") opens the window. "--exit" asks a running Player to close (used by the installer).</summary>
public static class StartArgs
{
    /// <summary>Single-instance mutex (per Windows session).</summary>
    public const string MutexName = @"Local\WavWizPlayer";
    /// <summary>Set by a second manual launch: the running Player brings its window to the front.</summary>
    public const string ShowEventName = @"Local\WavWizPlayer.Show";
    /// <summary>Set by the installer (or "wavwiz-player.exe --exit"): the running Player exits cleanly.</summary>
    public const string ExitEventName = @"Local\WavWizPlayer.Exit";

    private static readonly string[] TrayArgs = ["autostart", "background", "tray", "minimized"];

    private static string Norm(string a) => a.Trim().TrimStart('-', '/').ToLowerInvariant();

    /// <summary>True when this launch should stay in the tray (sign-in auto-start).</summary>
    public static bool StartHidden(IEnumerable<string> args) => args.Any(a => TrayArgs.Contains(Norm(a)));

    /// <summary>True for "--exit": signal the running Player to quit and do nothing else.</summary>
    public static bool IsExitRequest(IEnumerable<string> args) => args.Any(a => Norm(a) == "exit");

    /// <summary>What a launch does when another Player is already running in this session: a hidden (auto-start) launch just quits,
    /// a manual launch asks the running one to show its window.</summary>
    public static bool ShouldSignalShow(IEnumerable<string> args) => !StartHidden(args) && !IsExitRequest(args);
}
