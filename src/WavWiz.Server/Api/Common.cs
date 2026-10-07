using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Api;

public sealed record RoleRequirement(Role Need, bool Public = false);

public sealed class Services
{
    public required ServerConfig Cfg; public required Db Db; public required AuthService Auth; public required EventHub Events;
    public required Library.LibraryService Library; public required Playback.Conductor Conductor; public required Net.AudioHost Audio; public required Net.ClockHost Clock;
    public required Zones.ZoneManager Zones; public required Dsp.DspService Dsp; public required Calibration.CalibrationService Cal; public required Tls.LocalCa Ca;
    public DateTime Started = DateTime.UtcNow; public string FfmpegPath = "";
    public volatile bool Scanning; public Library.ScanResult? LastScan; public CancellationTokenSource Stop = new();
    public required Library.ArtService Art;
    public Playback.VizHub Viz = new();
    public string ServerId = ""; public Net.DiscoveryHost? Discovery;
    public Features.SceneService Scenes = null!;
    public Features.ScheduleService Schedules = null!;
    public Features.SpeakerFollowService Speakers = null!;
    public Features.RadioFinderService RadioFinder = null!;
    public Features.TagFixService TagFix = null!;
    public Features.CdRipService CdRip = null!;
    public Receivers.AirPlayReceiver? AirPlay; public Receivers.SpotifyReceiver? Spotify;
    public Library.NasLogon? Nas;      // 0.1.3
    public WavWiz.Core.Discovery.ServerBeacon Beacon() => new(ServerId, ServerName ?? Environment.MachineName, System.Net.IPAddress.TryParse(Cfg.BindAddress, out var ip) && !System.Net.IPAddress.IsLoopback(ip) ? Cfg.BindAddress : "", Cfg.HttpPort, Cfg.HttpsPort, Audio.Port, WavWiz.Core.WavWizInfo.Version);
    public string? ServerName => Db.Setting("server.name") is string s ? JsonSerializer.Deserialize<string>(s) : null;
}

public static class Ext
{
    public static T Req<T>(this T b, Role r) where T : IEndpointConventionBuilder => b.WithMetadata(new RoleRequirement(r));
    public static T Anon<T>(this T b) where T : IEndpointConventionBuilder => b.WithMetadata(new RoleRequirement(Role.None, true));
    public static IResult Bad(string msg, int code = 400) => Results.Json(new { error = msg }, statusCode: code);
    public static AuthInfo? Who(this HttpContext c) => c.Items["auth"] as AuthInfo;
    public static string Client(this HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    public static string? Str(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    public static double? Num(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    public static long? Long(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var l) ? l : null;
    public static List<long>? LongList(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
        ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Number && x.TryGetInt64(out _)).Select(x => x.GetInt64()).ToList() : null;
    public static bool? Bool(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;
    public static JsonElement? Prop(this JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : null;

    public static async Task<JsonElement> Body(this HttpRequest r)
    {
        if (r.ContentLength is 0 or null && !r.Headers.ContainsKey("Transfer-Encoding")) return default;
        try { using var d = await JsonDocument.ParseAsync(r.Body); return d.RootElement.Clone(); } catch { return default; }
    }

    public static void SetSession(this HttpContext c, string token, int days = 30)
        => c.Response.Cookies.Append("unison_session", token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/", Secure = c.Request.IsHttps, MaxAge = TimeSpan.FromDays(days) });
}
