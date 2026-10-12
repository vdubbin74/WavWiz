using System.Diagnostics;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.3.1 B19: artist / album thumbnails - every common image kind makes a clean thumbnail; damaged data never does (the UI then shows
/// its themed initials tile); the cache is rebuilt once on upgrade.</summary>
public class Release031ArtTests
{
    static string Fx(string n) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "art", n);
    static (ArtService Art, string Dir) Make()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-b19-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(dir);
        var db = new Db(Path.Combine(dir, "t.db")); db.Migrate();
        return (new ArtService(new LibraryService(db), dir, "ffmpeg"), dir);
    }
    static byte[] Rgb(byte[] jpg)
    {
        var psi = new ProcessStartInfo("ffmpeg") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-v", "error", "-i", "pipe:0", "-vf", "scale=8:8:flags=area,format=rgb24", "-f", "rawvideo", "pipe:1" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!; p.StandardInput.BaseStream.Write(jpg); p.StandardInput.Close();
        using var ms = new MemoryStream(); p.StandardOutput.BaseStream.CopyTo(ms); p.WaitForExit(); return ms.ToArray();
    }

    [Theory]
    [InlineData("baseline.jpg")] [InlineData("progressive.jpg")] [InlineData("cmyk.jpg")] [InlineData("plain.png")] [InlineData("palette.png")]
    public async Task Good_images_make_clean_thumbnails_with_the_right_colors(string name)
    {
        var (art, dir) = Make();
        try
        {
            var jpg = await art.ThumbAsync(File.ReadAllBytes(Fx(name)), 96);
            Assert.True(ArtService.LooksLikeJpeg(jpg), name);
            var px = Rgb(jpg!); Assert.Equal(8 * 8 * 3, px.Length);
            // the center is the yellow disc (240,200,40); the left-top corner is dark blue-ish - wrong pixel formats / CMYK inversion break this
            int c = (4 * 8 + 4) * 3; Assert.InRange(px[c], 190, 255); Assert.InRange(px[c + 1], 150, 240); Assert.InRange(px[c + 2], 0, 110);
            Assert.False(ArtService.LooksStriped(px, 8, 8));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public async Task Corrupt_or_non_image_data_gives_no_thumbnail()
    {
        var (art, dir) = Make();
        try
        {
            Assert.Null(await art.ThumbAsync(File.ReadAllBytes(Fx("corrupt.jpg")), 96));
            Assert.Null(await art.ThumbAsync(System.Text.Encoding.UTF8.GetBytes("http://example.com/cover.jpg not a picture at all"), 96));
            Assert.Null(ArtService.Sniff(new byte[3]));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void Striped_magenta_green_noise_is_detected_but_smooth_green_or_purple_covers_pass()
    {
        byte[] Fill(Func<int, (byte, byte, byte)> row) { var b = new byte[16 * 16 * 3]; for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) { var (r, g, bl) = row(y); int i = (y * 16 + x) * 3; b[i] = r; b[i + 1] = g; b[i + 2] = bl; } return b; }
        Assert.True(ArtService.LooksStriped(Fill(y => y % 2 == 0 ? ((byte)230, (byte)20, (byte)220) : ((byte)20, (byte)230, (byte)30)), 16, 16));
        Assert.False(ArtService.LooksStriped(Fill(_ => (20, 200, 40)), 16, 16));
        Assert.False(ArtService.LooksStriped(Fill(_ => (200, 20, 200)), 16, 16));
    }

    [Theory]
    [InlineData("mp3")] [InlineData("flac")]
    public async Task Embedded_ID3_and_FLAC_art_is_read_and_thumbnailed(string ext)
    {
        var (art, dir) = Make();
        try
        {
            var f = Path.Combine(dir, "t." + ext);
            var psi = new ProcessStartInfo("ffmpeg") { UseShellExecute = false, RedirectStandardError = true };
            foreach (var a in new[] { "-v", "error", "-f", "lavfi", "-i", "sine=d=1", f }) psi.ArgumentList.Add(a);
            using (var p = Process.Start(psi)!) p.WaitForExit();
            using (var tf = TagLib.File.Create(f))
            {
                tf.Tag.Pictures = new TagLib.IPicture[] { new TagLib.Picture(new TagLib.ByteVector(File.ReadAllBytes(Fx("progressive.jpg")))) { Type = TagLib.PictureType.FrontCover, MimeType = "image/jpeg" } };
                tf.Save();
            }
            var raw = ArtService.ReadEmbedded(f); Assert.NotNull(raw);
            Assert.True(ArtService.LooksLikeJpeg(await art.ThumbAsync(raw!, 192)));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void Cache_is_cleared_once_on_upgrade()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-b19c-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllText(Path.Combine(dir, "abc-96.jpg"), "old");
            ArtService.UpgradeCache(dir);
            Assert.False(File.Exists(Path.Combine(dir, "abc-96.jpg")));
            File.WriteAllText(Path.Combine(dir, $"v{ArtService.CacheVersion}-abc-96.jpg"), "new");
            ArtService.UpgradeCache(dir);                                                // already upgraded: kept
            Assert.True(File.Exists(Path.Combine(dir, $"v{ArtService.CacheVersion}-abc-96.jpg")));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}
