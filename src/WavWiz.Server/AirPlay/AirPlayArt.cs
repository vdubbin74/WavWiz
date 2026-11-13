using WavWiz.Server.Library;
using WavWiz.Server.Media;

namespace WavWiz.Server.AirPlay;

/// <summary>
/// 0.7.0 t1960: artwork bytes for an outgoing SET_PARAMETER. Library tracks keep using embedded / folder / online covers.
/// Radio was skipped (ArtFor returned null, so the speaker got image/none and showed its own generic note). Now radio
/// uses the live song picture when the station sent one, else the saved logo_url (fetched server-side, converted to
/// JPEG, cached — same path as /art/radio/{id}), else the WavWiz radio placeholder. Shared by realtime and buffered.
/// </summary>
public static class AirPlayArt
{
    public const int Size = 384;
    public const string PlaceholderResource = "WavWiz.radio-placeholder.png";

    /// <summary>The WavWiz mark shipped as assets/logo-placeholder-512.png (the web radio tile is a themed SVG, which AirPlay cannot display).</summary>
    public static byte[]? LoadPlaceholder()
    {
        var asm = typeof(AirPlayArt).Assembly;
        using var s = asm.GetManifestResourceStream(PlaceholderResource);
        if (s == null) return null;
        using var ms = new MemoryStream();
        s.CopyTo(ms);
        return ms.ToArray();
    }

    public static async Task<byte[]?> PlaceholderAsync(ArtService art, int size, CancellationToken ct)
    {
        var raw = LoadPlaceholder();
        if (raw == null || raw.Length == 0) return null;
        return await art.ResizeCachedAsync("placeholder|radio", raw, size, ct) ?? raw;
    }

    /// <summary>Pick the bytes to send. <paramref name="liveArtUrl"/> is the station's amgArtworkURL when a song picture is in flight.</summary>
    public static async Task<byte[]?> BytesAsync(
        QueueItem it,
        Func<QueueItem, CancellationToken, Task<byte[]?>> trackArt,
        Func<string?, CancellationToken, Task<byte[]?>> remoteArt,
        string? liveArtUrl,
        byte[]? radioPlaceholder,
        CancellationToken ct)
    {
        if (it.Kind == "track") return await trackArt(it, ct);
        if (it.Kind != "radio") return null;
        foreach (var url in new[] { liveArtUrl, it.ArtUrl })
        {
            if (string.IsNullOrWhiteSpace(url)) continue;
            byte[]? img;
            try { img = await remoteArt(url, ct); }
            catch (OperationCanceledException) { img = null; } // 4 s ArtFor timer: still send the logo/placeholder, never image/none
            catch { img = null; }
            if (img is { Length: > 0 }) return img;
        }
        return radioPlaceholder is { Length: > 0 } ? radioPlaceholder : null;
    }
}
