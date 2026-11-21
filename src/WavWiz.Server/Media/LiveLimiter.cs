using WavWiz.Dsp;

namespace WavWiz.Server.Media;

/// <summary>
/// 0.7.2: the shared limiter for live audio coming INTO WavWiz - AirPlay and Spotify Connect (after the 0..+6 dB boost) and audio inputs
/// (after their -12..+6 dB gain). It is the same zero-lookahead <see cref="PeakLimiter"/> the per-speaker DSP chain ends with, with the same
/// defaults (ceiling -0.3 dBFS, 120 ms release, no added latency). One setting, <c>live.limiter</c>, default on.
/// </summary>
public static class LiveLimiter
{
    public const string SettingKey = "live.limiter";
    /// <summary>The limiter used on every <see cref="LiveFeed"/> while <c>live.limiter</c> is on (DspPreset defaults).</summary>
    public static readonly LimiterSettings Settings = new();
    /// <summary>Limiter off: nothing is turned down; the 0 dBFS safety clamp still applies.</summary>
    public static readonly LimiterSettings Off = new(Enabled: false);

    /// <summary>Saved setting; anything but an explicit <c>false</c> (missing, unreadable) means on.</summary>
    public static bool Enabled(Db db)
    {
        try { return db.Setting(SettingKey)?.Trim() != "false"; }
        catch { return true; }
    }
}
