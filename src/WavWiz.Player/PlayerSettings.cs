using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WavWiz.Core;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>Per-user settings in %LocalAppData%\WavWiz\player.json (BOM-less). The pairing token is in a separate DPAPI-protected file, never in the JSON or the log.</summary>
public sealed class PlayerSettings
{
    public string ServerHost { get; set; } = "";
    /// <summary>Remembered server identity (0.0.2): lets the player find the server again if its IP address changes.</summary>
    public string ServerId { get; set; } = "";
    public string ServerName { get; set; } = "";
    public int HttpPort { get; set; } = WavWizInfo.DefaultHttpPort;
    public int AudioPort { get; set; } = WavWizInfo.DefaultAudioPort;
    public string PlayerId { get; set; } = "";
    public string Name { get; set; } = Environment.MachineName;
    public string LinkType { get; set; } = "auto";           // auto | ethernet | wifi
    public bool StartWithWindows { get; set; } = true;
    /// <summary>0 = Auto (follow Windows), else 100..300 percent (see UiScale).</summary>
    public int UiScale { get; set; } = WavWiz.PlayerCore.UiScale.Auto;

    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WavWiz");
    public static string FilePath => Path.Combine(Dir, "player.json");
    public static string DefaultsPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WavWiz", "player-defaults.json");   // written by the installer (server address)

    public static PlayerSettings Load()
    {
        WavWiz.PlayerCore.LegacyFolder.Migrate(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
        Directory.CreateDirectory(Dir);
        PlayerSettings? s = null;
        try { if (File.Exists(FilePath)) s = JsonSerializer.Deserialize<PlayerSettings>(File.ReadAllText(FilePath).TrimStart('\uFEFF'), J); } catch { /* unreadable file: start from defaults, do not crash */ }
        s ??= new PlayerSettings();
        if (string.IsNullOrWhiteSpace(s.ServerHost))
        {
            try { if (File.Exists(DefaultsPath)) { var d = JsonSerializer.Deserialize<PlayerSettings>(File.ReadAllText(DefaultsPath).TrimStart('\uFEFF'), J); if (d != null) { s.ServerHost = d.ServerHost; if (d.HttpPort > 0) s.HttpPort = d.HttpPort; if (d.AudioPort > 0) s.AudioPort = d.AudioPort; } } } catch { }
        }
        if (string.IsNullOrWhiteSpace(s.PlayerId)) { s.PlayerId = Guid.NewGuid().ToString("N"); s.Save(); }
        return s;
    }

    public void Save()
    {
        Directory.CreateDirectory(Dir);
        var tmp = FilePath + ".tmp"; File.WriteAllText(tmp, JsonSerializer.Serialize(this, J), new UTF8Encoding(false)); File.Move(tmp, FilePath, true);
    }

    /// <summary>ethernet/wifi for the buffer depth (3 s / 4 s, spec 7.4): the adapter that routes to the server.</summary>
    public string ResolveLinkType()
    {
        if (LinkType is "ethernet" or "wifi") return LinkType;
        try
        {
            using var s = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.InterNetwork, System.Net.Sockets.SocketType.Dgram, System.Net.Sockets.ProtocolType.Udp);
            s.Connect(ServerHost, 9); var local = ((System.Net.IPEndPoint)s.LocalEndPoint!).Address;
            var nic = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n => n.GetIPProperties().UnicastAddresses.Any(a => a.Address.Equals(local)));
            if (nic != null) return nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? "wifi" : "ethernet";
        }
        catch { }
        return "unknown";
    }
}

public sealed class DpapiSecretStore : ISecretStore
{
    private static string PathFor(string name) => System.IO.Path.Combine(PlayerSettings.Dir, name + ".dpapi");
    // NOT renamed on purpose: it is part of the key that unlocks tokens saved by 0.0.2, so players keep their pairing after the upgrade.
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Unison.Player.v1");
    public string? Load(string name)
    {
        try { var p = PathFor(name); return File.Exists(p) ? Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(p), Entropy, DataProtectionScope.CurrentUser)) : null; } catch { return null; }
    }
    public void Save(string name, string value)
    {
        Directory.CreateDirectory(PlayerSettings.Dir);
        File.WriteAllBytes(PathFor(name), ProtectedData.Protect(Encoding.UTF8.GetBytes(value), Entropy, DataProtectionScope.CurrentUser));
    }
    public void Delete(string name) { try { File.Delete(PathFor(name)); } catch { } }
}
