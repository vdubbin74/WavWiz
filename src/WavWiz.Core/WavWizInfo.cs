using System.Reflection;
namespace WavWiz.Core;

/// <summary>Product constants. The name is one constant (spec D11). Version comes from Directory.Build.props only.</summary>
public static class WavWizInfo
{
    public const string ProductName = "WavWiz";
    public const string MdnsService = "_unison._tcp";
    public const string ServiceName = "WavWizServer";
    public const int DefaultHttpPort = 47800;
    public const int DefaultHttpsPort = 47443;
    public const int DefaultAudioPort = 47801;
    public const int DefaultClockPort = 47802;
    /// <summary>UDP: "who is a WavWiz server?" broadcast/unicast probe and reply (0.0.2).</summary>
    public const int DefaultDiscoveryPort = 47803;

    public static string Version =>
        typeof(WavWizInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion?.Split('+')[0].Replace("-beta", "") ?? "0.0.0";

    public static string Channel =>
        typeof(WavWizInfo).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "WavWizChannel")?.Value ?? "BETA";

    /// <summary>"WavWiz 0.0.2 BETA" - used by the installer, About box, tray tooltip, web header/footer.</summary>
    public static string DisplayName => $"{ProductName} {Version} {Channel}";
}
