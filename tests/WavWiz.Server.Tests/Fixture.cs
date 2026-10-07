using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using WavWiz.Core.Clock;
using WavWiz.PlayerCore;
using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>A real server on loopback with ephemeral ports and a temp data folder.</summary>
public sealed class ServerFixture : IAsyncDisposable
{
    public TempDir Dir = new(); public WavWizServer Server = null!; public HttpClient Http = null!; public string Base = "";
    public ServerConfig Cfg = null!;
    public static async Task<ServerFixture> StartAsync(Action<ServerConfig>? tweak = null)
    {
        var f = new ServerFixture();
        f.Cfg = new ServerConfig { DataDir = f.Dir.Path, BindAddress = "127.0.0.1", HttpPort = 0, HttpsPort = 0, AudioPort = 0, ClockPort = 0, FfmpegPath = TestMedia.Ffmpeg, LeadMs = 300, WebRoot = Path.Combine(f.Dir.Path, "web") };
        Directory.CreateDirectory(f.Cfg.WebRoot); File.WriteAllText(Path.Combine(f.Cfg.WebRoot, "index.html"), "<html>ok</html>");
        f.Cfg.Discovery = false;      // tests that need discovery switch it on with a free port
        tweak?.Invoke(f.Cfg);
        f.Server = await WavWizServer.StartAsync(f.Cfg);
        f.Base = f.Server.HttpUrl; f.Http = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(f.Base), Timeout = TimeSpan.FromSeconds(30) };
        return f;
    }

    public async Task<string> SetupAdmin(string password = "correct horse battery")
    {
        var r = await Http.PostAsJsonAsync("/api/v1/auth/setup", new { password }); r.EnsureSuccessStatusCode();
        var cookie = r.Headers.GetValues("Set-Cookie").First().Split(';')[0].Split('=', 2)[1];
        return cookie;
    }

    public HttpClient As(string token)
    {
        var c = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(Base), Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token); return c;
    }

    public string Token(Role role, string name = "t") => Server.S.Auth.CreateToken(name, role);
    public async ValueTask DisposeAsync() { Http.Dispose(); await Server.DisposeAsync(); Dir.Dispose(); }
}

public static class HttpExt
{
    public static Task<HttpResponseMessage> PostAsJsonAsync(this HttpClient c, string url, object body)
        => c.PostAsync(url, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
    public static Task<HttpResponseMessage> PutAsJsonAsync(this HttpClient c, string url, object body)
        => c.PutAsync(url, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
    public static Task<HttpResponseMessage> PatchAsJsonAsync(this HttpClient c, string url, object body)
        => c.SendAsync(new HttpRequestMessage(HttpMethod.Patch, url) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") });
    public static async Task<JsonElement> Json(this HttpResponseMessage r) { var t = await r.Content.ReadAsStringAsync(); return JsonDocument.Parse(t).RootElement.Clone(); }
    public static async Task<JsonElement> GetJson(this HttpClient c, string url) { var r = await c.GetAsync(url); r.EnsureSuccessStatusCode(); return await r.Json(); }
}
