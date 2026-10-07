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

    public ArtService(LibraryService lib, string dataDir, string ffmpeg) { _lib = lib; _cache = Path.Combine(dataDir, "artcache"); _ffmpeg = ffmpeg; Directory.CreateDirectory(_cache); }

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

    private static byte[]? ReadEmbedded(string path)
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

    /// <summary>Returns the cached/rendered JPEG bytes, or null when this track has no picture.</summary>
    public async Task<byte[]?> GetAsync(TrackRow t, int size, CancellationToken ct)
    {
        size = SnapSize(size);
        var src = Source(t); if (src == null) return null;
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(src.Value.Key))).ToLowerInvariant();
        var file = Path.Combine(_cache, $"{hash}-{size}.jpg");
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
        if (_none.ContainsKey(hash)) return null;
        await _gate.WaitAsync(ct);
        try
        {
            if (File.Exists(file)) return await File.ReadAllBytesAsync(file, ct);
            var raw = src.Value.Load(); if (raw == null || raw.Length == 0) { _none[hash] = true; return null; }
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
        var file = Path.Combine(_cache, $"remote-{hash}-{size}.jpg");
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

    private async Task<byte[]?> ResizeAsync(byte[] raw, int size, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(_ffmpeg) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in new[] { "-v", "error", "-i", "pipe:0", "-vf", $"scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=yuvj420p", "-frames:v", "1", "-q:v", "4", "-f", "mjpeg", "pipe:1" }) psi.ArgumentList.Add(a);
        try
        {
            using var p = Process.Start(psi)!; using var tk = CancellationTokenSource.CreateLinkedTokenSource(ct); tk.CancelAfter(TimeSpan.FromSeconds(20));
            var err = p.StandardError.ReadToEndAsync(tk.Token);
            var wr = Task.Run(async () => { try { await p.StandardInput.BaseStream.WriteAsync(raw, tk.Token); } catch { } finally { try { p.StandardInput.Close(); } catch { } } });
            using var ms = new MemoryStream(); await p.StandardOutput.BaseStream.CopyToAsync(ms, tk.Token);
            await wr; await p.WaitForExitAsync(tk.Token);
            return p.ExitCode == 0 && ms.Length > 100 ? ms.ToArray() : null;
        }
        catch { return null; }
    }
}
