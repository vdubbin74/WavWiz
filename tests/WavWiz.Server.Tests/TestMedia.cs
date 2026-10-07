using System.Diagnostics;
namespace WavWiz.Server.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "wavwiz-test-" + Guid.NewGuid().ToString("N")[..8]);
    public TempDir() { Directory.CreateDirectory(Path); }
    public string File(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose() { try { Directory.Delete(Path, true); } catch { } }
}

public static class TestMedia
{
    public static string Ffmpeg => Environment.GetEnvironmentVariable("WAVWIZ_FFMPEG") ?? "ffmpeg";

    public static void Run(params string[] args)
    {
        var psi = new ProcessStartInfo(Ffmpeg) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false };
        foreach (var a in new[] { "-y", "-hide_banner", "-loglevel", "error" }.Concat(args)) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!; var err = p.StandardError.ReadToEnd(); p.WaitForExit();
        if (p.ExitCode != 0) throw new Exception("ffmpeg failed: " + err);
    }

    /// <summary>A tagged tone file. title/artist/album become real tags (flac/mp3/m4a/ogg).</summary>
    public static string Tone(string path, double seconds, double hz = 440, string title = "Tone", string artist = "Test Artist", string album = "Test Album", int track = 1, string genre = "Test", int? year = null, string? artPng = null)
    {
        var a = new List<string> { "-f", "lavfi", "-i", $"sine=frequency={hz.ToString(System.Globalization.CultureInfo.InvariantCulture)}:sample_rate=48000:duration={seconds.ToString(System.Globalization.CultureInfo.InvariantCulture)}" };
        if (artPng != null) { a.AddRange(new[] { "-i", artPng, "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg", "-id3v2_version", "3" }); }
        a.AddRange(new[] { "-ac", "2", "-metadata", $"title={title}", "-metadata", $"artist={artist}", "-metadata", $"album={album}", "-metadata", $"track={track}", "-metadata", $"genre={genre}" });
        if (year != null) a.AddRange(new[] { "-metadata", $"date={year}" });
        a.Add(path); Run(a.ToArray());
        return path;
    }

    /// <summary>A small solid-color PNG, used as embedded or folder cover art.</summary>
    public static string Png(string path, string color = "orange") { Run("-f", "lavfi", "-i", $"color=c={color}:s=300x300:d=1", "-frames:v", "1", path); return path; }
}
