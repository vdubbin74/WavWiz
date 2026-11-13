using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 Jukebox: J1 a queued song with no picture of its own gets its album's cover on the Jukebox screens (the general art endpoint
/// is unchanged); J3 the per-guest limit, bans and votes also follow the phone's network address (salted, in-memory), so clearing the browser
/// does not give fresh picks, and the host can reset guests; J4 add reports the position, a guest removes only their own waiting pick.</summary>
[Collection("serial")]
public class Release069JukeboxTests
{
    static async Task<(ServerFixture f, HttpClient admin, List<long> ids, string code)> Setup(int songs = 8)
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var dir = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        for (int i = 1; i <= songs; i++) TestMedia.Tone(Path.Combine(dir, $"{i}.flac"), 60, 440, $"Song {i}", "Band " + i, "Album " + i, i);
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = dir });
        for (int i = 0; i < 200; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == songs) break; await Task.Delay(100); }
        var ids = (await admin.GetJson("/api/v1/library/search?q=song")).EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).OrderBy(x => x).ToList();
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { perGuest = 3 });
        var code = (await (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).Json()).GetProperty("code").GetString()!;
        return (f, admin, ids, code);
    }
    static int Left(object board) => JsonSerializer.SerializeToElement(board, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("playsLeft").GetInt32();

    [Fact]
    public void J3_network_key_is_salted_hashed_and_skips_the_server_itself()
    {
        var jb = new WavWiz.Server.Features.JukeboxService(null!, null!, null!);
        var a = jb.NetKey(IPAddress.Parse("192.168.1.50")); var mapped = jb.NetKey(IPAddress.Parse("::ffff:192.168.1.50")); var b = jb.NetKey(IPAddress.Parse("192.168.1.51"));
        Assert.NotNull(a); Assert.Equal(a, mapped); Assert.NotEqual(a, b);
        Assert.DoesNotContain("192", a!); Assert.Equal(16, a!.Length);
        Assert.Null(jb.NetKey(IPAddress.Loopback)); Assert.Null(jb.NetKey(IPAddress.IPv6Loopback)); Assert.Null(jb.NetKey(null));
        Assert.NotEqual(a, new WavWiz.Server.Features.JukeboxService(null!, null!, null!).NetKey(IPAddress.Parse("192.168.1.50")));   // a fresh salt per service / session
    }

    [Fact]
    public async Task J3_clearing_the_browser_does_not_reset_the_limit_and_host_reset_frees_everyone()
    {
        var (f, admin, ids, code) = await Setup(); await using var _ = f; var jb = f.Server.S.Jukebox;
        for (int i = 0; i < 3; i++) Assert.Null(jb.Add("guest-aaaa-1", "Tbone", ids[i], "net-phone-1"));
        // the same phone after clearing its cache: a new random guest id, same address -> still at the limit
        Assert.Equal(0, Left(jb.Board(false, "guest-cleared-9", "net-phone-1")));
        Assert.NotNull(jb.Add("guest-cleared-9", "Tbone", ids[3], "net-phone-1"));
        // another phone is independent
        Assert.Equal(3, Left(jb.Board(false, "guest-bbbb-2", "net-phone-2")));
        Assert.Null(jb.Add("guest-bbbb-2", "Sam", ids[4], "net-phone-2"));
        // the cleared phone sees its earlier picks as its own
        var board = JsonSerializer.SerializeToElement(jb.Board(false, "guest-cleared-9", "net-phone-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.True(board.GetProperty("next").EnumerateArray().Count(x => x.GetProperty("mine").GetBoolean()) >= 2);
        // host Reset guests: full allowance again, songs stay queued with their names
        var before = f.Server.S.Conductor.Queue().Count;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/jukebox/guests/reset", new { })).StatusCode);
        Assert.Equal(before, f.Server.S.Conductor.Queue().Count);
        Assert.Equal(3, Left(jb.Board(false, "guest-cleared-9", "net-phone-1")));
        Assert.Null(jb.Add("guest-cleared-9", "Tbone", ids[3], "net-phone-1"));
        var host = JsonSerializer.SerializeToElement(jb.Board(true), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains(host.GetProperty("next").EnumerateArray(), x => x.GetProperty("by").GetString() == "Tbone");
        Assert.DoesNotContain("net-phone", host.GetRawText());   // the network key never reaches a page
    }

    [Fact]
    public async Task J3_a_ban_and_a_vote_follow_the_phone_not_the_browser_id()
    {
        var (f, admin, ids, code) = await Setup(); await using var _ = f; var jb = f.Server.S.Jukebox;
        await admin.PutAsJsonAsync("/api/v1/jukebox/config", new { votesNeeded = 2 });
        Assert.Null(jb.Add("guest-aaaa-1", "A", ids[0], "net-a"));
        jb.Ban("guest-aaaa-1");
        Assert.NotNull(jb.Add("guest-newid-77", "A", ids[1], "net-a"));        // cleared browser, same phone: still banned
        Assert.Null(jb.Add("guest-bbbb-2", "B", ids[2], "net-b"));
        var c = f.Server.S.Conductor; var playing = c.Now().Item!.Id;
        var v1 = jb.Vote("guest-bbbb-2", "net-b"); Assert.Equal(1, v1.Votes);
        var v2 = jb.Vote("guest-other-3", "net-b"); Assert.Equal(1, v2.Votes); Assert.False(v2.Skipped);   // same phone, new id: not a 2nd vote
        var board = JsonSerializer.SerializeToElement(jb.Board(false, "guest-other-3", "net-b"), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.True(board.GetProperty("voted").GetBoolean());
        var v3 = jb.Vote("guest-cccc-4", "net-c"); Assert.True(v3.Skipped); Assert.NotEqual(playing, c.Now().Item!.Id);
        jb.ResetGuests(); Assert.Null(jb.Add("guest-newid-77", "A", ids[3], "net-a"));   // reset lifts the ban
    }

    [Fact]
    public async Task J4_add_reports_the_position_and_a_guest_removes_only_their_own_waiting_pick()
    {
        var (f, admin, ids, code) = await Setup(); await using var _ = f; var jb = f.Server.S.Jukebox;
        var anon = new HttpClient { BaseAddress = new Uri(f.Base) }; anon.DefaultRequestHeaders.Add("X-WavWiz-Guest", code);
        var r0 = await (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", trackId = ids[0] })).Json();
        Assert.Equal(0, r0.GetProperty("position").GetInt32());                  // first song plays at once
        var r1 = await (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-bbbb-2", name = "B", trackId = ids[1] })).Json();
        Assert.Equal(1, r1.GetProperty("position").GetInt32());
        var r2 = await (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/add", new { guest = "guest-aaaa-1", name = "A", trackId = ids[2] })).Json();
        Assert.Equal(2, r2.GetProperty("position").GetInt32());
        var next = (await anon.GetJson("/api/v1/jukebox/guest/board?g=guest-aaaa-1")).GetProperty("next").EnumerateArray().ToList();
        long bItem = next[0].GetProperty("id").GetInt64(), aItem = next[1].GetProperty("id").GetInt64();
        Assert.True(next[1].GetProperty("mine").GetBoolean()); Assert.False(next[0].GetProperty("mine").GetBoolean());
        Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/remove", new { guest = "guest-aaaa-1", id = bItem })).StatusCode);   // not yours
        var nowItem = f.Server.S.Conductor.Now().Item!.Id;
        Assert.Equal((HttpStatusCode)409, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/remove", new { guest = "guest-aaaa-1", id = nowItem })).StatusCode);  // playing now
        Assert.Equal(1, (await anon.GetJson("/api/v1/jukebox/guest/board?g=guest-aaaa-1")).GetProperty("playsLeft").GetInt32());
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/v1/jukebox/guest/remove", new { guest = "guest-aaaa-1", id = aItem })).StatusCode);
        Assert.DoesNotContain(f.Server.S.Conductor.Queue(), x => x.Id == aItem);
        Assert.Equal(2, (await anon.GetJson("/api/v1/jukebox/guest/board?g=guest-aaaa-1")).GetProperty("playsLeft").GetInt32());   // the pick is theirs again
        var bad = new HttpClient { BaseAddress = new Uri(f.Base) }; bad.DefaultRequestHeaders.Add("X-WavWiz-Guest", "nope");
        Assert.Equal(HttpStatusCode.Forbidden, (await bad.PostAsJsonAsync("/api/v1/jukebox/guest/remove", new { guest = "guest-bbbb-2", id = bItem })).StatusCode);
    }

    [Fact]
    public async Task J1_a_song_without_its_own_picture_gets_its_album_cover_on_the_jukebox_only()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        // a mixed folder (two albums, no folder picture): "Until It Sleeps" has no embedded picture, "Ain't My Bitch" (same album) has one
        var mixed = Directory.CreateDirectory(Path.Combine(music, "Metallica")).FullName;
        var png = TestMedia.Png(Path.Combine(f.Dir.Path, "load.png"), "red");
        TestMedia.Tone(Path.Combine(mixed, "01.mp3"), 1, 300, "Ain't My Bitch", "Metallica", "Load", 1, artPng: png);
        TestMedia.Tone(Path.Combine(mixed, "04.mp3"), 1, 320, "Until It Sleeps", "Metallica", "Load", 4);
        TestMedia.Tone(Path.Combine(mixed, "x.mp3"), 1, 340, "Enter Sadman", "Metallica", "Downloads", 1);
        f.Server.S.Library.AddRoot(music); f.Server.S.Library.Scan();
        var rows = f.Server.S.Db.Query("SELECT id, title FROM track WHERE missing=0", r => (Id: r.GetInt64(0), T: r.GetString(1)));
        long Id(string t) => rows.Single(x => x.T == t).Id;
        async Task<(HttpStatusCode, byte[])> Get(HttpClient c, string u) { var r = await c.GetAsync(u); return (r.StatusCode, await r.Content.ReadAsByteArrayAsync()); }
        var own = await Get(admin, $"/api/v1/jukebox/art/{Id("Ain't My Bitch")}?size=128"); Assert.Equal(HttpStatusCode.OK, own.Item1);
        var sleeps = await Get(admin, $"/api/v1/jukebox/art/{Id("Until It Sleeps")}?size=128"); Assert.Equal(HttpStatusCode.OK, sleeps.Item1); Assert.Equal(own.Item2, sleeps.Item2);
        Assert.Equal(HttpStatusCode.NoContent, (await Get(admin, $"/api/v1/jukebox/art/{Id("Enter Sadman")}?size=128")).Item1);   // really none: 204 -> placeholder
        Assert.Equal(HttpStatusCode.NoContent, (await Get(admin, $"/api/v1/art/track/{Id("Until It Sleeps")}?size=128")).Item1);    // the general rule (0.4.4 F24) is unchanged
        // guests (session code, no sign-in) get the same answer
        var code = (await (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).Json()).GetProperty("code").GetString()!;
        var anon = new HttpClient { BaseAddress = new Uri(f.Base) };
        var g = await Get(anon, $"/api/v1/jukebox/guest/art/{Id("Until It Sleeps")}?size=128&j={code}"); Assert.Equal(HttpStatusCode.OK, g.Item1);
        Assert.Equal(HttpStatusCode.NotFound, (await Get(anon, $"/api/v1/jukebox/guest/art/{Id("Until It Sleeps")}?size=128&j=wrong")).Item1);
    }
}
