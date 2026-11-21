using System.Text.Json;
using WavWiz.Core.Protocol;

namespace WavWiz.PlayerCore;

/// <summary>
/// 0.7.2 t2175u: "Sync with WavWiz" for the PC's own sound (loopback input). Windows' default output moves to a spare, unused output (so apps play
/// there and the process loopback still records them), and the Player plays the house-synced copy on the real speakers. The pure rules live here
/// (unit-tested on Linux); the Windows part is WavWiz.Player/LocalSync.cs. The restore file is written BEFORE Windows is switched, so a crash or
/// power cut is undone at the next Player start.
/// </summary>
public static class LocalSyncRules
{
    public const string On = "localsync-on", Off = "localsync-off";
    /// <summary>The input-error reason prefix the Player uses when it went back to Real time by itself (spare gone, tray Restore, switch failed).</summary>
    public const string FallbackTag = "localsync:";

    /// <summary>Outputs that can be the spare: switched on (connected) and not the speakers the synced copy plays on.</summary>
    public static IReadOnlyList<OutputInfo> SpareCandidates(IEnumerable<OutputInfo> outputs, string? speakers) =>
        outputs.Where(o => o.Connected && !string.Equals(o.EndpointId, speakers, StringComparison.Ordinal)).ToList();

    /// <summary>Why this pair cannot be used, or null when it can.</summary>
    public static string? Problem(IEnumerable<OutputInfo> outputs, string? spare, string? speakers)
    {
        var list = outputs.ToList();
        if (string.IsNullOrEmpty(spare) || string.IsNullOrEmpty(speakers)) return "Pick a spare output and the speakers to play on.";
        if (spare == speakers) return "The spare output must be a different output than your speakers.";
        if (!list.Any(o => o.EndpointId == speakers && o.Connected)) return "Those speakers are not available.";
        if (!list.Any(o => o.EndpointId == spare && o.Connected)) return "The spare output is not available (is the monitor or device switched on?).";
        return null;
    }

    public static string Serialize(LocalSyncState s) => JsonSerializer.Serialize(s);
    public static LocalSyncState? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { var s = JsonSerializer.Deserialize<LocalSyncState>(text); return s is { Spare.Length: > 0 } ? s : null; } catch { return null; }
    }
}

/// <summary>What to put back: Windows' default output for each role (console, multimedia, communications) before the switch.</summary>
public sealed record LocalSyncState(string InputId, string Spare, string Speakers, string? PrevConsole, string? PrevMultimedia, string? PrevCommunications);
