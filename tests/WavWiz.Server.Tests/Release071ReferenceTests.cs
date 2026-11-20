using System.Net;
using System.Text.Json;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1 reference speakers: a recommended reference per zone (ranked, with a one-line reason), no automatic re-pick when the reference
/// leaves (a flag with the recommended replacement instead), and the house reference kept internal (no REF tag on an Unassigned speaker).</summary>
public class Release071ReferenceTests
{
    static ZoneRefs.Cand C(long id, int tier, double? ms = null, double inst = 0, bool on = true) => new(id, tier <= 1, on, inst, tier, ms);

    [Fact]
    public void Rank_orders_by_kind_then_lowest_delay_then_steadiest_then_online()
    {
        var r = ZoneRefs.Rank(new[] { C(1, ZoneRefs.TierBluetooth, 0), C(2, ZoneRefs.TierNetwork, 0), C(3, ZoneRefs.TierBrowser, 0), C(4, ZoneRefs.TierPcWired, 50), C(5, ZoneRefs.TierServerWired, 90) });
        Assert.Equal(new long[] { 5, 4, 3, 2, 1 }, r.Select(x => x.Id).ToArray());
        Assert.Equal(new long[] { 7, 6 }, ZoneRefs.Rank(new[] { C(6, 1, 30), C(7, 1, 12) }).Select(x => x.Id).ToArray());                 // lowest delay
        Assert.Equal(new long[] { 9, 8 }, ZoneRefs.Rank(new[] { C(8, 1, 12, inst: 4), C(9, 1, 12, inst: 1) }).Select(x => x.Id).ToArray());   // steadiest
        Assert.Equal(new long[] { 11, 10 }, ZoneRefs.Rank(new[] { C(10, 1, 12, on: false), C(11, 1, 12) }).Select(x => x.Id).ToArray());      // online
        Assert.Equal(new long[] { 13, 12 }, ZoneRefs.Rank(new[] { C(12, 1, null), C(13, 1, 40) }).Select(x => x.Id).ToArray());            // unknown delay sorts last
        Assert.Equal(11, ZoneRefs.Recommend(new[] { C(10, 0, 0, on: false), C(11, 3) })!.Id);   // only an online speaker is recommended
        Assert.Null(ZoneRefs.Recommend(new[] { C(10, 0, on: false) }));
    }

    [Fact]
    public void Tier_reason_and_warning()
    {
        Assert.Equal(ZoneRefs.TierServerWired, ZoneRefs.TierOf("local-abc", "analog", false, false));
        Assert.Equal(ZoneRefs.TierServerWired, ZoneRefs.TierOf("pc1", "usb", false, onServer: true));
        Assert.Equal(ZoneRefs.TierPcWired, ZoneRefs.TierOf("pc1", "hdmi", false, false));
        Assert.Equal(ZoneRefs.TierBrowser, ZoneRefs.TierOf("web-1", "analog", true, false));
        Assert.Equal(ZoneRefs.TierBrowser, ZoneRefs.TierOf("pc1", "other", false, false));
        Assert.Equal(ZoneRefs.TierNetwork, ZoneRefs.TierOf("airplay:k", "other", false, false));
        Assert.Equal(ZoneRefs.TierNetwork, ZoneRefs.TierOf("cast:k", "other", false, false));
        Assert.Equal(ZoneRefs.TierBluetooth, ZoneRefs.TierOf("pc1", "bluetooth", false, true));
        Assert.Equal(ZoneRefs.TierBluetooth, ZoneRefs.TierOf("pc1", "other", false, false, hasBtAddress: true));
        Assert.Equal("Wired output on the server, lowest delay (12 ms)", ZoneRefs.Reason(new(1, true, true, 0, 0, 12, OnServer: true)));
        Assert.Equal("Wired output on a PC", ZoneRefs.Reason(C(1, 1)));
        Assert.StartsWith("Bluetooth", ZoneRefs.Reason(C(1, 4)));
        Assert.True(ZoneRefs.Warn(C(1, 4))); Assert.True(ZoneRefs.Warn(C(1, 3))); Assert.False(ZoneRefs.Warn(C(1, 2)));
    }

    [Fact]
    public void A_reference_that_leaves_is_flagged_never_replaced()
    {
        var members = new Dictionary<long, List<long>> { [10] = new() { 1, 2, 9 }, [20] = new() { 3, 4 } };   // 4 (ref of 10) moved to zone 20
        var (map, ch) = ZoneRefs.Normalize(new Dictionary<long, long> { [10] = 4, [20] = 3 }, members, id => C(id, id == 9 ? 0 : 2), houseRef: 4);
        Assert.False(map.ContainsKey(10)); Assert.Equal(3, map[20]);
        Assert.Equal(new ZoneRefs.Change(10, 4, 0), Assert.Single(ch));
    }

