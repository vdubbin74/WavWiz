using WavWiz.Server.Api;
namespace WavWiz.Server.Host;

/// <summary>0.7.0 item 3: can the account the server runs as (Local Service on new installs) read every music folder and write where CD rips go
/// (the first music folder)? Shown in Diagnostics as "Service account folder access" with the exact icacls line to fix it. Windows only;
/// the check itself is pure (unit-tested on any OS).</summary>
public static class ServiceAccess
{
    public const string ServiceName = "WavWizServer";
    /// <summary>One folder: Read = listing works; Write = null when the folder does not need it.</summary>
    public sealed record Probe(string Path, bool Read, bool? Write, string? Error = null);

    public static List<Probe> ProbeAll(IReadOnlyList<string> roots)
    {
        var res = new List<Probe>();
        for (int i = 0; i < roots.Count; i++)
        {
            var p = roots[i]; bool read; string? err = null; bool? write = null;
            if (p.StartsWith(@"\\", StringComparison.Ordinal)) continue;           // network shares: their own check (library / NAS logins)
            try { _ = Directory.EnumerateFileSystemEntries(p).Take(1).ToList(); read = true; } catch (Exception e) { read = false; err = e.GetType().Name; }
            if (i == 0)                                                             // CD rips are written into the first music folder
            {
                try { var t = Path.Combine(p, ".wavwiz-write-test-" + Guid.NewGuid().ToString("N")[..8]); File.WriteAllText(t, "x"); File.Delete(t); write = true; }
                catch (Exception e) { write = false; err ??= e.GetType().Name; }
            }
            res.Add(new(p, read, write, err));
        }
        return res;
    }

    /// <summary>The Diagnostics row. <paramref name="identity"/> = who the server runs as; <paramref name="asService"/> = started by the service manager.</summary>
    public static DiagCheck Check(string identity, bool asService, IReadOnlyList<Probe> probes)
    {
        string who = asService ? $"the WavWiz service ({identity})" : $"this session ({identity})";
        if (probes.Count == 0) return new("service-access", "Service account folder access", "ok", $"Runs as {who}. No local music folders to check.", null);
        var noRead = probes.Where(p => !p.Read).ToList(); var noWrite = probes.Where(p => p.Write == false).ToList();
        if (noRead.Count == 0 && noWrite.Count == 0)
            return new("service-access", "Service account folder access", "ok", $"Runs as {who}. It can read all {probes.Count} music folder(s) and write CD rips to {probes[0].Path}.", null);
        var detail = $"Runs as {who}." + (noRead.Count > 0 ? " Cannot read: " + string.Join(", ", noRead.Select(p => p.Path)) + "." : "")
                   + (noWrite.Count > 0 ? " Cannot write CD rips to: " + string.Join(", ", noWrite.Select(p => p.Path)) + "." : "");
        var fix = string.Join("  ", noRead.Select(p => $"icacls \"{p.Path}\" /grant \"NT SERVICE\\{ServiceName}:(OI)(CI)RX\" /T")
                  .Concat(noWrite.Where(p => p.Read).Select(p => $"icacls \"{p.Path}\" /grant \"NT SERVICE\\{ServiceName}:(OI)(CI)M\"")))
                  + "  (run in an administrator Command Prompt, then Rescan; folders inside your user profile such as Music usually need this when the service runs as Local Service.)";
        return new("service-access", "Service account folder access", noRead.Count > 0 ? "fail" : "warn", detail, fix);
    }
}
