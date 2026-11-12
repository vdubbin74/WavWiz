using System.Text.Json;
using WavWiz.Core;
namespace WavWiz.Server;

/// <summary>server.json under the data folder (BOM-less UTF-8, written by the installer and the first-run page). Environment variables override for tests.</summary>
public sealed class ServerConfig
{
    /// <summary>Tests only: answers Last.fm calls instead of the internet.</summary>
    [System.Text.Json.Serialization.JsonIgnore] public HttpMessageHandler? LastFmHandler { get; set; }
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
    /// <summary>0.2.1 F13: look up missing album covers (Cover Art Archive) and artist photos (MusicBrainz / Wikidata) online, cached on this PC.
    /// The admin setting "library.onlineArt" can switch it off too.</summary>
    public bool OnlineArt { get; set; } = true;
    /// <summary>0.1.1: AirPlay speaker "WavWiz – Everywhere" (always on unless switched off here) and its RTSP port; Spotify Connect zeroconf port (the add-on itself is an admin setting, off by default).</summary>
    public bool AirPlay { get; set; } = true;
    public int AirPlayPort { get; set; } = 47804;
    public int SpotifyPort { get; set; } = 47805;
    /// <summary>0.5.0: AirPlay speakers as outputs. AirPlay 2 speakers are experimental (off by default); buffered AAC uses FfmpegPath, realtime ALAC otherwise.</summary>
    public bool AirPlay2Experimental { get; set; }
    public bool AirPlay2Buffered { get; set; } = true;
    /// <summary>F261: optional remote HTTPS identity, served by exact SNI next to the local-CA leaf. "off" (default), "tailscale" (tailscale cert, needs the CT acknowledgement) or "pfx" (own certificate at RemoteCertPath; its password is DPAPI-protected in tls/remote-pfx.pwd, never here).</summary>
    public string RemoteCertMode { get; set; } = "off";
    /// <summary>F261: exact remote host name (e.g. box.tailnet.ts.net or music.example.com). Tailscale mode may fill it from Status.CertDomains when there is exactly one.</summary>
    public string? RemoteHost { get; set; }
    /// <summary>F261: path of the own PFX (pfx mode).</summary>
    public string? RemoteCertPath { get; set; }
    /// <summary>F261: when the admin acknowledged that a Tailscale certificate publishes the host name in public Certificate Transparency logs (ISO-8601). Empty = not acknowledged; tailscale mode stays inactive.</summary>
    public string? RemoteCertCtAcknowledgedAt { get; set; }
    /// <summary>Tests only: behave as if every client were another PC (not serialized). Lets a loopback test exercise the 'other device' paths such as the https redirect and pairing codes.</summary>
    [System.Text.Json.Serialization.JsonIgnore] public bool TestTreatAllClientsAsRemote { get; set; }

    /// <summary>F166: no "this PC" browser (Linux/Docker). First-run uses the claim code / 15-min LAN window. WAVWIZ_HEADLESS=0/1 overrides; default = not Windows.</summary>
    [System.Text.Json.Serialization.JsonIgnore] public bool Headless => Environment.GetEnvironmentVariable("WAVWIZ_HEADLESS")?.Trim() switch { "1" or "true" => true, "0" or "false" => false, _ => !OperatingSystem.IsWindows() };

    public static string DefaultDataDir() =>
        OperatingSystem.IsWindows() ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WavWiz")
                                     : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WavWiz-server");

