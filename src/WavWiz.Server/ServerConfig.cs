using System.Text.Json;
using WavWiz.Core;
namespace WavWiz.Server;

/// <summary>server.json under the data folder (BOM-less UTF-8, written by the installer and the first-run page). Environment variables override for tests.</summary>
public sealed class ServerConfig
{
    public string DataDir { get; set; } = DefaultDataDir();
    public string BindAddress { get; set; } = "127.0.0.1";
    public bool AllowAllInterfaces { get; set; }
    public int HttpPort { get; set; } = WavWizInfo.DefaultHttpPort;
    public int HttpsPort { get; set; } = WavWizInfo.DefaultHttpsPort;
    public int AudioPort { get; set; } = WavWizInfo.DefaultAudioPort;
    public int ClockPort { get; set; } = WavWizInfo.DefaultClockPort;
    public string? FfmpegPath { get; set; }
    public string WebRoot { get; set; } = "";
    /// <summary>Extra source subnets treated as "home LAN" besides RFC 1918 / link-local / loopback (spec 13). Example: "100.64.0.0/10".</summary>
    public List<string> ExtraAllowedSubnets { get; set; } = new();
    public int LeadMs { get; set; } = 600;
    /// <summary>UDP discovery port + mDNS so players find the server without typing an address (0.0.2).</summary>
    public int DiscoveryPort { get; set; } = WavWizInfo.DefaultDiscoveryPort;
    public bool Discovery { get; set; } = true;
    /// <summary>0.1.1: AirPlay speaker "WavWiz – Whole House" (always on unless switched off here) and its RTSP port; Spotify Connect zeroconf port (the add-on itself is an admin setting, off by default).</summary>
    public bool AirPlay { get; set; } = true;
    public int AirPlayPort { get; set; } = 47804;
    public int SpotifyPort { get; set; } = 47805;
    /// <summary>Tests only: behave as if every client were another PC (not serialized). Lets a loopback test exercise the 'other device' paths such as the https redirect and pairing codes.</summary>
    [System.Text.Json.Serialization.JsonIgnore] public bool TestTreatAllClientsAsRemote { get; set; }

    public static string DefaultDataDir() =>
        OperatingSystem.IsWindows() ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WavWiz")
                                     : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WavWiz-server");

    public string ConfigPath => Path.Combine(DataDir, "server.json");
    /// <summary>0.1.2: library DB is wavwiz.db. On first start after upgrade, rename unison.db → wavwiz.db (library + password kept).</summary>
    public string DbPath
    {
        get
        {
            var neu = Path.Combine(DataDir, "wavwiz.db");
            var old = Path.Combine(DataDir, "unison.db");
            try
            {
                if (!File.Exists(neu) && File.Exists(old))
                {
                    File.Move(old, neu);
                    foreach (var s in new[] { "-wal", "-shm" })
                    {
                        var os = old + s; var ns = neu + s;
                        if (File.Exists(os) && !File.Exists(ns)) File.Move(os, ns);
                    }
                }
            }
            catch { /* leave old path if rename fails; Migrate still opens whatever exists */ }
            return File.Exists(neu) || !File.Exists(old) ? neu : old;
        }
    }

    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static ServerConfig Load(string? explicitPath = null)
    {
        var cfg = new ServerConfig();
        var dir = Environment.GetEnvironmentVariable("WAVWIZ_DATA_DIR");
        var path = explicitPath ?? Path.Combine(dir ?? cfg.DataDir, "server.json");
        if (File.Exists(path))
        {
            var text = File.ReadAllText(path).TrimStart('\uFEFF');           // tolerate a BOM written by some editors
            cfg = JsonSerializer.Deserialize<ServerConfig>(text, J) ?? cfg;
            if (string.IsNullOrWhiteSpace(cfg.DataDir) || (dir == null && !Directory.Exists(cfg.DataDir) && explicitPath == null)) cfg.DataDir = Path.GetDirectoryName(path)!;
        }
        if (dir != null) cfg.DataDir = dir;
        if (Environment.GetEnvironmentVariable("WAVWIZ_BIND") is { Length: > 0 } b) cfg.BindAddress = b;
        if (Environment.GetEnvironmentVariable("WAVWIZ_FFMPEG") is { Length: > 0 } f) cfg.FfmpegPath = f;
        Directory.CreateDirectory(cfg.DataDir);
        return cfg;
    }

    public void Save()
    {
        Directory.CreateDirectory(DataDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this, J), new System.Text.UTF8Encoding(false));
    }

    /// <summary>Spec 13: never 0.0.0.0 / :: unless the user explicitly opted in.</summary>
    public void Validate()
    {
        if (BindAddress is "0.0.0.0" or "::" or "[::]" && !AllowAllInterfaces)
            throw new InvalidOperationException("Refusing to listen on all interfaces: set AllowAllInterfaces=true in server.json only if you really want that (spec 13).");
        if (!System.Net.IPAddress.TryParse(BindAddress.Trim('[', ']'), out _)) throw new InvalidOperationException($"BindAddress '{BindAddress}' is not an IP address.");
    }

    public string ResolveFfmpeg()
    {
        if (!string.IsNullOrWhiteSpace(FfmpegPath)) return FfmpegPath;
        var exe = OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";
        var beside = Path.Combine(AppContext.BaseDirectory, "ffmpeg", exe);
        if (File.Exists(beside)) return beside;
        beside = Path.Combine(AppContext.BaseDirectory, exe);
        return File.Exists(beside) ? beside : exe;
    }
}
