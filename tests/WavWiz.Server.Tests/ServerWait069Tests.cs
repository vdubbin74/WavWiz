using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #14: the Player window waits for a server that is still starting (after a reboot) instead of giving up.</summary>
public class ServerWait069Tests
{
    [Theory]
    [InlineData(0, 2)] [InlineData(1, 2)] [InlineData(2, 4)] [InlineData(3, 8)] [InlineData(4, 16)] [InlineData(5, 30)] [InlineData(6, 30)] [InlineData(500, 30)]
    public void Backoff_doubles_from_2s_and_settles_at_30s(int attempt, int seconds) => Assert.Equal(TimeSpan.FromSeconds(seconds), ServerWait.Delay(attempt));

    [Fact]
    public void It_never_gives_up_a_server_that_takes_three_minutes_to_start_is_tried_within_30s_of_coming_up()
    {
        // 3 minutes of "not answering" (the reported reboot): the window keeps trying, and no pause is ever longer than 30 s
        double t = 0; int n = 0; while (t < 180) { n++; t += ServerWait.Delay(n).TotalSeconds; }
        Assert.True(n >= 8); Assert.True(t - 180 <= 30);
    }

    [Theory]
    [InlineData("CannotConnect", true)] [InlineData("Timeout", true)] [InlineData("ServerUnreachable", true)] [InlineData("ConnectionReset", true)]
    [InlineData("HostNameNotResolved", true)] [InlineData("Disconnected", true)]
    [InlineData("CertificateIsInvalid", false)] [InlineData("RedirectFailed", false)] [InlineData("OperationCanceled", false)] [InlineData(null, false)]
    public void Only_nobody_answering_waits_other_errors_still_explain(string? status, bool wait) => Assert.Equal(wait, ServerWait.ShouldWait(status));

    [Fact]
    public void Waiting_page_says_what_is_happening_counts_down_and_keeps_try_now_and_open_in_browser()
    {
        var html = ServerWait.Page("http://192.168.1.10:47800/?remote=0", 3, TimeSpan.FromSeconds(8), "BOX<script>");
        Assert.Contains("Waiting for the WavWiz server…", html);
        Assert.Contains("Trying again in 8 s (try 3).", html);
        Assert.Contains("href='http://192.168.1.10:47800/?remote=0'", html);
        Assert.Contains("href='wavwiz-browser:'", html);
        Assert.Contains("WavWiz on BOX&lt;script&gt;", html);   // the server name is encoded
        Assert.DoesNotContain("BOX<script>", html);
    }

    [Fact]
    public void The_window_waits_instead_of_showing_could_not_be_reached_before_the_first_load()
    {
        var root = AppContext.BaseDirectory; while (!File.Exists(Path.Combine(root, "WavWiz.sln"))) root = Path.GetDirectoryName(root)!;
        var f = File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "Forms.cs"));
        Assert.Contains("if (!_loadedOnce) WaitForServer();", f);                                            // the 20 s watch no longer gives up
        Assert.Contains("if (!_loadedOnce && ServerWait.ShouldWait(e.WebErrorStatus.ToString())) { WaitForServer(); return; }", f);
        Assert.Contains("_again.Interval = (int)next.TotalMilliseconds", f);
        Assert.DoesNotContain("WavWiz did not answer in time.", f);
    }
}
