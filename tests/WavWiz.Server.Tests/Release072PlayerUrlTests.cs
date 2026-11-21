using WavWiz.PlayerCore;
using Xunit;

namespace WavWiz.Server.Tests;

/// <summary>0.7.2 t2166u / t2167u: the desktop Player's microphone origin and which pages its window may show.</summary>
public class Release072PlayerUrlTests
{
    private const string App = "http://192.168.1.169:47800/";

    [Fact]
    public void Secure_origin_argument_names_exactly_the_http_server_origin()
    {
        Assert.Equal("--unsafely-treat-insecure-origin-as-secure=http://192.168.1.169:47800", UiUrl.SecureOriginArgs(App + "?remote=0"));
        Assert.Null(UiUrl.SecureOriginArgs("https://pc:47443/"));
        Assert.Null(UiUrl.SecureOriginArgs(""));
    }

    [Fact]
    public void Microphone_is_allowed_for_the_app_origin_only()
    {
        Assert.True(UiUrl.MicAllowed(App, "http://192.168.1.169:47800/#calibrate"));
        Assert.False(UiUrl.MicAllowed(App, "http://192.168.1.169:47443/"));
        Assert.False(UiUrl.MicAllowed(App, "https://192.168.1.169:47800/"));
        Assert.False(UiUrl.MicAllowed(App, "http://evil.example:47800/"));
        Assert.False(UiUrl.MicAllowed(App, null));
    }

    [Fact]
    public void Tls_pages_and_the_https_port_leave_the_window_app_pages_stay()
    {
        Assert.True(UiUrl.IsAppPage(App, "http://192.168.1.169:47800/?remote=0#calibrate"));
        Assert.True(UiUrl.IsAppPage(App, "http://192.168.1.169:47800/phone/mic?code=1"));
        Assert.True(UiUrl.IsAppPage(App, "about:blank"));
        Assert.False(UiUrl.IsAppPage(App, "http://192.168.1.169:47800/tls/check"));
        Assert.False(UiUrl.IsAppPage(App, "http://192.168.1.169:47800/tls/setup"));
        Assert.False(UiUrl.IsAppPage(App, "https://192.168.1.169:47443/"));
        Assert.False(UiUrl.IsAppPage(App, "https://example.com/"));
    }
}
