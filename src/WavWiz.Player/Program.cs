using WavWiz.Core;
namespace WavWiz.Player;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--version")) { MessageBox.Show(WavWizInfo.DisplayName, "WavWiz"); return 0; }
        using var mutex = new Mutex(true, @"Local\WavWizPlayer", out bool first);
        if (!first) return 0;                                  // already running in the tray
        ApplicationConfiguration.Initialize();
        try { Application.Run(new PlayerApp()); return 0; }
        catch (Exception e)
        {
            try { Directory.CreateDirectory(PlayerSettings.Dir); File.AppendAllText(Path.Combine(PlayerSettings.Dir, "startup-error.txt"), $"{DateTimeOffset.Now:O} {e}\n"); } catch { }
            MessageBox.Show("WavWiz Player could not start:\n" + e.Message + "\n\nDetails were saved to " + PlayerSettings.Dir, "WavWiz (BETA)", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
