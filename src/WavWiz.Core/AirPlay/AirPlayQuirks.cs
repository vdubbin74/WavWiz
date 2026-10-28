namespace WavWiz.Core.AirPlay;

/// <summary>
/// 0.5.0 stage 10: per-model sender choices. Matched on the TXT "model" (am / model) prefix, first match wins.
/// Rows marked Verified=false are from public protocol notes only and still need a hardware pass.
/// </summary>
public static class AirPlayQuirks
{
    public sealed record Quirk(string ModelPrefix, string Label, bool Buffered, int DefaultDelayMs, bool Verified, string Note);

    public static readonly IReadOnlyList<Quirk> Table = new Quirk[]
    {
        new("ShairportSync", "shairport-sync 4.3 (bench)", true, 0, true, "Buffered = AAC only; realtime ALAC also fine. Needs nqptp; rejects NTP-timed AirPlay 2."),
        new("Sonos", "Sonos (Era 100 etc.)", true, 0, false, "Still being tested: PTP master acceptance, AAC buffered, clap test."),
        new("WiiM", "WiiM (Mini / Pro / Amp etc.)", true, 0, false, "Pending hardware: same AirPlay 2 path as Sonos; still being tested."),
        new("AudioAccessory", "HomePod", true, 0, false, "Not supported yet: needs pair-verify (not built)."),
        new("AppleTV", "Apple TV", true, 0, false, "Not supported yet: needs pair-verify (not built)."),
        new("AirPort", "AirPort Express", false, 0, false, "AirPlay 1 route (RAOP, RSA for gen 1)."),
    };

    public static readonly Quirk Default = new("", "Other AirPlay 2", true, 0, false, "Generic: buffered AAC, realtime ALAC fallback.");

    public static Quirk For(string? model) =>
        string.IsNullOrEmpty(model) ? Default : Table.FirstOrDefault(q => model.StartsWith(q.ModelPrefix, StringComparison.OrdinalIgnoreCase)) ?? Default;

    /// <summary>Windows Defender Firewall rules the sender needs (PTP must use the fixed ports 319/320; audio/control ports are ephemeral).</summary>
    public static readonly IReadOnlyList<string> FirewallRules = new[]
    {
        "netsh advfirewall firewall add rule name=\"WavWiz AirPlay PTP\" dir=in action=allow protocol=UDP localport=319-320 profile=private program=\"%ProgramFiles%\\WavWiz\\WavWiz.Server.exe\"",
        "netsh advfirewall firewall add rule name=\"WavWiz AirPlay audio\" dir=in action=allow protocol=UDP profile=private program=\"%ProgramFiles%\\WavWiz\\WavWiz.Server.exe\"",
    };
}
