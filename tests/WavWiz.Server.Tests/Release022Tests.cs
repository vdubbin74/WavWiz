using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.2.2 items (from the user's 0.2.1 test notes T1-T11).</summary>
public partial class Release022Tests
{
    // T7: only the sign-in auto-start stays in the tray; every manual launch opens the window; a second manual launch shows the running one.
    [Theory]
    [InlineData(new string[0], false, true)]                       // Start menu / desktop shortcut / double-click
    [InlineData(new[] { "--autostart" }, true, false)]             // installer's all-users Run value
    [InlineData(new[] { "--background" }, true, false)]            // the player's own per-user Run value
    [InlineData(new[] { "--tray" }, true, false)]
    [InlineData(new[] { "/MINIMIZED" }, true, false)]
    [InlineData(new[] { "--exit" }, false, false)]
    [InlineData(new[] { "--some-other" }, false, true)]
    public void T7_launch_arguments(string[] args, bool hidden, bool signalShow)
    {
        Assert.Equal(hidden, StartArgs.StartHidden(args));
        Assert.Equal(signalShow, StartArgs.ShouldSignalShow(args));
    }

    [Fact]
    public void T7_autostart_values_use_a_tray_argument()
    {
        var repo = Repo();
        var iss = File.ReadAllText(Path.Combine(repo, "installer", "WavWiz.iss"));
        Assert.Contains("wavwiz-player.exe\"\" --autostart", iss);
        var app = File.ReadAllText(Path.Combine(repo, "src", "WavWiz.Player", "PlayerApp.cs"));
        Assert.Contains("\" --background\"", app);
        Assert.Contains("_showWindow", app);
    }

    internal static string Repo()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d != null && !File.Exists(Path.Combine(d.FullName, "WavWiz.sln"))) d = d.Parent;
        return d!.FullName;
    }
}
