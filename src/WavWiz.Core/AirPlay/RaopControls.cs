using System.Globalization;
using System.Text;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// 0.5.0 AirPlay 1 controls: WavWiz volume to AirPlay dB, DMAP track metadata, artwork and progress bodies,
/// all sent as SET_PARAMETER with an RTP-Info rtptime so the receiver applies them at the right point.
/// </summary>
public static class RaopControls
{
    public const double Mute = -144.0;

    /// <summary>Maps a WavWiz 0..1 (or 0..100 via <paramref name="percent"/>) slider to AirPlay's -30..0 dB.
    /// The slider is treated as perceptual: dB = 20*log10(v) clamped at -30, 0 means mute.</summary>
    public static double ToAirPlayDb(double v, bool percent = false)
    {
        if (percent) v /= 100.0;
        if (v <= 0.0005) return Mute;
        if (v >= 1) return 0;
        return Math.Max(-30, 20 * Math.Log10(v));
    }

    /// <summary>DMAP "mlit" listing item with title / artist / album (application/x-dmap-tagged).</summary>
    public static byte[] Dmap(string? title, string? artist, string? album)
    {
        var inner = new MemoryStream();
        void Tag(string code, string? v)
        {
            if (string.IsNullOrEmpty(v)) return;
            var b = Encoding.UTF8.GetBytes(v);
            inner.Write(Encoding.ASCII.GetBytes(code)); WriteBe(inner, b.Length); inner.Write(b);
        }
        Tag("minm", title); Tag("asar", artist); Tag("asal", album);
        var body = inner.ToArray();
        var outer = new MemoryStream();
        outer.Write("mlit"u8); WriteBe(outer, body.Length); outer.Write(body);
        return outer.ToArray();
    }

    static void WriteBe(System.IO.Stream s, int v) { s.WriteByte((byte)(v >> 24)); s.WriteByte((byte)(v >> 16)); s.WriteByte((byte)(v >> 8)); s.WriteByte((byte)v); }

    /// <summary>"progress: start/current/end" in RTP frames.</summary>
    public static byte[] Progress(uint start, uint current, uint end) =>
        Encoding.ASCII.GetBytes($"progress: {start}/{current}/{end}\r\n");

    public static string ImageType(byte[] img) =>
        img.Length > 3 && img[0] == 0x89 && img[1] == 'P' ? "image/png" : "image/jpeg";

    public static Dictionary<string, string> At(uint rtptime) => new() { ["RTP-Info"] = $"rtptime={rtptime}" };

    public static Task<RtspResponse> SendMetadataAsync(RaopSession s, uint rtptime, string? title, string? artist, string? album) =>
        s.SetParameterAsync(Dmap(title, artist, album), "application/x-dmap-tagged", At(rtptime));

    public static Task<RtspResponse> SendArtworkAsync(RaopSession s, uint rtptime, byte[] img) =>
        s.SetParameterAsync(img, ImageType(img), At(rtptime));

    public static Task<RtspResponse> SendProgressAsync(RaopSession s, uint start, uint cur, uint end) =>
        s.SetParameterAsync(Progress(start, cur, end), "text/parameters");

    public static string Db(double d) => d.ToString("0.000000", CultureInfo.InvariantCulture);
}
