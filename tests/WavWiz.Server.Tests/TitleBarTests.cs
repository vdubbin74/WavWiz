using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#16: the Windows app's themed title bar protocol (page -> host window buttons, host -> page max state, NCCALCSIZE math).
/// The WinForms side (Forms.cs) is Windows-only and is checked by reading its source here.</summary>
public class TitleBarTests
{
    [Theory]
    [InlineData("{\"cmd\":\"win\",\"act\":\"min\"}", TitleBar.Act.Minimize)]
    [InlineData("{\"cmd\":\"win\",\"act\":\"max\"}", TitleBar.Act.MaximizeRestore)]
    [InlineData("{\"cmd\":\"win\",\"act\":\"close\"}", TitleBar.Act.Close)]
    [InlineData("{\"cmd\":\"win\",\"act\":\"ready\"}", TitleBar.Act.Ready)]
    [InlineData("{\"cmd\":\"win\",\"act\":\"fly\"}", TitleBar.Act.None)]
    [InlineData("{\"cmd\":\"mini\",\"toggle\":true}", TitleBar.Act.None)]
    [InlineData("{\"cmd\":\"osd\",\"text\":\"win\"}", TitleBar.Act.None)]
    [InlineData("\"win\"", TitleBar.Act.None)]
    [InlineData("{oops \"win\"", TitleBar.Act.None)]
    [InlineData(null, TitleBar.Act.None)]
    public void Page_messages_map_to_window_actions(string? json, TitleBar.Act want) => Assert.Equal(want, TitleBar.Parse(json));

    [Fact]
    public void State_json_and_client_top()
    {
        Assert.Equal("{\"cmd\":\"win\",\"state\":\"max\"}", TitleBar.StateJson(true));
        Assert.Equal("{\"cmd\":\"win\",\"state\":\"normal\"}", TitleBar.StateJson(false));
        Assert.Equal(100, TitleBar.ClientTop(100, false, 4, 4));   // caption gone, client starts at the window top
        Assert.Equal(-8 + 8, TitleBar.ClientTop(-8, true, 4, 4));    // maximized: the frame hangs off-screen, client starts at the monitor top
        Assert.Equal("--wtb-ctl-w", TitleBar.CtlWidthCss);
        Assert.Equal(138, TitleBar.DefaultCtlWidthPx);
    }

    [Fact]
    public void Client_top_on_restore_uses_the_proposed_rect_not_a_stale_maximized_flag()
    {
        const int frame = 4, pad = 4;
        // Restore WM_NCCALCSIZE: proposed top is already the restored position (100). WindowState can still
        // report Maximized; trusting that flag insets the client by 8 px and leaves an accent-colored band.
        Assert.False(TitleBar.TopFrameHangsOff(100, 0, frame, pad));
        Assert.Equal(100, TitleBar.ClientTop(100, workTop: 0, frame, pad));
        Assert.Equal(108, TitleBar.ClientTop(100, maximized: true, frame, pad));   // the stale-flag trap
        // Maximized, taskbar at the bottom: window hangs 8 px above the work area.
        Assert.True(TitleBar.TopFrameHangsOff(-8, 0, frame, pad));
        Assert.Equal(0, TitleBar.ClientTop(-8, workTop: 0, frame, pad));
        // Maximized, 40 px taskbar at the top of the monitor: window hangs 8 px above the work area (y=32).
        Assert.True(TitleBar.TopFrameHangsOff(32, 40, frame, pad));
        Assert.Equal(40, TitleBar.ClientTop(32, workTop: 40, frame, pad));
        // Restored window below a top taskbar: do not pull the client up to the work area.
        Assert.False(TitleBar.TopFrameHangsOff(100, 40, frame, pad));
        Assert.Equal(100, TitleBar.ClientTop(100, workTop: 40, frame, pad));
        // Secondary monitor above the primary (work area starts at y=-1080).
        Assert.True(TitleBar.TopFrameHangsOff(-1088, -1080, frame, pad));
        Assert.Equal(-1080, TitleBar.ClientTop(-1088, workTop: -1080, frame, pad));
        Assert.False(TitleBar.TopFrameHangsOff(-1000, -1080, frame, pad));
        Assert.Equal(-1000, TitleBar.ClientTop(-1000, workTop: -1080, frame, pad));
        // Zero metrics never hang (avoid treating every window as maximized).
        Assert.False(TitleBar.TopFrameHangsOff(-8, 0, 0, 0));
        Assert.Equal(-8, TitleBar.ClientTop(-8, workTop: 0, 0, 0));
    }

    [Fact]
    public void The_host_window_wires_the_bar_without_dropping_the_frame()
    {
        var root = AppContext.BaseDirectory; while (!File.Exists(Path.Combine(root, "WavWiz.sln"))) root = Path.GetDirectoryName(root)!;
        var f = File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "Forms.cs"));
        Assert.Contains("cw.Settings.IsNonClientRegionSupportEnabled = _chrome;", f);
        Assert.Contains("TitleBar.UaToken", f);
        Assert.Contains("m.Msg == WM_NCCALCSIZE", f); Assert.Contains("SWP_FRAMECHANGED", f);
        Assert.DoesNotContain("FormBorderStyle = FormBorderStyle.None; // 0.6.8", f);   // Snap / resize need the frame styles
        Assert.DoesNotContain("ClientTop(before.Top, WindowState == FormWindowState.Maximized", f);   // WindowState is stale on restore
        Assert.Contains("WorkingArea.Top", f);
        Assert.Contains("TitleBar.ClientTop(before.Top, workTop,", f);
        Assert.Contains("public bool CustomTitleBar { get; set; } = true;", File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "PlayerSettings.cs")));
    }
}
