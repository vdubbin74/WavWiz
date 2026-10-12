using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Net.Http;
namespace WavWiz.Server.Library;

/// <summary>
/// Album covers (0.0.2): the picture embedded in the file, else cover/folder/front/album .jpg/.png in the track's folder (or its parent, for CD1/CD2 layouts).
/// Small JPEG copies (ffmpeg) are cached under the data folder; the music files are only ever read.
/// </summary>
public sealed class ArtService
{
    private readonly LibraryService _lib; private readonly string _cache; private readonly string _ffmpeg;
    private readonly SemaphoreSlim _gate = new(2); private readonly ConcurrentDictionary<string, bool> _none = new();
    private static readonly string[] Names = { "cover", "folder", "front", "album", "albumart", "albumartsmall", "artwork" };
    private static readonly string[] Exts = { ".jpg", ".jpeg", ".png", ".webp" };
    public static readonly int[] Sizes = { 96, 192, 384, 768 };

    public ArtService(LibraryService lib, string dataDir, string ffmpeg) { _lib = lib; _cache = Path.Combine(dataDir, "artcache"); _ffmpeg = ffmpeg; Directory.CreateDirectory(_cache); UpgradeCache(_cache); }

    // ---- 0.3.1 B19: corrupted (magenta/green striped) thumbnails. The decoder used to conceal damaged / unsupported data and the result was cached
    // forever. Now: sniff the format, decode strictly (any decode error = no picture), normalize to 8-bit RGB with even sizes, re-check the JPEG we
    // made, and reject striped noise. A rejected picture is "no art": the web UI shows its themed initials tile. The cache is rebuilt once on upgrade.
    public const int CacheVersion = 2;
    /// <summary>Clears thumbnails made by older versions (once; a marker file records the version).</summary>
    public static void UpgradeCache(string dir)
    {
        try
        {
            var marker = Path.Combine(dir, "cache.version");
            if (File.Exists(marker) && File.ReadAllText(marker).Trim() == CacheVersion.ToString()) return;
            foreach (var f in Directory.EnumerateFiles(dir, "*.jpg")) { try { File.Delete(f); } catch { } }
            File.WriteAllText(marker, CacheVersion.ToString());
        }
        catch { }
    }
    /// <summary>Image formats we accept (magic bytes): JPEG, PNG, WebP, GIF, BMP. Anything else (a URL stored as a "picture", HTML, junk) is no art.</summary>
    public static string? Sniff(byte[]? b)
    {
        if (b == null || b.Length < 16) return null;
        if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "jpeg";
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "png";
        if (b[0] == (byte)'R' && b[1] == (byte)'I' && b[2] == (byte)'F' && b[3] == (byte)'F' && b[8] == (byte)'W' && b[9] == (byte)'E' && b[10] == (byte)'B' && b[11] == (byte)'P') return "webp";
        if (b[0] == (byte)'G' && b[1] == (byte)'I' && b[2] == (byte)'F') return "gif";
        if (b[0] == (byte)'B' && b[1] == (byte)'M') return "bmp";
        return null;
    }
    /// <summary>A finished thumbnail: a complete JPEG (SOI ... EOI).</summary>
    public static bool LooksLikeJpeg(byte[]? j) => j != null && j.Length > 100 && j[0] == 0xFF && j[1] == 0xD8 && j[^2] == 0xFF && j[^1] == 0xD9;
    /// <summary>Striped-noise check on a small 8-bit RGB sample (w x h): the corruption shows as saturated magenta / green pixels alternating
    /// from row to row. True = looks corrupted. Conservative: a normal green or purple cover is smooth, so it passes.</summary>
    public static bool LooksStriped(byte[] rgb, int w, int h)
    {
        if (rgb.Length < w * h * 3 || w < 4 || h < 4) return false;
        int mg = 0; double rowJump = 0;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = (y * w + x) * 3, r = rgb[i], g = rgb[i + 1], bl = rgb[i + 2];
                if ((g > r + 60 && g > bl + 60) || (r > g + 60 && bl > g + 60)) mg++;
                if (y > 0) { int k = i - w * 3; rowJump += Math.Abs(r - rgb[k]) + Math.Abs(g - rgb[k + 1]) + Math.Abs(bl - rgb[k + 2]); }
            }
        double mgFrac = mg / (double)(w * h), jump = rowJump / ((h - 1) * w * 3.0);
        return mgFrac > 0.35 && jump > 40;
    }

    public static int SnapSize(int want) => Sizes.FirstOrDefault(s => s >= want) is var x && x > 0 ? x : Sizes[^1];

    /// <summary>Finds the picture for a track: (source key, loader) or null.</summary>
    public (string Key, Func<byte[]?> Load)? Source(TrackRow t)
    {
        try
        {
            var fi = new FileInfo(t.Path); if (!fi.Exists) return null;
            string? dirImage = FolderImage(fi.DirectoryName) ?? FolderImage(fi.Directory?.Parent?.FullName, onlyIfSiblingDisc: fi.Directory?.Name);
            // embedded art wins (it is what the tagger chose for this exact file)
            if (HasEmbedded(t)) return ("emb|" + t.Path + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks, () => ReadEmbedded(t.Path));
            if (dirImage != null) { var di = new FileInfo(dirImage); return ("dir|" + dirImage + "|" + di.Length + "|" + di.LastWriteTimeUtc.Ticks, () => File.ReadAllBytes(dirImage)); }
        }
        catch { }
        return null;
    }

    private bool HasEmbedded(TrackRow t) => Convert.ToInt32(_lib.Scalar("SELECT has_art FROM track WHERE id=$i", ("$i", t.Id))) != 0;

    public static byte[]? ReadEmbedded(string path)
    {
        try { using var tf = TagLib.File.Create(path, TagLib.ReadStyle.Average); var pic = tf.Tag.Pictures.FirstOrDefault(p => p.Type == TagLib.PictureType.FrontCover) ?? tf.Tag.Pictures.FirstOrDefault(); return pic?.Data.Data; }
        catch { return null; }
    }

    private static string? FolderImage(string? dir, string? onlyIfSiblingDisc = null)
    {
        if (dir == null || !Directory.Exists(dir)) return null;
        if (onlyIfSiblingDisc != null && !System.Text.RegularExpressions.Regex.IsMatch(onlyIfSiblingDisc, @"^(cd|disc|disk)\s*\d+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return null;
        try
        {
            var files = Directory.EnumerateFiles(dir).Where(f => Exts.Contains(Path.GetExtension(f), StringComparer.OrdinalIgnoreCase)).ToList();
            foreach (var n in Names) { var m = files.FirstOrDefault(f => string.Equals(Path.GetFileNameWithoutExtension(f), n, StringComparison.OrdinalIgnoreCase)); if (m != null) return m; }
        }
        catch { }
        return null;
    }

    /// <summary>0.2.1 F13: online covers / artist photos (Cover Art Archive, Wikidata), null = off.</summary>
    public OnlineArt? Online { get; set; }

    /// <summary>Returns the cached/rendered JPEG bytes, or null when this track has no picture. 0.2.1: no embedded or folder picture
    /// falls back to the album's online cover (cached; looked up in the background the first time).</summary>
    public async Task<byte[]?> GetAsync(TrackRow t, int size, CancellationToken ct)
    {
        var src = Source(t);
        if (src == null)
        {
            var who = string.IsNullOrWhiteSpace(t.AlbumArtist) ? t.Artist : t.AlbumArtist;
            if (Online == null || string.IsNullOrWhiteSpace(t.Album)) return null;
            var key = Online.CacheKey("album", who, t.Album);
            if (key == null) { Online.Album(who, t.Album); return null; }       // queues the lookup; the generated cover shows meanwhile
            return await Cached("online|" + key, () => Online.Album(who, t.Album), size, ct);
        }
        return await Cached(src.Value.Key, src.Value.Load, size, ct);
    }
    /// <summary>0.2.1 F13: an artist photo (online, cached), or null - the web UI then draws a generated portrait.</summary>
    public async Task<byte[]?> ArtistAsync(string name, int size, CancellationToken ct)
    {
        if (Online == null || string.IsNullOrWhiteSpace(name)) return null;
        var key = Online.CacheKey("artist", name);
        if (key == null) { Online.Artist(name); return null; }
        return await Cached("online|" + key, () => Online.Artist(name), size, ct);
    }

    private async Task<byte[]?> Cached(string srcKey, Func<byte[]?> load, int size, CancellationToken ct)
    {
        size = SnapSize(size);
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(srcKey))).ToLowerInvariant();
        var file = Path.Combine(_cache, $"v{CacheVersion}-{hash}-{size}.jpg");
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
        if (_none.ContainsKey(hash)) return null;
        await _gate.WaitAsync(ct);
        try
        {
            if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
            var raw = load(); if (raw == null || raw.Length == 0) { _none[hash] = true; return null; }
            var jpg = await ResizeAsync(raw, size, ct);
            if (jpg == null) { _none[hash] = true; return null; }
            var tmp = file + "." + Environment.CurrentManagedThreadId + ".tmp"; await File.WriteAllBytesAsync(tmp, jpg, ct); File.Move(tmp, file, true);
            return jpg;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Fetch a remote image (e.g. Radio Browser favicon), resize to JPEG, cache under artcache/remote-*.</summary>
    public async Task<byte[]?> GetRemoteAsync(string? url, int size, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return null;
        size = SnapSize(size);
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(u.AbsoluteUri))).ToLowerInvariant();
        var file = Path.Combine(_cache, $"remote-v{CacheVersion}-{hash}-{size}.jpg");
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
        if (_none.ContainsKey("r:" + hash)) return null;
        await _gate.WaitAsync(ct);
        try
        {
            if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("WavWiz/" + WavWiz.Core.WavWizInfo.Version);
            byte[] raw;
            try { raw = await http.GetByteArrayAsync(u, ct); }
            catch { _none["r:" + hash] = true; return null; }
            if (raw.Length < 32 || raw.Length > 8_000_000) { _none["r:" + hash] = true; return null; }
            var jpg = await ResizeAsync(raw, size, ct);
            if (jpg == null) { _none["r:" + hash] = true; return null; }
            var tmp = file + "." + Environment.CurrentManagedThreadId + ".tmp"; await File.WriteAllBytesAsync(tmp, jpg, ct); File.Move(tmp, file, true);
            return jpg;
        }
        finally { _gate.Release(); }
    }

    public Task<byte[]?> ThumbAsync(byte[] raw, int size, CancellationToken ct = default) => ResizeAsync(raw, size, ct);
    private async Task<byte[]?> ResizeAsync(byte[] raw, int size, CancellationToken ct)
    {
        if (Sniff(raw) == null) return null;
        // strict decode (no error concealment), 8-bit RGB first (CMYK/YCCK, 16-bit, palette, alpha), even sizes, then a baseline 4:2:0 JPEG
        var vf = $"format=rgb24,scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale='max(2,trunc(iw/2)*2)':'max(2,trunc(ih/2)*2)',format=yuvj420p";
        var (jpg, err) = await Ffmpeg(raw, new[] { "-v", "error", "-err_detect", "explode", "-xerror", "-i", "pipe:0", "-vf", vf, "-frames:v", "1", "-q:v", "4", "-f", "mjpeg", "pipe:1" }, ct);
        if (jpg == null || !string.IsNullOrWhiteSpace(err) || !LooksLikeJpeg(jpg)) return null;
        // validate what we made: it must decode cleanly, and must not be striped noise
        var (px, err2) = await Ffmpeg(jpg, new[] { "-v", "error", "-err_detect", "explode", "-xerror", "-i", "pipe:0", "-vf", "scale=32:32:flags=area,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1" }, ct);
        if (px == null || px.Length != 32 * 32 * 3 || !string.IsNullOrWhiteSpace(err2) || LooksStriped(px, 32, 32)) return null;
        return jpg;
    }

    private async Task<(byte[]? Out, string Err)> Ffmpeg(byte[] input, string[] args, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(_ffmpeg) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        try
        {
            using var p = Process.Start(psi)!; using var tk = CancellationTokenSource.CreateLinkedTokenSource(ct); tk.CancelAfter(TimeSpan.FromSeconds(20));
            var err = p.StandardError.ReadToEndAsync(tk.Token);
            var wr = Task.Run(async () => { try { await p.StandardInput.BaseStream.WriteAsync(input, tk.Token); } catch { } finally { try { p.StandardInput.Close(); } catch { } } });
            using var ms = new MemoryStream(); await p.StandardOutput.BaseStream.CopyToAsync(ms, tk.Token);
            await wr; await p.WaitForExitAsync(tk.Token);
            var e = await err;
            return p.ExitCode == 0 && ms.Length > 0 ? (ms.ToArray(), e) : (null, e);
        }
        catch { return (null, "failed"); }
    }
}
