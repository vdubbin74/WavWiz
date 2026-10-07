using System.Globalization;
namespace WavWiz.Server.Media;

/// <summary>What a file's tags say about its loudness and its encoder padding (0.1.3). Every field is optional: no tag = no adjustment.</summary>
public sealed record TrackTags(double? TrackGainDb, double? TrackPeak, double? AlbumGainDb, double? AlbumPeak, long? ValidSamples, int? SampleRate)
{
    public static readonly TrackTags None = new(null, null, null, null, null, null);
}

/// <summary>
/// ReplayGain (0.1.3). Reads REPLAYGAIN_* (ID3 TXXX, Vorbis/FLAC/Opus comments, APE, MP4 ----:com.apple.iTunes) and EBU R128 (R128_TRACK_GAIN /
/// R128_ALBUM_GAIN, Q7.8 dB relative to -23 LUFS; +5 dB brings it to the ReplayGain reference) with TagLib. Also reads iTunSMPB (AAC/ALAC encoder
/// padding) so gapless albums from iTunes do not get a click of silence at each join. Mode: off | track | album | auto (album gain when the queue is
/// playing that album in order, track gain otherwise). Clipping protection: the gain never pushes the tagged peak over full scale, and a soft limiter
/// catches anything untagged.
/// </summary>
public static class Loudness
{
    public static readonly string[] Modes = { "off", "auto", "track", "album" };
    public const string DefaultMode = "auto";
    public static string NormMode(string? m) { m = (m ?? "").Trim('"').ToLowerInvariant(); return Modes.Contains(m) ? m : DefaultMode; }

    public static TrackTags Read(string path)
    {
        try
        {
            using var f = TagLib.File.Create(path);
            double? tg = Num(f.Tag.ReplayGainTrackGain), tp = Num(f.Tag.ReplayGainTrackPeak), ag = Num(f.Tag.ReplayGainAlbumGain), ap = Num(f.Tag.ReplayGainAlbumPeak);
            if (f.GetTag(TagLib.TagTypes.Xiph) is TagLib.Ogg.XiphComment x)
            {
                tg ??= R128(x.GetFirstField("R128_TRACK_GAIN")); ag ??= R128(x.GetFirstField("R128_ALBUM_GAIN"));
                tg ??= Db(x.GetFirstField("REPLAYGAIN_TRACK_GAIN")); ag ??= Db(x.GetFirstField("REPLAYGAIN_ALBUM_GAIN"));
                tp ??= Peak(x.GetFirstField("REPLAYGAIN_TRACK_PEAK")); ap ??= Peak(x.GetFirstField("REPLAYGAIN_ALBUM_PEAK"));
            }
            long? valid = null; int? sr = null;
            if (f.GetTag(TagLib.TagTypes.Apple) is TagLib.Mpeg4.AppleTag apple)
            {
                var smpb = apple.GetDashBox("com.apple.iTunes", "iTunSMPB");
                if (ParseSmpb(smpb) is { } v && f.Properties?.AudioSampleRate > 0) { valid = v.Valid; sr = f.Properties.AudioSampleRate; }
            }
            return new TrackTags(tg, tp is > 0 ? tp : null, ag, ap is > 0 ? ap : null, valid, sr);
        }
        catch { return TrackTags.None; }
    }

