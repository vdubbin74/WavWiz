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
    /// <summary>0.7.2 t2183u: Real time: the source PC's Player does not play its own sound back (no echo, no double level).</summary>
    public const string SelfMuteOn = "selfmute-on", SelfMuteOff = "selfmute-off";
    /// <summary>0.7.2 t2193u: "Pause PC audio & stop": the Player presses the media Play/Pause key on its PC (only sent while the PC is making sound).</summary>
    public const string MediaPause = "media-pause";
    /// <summary>0.7.2 t2193u: this PC's sound counts as playing when its loopback was above -50 dBFS within the last 4 s (a toggle key must never
    /// START a paused player, so a quiet PC gets no key).</summary>
    public const double SoundDb = -50; public const long SoundRecentMs = 4000;
    public static bool SoundingNow(long loudAtMs, long nowMs) => nowMs - loudAtMs <= SoundRecentMs;
    /// <summary>The input-error reason prefix the Player uses when it went back to Real time by itself (spare gone, tray Restore, switch failed).</summary>
    public const string FallbackTag = "localsync:";

    /// <summary>Outputs that can be the spare (the user may pick any of them): switched on and not the speakers; best defaults first, headsets last.</summary>
    public static IReadOnlyList<OutputInfo> SpareCandidates(IEnumerable<OutputInfo> outputs, string? speakers) =>
        outputs.Where(o => o.Connected && !string.Equals(o.EndpointId, speakers, StringComparison.Ordinal)).OrderBy(SpareRank).ToList();

    // ---- 0.7.2 t2183u: defaults. Never auto-pick a headset (it was picked and played the PC's sound loud in the user's ears). ----
    /// <summary>Windows form factor 3 = Headphones, 5 = Headset; or the name says so (HyperX makes headsets).</summary>
    public static bool IsHeadset(OutputInfo o) =>
        o.FormFactor is 3 or 5 || System.Text.RegularExpressions.Regex.IsMatch(o.Name ?? "", @"head\s?set|head\s?phone|hyperx|earphone|ear\s?buds|hands-free", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    public static bool IsDigital(OutputInfo o) =>
        o.Kind == "spdif" || o.FormFactor == 8 || System.Text.RegularExpressions.Regex.IsMatch(o.Name ?? "", @"optical|s/?pdif|toslink|digital\s+(audio\s+)?(output|interface)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    public static bool IsHdmi(OutputInfo o) =>
        o.Kind == "hdmi" || o.FormFactor == 9 || System.Text.RegularExpressions.Regex.IsMatch(o.Name ?? "", @"hdmi|displayport|\bDP\b|monitor|nvidia high definition|amd high definition|intel\(r\) display", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    /// <summary>0.7.2 t2186u: a headset / headphone output is fine as the spare only when nothing is plugged into it: the endpoint is on (Windows can
    /// switch to it) and Windows' jack detection says the jack is empty. Unknown (USB / wireless headsets like the HyperX have no jack report,
    /// or the driver has no jack detection) = in use = skipped.</summary>
    public static bool IsIdleHeadset(OutputInfo o) => IsHeadset(o) && o.Connected && o.JackEmpty == true;
    /// <summary>Spare priority: S/PDIF / optical / digital 0, HDMI / DisplayPort / monitor 1, other unused outputs 2, an empty headphone jack 3,
    /// a headset in use 9 (manual only).</summary>
    public static int SpareRank(OutputInfo o) => IsHeadset(o) ? (IsIdleHeadset(o) ? 3 : 9) : IsDigital(o) ? 0 : IsHdmi(o) ? 1 : 2;
    /// <summary>"Play synced on" default: the Windows default output unless it is a headset; else the best speakers (named Speakers, then the
    /// Player's output, then any other non-headset, non-digital, non-HDMI output, then HDMI). Null = nothing safe to pick (the user chooses).</summary>
    public static string? DefaultSpeakers(IEnumerable<OutputInfo> outputs)
    {
        var ok = outputs.Where(o => o.Connected && !IsHeadset(o)).ToList();
        var win = ok.FirstOrDefault(o => o.WinDefault == true); if (win != null) return win.EndpointId;
        return ok.OrderBy(o => System.Text.RegularExpressions.Regex.IsMatch(o.Name ?? "", "speaker", System.Text.RegularExpressions.RegexOptions.IgnoreCase) ? 0 : 1)
                 .ThenBy(o => IsDigital(o) ? 2 : IsHdmi(o) ? 1 : 0).ThenBy(o => o.Active ? 0 : 1).FirstOrDefault()?.EndpointId;
    }
    /// <summary>0.7.2 t2189u: the speakers actually used. A saved choice stands when the user picked it in the 0.7.2 UI (<paramref name="chosen"/>) or it is
    /// not a headset; a headset saved by an older build's "first output" default (PCBOXV2: the HyperX) is replaced by the default.</summary>
    public static string? EffectiveSpeakers(IEnumerable<OutputInfo> outputs, string? saved, bool chosen)
    {
        var list = outputs.ToList(); var o = saved == null ? null : list.FirstOrDefault(x => x.EndpointId == saved);
        if (saved != null && (o == null || chosen || !IsHeadset(o))) return saved;     // not listed (yet): kept, Problem() decides
        return DefaultSpeakers(list);
    }
    /// <summary>0.7.2 t2189u: the spare actually used: a saved one stands when picked by hand or it is not a headset in use; else the default.</summary>
    public static string? EffectiveSpare(IEnumerable<OutputInfo> outputs, string? saved, bool chosen, string? speakers)
    {
        var list = outputs.ToList(); var o = saved == null ? null : list.FirstOrDefault(x => x.EndpointId == saved);
        if (saved != null && saved != speakers && (o == null || chosen || SpareRank(o) < 9)) return saved;
        return DefaultSpare(list, speakers);
    }

    /// <summary>Spare default: best-ranked connected output that is not the speakers, not the Windows default, and never a headset in use
    /// (an empty headphone jack is allowed, after everything else). Null = none.</summary>
    public static string? DefaultSpare(IEnumerable<OutputInfo> outputs, string? speakers) =>
        SpareCandidates(outputs, speakers).Where(o => SpareRank(o) < 9 && o.WinDefault != true).FirstOrDefault()?.EndpointId;

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

    /// <summary>0.7.2 t2189u: the Communications default moves to the spare only when it was the speakers (or unknown with the speakers the default).</summary>
    public static bool MoveCommunications(LocalSyncState st) =>
        st.PrevCommunications == st.Speakers || (st.PrevCommunications == null && st.PrevMultimedia == st.Speakers);

    /// <summary>0.7.2 t2192u: while synced the user hears this PC's apps at (speakers' Windows volume) x (WavWiz volume on this PC); handed back
    /// they play at the Windows volume alone, often 100%, so they blare. Before handing back, the speakers' endpoint level (dB) is lowered by the
    /// WavWiz gain so the level stays where it was (WavWiz volume: -0.5 dB a percent, <see cref="WavWiz.Dsp.DspChain.VolumeToGain"/>), and never above the
    /// level saved when Sync started. Never raised; never more than 40 dB down; clamped to the endpoint's range. Null = leave it alone.</summary>
    public const double MaxHandBackCutDb = 40;
    public static float? HandBackDb(float currentDb, float? savedDb, double? wavwizPercent, float minDb, float maxDb)
    {
        if (wavwizPercent is not { } pct || !double.IsFinite(pct) || !float.IsFinite(currentDb)) return null;
        var g = WavWiz.Dsp.DspChain.VolumeToGain(Math.Clamp(pct, 0, 100));
        var cut = g <= 0 ? MaxHandBackCutDb : Math.Min(MaxHandBackCutDb, -20 * Math.Log10(g));
        double t = currentDb - cut;
        if (savedDb is { } s && float.IsFinite(s)) t = Math.Min(t, s);
        t = Math.Clamp(t, Math.Min(minDb, maxDb), maxDb);
        return t < currentDb - 0.05 ? (float)t : null;
    }
    /// <summary>0.7.2 t2192u: which restores hand the sound back to the speakers for real (and so match the level). "changed" re-syncs at once,
    /// "switch failed" never switched, a start-up restore of a crash file has no WavWiz level.</summary>
    public static bool MatchesLevel(string why) => why is not ("changed" or "switch failed") && !why.StartsWith("start", StringComparison.Ordinal) && why != "left over";

    public static string Serialize(LocalSyncState s) => JsonSerializer.Serialize(s);
    public static LocalSyncState? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { var s = JsonSerializer.Deserialize<LocalSyncState>(text); return s is { Spare.Length: > 0 } ? s : null; } catch { return null; }
    }
}

/// <summary>What to put back: Windows' default output for each role (console, multimedia, communications) before the switch.</summary>
public sealed record LocalSyncState(string InputId, string Spare, string Speakers, string? PrevConsole, string? PrevMultimedia, string? PrevCommunications);
