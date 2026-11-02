using System.Security.Cryptography;
namespace WavWiz.Server.Host;

/// <summary>F166: first-run on a headless (Linux/Docker) server, which has no "browser on this PC".
/// While no admin password exists: (1) a one-time claim code is written to {data}/claim.txt (mode 0600) and logged once;
/// (2) for 15 minutes after start any home-network browser may finish setup without the code (banner shows the countdown).
/// After the window the code is required. The file is deleted once setup is done.</summary>
public sealed class HeadlessClaim
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private readonly string _path; private readonly DateTime _openedUtc; private readonly Func<DateTime> _now;
    public string? Code { get; private set; }
    public bool Enabled { get; }
    public string FilePath => _path;

    public HeadlessClaim(string dataDir, bool enabled, bool setupRequired, Action<string>? log = null, Func<DateTime>? now = null)
    {
        _now = now ?? (() => DateTime.UtcNow); _openedUtc = _now(); _path = Path.Combine(dataDir, "claim.txt");
        Enabled = enabled && setupRequired;
        if (!Enabled) { TryDelete(); return; }
        try { if (File.Exists(_path)) { var c = File.ReadAllText(_path).Trim(); if (c.Length >= 8 && c.Length <= 16) Code = c; } } catch { }
        Code ??= NewCode();
        try
        {
            using var fs = PrivateFile.Create(_path);
            using var w = new StreamWriter(fs); w.Write(Code + "\n");
        }
        catch (Exception e) { log?.Invoke("claim.txt could not be written: " + e.Message); }
        var line = $"WavWiz first-run: open http://<this-server>:<port>/ from a home-network browser within 15 minutes, or use claim code {Code} (also in {_path}).";
        log?.Invoke(line); Console.WriteLine(line);
    }

    private static string NewCode()
    {
        const string A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";       // no 0/O/1/I
        var b = RandomNumberGenerator.GetBytes(10); var c = new char[10];
        for (int i = 0; i < c.Length; i++) c[i] = A[b[i] % A.Length];
        return new string(c);
    }

    public int WindowSecondsLeft => Enabled ? Math.Max(0, (int)(Window - (_now() - _openedUtc)).TotalSeconds) : 0;
    public bool WindowOpen => WindowSecondsLeft > 0;

    /// <summary>True when this request may run first-time setup (caller already checked LAN source + SetupRequired).</summary>
    public bool Allows(string? code)
    {
        if (!Enabled) return false;
        if (WindowOpen) return true;
        if (Code == null || string.IsNullOrWhiteSpace(code)) return false;
        var a = System.Text.Encoding.UTF8.GetBytes(code.Trim().ToUpperInvariant().Replace("-", "").Replace(" ", "")); var b = System.Text.Encoding.UTF8.GetBytes(Code);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    public void Done() => TryDelete();
    private void TryDelete() { try { if (File.Exists(_path)) File.Delete(_path); } catch { } }
}
