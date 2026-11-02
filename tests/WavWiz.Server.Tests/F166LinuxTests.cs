using System.Text;
using WavWiz.Server.Host;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>F166: Linux/Docker edges: AES key-file secret store, headless claim (claim.txt + 15-min LAN window), env overrides.</summary>
public class F166LinuxTests
{
    private static string TempDir() { var d = Path.Combine(Path.GetTempPath(), "ww-f166-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }

    [Fact]
    public void AesFileProtector_RoundTrips_AndPersistsKey_0600()
    {
        var d = TempDir();
        var blob = new AesFileProtector(d).Protect(Encoding.UTF8.GetBytes("s3cret"));
        Assert.Equal("s3cret", Encoding.UTF8.GetString(new AesFileProtector(d).Unprotect(blob)));      // a new instance reads the same key file
        var key = Path.Combine(d, "secret.key"); Assert.Equal(32, new FileInfo(key).Length);
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(key));
        Assert.ThrowsAny<System.Security.Cryptography.CryptographicException>(() => new AesFileProtector(TempDir()).Unprotect(blob));   // other key
    }

    [Fact]
    public void Claim_WindowOpen_ThenCodeRequired_AndFileRemovedWhenDone()
    {
        var d = TempDir(); var now = DateTime.UtcNow;
        var c = new HeadlessClaim(d, enabled: true, setupRequired: true, now: () => now);
        var file = Path.Combine(d, "claim.txt"); Assert.True(File.Exists(file));
        Assert.Equal(c.Code, File.ReadAllText(file).Trim());
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(file));
        Assert.True(c.WindowOpen); Assert.True(c.Allows(null));
        now += TimeSpan.FromMinutes(16);
        Assert.False(c.WindowOpen); Assert.False(c.Allows(null)); Assert.False(c.Allows("WRONGCODE1"));
        Assert.True(c.Allows(c.Code!.ToLowerInvariant()));
        c.Done(); Assert.False(File.Exists(file));
    }

    [Fact]
    public void Claim_Disabled_WhenNotHeadless_OrAlreadySetUp()
    {
        var d = TempDir(); File.WriteAllText(Path.Combine(d, "claim.txt"), "OLDCODE123");
        var c = new HeadlessClaim(d, enabled: true, setupRequired: false);
        Assert.False(c.Enabled); Assert.False(c.Allows("OLDCODE123")); Assert.False(File.Exists(Path.Combine(d, "claim.txt")));
        Assert.False(new HeadlessClaim(TempDir(), enabled: false, setupRequired: true).Allows(null));
    }

    [Fact]
    public void Config_EnvOverrides_ForSideBySide()
    {
        var d = TempDir();
        var keys = new[] { "WAVWIZ_DATA", "WAVWIZ_HTTP_PORT", "WAVWIZ_DISCOVERY", "WAVWIZ_ALLOW_ALL_INTERFACES" };
        var old = keys.ToDictionary(k => k, Environment.GetEnvironmentVariable);
        var oldDir = Environment.GetEnvironmentVariable("WAVWIZ_DATA_DIR");
        try
        {
            Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", null);
            Environment.SetEnvironmentVariable("WAVWIZ_DATA", d); Environment.SetEnvironmentVariable("WAVWIZ_HTTP_PORT", "48800");
            Environment.SetEnvironmentVariable("WAVWIZ_DISCOVERY", "0"); Environment.SetEnvironmentVariable("WAVWIZ_ALLOW_ALL_INTERFACES", "1");
            var cfg = ServerConfig.Load();
            Assert.Equal(d, cfg.DataDir); Assert.Equal(48800, cfg.HttpPort); Assert.False(cfg.Discovery); Assert.True(cfg.AllowAllInterfaces);
        }
        finally { foreach (var kv in old) Environment.SetEnvironmentVariable(kv.Key, kv.Value); Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", oldDir); }
    }
}
