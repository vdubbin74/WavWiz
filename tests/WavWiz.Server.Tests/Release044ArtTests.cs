using System.Net;
using WavWiz.Server.Library;
namespace WavWiz.Server.Tests;

/// <summary>0.4.4 F24: one album's cover ("Habits") showed on most of the library. A folder picture is used only for the one real album in its
/// folder (never a mixed folder or a library root), untagged / Unknown Album songs never borrow another album's cover, "Unknown Artist"
/// only when nothing names the artist, and "Rebuild album art" (admin) clears the cache and changes the picture URLs.</summary>
[Collection("serial")]
public class Release044ArtTests
{
    static void Raw(string path, params string[] meta)
    {
        var a = new List<string> { "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=1", "-ac", "2", "-map_metadata", "-1" };
        foreach (var m in meta) { a.Add("-metadata"); a.Add(m); }
        a.Add(path); TestMedia.Run(a.ToArray());
    }
    static async Task<byte[]?> Art(HttpClient c, long id) { var r = await c.GetAsync($"/api/v1/art/track/{id}?size=96"); return r.StatusCode == HttpStatusCode.OK ? await r.Content.ReadAsByteArrayAsync() : null; }

    [Fact]
    public async Task F24_a_shared_folder_picture_never_spreads_one_cover_over_other_albums_or_untagged_songs()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        // the library root itself has a folder.jpg (the "Habits" cover) next to loose songs of several albums and untagged songs
        TestMedia.Png(Path.Combine(music, "folder.jpg"), "red");
        TestMedia.Tone(Path.Combine(music, "loose1.mp3"), 1, 300, "Higher", "Creed", "Human Clay");
        TestMedia.Tone(Path.Combine(music, "loose2.mp3"), 1, 320, "Yellow", "Coldplay", "Parachutes");
        Raw(Path.Combine(music, "untagged-root.mp3"));
        // a mixed downloads folder with a folder.jpg
        var mixed = Directory.CreateDirectory(Path.Combine(music, "Downloads")).FullName; TestMedia.Png(Path.Combine(mixed, "folder.jpg"), "red");
        TestMedia.Tone(Path.Combine(mixed, "a.mp3"), 1, 340, "Everybody Talks", "Neon Trees", "Picture Show");
        TestMedia.Tone(Path.Combine(mixed, "b.mp3"), 1, 360, "One Last Breath", "Creed", "Weathered");
        Raw(Path.Combine(mixed, "c.mp3"));
        // a real album folder: its cover is used for its songs (and an untagged song in it)
        var habits = Directory.CreateDirectory(Path.Combine(music, "Neon Trees", "Habits")).FullName; TestMedia.Png(Path.Combine(habits, "cover.jpg"), "red");
        TestMedia.Tone(Path.Combine(habits, "01.mp3"), 1, 380, "Animal", "Neon Trees", "Habits", 1);
        TestMedia.Tone(Path.Combine(habits, "02.mp3"), 1, 400, "1983", "Neon Trees", "Habits", 2);
        Raw(Path.Combine(habits, "03.mp3"));
        // a song with its own embedded picture keeps it
        var own = Directory.CreateDirectory(Path.Combine(music, "Own")).FullName;
        TestMedia.Tone(Path.Combine(own, "x.mp3"), 1, 420, "Arms", "Creed", "Human Clay", artPng: TestMedia.Png(Path.Combine(f.Dir.Path, "blue.png"), "blue"));
        f.Server.S.Library.AddRoot(music); f.Server.S.Library.Scan();
        var ids = f.Server.S.Db.Query("SELECT id, path FROM track WHERE missing=0", r => (Id: r.GetInt64(0), Path: r.GetString(1)));
        long Id(string end) => ids.Single(x => x.Path.EndsWith(end)).Id;
        var habitsCover = await Art(admin, Id(Path.Combine("Habits", "01.mp3")));
        Assert.NotNull(habitsCover);
        Assert.Equal(habitsCover, await Art(admin, Id(Path.Combine("Habits", "02.mp3"))));
        Assert.Equal(habitsCover, await Art(admin, Id(Path.Combine("Habits", "03.mp3"))));       // untagged song inside the album folder
        foreach (var p in new[] { "loose1.mp3", "loose2.mp3", "untagged-root.mp3", Path.Combine("Downloads", "a.mp3"), Path.Combine("Downloads", "b.mp3"), Path.Combine("Downloads", "c.mp3") })
            Assert.Null(await Art(admin, Id(Path.DirectorySeparatorChar + p)));              // 204: the UI shows the themed placeholder
        var mine = await Art(admin, Id(Path.Combine("Own", "x.mp3"))); Assert.NotNull(mine); Assert.NotEqual(habitsCover, mine);
        // the "Unknown Album" tile never carries a cover (it is a bag of unrelated songs)
        var albums = (await admin.GetJson("/api/v1/library/albums")).EnumerateArray().ToList();
        Assert.All(albums.Where(a => a.GetProperty("album").GetString() == "Unknown Album"), a => Assert.Equal(0, a.GetProperty("artTrackId").GetInt64()));
        Assert.Contains(albums, a => a.GetProperty("album").GetString() == "Habits" && a.GetProperty("artTrackId").GetInt64() > 0);
    }

    [Fact]
    public void F24_unknown_artist_only_when_nothing_names_the_artist()
    {
        using var d = new TempDir(); var db = new Db(d.File("t.db")); db.Migrate(); var lib = new LibraryService(db);
        var music = Directory.CreateDirectory(Path.Combine(d.Path, "m")).FullName;
        Raw(Path.Combine(music, "aa.mp3"), "album_artist=Creed", "title=Higher", "album=Human Clay");
        Raw(Path.Combine(music, "Creed - With Arms Wide Open.mp3"));
        Raw(Path.Combine(music, "07 - Creed - My Own Prison.mp3"));
        Raw(Path.Combine(music, "track07.mp3"));
        lib.AddRoot(music); lib.Scan();
        var rows = db.Query("SELECT path, artist, title FROM track", r => (P: Path.GetFileName(r.GetString(0)), A: r.GetString(1), T: r.GetString(2)));
        Assert.Equal("Creed", rows.Single(r => r.P == "aa.mp3").A);
        var w = rows.Single(r => r.P.StartsWith("Creed")); Assert.Equal("Creed", w.A); Assert.Equal("With Arms Wide Open", w.T);
        var o = rows.Single(r => r.P.StartsWith("07")); Assert.Equal("Creed", o.A); Assert.Equal("My Own Prison", o.T);
        Assert.Equal("Unknown Artist", rows.Single(r => r.P == "track07.mp3").A);
        Assert.Equal((null, null), LibraryService.FromFileName("2024-05-01"));
    }

    [Fact]
    public async Task F24_rebuild_album_art_is_admin_only_clears_the_cache_and_changes_the_picture_urls()
    {
        await using var f = await ServerFixture.StartAsync(); await f.SetupAdmin(); var admin = f.As(f.Token(Role.Admin, "admin"));
        var music = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music", "Neon Trees", "Habits")).FullName;
        TestMedia.Png(Path.Combine(music, "cover.jpg"), "red"); TestMedia.Tone(Path.Combine(music, "01.mp3"), 1, 380, "Animal", "Neon Trees", "Habits");
        f.Server.S.Library.AddRoot(Path.Combine(f.Dir.Path, "music")); f.Server.S.Library.Scan();
        var id = f.Server.S.Db.Query("SELECT id FROM track", r => r.GetInt64(0)).Single();
        Assert.NotNull(await Art(admin, id));
        var cache = Path.Combine(f.Dir.Path, "artcache"); Assert.NotEmpty(Directory.GetFiles(cache, "*.jpg"));
        var cv = ArtService.UrlVersion;
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.Control, "c")).PostAsync("/api/v1/library/art/rebuild", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View, "v")).PostAsync("/api/v1/library/art/rebuild", null)).StatusCode);
        var r = await admin.PostAsync("/api/v1/library/art/rebuild", null); r.EnsureSuccessStatusCode(); var j = await r.Json();
        Assert.True(j.GetProperty("removed").GetInt32() >= 1);
        Assert.NotEqual(cv, j.GetProperty("artCv").GetString()); Assert.Equal(ArtService.UrlVersion, j.GetProperty("artCv").GetString());
        for (int i = 0; i < 100 && f.Server.S.Art.Rebuilding; i++) await Task.Delay(100);
        Assert.NotNull(await Art(admin, id));                                                   // rebuilt from the album folder
    }
}
