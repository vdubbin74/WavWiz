using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.3.2 F10/F11 (P0): album/artist art showed as letter tiles because the 0.3.1 validator asked ffmpeg for "-f rawvideo", which the
/// shipped LGPL ffmpeg does not have. These tests run against the SHIPPED ffmpeg.exe (under Wine on the build box; set WAVWIZ_SHIPPED_FFMPEG).</summary>
public class Release032ArtTests
{
    static string Fx(string n) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "art", n);
    public static string Shipped => Environment.GetEnvironmentVariable("WAVWIZ_SHIPPED_FFMPEG") is { Length: > 0 } e ? e
        : File.Exists("/workspace/tools-cache/ffmpeg-shipped-wine.sh") ? "/workspace/tools-cache/ffmpeg-shipped-wine.sh" : "ffmpeg";
    static (ArtService Art, LibraryService Lib, string Dir) Make(string? ff = null, Action<string>? before = null)
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-f10-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(dir);
        before?.Invoke(dir);
        var db = new Db(Path.Combine(dir, "t.db")); db.Migrate(); var lib = new LibraryService(db);
        return (new ArtService(lib, dir, ff ?? Shipped), lib, dir);
    }
    static void Del(string d) { try { Directory.Delete(d, true); } catch { } }

    [Fact]
    public void Shipped_ffmpeg_really_lacks_rawvideo_so_the_validator_must_not_need_it()
    {
        var psi = new ProcessStartInfo(Shipped) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-hide_banner", "-muxers" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!; var o = p.StandardOutput.ReadToEnd(); p.WaitForExit();
        Assert.Contains("mjpeg", o);
        if (Shipped != "ffmpeg") Assert.DoesNotContain(" rawvideo ", o);
    }

    [Theory]
    [InlineData("baseline.jpg")] [InlineData("progressive.jpg")] [InlineData("cmyk.jpg")] [InlineData("plain.png")] [InlineData("palette.png")]
    public async Task Shipped_ffmpeg_makes_real_thumbnails_with_correct_colors(string name)
    {
        var (art, _, dir) = Make();
        try
        {
            ArtService.ValidatorLog.Clear();
            foreach (var size in new[] { 96, 384 })
            {
                var jpg = await art.ThumbAsync(File.ReadAllBytes(Fx(name)), size);
                Assert.True(ArtService.LooksLikeJpeg(jpg), name + " " + size);
                var (px, w, h) = JpegDc.Decode(jpg!);
                int c = ((h / 2) * w + w / 2) * 3;                              // center = the yellow disc (240,200,40)
                Assert.InRange(px[c], 190, 255); Assert.InRange(px[c + 1], 150, 240); Assert.InRange(px[c + 2], 0, 110);
                Assert.False(ArtService.LooksStriped(px, w, h));
            }
            Assert.Empty(ArtService.ValidatorLog);                              // the check itself worked (no "could not check")
        }
        finally { Del(dir); }
    }

    [Fact]
    public async Task Shipped_ffmpeg_still_rejects_corrupt_and_striped_pictures()
    {
        var (art, _, dir) = Make();
        try
        {
            Assert.Null(await art.ThumbAsync(File.ReadAllBytes(Fx("corrupt.jpg")), 96));
            Assert.Null(await art.ThumbAsync(System.Text.Encoding.UTF8.GetBytes("http://example.com/cover.jpg not a picture at all"), 96));
        }
        finally { Del(dir); }
    }

    [Fact]
    public async Task Validator_crash_keeps_the_thumbnail_and_logs_it()
    {
        var (art, _, dir) = Make();
        try
        {
            ArtService.ValidatorLog.Clear();
            art.ValidatorOverride = _ => throw new InvalidOperationException("simulated validator crash");
            var jpg = await art.ThumbAsync(File.ReadAllBytes(Fx("baseline.jpg")), 192);
            Assert.True(ArtService.LooksLikeJpeg(jpg));
            Assert.Contains(ArtService.ValidatorLog, l => l.Contains("simulated validator crash") && l.Contains("kept"));
            art.ValidatorOverride = _ => false;                                  // a confirmed bad picture is still rejected
            Assert.Null(await art.ThumbAsync(File.ReadAllBytes(Fx("plain.png")), 192));
        }
        finally { Del(dir); }
    }

    static void Tone(string f)
    {
        var psi = new ProcessStartInfo("ffmpeg") { UseShellExecute = false, RedirectStandardError = true };
        foreach (var a in new[] { "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1", f }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!; p.WaitForExit();
    }
    static void Embed(string f, string fx, string mime)
    {
        using var tf = TagLib.File.Create(f);
        tf.Tag.Title = Path.GetFileNameWithoutExtension(f); tf.Tag.Album = "A " + fx; tf.Tag.Performers = new[] { "Artist" };
        tf.Tag.Pictures = new TagLib.IPicture[] { new TagLib.Picture(new TagLib.ByteVector(File.ReadAllBytes(Fx(fx)))) { Type = TagLib.PictureType.FrontCover, MimeType = mime } };
        tf.Save();
    }

    [Fact]
    public async Task User_like_library_shows_real_art_after_upgrading_from_031_without_manual_cache_delete()
    {
        // a 0.3.1 data folder: cache.version = 2 and its leftovers
        var (art, lib, dir) = Make(before: d =>
        {
            var ac = Path.Combine(d, "artcache"); Directory.CreateDirectory(ac);
            File.WriteAllText(Path.Combine(ac, "cache.version"), "2");
            File.WriteAllText(Path.Combine(ac, "v2-deadbeef-192.jpg"), "stale scrambled 0.3.0/0.3.1 thumbnail");
        });
        try
        {
            Assert.False(File.Exists(Path.Combine(dir, "artcache", "v2-deadbeef-192.jpg")));
            Assert.Equal(ArtService.CacheVersion.ToString(), File.ReadAllText(Path.Combine(dir, "artcache", "cache.version")).Trim());
            var music = Path.Combine(dir, "music");
            var a1 = Directory.CreateDirectory(Path.Combine(music, "EmbJpeg")).FullName; Tone(Path.Combine(a1, "01.mp3")); Embed(Path.Combine(a1, "01.mp3"), "baseline.jpg", "image/jpeg");
            var a2 = Directory.CreateDirectory(Path.Combine(music, "EmbPng")).FullName; Tone(Path.Combine(a2, "01.flac")); Embed(Path.Combine(a2, "01.flac"), "plain.png", "image/png");
            var a3 = Directory.CreateDirectory(Path.Combine(music, "Folder")).FullName; Tone(Path.Combine(a3, "01.mp3")); File.Copy(Fx("progressive.jpg"), Path.Combine(a3, "folder.jpg"));
            var a4 = Directory.CreateDirectory(Path.Combine(music, "FolderPng")).FullName; Tone(Path.Combine(a4, "01.flac")); File.Copy(Fx("palette.png"), Path.Combine(a4, "cover.png"));
            var a5 = Directory.CreateDirectory(Path.Combine(music, "NoArt")).FullName; Tone(Path.Combine(a5, "01.mp3"));
            lib.AddRoot(music); lib.Scan();
            int real = 0;
            for (long id = 1; id <= 5; id++)
            {
                var t = lib.Track(id); Assert.NotNull(t);
                var jpg = await art.GetAsync(t!, 192, default);
                if (t!.Path.Contains("NoArt")) { Assert.Null(jpg); continue; }       // genuinely missing: letter tile stays the fallback
                Assert.True(ArtService.LooksLikeJpeg(jpg), t.Path);
                var (px, w, h) = JpegDc.Decode(jpg!); Assert.False(ArtService.LooksStriped(px, w, h), t.Path); real++;
            }
            Assert.Equal(4, real);
        }
        finally { Del(dir); }
    }

    [Fact]
    public void Upgrade_clears_the_negative_cache()
    {
        var (art, _, dir) = Make();
        try { Assert.Equal(0, art.NegativeCount); Assert.False(ArtService.UpgradeCache(Path.Combine(dir, "artcache"))); }
        finally { Del(dir); }
    }

    [Fact]
    public void Art_urls_are_versioned_and_unversioned_requests_revalidate_with_an_etag()
    {
        Assert.Contains(WavWiz.Core.WavWizInfo.Version, ArtService.UrlVersion);
        Assert.StartsWith(ArtService.CacheVersion + ".", ArtService.UrlVersion);
        var jpg = File.ReadAllBytes(Fx("baseline.jpg"));
        var c1 = new DefaultHttpContext(); c1.Request.QueryString = new QueryString("?size=192&cv=" + ArtService.UrlVersion);
        Api.LibraryApi.Send(c1, jpg, 120); Assert.Equal("private, max-age=604800", c1.Response.Headers.CacheControl.ToString());
        var tag = c1.Response.Headers.ETag.ToString(); Assert.Contains(ArtService.UrlVersion, tag);
        var c2 = new DefaultHttpContext(); c2.Request.QueryString = new QueryString("?size=192");                    // old, unversioned URL
        Api.LibraryApi.Send(c2, jpg, 120); Assert.Equal("private, no-cache", c2.Response.Headers.CacheControl.ToString());
        var c3 = new DefaultHttpContext(); c3.Request.Headers.IfNoneMatch = tag;
        var r = Api.LibraryApi.Send(c3, jpg, 120); Assert.Equal(304, (r as Microsoft.AspNetCore.Http.HttpResults.StatusCodeHttpResult)?.StatusCode);
        var c4 = new DefaultHttpContext(); c4.Request.Headers.IfNoneMatch = "\"2.0.3.1-0000000000000000\"";            // a 0.3.1 tag never matches
        Assert.IsNotType<Microsoft.AspNetCore.Http.HttpResults.StatusCodeHttpResult>(Api.LibraryApi.Send(c4, jpg, 120));
    }

    [Fact]
    public void Managed_dc_reader_agrees_with_ffmpeg_block_means()
    {
        foreach (var n in new[] { "baseline.jpg" })
        {
            var (px, w, h) = JpegDc.Decode(File.ReadAllBytes(Fx(n)));
            Assert.True(w > 0 && h > 0 && px.Length == w * h * 3);
        }
        Assert.Throws<NotSupportedException>(() => JpegDc.Decode(File.ReadAllBytes(Fx("progressive.jpg"))));
        Assert.ThrowsAny<Exception>(() => JpegDc.Decode(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 }));
    }
}
