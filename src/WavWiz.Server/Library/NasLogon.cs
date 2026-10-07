using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
namespace WavWiz.Server.Library;

/// <summary>Encrypts secrets at rest. Windows: DPAPI (bound to the WavWiz service account on this PC). Tests inject a fake.</summary>
public interface ISecretProtector
{
    bool Available { get; }
    byte[] Protect(byte[] plain);
    byte[] Unprotect(byte[] blob);
}

/// <summary>Windows DPAPI (CryptProtectData), user scope of the service account plus a WavWiz-specific entropy. The password never touches disk in plain text.</summary>
public sealed class DpapiProtector : ISecretProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("WavWiz.NAS.v1:7c1e");
    public bool Available => OperatingSystem.IsWindows();

    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Size; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref Blob input, string? desc, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref Blob input, IntPtr desc, ref Blob entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr h);
    private const int UiForbidden = 0x1;

    public byte[] Protect(byte[] plain) => Run(plain, true);
    public byte[] Unprotect(byte[] blob) => Run(blob, false);

    private static byte[] Run(byte[] data, bool protect)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Saved network-share logins need Windows.");
        var hIn = GCHandle.Alloc(data, GCHandleType.Pinned); var hEnt = GCHandle.Alloc(Entropy, GCHandleType.Pinned);
        try
        {
            var input = new Blob { Size = data.Length, Data = hIn.AddrOfPinnedObject() }; var ent = new Blob { Size = Entropy.Length, Data = hEnt.AddrOfPinnedObject() };
            bool ok = protect ? CryptProtectData(ref input, "WavWiz NAS login", ref ent, IntPtr.Zero, IntPtr.Zero, UiForbidden, out var output)
                              : CryptUnprotectData(ref input, IntPtr.Zero, ref ent, IntPtr.Zero, IntPtr.Zero, UiForbidden, out output);
            if (!ok) throw new InvalidOperationException("Windows could not " + (protect ? "encrypt" : "decrypt") + " the saved login (error " + Marshal.GetLastWin32Error() + ").");
            try { var r = new byte[output.Size]; Marshal.Copy(output.Data, r, 0, output.Size); return r; } finally { LocalFree(output.Data); }
        }
        finally { hIn.Free(); hEnt.Free(); }
    }
}

/// <summary>Connects / disconnects a UNC share for the current process' logon session (the service account). Tests inject a fake.</summary>
public interface IShareConnector
{
    /// <returns>null when connected, else a Windows error code.</returns>
    int? Connect(string share, string user, string password);
    void Disconnect(string share);
}

public sealed class WNetConnector : IShareConnector
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NetResource { public int Scope, Type, DisplayType, Usage; public string? LocalName, RemoteName, Comment, Provider; }
    [DllImport("mpr.dll", CharSet = CharSet.Unicode)] private static extern int WNetAddConnection2(ref NetResource nr, string? password, string? user, int flags);
    [DllImport("mpr.dll", CharSet = CharSet.Unicode)] private static extern int WNetCancelConnection2(string name, int flags, bool force);

    public int? Connect(string share, string user, string password)
    {
        if (!OperatingSystem.IsWindows()) return 50;      // ERROR_NOT_SUPPORTED
        var nr = new NetResource { Type = 1 /* RESOURCETYPE_DISK */, RemoteName = share };
        int r = WNetAddConnection2(ref nr, password, user, 0);
        if (r == 1219) { WNetCancelConnection2(share, 0, true); r = WNetAddConnection2(ref nr, password, user, 0); }   // an old connection with other credentials: replace it
        return r is 0 or 85 ? null : r;
    }
    public void Disconnect(string share) { if (OperatingSystem.IsWindows()) try { WNetCancelConnection2(share, 0, true); } catch { } }
}

/// <summary>
/// 0.1.3 NAS logon: password-protected network shares (\\NAS\Music). The admin saves user + password once in Settings > Library; WavWiz stores them
/// encrypted with Windows DPAPI (never plain text, never returned by the API) and connects the share for the service account before adding the
/// folder, before every scan, and every few minutes so the library keeps playing after the NAS reboots.
/// </summary>
public sealed class NasLogon
{
    public const string Key = "admin.nas.credentials";       // admin.* settings are never listed by GET /settings
    private readonly Db _db; private readonly ISecretProtector _prot; private readonly IShareConnector _conn;
    private readonly Dictionary<string, (DateTime At, string? Error)> _state = new(StringComparer.OrdinalIgnoreCase); private readonly object _l = new();
    public sealed record Saved(string Share, string User, string Secret, DateTimeOffset SavedAt);

    public NasLogon(Db db, ISecretProtector? prot = null, IShareConnector? conn = null) { _db = db; _prot = prot ?? new DpapiProtector(); _conn = conn ?? new WNetConnector(); }
    public bool Available => _prot.Available;

