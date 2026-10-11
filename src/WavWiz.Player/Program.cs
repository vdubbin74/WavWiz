using WavWiz.Core;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--version")) { MessageBox.Show(WavWizInfo.DisplayName, "WavWiz"); return 0; }
        // 0.2.2 T7: "--exit" (installer / scripts) asks the running Player to close and waits a little for it
        if (StartArgs.IsExitRequest(args))
        {
            if (EventWaitHandle.TryOpenExisting(StartArgs.ExitEventName, out var ex)) { using (ex) ex.Set(); }
            for (int i = 0; i < 50 && Mutex.TryOpenExisting(StartArgs.MutexName, out var m); i++) { m.Dispose(); Thread.Sleep(200); }
            return 0;
        }
        using var mutex = new Mutex(true, StartArgs.MutexName, out bool first);
        if (!first)
        {
            // 0.2.2 T7: single instance. A manual launch brings the running Player's window to the front; a second auto-start does nothing.
            if (StartArgs.ShouldSignalShow(args) && EventWaitHandle.TryOpenExisting(StartArgs.ShowEventName, out var show)) { using (show) show.Set(); }
            return 0;
        }
        ApplicationConfiguration.Initialize();
        try { Application.Run(new PlayerApp(showWindow: !StartArgs.StartHidden(args))); return 0; }
        catch (Exception e)
        {
            try { Directory.CreateDirectory(PlayerSettings.Dir); File.AppendAllText(Path.Combine(PlayerSettings.Dir, "startup-error.txt"), $"{DateTimeOffset.Now:O} {e}\n"); } catch { }
            MessageBox.Show("WavWiz Player could not start:\n" + e.Message + "\n\nDetails were saved to " + PlayerSettings.Dir, "WavWiz (BETA)", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
