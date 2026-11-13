namespace WavWiz.Core.AirPlay;

/// <summary>
/// 0.5.0 stage 10: per-model sender choices. Matched on the TXT "model" (am / model) prefix, first match wins.
/// LG webOS TVs are also recognized from manufacturer / name: their model is often just "QNED70AUA" or
/// "OLED65C1PUB", so a prefix on model alone would miss them. Rows marked Verified=false are from public
/// protocol notes only and still need a hardware pass.
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

    /// <summary>43QNED70AUA (13 Nov 2026): buffered AAC showed title and art but no audio; realtime ALAC plays.</summary>
    public static readonly Quirk LgWebOs = new("LG", "LG webOS TV", false, 0, true, "Realtime ALAC (type 96). Buffered AAC is accepted (title, art, SETRATE 200) but the TV does not play.");

    public static Quirk For(string? model) => For(model, null, null);

    public static Quirk For(string? model, string? manufacturer, string? name)
    {
        if (!string.IsNullOrEmpty(model))
        {
            var q = Table.FirstOrDefault(x => model.StartsWith(x.ModelPrefix, StringComparison.OrdinalIgnoreCase));
            if (q != null) return q;
        }
        if (IsLgWebOs(model, manufacturer, name)) return LgWebOs;
        return Default;
    }

    /// <summary>Whether this speaker uses the buffered AAC path. A quirk can force realtime even when the global setting is on.</summary>
    public static bool UseBuffered(bool globalBuffered, Quirk q, string? ffmpegPath) =>
        globalBuffered && q.Buffered && !string.IsNullOrEmpty(ffmpegPath) && (ffmpegPath == "ffmpeg" || File.Exists(ffmpegPath));

    /// <summary>manufacturer "LG Electronics"; name "[LG] webOS TV QNED70AUA"; model is often only "43QNED70AUA" / "OLED65C1PUB".</summary>
    public static bool IsLgWebOs(string? model, string? manufacturer, string? name)
    {
        if (LgManufacturer(manufacturer)) return true;
        return LgHint(name) || LgHint(model);
    }

    static bool LgManufacturer(string? s)
    {
        if (string.IsNullOrEmpty(s) || !s.StartsWith("LG", StringComparison.OrdinalIgnoreCase)) return false;
        return s.Length == 2 || !char.IsLetter(s[2]); // "LG", "LG Electronics"; not "Logitech"
    }

    static bool LgHint(string? s) =>
        !string.IsNullOrEmpty(s) &&
        (s.Contains("webOS", StringComparison.OrdinalIgnoreCase) ||
         s.Contains("[LG]", StringComparison.OrdinalIgnoreCase) ||
         s.StartsWith("LG ", StringComparison.OrdinalIgnoreCase) ||
         s.StartsWith("LG-", StringComparison.OrdinalIgnoreCase));

    /// <summary>Windows Defender Firewall rules the sender needs (PTP must use the fixed ports 319/320; audio/control ports are ephemeral).
    /// 0.6.8-#14g: same names, scope and program as the installer's opt-in "Allow AirPlay speakers through the firewall" (installer/scripts/lib.ps1
    /// Set-AirPlayOutFirewall): Private profile, local subnet only, the installed server program.</summary>
    public static readonly IReadOnlyList<string> FirewallRules = new[]
    {
        "netsh advfirewall firewall add rule name=\"WavWiz AirPlay speakers (PTP)\" dir=in action=allow protocol=UDP localport=319-320 profile=private remoteip=localsubnet program=\"%ProgramFiles%\\WavWiz\\Server\\wavwiz-server.exe\" enable=yes",
        "netsh advfirewall firewall add rule name=\"WavWiz AirPlay speakers (audio)\" dir=in action=allow protocol=UDP profile=private remoteip=localsubnet program=\"%ProgramFiles%\\WavWiz\\Server\\wavwiz-server.exe\" enable=yes",
    };
}