    static async Task<Dictionary<string, JsonElement>> Groups(HttpClient c) => (await c.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
    static long? L(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;

    [Fact]
    public async Task Recommendation_flag_one_tap_switch_and_hidden_house_reference_end_to_end()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Wired A", kind: "analog"); await using var b = await FakePc.StartAsync(f, "pc-b", "Other B");
        await using var c = await FakePc.StartAsync(f, "pc-c", "BT C", kind: "bluetooth", bt: "AA:BB:CC:DD:EE:01");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        for (int i = 0; i < 100 && S.Zones.Zones().Count < 3; i++) await Task.Delay(50);
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long dA = dev["pc-a"], dB = dev["pc-b"], dC = dev["pc-c"];
        long deck = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Deck", deviceIds = new[] { dC, dB, dA } })).Json()).GetProperty("id").GetInt64();

        // a zone with no reference: recommended (wired first, with a reason) but NOT set
        var g = (await Groups(admin))["Deck"];
        Assert.Null(L(g, "referenceId")); Assert.Equal(dA, L(g, "recommendedId"));
        Assert.StartsWith("Wired output", g.GetProperty("recommendedReason").GetString()); Assert.False(g.GetProperty("recommendedWarn").GetBoolean());
        var rk = await admin.GetJson($"/api/v1/calibration/ranking?groupId={deck}");
        Assert.Equal(new[] { dA, dB, dC }, rk.GetProperty("ranking").EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).ToArray());
        Assert.True(rk.GetProperty("ranking")[2].GetProperty("warn").GetBoolean());   // Bluetooth: allowed, last, with a warning
        Assert.Equal(JsonValueKind.Null, rk.GetProperty("defaultId").ValueKind);        // no silent default for a zone without a reference

        // the user picks Bluetooth C (allowed); the recommendation stays A
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/reference", new { zoneId = dC })).StatusCode);
        g = (await Groups(admin))["Deck"]; Assert.Equal(dC, L(g, "referenceId")); Assert.Equal(dA, L(g, "recommendedId"));
        Assert.Equal(dC, (await admin.GetJson($"/api/v1/calibration/ranking?groupId={deck}")).GetProperty("defaultId").GetInt64());

        // the reference leaves: nothing is picked for the user; a "left" flag names the recommended replacement
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{deck}", new { deviceIds = new[] { dB, dA } })).StatusCode);
        g = (await Groups(admin))["Deck"];
        Assert.Null(L(g, "referenceId"));
        var flag = g.GetProperty("refFlag"); Assert.Equal("left", flag.GetProperty("kind").GetString());
        Assert.Equal(dC, L(flag, "oldId")); Assert.Equal(dA, L(flag, "nextId")); Assert.Contains("BT C", flag.GetProperty("text").GetString());
        g = (await Groups(admin))["Deck"]; Assert.Null(L(g, "referenceId"));   // still none on the next read
        // one tap: use the recommended one -> flag cleared
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/reference", new { zoneId = dA })).StatusCode);
        g = (await Groups(admin))["Deck"]; Assert.Equal(dA, L(g, "referenceId")); Assert.Equal(JsonValueKind.Null, g.GetProperty("refFlag").ValueKind);

        // the house reference stays internal: an Unassigned house reference shows no REF tag, but still times an Unassigned speaker
        S.Zones.ReferenceZoneId = dC;
        var zs = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("id").GetInt64(), z => z.GetProperty("reference").GetBoolean());
        Assert.False(zs[dC]); Assert.True(zs[dA]);
        Assert.Equal(dC, S.Zones.ReferenceFor(dC));
        // the UI learns which speaker times each one without a REF tag on the house reference (Calibrate for a regular user)
        var tb = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("id").GetInt64(), z => L(z, "timedBy"));
        Assert.Equal(dC, tb[dC]); Assert.Equal(dA, tb[dB]); Assert.Equal(dA, tb[dA]);
    }

    [Fact]
    public async Task Reference_output_changed_flag_switch_back_next_best_or_keep_and_no_flag_on_upgrade()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Amp A", kind: "analog"); await using var b = await FakePc.StartAsync(f, "pc-b", "Pi B", kind: "analog");
        await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 100 && S.Zones.Zones().Count < 2; i++) await Task.Delay(50);
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long dA = dev["pc-a"], dB = dev["pc-b"];
        long deck = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Deck", deviceIds = new[] { dA, dB } })).Json()).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/reference", new { zoneId = dA })).StatusCode);
        string devA = (string)S.Db.Scalar("SELECT active_output_device_id FROM zone WHERE id=$i", ("$i", dA))!;
        async Task<JsonElement> Flag() => (await Groups(admin))["Deck"].GetProperty("refFlag");
        Assert.Equal(JsonValueKind.Null, (await Flag()).ValueKind);

        // the type of the remembered output changes (wired -> Bluetooth): flagged, with the next best and the way back
        S.Db.Exec("UPDATE output_device SET kind='bluetooth' WHERE id=$d", ("$d", devA));
        var fl = await Flag();
        Assert.Equal("output", fl.GetProperty("kind").GetString()); Assert.Equal(dA, L(fl, "refId")); Assert.Equal(dB, L(fl, "nextId"));
        Assert.Equal("analog", fl.GetProperty("wasKind").GetString()); Assert.Equal("bluetooth", fl.GetProperty("nowKind").GetString());
        Assert.Contains("Reference output changed", fl.GetProperty("text").GetString()); Assert.Contains("wired → Bluetooth", fl.GetProperty("text").GetString());
        Assert.Equal(dA, L((await Groups(admin))["Deck"], "referenceId"));   // never switched by itself
        // keep it and recalibrate: the current output is the new baseline
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{deck}/reference-output", new { })).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Flag()).ValueKind);

        // a different output device: flagged; "switch back" uses the remembered device's endpoint and clears it
        S.Db.Exec("UPDATE output_device SET kind='analog' WHERE id=$d", ("$d", devA));
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/groups/{deck}/reference-output", new { })).StatusCode);
        S.Db.Exec("INSERT INTO output_device(id,kind,friendly_name) VALUES('dev-usb','usb','USB DAC')");
        S.Db.Exec("UPDATE zone SET active_output_device_id='dev-usb' WHERE id=$i", ("$i", dA));
        fl = await Flag(); Assert.Equal("output", fl.GetProperty("kind").GetString()); Assert.Equal("USB DAC", fl.GetProperty("nowName").GetString());
        long ep = L(fl, "wasEndpointId")!.Value;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/v1/zones/{dA}/output", new { endpointId = ep })).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Flag()).ValueKind);
        // use the next best: one tap, flag gone (the new reference's output is remembered)
        S.Db.Exec("UPDATE zone SET active_output_device_id='dev-usb' WHERE id=$i", ("$i", dA));
        Assert.Equal(dB, L(await Flag(), "nextId"));
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/reference", new { zoneId = dB })).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Flag()).ValueKind);

        // upgrade: a reference with no remembered output gets its current one silently - no flag
        S.Db.DeleteSetting(ZoneManager.RefOutKey);
        Assert.Equal(JsonValueKind.Null, (await Flag()).ValueKind);
        Assert.Contains(deck.ToString(), S.Db.Setting(ZoneManager.RefOutKey));
    }

    [Fact]
    public async Task Calibration_never_shifts_the_reference_and_offers_a_faster_speaker_as_the_reference()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Ref A", kind: "analog"); await using var b = await FakePc.StartAsync(f, "pc-b", "Fast B", kind: "analog");
        await using var c = await FakePc.StartAsync(f, "pc-c", "Slow C", kind: "analog");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        for (int i = 0; i < 100 && S.Zones.Zones().Count < 3; i++) await Task.Delay(50);
        long Id(string p) => S.Zones.Zones().First(z => z.PlayerId == p).Id;
        long dA = Id("pc-a"), dB = Id("pc-b"), dC = Id("pc-c");
        (List<Calibration.Proposal> P, List<string> M) Run(double refMs, double bMs, double cMs)
        {
            var sess = new Calibration.CalSession { Mode = "pc-mic", ReferenceZoneId = dA, Quick = true };
            foreach (var x in new[] { refMs - 0.2, refMs, refMs + 0.2 }) sess.Runs.Add((dA, "ref", x, 1));
            foreach (var x in new[] { bMs - 0.2, bMs, bMs + 0.2 }) sess.Runs.Add((dB, "dev", x, 1));
            foreach (var x in new[] { cMs - 0.2, cMs, cMs + 0.2 }) sess.Runs.Add((dC, "dev", x, 1));
            return S.Cal.Finish(sess);
        }
        // a new reference (0 ms): B sounds 20 ms earlier -> said so, offered as reference, clamped to 0; the reference is NOT shifted up or proposed
        var (p, m) = Run(100, 80, 115);
        Assert.DoesNotContain(p, x => x.ZoneId == dA);
        var pb = p.Single(x => x.ZoneId == dB); Assert.Equal(0, pb.ProposedLatencyMs); Assert.Equal(20, pb.FasterMs);
        var pc = p.Single(x => x.ZoneId == dC); Assert.Equal(15, pc.ProposedLatencyMs, 1); Assert.Null(pc.FasterMs);   // C lines up with no shift added
        Assert.Contains(m, x => x.Contains("Fast B sounds 20 ms EARLIER than the reference Ref A") && x.Contains("Make Fast B the reference"));
        Assert.DoesNotContain(m, x => x.Contains("including the reference"));
        // an existing reference with a saved 30 ms delay (upgrade): it keeps it; B 20 ms earlier still fits (10 ms) and is only mentioned
        string devA = S.Zones.Zone(dA)!.Outputs.First(o => o.Active).DeviceId;
        S.Db.Exec("INSERT INTO calibration(output_device_id,latency_ms,raw_latency_ms,method,measured_at,is_current) VALUES($d,30,0,'test',$t,1)", ("$d", devA), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        (p, m) = Run(100, 80, 115);
        Assert.Equal(10, p.Single(x => x.ZoneId == dB).ProposedLatencyMs, 1); Assert.Equal(45, p.Single(x => x.ZoneId == dC).ProposedLatencyMs, 1);
        Assert.Contains(m, x => x.Contains("may make a better reference")); Assert.DoesNotContain(p, x => x.ZoneId == dA);
        Assert.Equal(30, S.Zones.Zone(dA)!.Outputs.First(o => o.Active).LatencyMs);
    }

    [Fact]
    public async Task Zone_vs_house_offset_is_applied_live_clamped_and_zero_keeps_the_saved_delay()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Deck Pi", kind: "analog"); await a.WaitConnected();
        for (int i = 0; i < 100 && S.Zones.Zones().Count < 1; i++) await Task.Delay(50);
        long dA = S.Zones.Zones().Single().Id;
        string dev = S.Zones.Zone(dA)!.Outputs.First(o => o.Active).DeviceId;
        S.Db.Exec("INSERT INTO calibration(output_device_id,latency_ms,raw_latency_ms,method,measured_at,is_current) VALUES($d,40,0,'test',$t,1)", ("$d", dev), ("$t", DateTimeOffset.UtcNow.ToString("O")));
        long deck = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Deck", deviceIds = new[] { dA } })).Json()).GetProperty("id").GetInt64();
        async Task<double> Lat(double want) { for (int i = 0; i < 100 && Math.Abs(a.Client.State.LatencyMs - want) > 0.01; i++) await Task.Delay(30); return a.Client.State.LatencyMs; }
        S.Zones.PushZone(S.Audio.Get("pc-a")!);
        Assert.Equal(40, await Lat(40));   // no offset (every upgrade): exactly the saved delay
        Assert.Equal(0, (await Groups(admin))["Deck"].GetProperty("houseOffsetMs").GetDouble());

        // +15 ms = the zone sounds 15 ms later: the engine gets 15 ms less of "play early"; the saved delay is untouched
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/house-offset", new { ms = 15 })).StatusCode);
        Assert.Equal(25, await Lat(25));
        Assert.Equal(40, S.Zones.Zone(dA)!.Outputs.First(o => o.Active).LatencyMs);
        Assert.Equal(15, (await Groups(admin))["Deck"].GetProperty("houseOffsetMs").GetDouble());
        Assert.Equal(15, (await admin.GetJson("/api/v1/zones")).EnumerateArray().Single().GetProperty("houseOffsetMs").GetDouble());
        // clamped to the small fine-tune range; a viewer cannot change it
        var r = await (await admin.PutAsJsonAsync($"/api/v1/groups/{deck}/house-offset", new { ms = 999 })).Json(); Assert.Equal(ZoneManager.HouseOffMaxMs, r.GetProperty("ms").GetDouble());
        Assert.Equal(40 - ZoneManager.HouseOffMaxMs, await Lat(40 - ZoneManager.HouseOffMaxMs));
        Assert.Equal(HttpStatusCode.Forbidden, (await f.As(f.Token(Role.View)).PutAsJsonAsync($"/api/v1/groups/{deck}/house-offset", new { ms = 1 })).StatusCode);
        // leaving the zone drops its offset live
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{deck}", new { deviceIds = Array.Empty<long>() })).StatusCode);
        Assert.Equal(40, await Lat(40));
        // back in, then the zone is deleted: back to the saved delay, and the setting is gone
        Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/v1/groups/{deck}", new { deviceIds = new[] { dA } })).StatusCode);
        Assert.Equal(40 - ZoneManager.HouseOffMaxMs, await Lat(40 - ZoneManager.HouseOffMaxMs));
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/v1/groups/{deck}")).StatusCode);
        Assert.Equal(40, await Lat(40)); Assert.Empty(S.Zones.HouseOffsets());
    }
}
