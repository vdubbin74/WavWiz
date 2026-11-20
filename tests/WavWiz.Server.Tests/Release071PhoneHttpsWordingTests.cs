using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 t2042u: hints said "Settings > Phone & HTTPS", a page that does not exist. The card is in Settings > Devices (Calibration).</summary>
public class Release071PhoneHttpsWordingTests
{
    private static IEnumerable<string> Strings(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => new[] { e.GetString()! },
        JsonValueKind.Array => e.EnumerateArray().SelectMany(Strings),
        JsonValueKind.Object => e.EnumerateObject().SelectMany(p => Strings(p.Value)),
        _ => Array.Empty<string>(),
    };

    [Fact]
    public async Task Status_and_diagnostics_point_to_Settings_Devices_Phone_and_HTTPS()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var all = Strings(await admin.GetJson("/api/v1/status")).Concat(Strings(await admin.GetJson("/api/v1/diagnostics"))).ToList();
        Assert.DoesNotContain(all, x => x.Contains("Settings > Phone & HTTPS"));
        if (!f.Server.S.Ca.Enabled) Assert.Contains(all, x => x.Contains("Settings > Devices > Phone & HTTPS"));
        var src = string.Join("\n", new[] { "DiagnosticsApi.cs", "SystemApi.cs" }.Select(n => File.ReadAllText(Path.Combine(RepoRoot(), "src", "WavWiz.Server", "Api", n))));
        Assert.DoesNotContain("Settings > Phone & HTTPS", src);
        Assert.Equal(5, System.Text.RegularExpressions.Regex.Matches(src, "Settings > Devices > Phone & HTTPS").Count);
    }
    private static string RepoRoot() { var d = new DirectoryInfo(AppContext.BaseDirectory); while (d != null && !Directory.Exists(Path.Combine(d.FullName, "src", "WavWiz.Server"))) d = d.Parent; return d!.FullName; }
}
