using System.Net;
using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #27 (t1877): a radio station (a stream that never ends) never goes into the running Jukebox's queue - from the admin page (add, play
/// next, drop at a position, play now), by sending another zone's queue there, or by any server path (the conductor backstop). A station already in
/// the queue is taken out when the Jukebox ticks. Songs still go in; after the Jukebox stops, radio works as before.</summary>
[Collection("serial")]
public class Release069JukeboxRadioTests
{
    static async Task<(ServerFixture f, HttpClient admin, List<long> ids, long radio)> Setup()
    {
        var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        var dir = Directory.CreateDirectory(Path.Combine(f.Dir.Path, "music")).FullName;
        for (int i = 1; i <= 3; i++) TestMedia.Tone(Path.Combine(dir, $"{i}.flac"), 60, 440, $"Song {i}", "Band " + i, "Album " + i, i);
        await admin.PostAsJsonAsync("/api/v1/library/roots", new { path = dir });
        for (int i = 0; i < 200; i++) { var st = await admin.GetJson("/api/v1/library/status"); if (!st.GetProperty("scanning").GetBoolean() && st.GetProperty("tracks").GetInt32() == 3) break; await Task.Delay(100); }
        var ids = (await admin.GetJson("/api/v1/library/search?q=song")).EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).OrderBy(x => x).ToList();
        var radio = (await (await admin.PostAsJsonAsync("/api/v1/radio", new { name = "Never Ends FM", url = "http://127.0.0.1:9/stream" })).Json()).GetProperty("id").GetInt64();
        return (f, admin, ids, radio);
    }
    static int RadioIn(ServerFixture f) => f.Server.S.Conductor.Queue().Count(x => x.Kind == "radio");

    [Fact]
    public async Task Admin_paths_refuse_radio_while_the_Jukebox_runs_with_a_clear_message()
    {
        var (f, admin, ids, radio) = await Setup(); await using var _ = f;
        (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).EnsureSuccessStatusCode();
        Assert.Same(f.Server.S.Conductor, f.Server.S.Jukebox.Owns);   // no Jukebox speakers: it plays in the main zone
        foreach (var body in new object[] { new { kind = "radio", id = radio }, new { kind = "radio", id = radio, next = true }, new { kind = "radio", id = radio, at = 0 } })
        {
            var r = await admin.PostAsJsonAsync("/api/v1/queue/add", body);
            Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
            Assert.Contains("Radio can't go in the Jukebox queue", await r.Content.ReadAsStringAsync());
        }
        var p = await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "radio", id = radio });
        Assert.Equal(HttpStatusCode.Conflict, p.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/v1/stream/play", new { kind = "radio", id = radio, enqueue = true, next = true })).StatusCode);
        Assert.Equal(0, RadioIn(f));
        // songs still go in
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "tracks", ids = new[] { ids[0] } })).StatusCode);
        Assert.Contains(f.Server.S.Conductor.Queue(), x => x.Kind == "track");
        // after the Jukebox stops, radio is allowed again
        (await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/queue/add", new { kind = "radio", id = radio })).StatusCode);
        Assert.Equal(1, RadioIn(f));
    }

    [Fact]
    public async Task Conductor_backstop_filters_radio_for_the_Jukebox_only_and_a_queued_station_is_dropped()
    {
        var (f, admin, ids, radio) = await Setup(); await using var _ = f; var cd = f.Server.S.Conductor;
        var station = cd.StationToItem(radio)!; var song = cd.TracksToItems(new[] { ids[1] });
        cd.Add(new[] { station }, false); Assert.Equal(1, RadioIn(f));   // Jukebox off: radio queues normally
        (await admin.PostAsJsonAsync("/api/v1/jukebox/start", new { })).EnsureSuccessStatusCode();
        // already queued before the start -> taken out by the Jukebox
        f.Server.S.Jukebox.DropRadio();   // the 1 s Tick may already have done it
        for (int i = 0; i < 30 && RadioIn(f) > 0; i++) await Task.Delay(100);
        Assert.Equal(0, RadioIn(f)); Assert.Equal(0, f.Server.S.Jukebox.DropRadio());
        // any other server path (schedules, Keep playing, ...) goes through the conductor: radio is filtered, songs pass
        cd.Add(new[] { station }, true); cd.Insert(new[] { station }, 0); cd.Add(song, false);
        Assert.Equal(0, RadioIn(f)); Assert.Contains(cd.Queue(), x => x.Kind == "track" && x.RefId == ids[1]);
        var before = cd.Queue().Select(x => x.Id).ToList();
        cd.PlayItems(new[] { station }); Assert.Equal(before, cd.Queue().Select(x => x.Id).ToList());   // radio-only play now leaves the Jukebox queue alone
        (await admin.PostAsJsonAsync("/api/v1/jukebox/stop", new { })).EnsureSuccessStatusCode();
        var r0 = RadioIn(f);   // Stop brings back the queue from before the Jukebox (it had the station)
        cd.Add(new[] { station }, false); Assert.Equal(r0 + 1, RadioIn(f));
    }
}
