using System.Text.Json;
using WavWiz.Server;
using WavWiz.Server.Features;
namespace WavWiz.Server.Tests;

public class Features004Tests
{
    [Fact]
    public void Db_migrates_to_v4()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wavwiz-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var db = new Db(Path.Combine(dir, "t.db"));
            db.Migrate();
            Assert.Equal(Db.Migrations.Length, db.Version());
            Assert.Equal(4, db.Version());
            // tables exist
            Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT COUNT(*) FROM scene")));
            Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT COUNT(*) FROM schedule")));
            Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT COUNT(*) FROM speaker_profile")));
            Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT COUNT(*) FROM tag_fix_job")));
            Assert.Equal(0L, Convert.ToInt64(db.Scalar("SELECT COUNT(*) FROM rip_job")));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void SpeakerFollow_normalizes_bt_address()
    {
        Assert.Equal("AA:BB:CC:DD:EE:FF", SpeakerFollowService.NormalizeBt("aa-bb-cc-dd-ee-ff"));
        Assert.Equal("AA:BB:CC:DD:EE:FF", SpeakerFollowService.NormalizeBt("AABBCCDDEEFF"));
        Assert.Null(SpeakerFollowService.NormalizeBt("not-a-mac"));
        Assert.Null(SpeakerFollowService.NormalizeBt(null));
    }

    [Fact]
    public void RemoteAccess_accepts_tailscale_cgnat()
    {
        Assert.True(RemoteAccess.IsPrivateOrTailscale(System.Net.IPAddress.Parse("100.64.1.2")));
        Assert.True(RemoteAccess.IsPrivateOrTailscale(System.Net.IPAddress.Parse("192.168.1.1")));
        Assert.False(RemoteAccess.IsPrivateOrTailscale(System.Net.IPAddress.Parse("8.8.8.8")));
    }
}
