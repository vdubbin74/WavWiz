namespace WavWiz.Server.Host;

/// <summary>F166: create a file only the owner can read (0600 on Linux; normal ACLs on Windows).</summary>
public static class PrivateFile
{
    public static FileStream Create(string path)
    {
        if (OperatingSystem.IsWindows()) return new FileStream(path, FileMode.Create, FileAccess.Write);
        if (File.Exists(path)) File.Delete(path);
        return new FileStream(path, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite });
    }
}
