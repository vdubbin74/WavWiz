using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.RegularExpressions;

namespace WavWiz.Server.Features;

/// <summary>Find and kill orphaned CD-rip helper processes (bundled ffmpeg / wavwiz-cdda under the Server ffmpeg folder).
/// Never touches executables outside that folder, and never kills live playback/AirPlay ffmpeg (pipe/f32le/adts).</summary>
public static class RipProcessCleanup
{
    public static readonly string[] ToolProcessNames = { "ffmpeg", "wavwiz-cdda" };

    public static string? ToolsDirectory(string? ffmpegPath)
    {
        if (string.IsNullOrWhiteSpace(ffmpegPath)) return null;
        try
        {
            var full = Path.GetFullPath(ffmpegPath);
            var dir = Path.GetDirectoryName(full);
            return string.IsNullOrEmpty(dir) ? null : dir;
        }
        catch { return null; }
    }

    public static bool IsUnderToolsDir(string? exePath, string? toolsDir)
    {
        if (string.IsNullOrWhiteSpace(exePath) || string.IsNullOrWhiteSpace(toolsDir)) return false;
        try
        {
            var full = Path.GetFullPath(exePath);
            var root = Path.GetFullPath(toolsDir)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            return full.StartsWith(root, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
        }
        catch { return false; }
    }

    public static bool IsRipToolProcessName(string? name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        var n = name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;
        return n.Equals("ffmpeg", StringComparison.OrdinalIgnoreCase)
            || n.Equals("wavwiz-cdda", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsWavWizProcessName(string? name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        return name.Contains("wavwiz", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>CD-rip encodes write under a wavwiz-rip-* temp dir or encode a .wav with a file codec.
    /// Playback decode (f32le/pipe) and AirPlay AAC (adts/pipe) must not match.</summary>
    public static bool LooksLikeRipFfmpeg(string? commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return false;
        if (commandLine.Contains("wavwiz-rip-", StringComparison.OrdinalIgnoreCase)) return true;
        if (commandLine.Contains("pipe:", StringComparison.OrdinalIgnoreCase)) return false;
        if (commandLine.Contains("f32le", StringComparison.OrdinalIgnoreCase)) return false;
        if (commandLine.Contains("adts", StringComparison.OrdinalIgnoreCase)) return false;
        bool wavIn = Regex.IsMatch(commandLine, @"-i\s+[""']?[^\s""']+\.wav\b", RegexOptions.IgnoreCase);
        if (!wavIn) return false;
        return commandLine.Contains("libmp3lame", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("-c:a flac", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("-c:a aac", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("-c:a pcm_s16le", StringComparison.OrdinalIgnoreCase)
            || commandLine.Contains("attached_pic", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Decide whether an observed process is a safe rip orphan to kill.</summary>
    public static bool ShouldReap(
        string processName,
        string? exePath,
        string? toolsDir,
        int parentPid,
        int ourPid,
        bool parentAlive,
        string? parentName,
        string? commandLine)
    {
        if (!IsRipToolProcessName(processName)) return false;
        if (!IsUnderToolsDir(exePath, toolsDir)) return false;

        bool parentIsUs = parentPid > 0 && parentPid == ourPid;
        bool noLiveWavWizParent = !parentAlive || !IsWavWizProcessName(parentName);
        if (!parentIsUs && !noLiveWavWizParent) return false;

        var bare = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? processName[..^4] : processName;
        if (bare.Equals("wavwiz-cdda", StringComparison.OrdinalIgnoreCase)) return true;

        // ffmpeg: true orphans (dead parent) are always safe under the tools dir.
        if (!parentAlive) return true;
        // Live child of this server (or of a non-WavWiz host): only kill rip encodes, never playback/AirPlay.
        return LooksLikeRipFfmpeg(commandLine);
    }

    public static bool TryKillPid(int pid, out string? error)
    {
        error = null;
        if (pid <= 0) { error = "invalid pid"; return false; }
        try
        {
            using var p = Process.GetProcessById(pid);
            try { if (p.HasExited) return false; } catch { return false; }
            try { p.Kill(entireProcessTree: true); }
            catch (Exception ex) { error = ex.Message; return false; }
            return true;
        }
        catch (ArgumentException) { return false; }
        catch (Exception ex) { error = ex.Message; return false; }
    }

    public static int? TryGetParentPid(int pid)
    {
        if (pid <= 0) return null;
        try
        {
            if (OperatingSystem.IsWindows()) return TryGetParentPidWindows(pid);
            return TryGetParentPidLinux(pid);
        }
        catch { return null; }
    }

    public static string? TryGetCommandLine(int pid)
    {
        if (pid <= 0) return null;
        try
        {
            if (OperatingSystem.IsWindows()) return TryGetCommandLineWindows(pid);
            return TryGetCommandLineLinux(pid);
        }
        catch { return null; }
    }

    public static string? TryGetMainModulePath(Process p)
    {
        try { return p.MainModule?.FileName; }
        catch { return null; }
    }

    public static bool TryIsProcessAlive(int pid)
    {
        if (pid <= 0) return false;
        try
        {
            using var p = Process.GetProcessById(pid);
            try { return !p.HasExited; } catch { return false; }
        }
        catch { return false; }
    }

    public static string? TryGetProcessName(int pid)
    {
        if (pid <= 0) return null;
        try
        {
            using var p = Process.GetProcessById(pid);
            try { return p.ProcessName; } catch { return null; }
        }
        catch { return null; }
    }

    /// <summary>Enumerate candidate rip-tool processes that ShouldReap under the tools directory.</summary>
    public static List<(int Pid, string Name, string? Path)> FindOrphans(string? toolsDir, int ourPid)
    {
        var found = new List<(int, string, string?)>();
        if (string.IsNullOrEmpty(toolsDir)) return found;
        foreach (var name in ToolProcessNames)
        {
            Process[] list;
            try { list = Process.GetProcessesByName(name); }
            catch { continue; }
            foreach (var p in list)
            {
                try
                {
                    using (p)
                    {
                        int pid;
                        try { pid = p.Id; if (p.HasExited) continue; }
                        catch { continue; }
                        var path = TryGetMainModulePath(p);
                        // Fallback: if MainModule is denied, still allow path match when the exe lives next to our tools dir
                        // by resolving via /proc or ignoring and relying on name+parent for wavwiz-cdda only.
                        var parentPid = TryGetParentPid(pid) ?? 0;
                        var parentAlive = parentPid > 0 && TryIsProcessAlive(parentPid);
                        var parentName = parentAlive ? TryGetProcessName(parentPid) : null;
                        string? cmd = null;
                        if (!name.Equals("wavwiz-cdda", StringComparison.OrdinalIgnoreCase))
                            cmd = TryGetCommandLine(pid);
                        // If path is unknown, only reap wavwiz-cdda (rip-only binary) when parent rules match.
                        if (path == null)
                        {
                            if (!name.Equals("wavwiz-cdda", StringComparison.OrdinalIgnoreCase)) continue;
                            // Without a path we refuse — never kill outside the tools folder.
                            continue;
                        }
                        if (ShouldReap(name, path, toolsDir, parentPid, ourPid, parentAlive, parentName, cmd))
                            found.Add((pid, name, path));
                    }
                }
                catch { /* access denied / raced exit */ }
            }
        }
        return found;
    }

    public static int ReapOrphans(string? toolsDir, int ourPid, Action<string>? log, string reason, ISet<int>? keepPids = null)
    {
        var orphans = FindOrphans(toolsDir, ourPid);
        int killed = 0;
        foreach (var (pid, name, path) in orphans)
        {
            if (keepPids != null && keepPids.Contains(pid)) continue;
            if (TryKillPid(pid, out var err))
            {
                killed++;
                log?.Invoke($"rip: killed orphan {name} pid={pid} reason={reason}" + (path != null ? $" path={path}" : ""));
            }
            else if (err != null)
                log?.Invoke($"rip: could not kill orphan {name} pid={pid} reason={reason}: {err}");
        }
        return killed;
    }

    [SupportedOSPlatform("windows")]
    static int? TryGetParentPidWindows(int pid)
    {
        var snap = CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0);
        if (snap == IntPtr.Zero || snap == (IntPtr)(-1)) return null;
        try
        {
            var pe = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
            if (!Process32First(snap, ref pe)) return null;
            do
            {
                if ((int)pe.th32ProcessID == pid) return (int)pe.th32ParentProcessID;
            } while (Process32Next(snap, ref pe));
        }
        finally { CloseHandle(snap); }
        return null;
    }

    [SupportedOSPlatform("windows")]
    static string? TryGetCommandLineWindows(int pid)
    {
        // ProcessCommandLineInformation (60) — Windows 10+.
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            int size = 0;
            NtQueryInformationProcess(h, 60, IntPtr.Zero, 0, ref size);
            if (size <= 0 || size > 1024 * 1024) return null;
            var buf = Marshal.AllocHGlobal(size);
            try
            {
                int st = NtQueryInformationProcess(h, 60, buf, size, ref size);
                if (st < 0) return null;
                var us = Marshal.PtrToStructure<UNICODE_STRING>(buf);
                if (us.Buffer == IntPtr.Zero || us.Length == 0) return null;
                return Marshal.PtrToStringUni(us.Buffer, us.Length / 2);
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        catch { return null; }
        finally { CloseHandle(h); }
    }

    static int? TryGetParentPidLinux(int pid)
    {
        try
        {
            var text = File.ReadAllText($"/proc/{pid}/stat");
            var close = text.LastIndexOf(')');
            if (close < 0 || close + 2 >= text.Length) return null;
            var rest = text[(close + 2)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            // after ") ": state, ppid, ...
            if (rest.Length < 2) return null;
            return int.TryParse(rest[1], out var pp) ? pp : null;
        }
        catch { return null; }
    }

    static string? TryGetCommandLineLinux(int pid)
    {
        try
        {
            var raw = File.ReadAllBytes($"/proc/{pid}/cmdline");
            if (raw.Length == 0) return null;
            for (int i = 0; i < raw.Length; i++) if (raw[i] == 0) raw[i] = (byte)' ';
            return Encoding.UTF8.GetString(raw).Trim();
        }
        catch { return null; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool Process32First(IntPtr snap, ref PROCESSENTRY32 pe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool Process32Next(IntPtr snap, ref PROCESSENTRY32 pe);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr h);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int infoClass, IntPtr info, int size, ref int returnLength);
}