    /// <summary>\\server\share from any UNC path (\\server\share\sub\dir → \\server\share); null if not UNC.</summary>
    public static string? ShareOf(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var p = path.Trim().Replace('/', '\\');
        if (!p.StartsWith(@"\\") || p.StartsWith(@"\\?\") || p.StartsWith(@"\\.\")) return null;
        var parts = p[2..].Split('\\', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $@"\\{parts[0]}\{parts[1]}" : null;
    }

    private List<Saved> Load() { try { return _db.Setting(Key) is string j ? JsonSerializer.Deserialize<List<Saved>>(j) ?? new() : new(); } catch { return new(); } }
    private void Store(List<Saved> l) => _db.SetSetting(Key, JsonSerializer.Serialize(l));

    public List<object> List()
    {
        var l = Load(); lock (_l)
            return l.Select(c => (object)new { share = c.Share, user = c.User, savedAt = c.SavedAt, connected = _state.TryGetValue(c.Share, out var st) && st.Error == null, lastError = _state.TryGetValue(c.Share, out var s2) ? s2.Error : null, checkedAt = _state.TryGetValue(c.Share, out var s3) ? s3.At : (DateTime?)null }).ToList();
    }

    /// <summary>Tries the login first; only a working login is saved. Returns a plain-English error or null.</summary>
    public string? Save(string path, string user, string password)
    {
        var share = ShareOf(path); if (share == null) return @"Enter the share as \\SERVER\Share (for example \\NAS\Music).";
        if (string.IsNullOrWhiteSpace(user)) return "Enter the user name for the share (for a NAS this is often NAS\\username or just username).";
        if (!_prot.Available) return "Saving network-share logins needs Windows (the password is encrypted with Windows DPAPI).";
        var err = Connect(share, user.Trim(), password);
        if (err != null) return err;
        var blob = Convert.ToBase64String(_prot.Protect(Encoding.UTF8.GetBytes(password)));
        var l = Load(); l.RemoveAll(c => c.Share.Equals(share, StringComparison.OrdinalIgnoreCase)); l.Add(new Saved(share, user.Trim(), blob, DateTimeOffset.Now)); Store(l);
        return null;
    }

    public bool Remove(string path)
    {
        var share = ShareOf(path) ?? path; var l = Load(); int n = l.RemoveAll(c => c.Share.Equals(share, StringComparison.OrdinalIgnoreCase));
        if (n > 0) { Store(l); _conn.Disconnect(share); lock (_l) _state.Remove(share); }
        return n > 0;
    }

    private string? Connect(string share, string user, string password)
    {
        int? code; try { code = _conn.Connect(share, user, password); } catch (Exception e) { code = -1; lock (_l) _state[share] = (DateTime.UtcNow, e.Message); return e.Message; }
        var err = code == null ? null : Explain(code.Value, share);
        lock (_l) _state[share] = (DateTime.UtcNow, err);
        return err;
    }

    public static string Explain(int code, string share) => code switch
    {
        86 or 1326 => $"The user name or password for {share} was not accepted.",
        53 or 1231 or 1232 or 64 => $"Could not reach {share.Split('\\', StringSplitOptions.RemoveEmptyEntries)[0]}. Is the NAS on, and is the name right? Try its IP address (\\\\192.168.1.20\\Music).",
        67 => $"The NAS is there but it has no share called \"{share.Split('\\', StringSplitOptions.RemoveEmptyEntries).Last()}\".",
        5 => $"The NAS refused access to {share} for that user.",
        1219 => $"Windows already has a different login open to that NAS. Restart the WavWiz service and try again.",
        1909 => "That account is locked on the NAS.",
        1330 => "That account's password has expired on the NAS.",
        50 => "Saving network-share logins needs Windows.",
        _ => $"Windows could not connect {share} (error {code}).",
    };

    /// <summary>Connect the share a path lives on, if we have a login for it. Rate-limited per share unless <paramref name="force"/>.</summary>
    public string? EnsureFor(string path, bool force = false)
    {
        var share = ShareOf(path); if (share == null) return null;
        var c = Load().FirstOrDefault(x => x.Share.Equals(share, StringComparison.OrdinalIgnoreCase)); if (c == null) return null;
        lock (_l) if (!force && _state.TryGetValue(share, out var st) && DateTime.UtcNow - st.At < TimeSpan.FromSeconds(st.Error == null ? 240 : 30)) return st.Error;
        string pw; try { pw = Encoding.UTF8.GetString(_prot.Unprotect(Convert.FromBase64String(c.Secret))); } catch (Exception e) { lock (_l) _state[share] = (DateTime.UtcNow, e.Message); return "The saved login could not be read on this PC; enter the password again."; }
        return Connect(c.Share, c.User, pw);
    }

    public void EnsureAll(bool force = false) { foreach (var c in Load()) try { EnsureFor(c.Share, force); } catch { } }
}
