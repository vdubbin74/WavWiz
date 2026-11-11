using WavWiz.Server.Host;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 item 3: the Diagnostics row that tells a Local Service install which music folders it cannot read / write, with the icacls fix.
/// The probe runs on any OS against real folders; the Windows-only part (WindowsIdentity, the service SID grant) needs the PC.</summary>
public class ServiceAccess070Tests
{
    [Fact]
    public void All_readable_and_rip_folder_writable_is_ok()
    {
        var c = ServiceAccess.Check(@"NT AUTHORITY\LOCAL SERVICE", true, new[] { new ServiceAccess.Probe(@"D:\Music", true, true), new ServiceAccess.Probe(@"E:\More", true, null) });
        Assert.Equal("ok", c.Status); Assert.Contains("the WavWiz service (NT AUTHORITY\\LOCAL SERVICE)", c.Detail); Assert.Contains(@"write CD rips to D:\Music", c.Detail); Assert.Null(c.Fix);
        Assert.Equal("ok", ServiceAccess.Check("x", false, Array.Empty<ServiceAccess.Probe>()).Status);
    }

    [Fact]
    public void Unreadable_profile_music_folder_fails_with_the_service_sid_grant()
    {
        var c = ServiceAccess.Check(@"NT AUTHORITY\LOCAL SERVICE", true, new[] { new ServiceAccess.Probe(@"C:\Users\trevo\Music", false, false, "UnauthorizedAccessException"), new ServiceAccess.Probe(@"D:\Music", true, null) });
        Assert.Equal("fail", c.Status);
        Assert.Contains(@"Cannot read: C:\Users\trevo\Music", c.Detail);
        Assert.Contains(@"icacls ""C:\Users\trevo\Music"" /grant ""NT SERVICE\WavWizServer:(OI)(CI)RX"" /T", c.Fix);
        Assert.DoesNotContain("(OI)(CI)M", c.Fix);            // unreadable: the read grant first; write only for readable folders
    }

    [Fact]
    public void Readable_but_not_writable_rip_folder_warns_with_modify_grant()
    {
        var c = ServiceAccess.Check(@"NT AUTHORITY\LOCAL SERVICE", true, new[] { new ServiceAccess.Probe(@"D:\Music", true, false) });
        Assert.Equal("warn", c.Status); Assert.Contains(@"Cannot write CD rips to: D:\Music", c.Detail);
        Assert.Contains(@"icacls ""D:\Music"" /grant ""NT SERVICE\WavWizServer:(OI)(CI)M""", c.Fix);
    }

    [Fact]
    public void Probe_reads_and_writes_real_folders_and_skips_unc()
    {
        using var t = new TempDir(); var a = Directory.CreateDirectory(Path.Combine(t.Path, "a")).FullName; var missing = Path.Combine(t.Path, "missing");
        var p = ServiceAccess.ProbeAll(new[] { a, missing, @"\\nas\music" });
        Assert.Equal(2, p.Count);
        Assert.True(p[0].Read); Assert.True(p[0].Write); Assert.Empty(Directory.GetFiles(a));      // the write test leaves nothing behind
        Assert.False(p[1].Read); Assert.Null(p[1].Write);
        if (!OperatingSystem.IsWindows() && Environment.UserName != "root")
        {
            var ro = Directory.CreateDirectory(Path.Combine(t.Path, "ro")).FullName; File.SetUnixFileMode(ro, UnixFileMode.UserRead | UnixFileMode.UserExecute);
            try { var q = ServiceAccess.ProbeAll(new[] { ro }); Assert.True(q[0].Read); Assert.False(q[0].Write); }
            finally { File.SetUnixFileMode(ro, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); }
        }
    }
}
