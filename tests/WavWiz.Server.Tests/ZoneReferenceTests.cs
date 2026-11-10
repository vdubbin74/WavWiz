using System.Net;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.6.8-#15: one reference speaker per zone - pick rules, move, swap, removal, delay re-base and migration from the house reference.</summary>
public class ZoneReferenceTests
{
    static ZoneRefs.Cand C(long id, bool wired = false, bool on = true, double inst = 0) => new(id, wired, on, inst);

    [Fact]
    public void Pick_prefers_wired_then_online_then_the_steadiest_then_the_lowest_id()
    {
        Assert.Equal(3, ZoneRefs.Pick(new[] { C(1, inst: 0), C(3, wired: true, inst: 9), C(2) }));
        Assert.Equal(2, ZoneRefs.Pick(new[] { C(1, wired: true, on: false), C(2, wired: true) }));
        Assert.Equal(5, ZoneRefs.Pick(new[] { C(4, inst: 3), C(5, inst: 0.5) }));
        Assert.Equal(6, ZoneRefs.Pick(new[] { C(7), C(6) }));
    }

    [Fact]
    public void Normalize_migrates_the_house_reference_to_its_zone_and_other_zones_auto_pick()
    {
        var members = new Dictionary<long, List<long>> { [10] = new() { 1, 2 }, [20] = new() { 3, 4 }, [30] = new() { 5 }, [40] = new() };
        var cand = new Dictionary<long, ZoneRefs.Cand> { [1] = C(1), [2] = C(2), [3] = C(3), [4] = C(4, wired: true), [5] = C(5) };
        var (map, ch) = ZoneRefs.Normalize(null, members, id => cand[id], houseRef: 2);
        Assert.Equal(2, map[10]); Assert.Equal(4, map[20]); Assert.Equal(5, map[30]); Assert.False(map.ContainsKey(40)); Assert.Empty(ch);
    }

    [Fact]
    public void Normalize_keeps_valid_references_and_replaces_one_that_left_with_a_change_note()
    {
        var members = new Dictionary<long, List<long>> { [10] = new() { 1, 2, 9 }, [20] = new() { 3, 4 } };   // 4 (ref of 10) moved to zone 20, which keeps 3
        var stored = new Dictionary<long, long> { [10] = 4, [20] = 3 };
        var (map, ch) = ZoneRefs.Normalize(stored, members, id => C(id, wired: id == 9), houseRef: 4);
        Assert.Equal(9, map[10]); Assert.Equal(3, map[20]);
        Assert.Equal(new ZoneRefs.Change(10, 4, 9), Assert.Single(ch));
    }

    [Fact]
    public void Rebase_keeps_applied_delays_and_rewrites_offsets_against_the_new_reference()
    {
        var off = ZoneRefs.Rebase(new Dictionary<long, double> { [1] = 120, [2] = 95.5, [3] = 140 }, 2);
        Assert.Equal(24.5, off[1]); Assert.Equal(0, off[2]); Assert.Equal(44.5, off[3]);
        Assert.Empty(ZoneRefs.Rebase(new Dictionary<long, double> { [1] = 120 }, 2));   // new reference not calibrated yet: leave offsets alone
    }

    [Fact]
    public void Map_json_round_trips_and_bad_json_reads_as_an_empty_map()
    {
        var m = new Dictionary<long, long> { [7] = 3, [9] = 12 };
        Assert.Equal(m, ZoneRefs.ParseMap(ZoneRefs.MapJson(m)));
        Assert.Null(ZoneRefs.ParseMap(null)); Assert.Empty(ZoneRefs.ParseMap("{oops")!);
    }