    public string ConfigPath => Path.Combine(DataDir, "server.json");
    /// <summary>F261-A: the server.json this config was read from (an explicit path may differ from DataDir).</summary>
    [System.Text.Json.Serialization.JsonIgnore] public string? LoadedFrom { get; set; }
    public string DbPath => Path.Combine(DataDir, "wavwiz.db");

    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static ServerConfig Load(string? explicitPath = null)
    {
        var cfg = new ServerConfig();
        var dir = Environment.GetEnvironmentVariable("WAVWIZ_DATA_DIR") is { Length: > 0 } d0 ? d0 : Environment.GetEnvironmentVariable("WAVWIZ_DATA") is { Length: > 0 } d1 ? d1 : null;     // F166: WAVWIZ_DATA alias (Docker: /data)
        var path = explicitPath ?? Path.Combine(dir ?? cfg.DataDir, "server.json");
        if (File.Exists(path))
        {
            var text = File.ReadAllText(path).TrimStart('\uFEFF');           // tolerate a BOM written by some editors
            cfg = JsonSerializer.Deserialize<ServerConfig>(text, J) ?? cfg;
            cfg.LoadedFrom = path;
            if (string.IsNullOrWhiteSpace(cfg.DataDir) || (dir == null && !Directory.Exists(cfg.DataDir) && explicitPath == null)) cfg.DataDir = Path.GetDirectoryName(path)!;
        }
        if (dir != null) cfg.DataDir = dir;
        if (Environment.GetEnvironmentVariable("WAVWIZ_BIND") is { Length: > 0 } b) cfg.BindAddress = b;
        if (Environment.GetEnvironmentVariable("WAVWIZ_FFMPEG") is { Length: > 0 } f) cfg.FfmpegPath = f;
        // F166: Linux/Docker overrides (side-by-side tests, bridge mode). Unset = server.json / defaults, so Windows is unchanged.
        static int? Int(string n) => int.TryParse(Environment.GetEnvironmentVariable(n), out var v) && v is >= 0 and <= 65535 ? v : null;
        static bool? Flag(string n) => Environment.GetEnvironmentVariable(n)?.Trim().ToLowerInvariant() switch { "1" or "true" or "yes" => true, "0" or "false" or "no" => false, _ => null };
        if (Int("WAVWIZ_HTTP_PORT") is int hp) cfg.HttpPort = hp;
        if (Int("WAVWIZ_HTTPS_PORT") is int hsp) cfg.HttpsPort = hsp;
        if (Int("WAVWIZ_AUDIO_PORT") is int ap) cfg.AudioPort = ap;
        if (Int("WAVWIZ_CLOCK_PORT") is int cp) cfg.ClockPort = cp;
        if (Int("WAVWIZ_DISCOVERY_PORT") is int dp) cfg.DiscoveryPort = dp;
        if (Int("WAVWIZ_AIRPLAY_PORT") is int app) cfg.AirPlayPort = app;
        if (Int("WAVWIZ_SPOTIFY_PORT") is int sp) cfg.SpotifyPort = sp;
        if (Flag("WAVWIZ_DISCOVERY") is bool disc) cfg.Discovery = disc;
        if (Flag("WAVWIZ_AIRPLAY") is bool air) cfg.AirPlay = air;
        if (Flag("WAVWIZ_ALLOW_ALL_INTERFACES") is bool all) cfg.AllowAllInterfaces = all;
        Directory.CreateDirectory(cfg.DataDir);
        return cfg;
    }

    public void Save()
    {
        Directory.CreateDirectory(DataDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this, J), new System.Text.UTF8Encoding(false));
    }

    /// <summary>F261-A M1: writes ONLY the four remote-certificate keys into the on-disk server.json (read-modify-write), so environment overrides
    /// (WAVWIZ_BIND, WAVWIZ_ALLOW_ALL_INTERFACES, ports, ...) and every other field on disk are never changed by the remote-HTTPS settings.</summary>
    private string RemoteKeysPath => LoadedFrom ?? ConfigPath;
    public void SaveRemoteCertKeys()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(RemoteKeysPath)!);
        System.Text.Json.Nodes.JsonObject root;
        try { root = File.Exists(RemoteKeysPath) ? System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(RemoteKeysPath).TrimStart('\uFEFF')) as System.Text.Json.Nodes.JsonObject ?? throw new InvalidOperationException() : new(); }
        catch (Exception e) when (e is JsonException or InvalidOperationException) { throw new InvalidOperationException("server.json could not be read, so the remote HTTPS settings were not saved."); }
        void Set(string k, string? v) { foreach (var old in root.Select(p => p.Key).Where(x => string.Equals(x, k, StringComparison.OrdinalIgnoreCase)).ToList()) root.Remove(old); root[k] = v; }
        Set("remoteCertMode", RemoteCertMode); Set("remoteHost", RemoteHost); Set("remoteCertPath", RemoteCertPath); Set("remoteCertCtAcknowledgedAt", RemoteCertCtAcknowledgedAt);
        var tmp = RemoteKeysPath + ".tmp"; File.WriteAllText(tmp, root.ToJsonString(J), new System.Text.UTF8Encoding(false)); File.Move(tmp, RemoteKeysPath, true);
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
