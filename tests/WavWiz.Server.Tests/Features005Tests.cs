using WavWiz.Server;
using WavWiz.Server.Features;
namespace WavWiz.Server.Tests;

public class Features005Tests
{
    [Fact]
    public void TagFix_Status_reports_missing_key_without_throwing()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var db = new Db(Path.Combine(dir, "t.db"));
            db.Migrate();
            var lib = new WavWiz.Server.Library.LibraryService(db);
            var art = new WavWiz.Server.Library.ArtService(lib, dir, "ffmpeg");
            var ev = new EventHub();
            var tags = new TagFixService(db, lib, art, ev, "ffmpeg");
            var st = tags.Status();
            var json = System.Text.Json.JsonSerializer.Serialize(st);
            Assert.Contains("acoustIdConfigured", json);
            Assert.Contains("false", json); // no key
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void CdRip_Formats_default_flac_and_mp3_unavailable()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var db = new Db(Path.Combine(dir, "t.db"));
            db.Migrate();
            var cfg = new ServerConfig { DataDir = dir };
            var lib = new WavWiz.Server.Library.LibraryService(db);
            var ev = new EventHub();
            var rip = new CdRipService(db, cfg, lib, ev, "ffmpeg");
            var f = rip.Formats();
            var json = System.Text.Json.JsonSerializer.Serialize(f);
            Assert.Contains("\"defaultFormat\":\"flac\"", json);
            Assert.Contains("\"id\":\"mp3\"", json);
            Assert.Contains("\"available\":false", json);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}