    // ---------------- against the real server ----------------
    static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs)
        => (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    static async Task<Dictionary<string, JsonElement>> Groups(HttpClient admin) => (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
    static long? RefOf(JsonElement g) => g.TryGetProperty("referenceId", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetInt64() : null;
    static string? Note(JsonElement g) => g.TryGetProperty("refNote", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : null;

    [Fact]
    public async Task Move_swap_removal_rebase_and_migration_end_to_end()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "A"); await using var b = await FakePc.StartAsync(f, "pc-b", "B"); await using var c = await FakePc.StartAsync(f, "pc-c", "C");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        for (int i = 0; i < 100 && S.Zones.Zones().Count < 3; i++) await Task.Delay(50);
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long dA = dev["pc-a"], dB = dev["pc-b"], dC = dev["pc-c"];

        // migration: the old house reference (B) becomes its zone's reference; the other zone auto-picks its only speaker
        S.Zones.ReferenceZoneId = dB; S.Db.DeleteSetting(ZoneRefs.MapKey);
        long living = await MakeZone(admin, "Living", dA, dB), patio = await MakeZone(admin, "Patio", dC);
        S.Db.DeleteSetting(ZoneRefs.MapKey);
        var g = await Groups(admin); Assert.Equal(dB, RefOf(g["Living"])); Assert.Equal(dC, RefOf(g["Patio"]));
        var zs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("id").GetInt64(), z => z.GetProperty("reference").GetBoolean());
        Assert.True(zs[dB]); Assert.True(zs[dC]); Assert.False(zs[dA]);   // exactly one reference per zone
        Assert.Equal(dB, S.Zones.ReferenceFor(dA)); Assert.Equal(dC, S.Zones.ReferenceFor(dC));

        // saved delays: A 120 ms, B 100 ms (offset of A = +20 against B)
        string Dev(long z) => (string)S.Db.Scalar("SELECT active_output_device_id FROM zone WHERE id=$i", ("$i", z))!;
        foreach (var (z, l) in new[] { (dA, 120.0), (dB, 100.0), (dC, 80.0) })
            S.Db.Exec("INSERT INTO calibration(output_device_id,latency_ms,raw_latency_ms,method,measured_at,is_current) VALUES($d,$l,0,'test',$t,1)", ("$d", Dev(z)), ("$l", l), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        (double Lat, double? Raw, string? Ref) Cal(long z) => S.Db.Query("SELECT latency_ms,raw_latency_ms,reference_device_id FROM calibration WHERE output_device_id=$d AND is_current=1", r => (r.GetDouble(0), r.IsDBNull(1) ? (double?)null : r.GetDouble(1), r.IsDBNull(2) ? null : r.GetString(2)), ("$d", Dev(z))).Single();

        // manual: make A Living's reference -> offsets re-based on A, applied delays unchanged, no note
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{living}/reference", new { zoneId = dA })).StatusCode);
        Assert.Equal((120.0, 0.0, Dev(dA)), Cal(dA)); Assert.Equal((100.0, -20.0, Dev(dA)), Cal(dB));
        g = await Groups(admin); Assert.Equal(dA, RefOf(g["Living"])); Assert.Null(Note(g["Living"]));
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/v1/groups/{living}/reference", new { zoneId = dC })).StatusCode);   // not its speaker

        // move the reference A into Patio: Patio keeps C, A joins as a regular speaker; Living auto-picks B, re-bases, and shows the quiet note
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{patio}", new { deviceIds = new[] { dC, dA } })).StatusCode);
        g = await Groups(admin);
        Assert.Equal(dC, RefOf(g["Patio"])); Assert.Equal(dB, RefOf(g["Living"]));
        Assert.Equal(ZoneManager.RefNoteText, Note(g["Living"]));   // leftover zone, even with one speaker: offsets were against a different clock
        Assert.Equal((100.0, 0.0, Dev(dB)), Cal(dB));

        // swap on "yes": A becomes Patio's reference (the legacy "Set as reference" endpoint now targets the speaker's zone)
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/calibration/reference", new { zoneId = dA })).StatusCode);
        g = await Groups(admin); Assert.Equal(dA, RefOf(g["Patio"])); Assert.Equal(dB, S.Zones.ReferenceZoneId);   // the house setting is untouched
        Assert.Equal((80.0, -40.0, Dev(dA)), Cal(dC));

        // removal: take A (the reference) out of a 3-speaker Patio -> new reference + note; dismissing clears it
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{patio}", new { deviceIds = new[] { dC, dA, dB } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{patio}", new { deviceIds = new[] { dC, dB } })).StatusCode);
        g = await Groups(admin); var r = RefOf(g["Patio"]); Assert.True(r == dB || r == dC); Assert.Equal(ZoneManager.RefNoteText, Note(g["Patio"]));
        Assert.Equal(0.0, Cal(r!.Value).Raw);
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{patio}/reference-note")).StatusCode);
        Assert.Null(Note((await Groups(admin))["Patio"]));
        Assert.Equal(dB, S.Zones.ReferenceFor(dA));   // A is in no zone now: falls back to the house reference
    }
}
