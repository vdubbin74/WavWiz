namespace WavWiz.PlayerCore;

/// <summary>0.0.2 kept player.json, the DPAPI-protected token and the logs in %LocalAppData%\Unison. On the first start of 0.0.3 they are copied to %LocalAppData%\WavWiz
/// (the old folder is left in place; the installer cannot do this because it may run as a different user than the one who uses the player).</summary>
public static class LegacyFolder
{
    /// <returns>true when something was copied.</returns>
    public static bool Migrate(string localAppData)
    {
        try
        {
            var oldDir = Path.Combine(localAppData, "Unison"); var newDir = Path.Combine(localAppData, "WavWiz");
            if (!Directory.Exists(oldDir) || File.Exists(Path.Combine(newDir, "player.json"))) return false;
            Copy(oldDir, newDir); return true;
        }
        catch { return false; }
    }
    private static void Copy(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) { try { File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false); } catch { /* locked or unreadable: skip, never fail startup */ } }
        foreach (var d in Directory.GetDirectories(from)) { var n = Path.GetFileName(d); if (n.Equals("webview", StringComparison.OrdinalIgnoreCase)) continue; Copy(d, Path.Combine(to, n)); }   // the WebView2 profile is rebuilt
    }
}