    private static double? Num(double v) => double.IsNaN(v) || double.IsInfinity(v) ? null : v;
    public static double? Db(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim(); if (s.EndsWith("dB", StringComparison.OrdinalIgnoreCase)) s = s[..^2].Trim();
        return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && Math.Abs(v) < 60 ? v : null;
    }
    public static double? Peak(string? s) => double.TryParse(s?.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && v > 0 && v < 20 ? v : null;
    /// <summary>R128_*_GAIN: integer Q7.8 relative to -23 LUFS; ReplayGain's reference is ~-18 LUFS, so add 5 dB.</summary>
    public static double? R128(string? s) => int.TryParse(s?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var q) ? q / 256.0 + 5.0 : null;

    /// <summary>iTunSMPB: " 00000000 00000840 000001CA 00000000003F31F6 ..." = reserved, encoder delay, end padding, valid sample count (hex).</summary>
    public static (int Delay, int Padding, long Valid)? ParseSmpb(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var p = s.Split(' ', StringSplitOptions.RemoveEmptyEntries); if (p.Length < 4) return null;
        try { var d = Convert.ToInt32(p[1], 16); var pad = Convert.ToInt32(p[2], 16); var v = Convert.ToInt64(p[3], 16); return v > 0 ? (d, pad, v) : null; } catch { return null; }
    }

    /// <summary>Linear gain for a mode. album falls back to track (and track to album) when only one is tagged; nothing tagged = 1.0. Never above 1/peak.</summary>
    public static float Gain(TrackTags t, string mode, bool albumContext, double preampDb = 0)
    {
        mode = NormMode(mode); if (mode == "off") return 1f;
        bool album = mode == "album" || (mode == "auto" && albumContext);
        double? db = album ? t.AlbumGainDb ?? t.TrackGainDb : t.TrackGainDb ?? t.AlbumGainDb;
        double? peak = album ? t.AlbumPeak ?? t.TrackPeak : t.TrackPeak ?? t.AlbumPeak;
        if (db == null) return 1f;
        double g = Math.Pow(10, Math.Clamp(db.Value + preampDb, -30, 15) / 20.0);
        if (peak is > 0) g = Math.Min(g, 1.0 / peak.Value);      // clipping protection from the tagged peak
        return (float)g;
    }

    /// <summary>Output frames (48 kHz) the file really has, from iTunSMPB; null = unknown.</summary>
    public static long? ValidFrames(TrackTags t, long startMs) =>
        t.ValidSamples is long v && t.SampleRate is int sr && sr > 0 ? Math.Max(0, (long)Math.Ceiling(v * 48000.0 / sr) - startMs * 48) : null;
}

/// <summary>Something whose file reader has delivered its last byte (QueueSource starts the next track's decoder then, for gapless joins).</summary>
public interface IReaderDone { bool ReaderDone { get; } }

/// <summary>
/// Wraps a track decoder with ReplayGain and the iTunSMPB end trim. The tags are read on a background task so a slow share never stalls the stream
/// thread; until they arrive (at most ~1.5 s; the next track is opened seconds before it is due) the wrapper delivers nothing, and if they never come
/// the track plays unadjusted.
/// </summary>
public sealed class ShapedDecoder : IPcmDecoder, IReaderDone
{
    private readonly IPcmDecoder _inner; private readonly Task<(float Gain, long? MaxFrames)> _plan; private readonly long _deadline;
    private float _gain = 1f; private long _left = long.MaxValue; private bool _ready; private bool _trimmed;
    public float Gain => _gain; public bool Ready => _ready;

    public ShapedDecoder(IPcmDecoder inner, Task<(float Gain, long? MaxFrames)> plan, int waitMs = 1500)
    {
        _inner = inner; _plan = plan; _deadline = Environment.TickCount64 + waitMs;
    }
    public ShapedDecoder(IPcmDecoder inner, float gain, long? maxFrames) : this(inner, Task.FromResult((gain, maxFrames))) { }

    private bool CheckReady()
    {
        if (_ready) return true;
        if (_plan.IsCompletedSuccessfully) { (_gain, var max) = _plan.Result; if (max is long m && m > 0) _left = m; _ready = true; }
        else if (_plan.IsCompleted || Environment.TickCount64 > _deadline) _ready = true;     // failed / too slow: play unadjusted
        return _ready;
    }

    public int Read(Span<float> dst, int frames)
    {
        if (!CheckReady()) return 0;
        if (_left <= 0) { _trimmed = true; return 0; }
        int want = (int)Math.Min(frames, _left);
        int n = _inner.Read(dst, want); _left -= n;
        if (n > 0 && _gain != 1f) Apply(dst[..(n * 2)], _gain);
        return n;
    }

    /// <summary>Gain with a soft knee above -1 dBFS (tanh-shaped), so a boost on an untagged peak bends instead of clipping.</summary>
    public static void Apply(Span<float> s, float gain)
    {
        const float knee = 0.89f, room = 1f - knee;
        for (int i = 0; i < s.Length; i++)
        {
            float x = s[i] * gain, a = MathF.Abs(x);
            if (a > knee) x = MathF.CopySign(knee + room * MathF.Tanh((a - knee) / room), x);
            s[i] = x;
        }
    }

    public bool Finished => _trimmed || (_ready && _left <= 0) || _inner.Finished;
    public bool ReaderDone => _left <= 0 || (_inner is IReaderDone r && r.ReaderDone);
    public string? Error => _inner.Error;
    public void Dispose() => _inner.Dispose();
}
