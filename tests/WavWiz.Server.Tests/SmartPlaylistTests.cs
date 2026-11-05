using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Features;
using WavWiz.Server.Media;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>Smart playlists: rules (AND), preview count, save / restart, Play, Keep playing → Smart.</summary>
public class SmartPlaylistTests
{
    [Fact]
    public async Task Rules_preview_save_play_and_keep_playing_smart()
    {
        await using var f = await ServerFixture.StartAsync(); var S = f.Server.S; var admin = f.As(f.Token(Role.Admin));
        var old = DateTimeOffset.UtcNow.AddDays(-400);
        long j1 = KeepPlayingTests.Track(S.Db, "J1", "Miles", "Cool Jazz", 1959, old), j2 = KeepPlayingTests.Track(S.Db, "J2", "Bill", "Jazz", 1961), r1 = KeepPlayingTests.Track(S.Db, "R1", "Band", "Rock", 1995);
        var p = await (await admin.PostAsJsonAsync("/api/v1/smart/preview", new { rules = new { genre = "jazz" } })).Json(); Assert.Equal(2, p.GetProperty("count").GetInt32());
        p = await (await admin.PostAsJsonAsync("/api/v1/smart/preview", new { rules = new { genre = "jazz", genreMatch = "equals" } })).Json(); Assert.Equal(1, p.GetProperty("count").GetInt32());
        p = await (await admin.PostAsJsonAsync("/api/v1/smart/preview", new { rules = new { genre = "jazz", yearMax = 1960 } })).Json(); Assert.Equal(1, p.GetProperty("count").GetInt32());
        p = await (await admin.PostAsJsonAsync("/api/v1/smart/preview", new { rules = new { addedDays = 30 } })).Json(); Assert.Equal(2, p.GetProperty("count").GetInt32());
        p = await (await admin.PostAsJsonAsync("/api/v1/smart/preview", new { rules = new { artist = "mil" } })).Json(); Assert.Equal(1, p.GetProperty("count").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/smart", new { name = "Empty", rules = new { } })).StatusCode);
        var id = (await (await admin.PostAsJsonAsync("/api/v1/smart", new { name = "Jazz", rules = new { genre = "jazz" } })).Json()).GetProperty("id").GetInt64();
        var fresh = new SmartPlaylistService(S.Db); Assert.Equal("Jazz", fresh.Get(id)!.Name);   // saved in the database
        var list = await admin.GetJson("/api/v1/smart"); Assert.Equal(2, list[0].GetProperty("count").GetInt32()); Assert.True(list[0].GetProperty("smart").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "smart", id })).StatusCode);
        Assert.Equal(new long?[] { j2, j1 }.OrderBy(x => x), S.Conductor.Queue().Select(x => x.RefId).OrderBy(x => x));
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "smart", id })).StatusCode);
        var k = await admin.GetJson("/api/v1/queue/keep"); Assert.Equal("Jazz", k.GetProperty("name").GetString());
        var it = S.Keep.Pick(Conductor.DefaultGroupId, S.Keep.Get(Conductor.DefaultGroupId), null, new List<QueueItem>());
        Assert.Contains(it!.RefId!.Value, new[] { j1, j2 }); _ = r1;
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/queue/keep", new { mode = "smart", id = 999 })).StatusCode);
    }
}
