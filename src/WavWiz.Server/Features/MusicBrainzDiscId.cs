using System.Security.Cryptography;
using System.Text;
namespace WavWiz.Server.Features;

/// <summary>MusicBrainz disc ID from a CD TOC, per https://musicbrainz.org/doc/Disc_ID_Calculation.
/// Offsets are LBA/LSN from the drive; the 150-frame (2 s) pregap is added here.</summary>
public static class MusicBrainzDiscId
{
    public const int PregapFrames = 150;

    /// <param name="first">First track number (usually 1).</param>
    /// <param name="last">Last audio track number included in the ID.</param>
    /// <param name="leadoutLba">Lead-out LBA (already adjusted for a mixed-mode gap if needed).</param>
    /// <param name="trackLba">Start LBA for each track number; index is the track number (slot 0 unused).</param>
    public static string FromLba(int first, int last, int leadoutLba, IReadOnlyList<int> trackLba)
    {
        if (first < 1 || last < first || last > 99) throw new ArgumentOutOfRangeException(nameof(last));
        var offsets = new int[100];
        offsets[0] = leadoutLba + PregapFrames;
        for (int t = first; t <= last; t++)
        {
            int lba = t < trackLba.Count ? trackLba[t] : 0;
            offsets[t] = lba + PregapFrames;
        }
        var sb = new StringBuilder(4 + 800);
        sb.Append(first.ToString("X2"));
        sb.Append(last.ToString("X2"));
        for (int i = 0; i < 100; i++) sb.Append(offsets[i].ToString("X8"));
        var hash = SHA1.HashData(Encoding.ASCII.GetBytes(sb.ToString()));
        return Convert.ToBase64String(hash).Replace('+', '.').Replace('/', '_').Replace('=', '-');
    }

    /// <summary>TOC query string for a fuzzy <c>/ws/2/discid</c> lookup when the exact ID is unknown.</summary>
    public static string TocQuery(int first, int last, int leadoutLba, IReadOnlyList<int> trackLba)
    {
        var parts = new List<string> { first.ToString(), last.ToString(), (leadoutLba + PregapFrames).ToString() };
        for (int t = first; t <= last; t++)
            parts.Add(((t < trackLba.Count ? trackLba[t] : 0) + PregapFrames).ToString());
        return string.Join('+', parts);
    }

    public static int DurationMs(int startLba, int endLbaOrLeadout) =>
        Math.Max(0, (int)((endLbaOrLeadout - startLba) * 1000L / 75));
}
