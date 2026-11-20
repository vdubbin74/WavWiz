using System.Net;
using System.Text.Json;
using WavWiz.Server.Api;
using WavWiz.Server.Zones;
namespace WavWiz.Server.Tests;

/// <summary>0.7.1: the phone mic page honors Whole house / one zone like Calibrate on the PC: a zone's speakers only, against THAT zone's own
/// reference (none = offered, never set by itself), the choice made in Calibrate goes along, and an offline reference offers the next best as a
/// stand-in for one session. A regular user's link is unchanged (their own speaker, its zone's reference).</summary>
public class Release071PhoneScopeTests
{
    static long[] Ids(JsonElement p) => p.GetProperty("speakers").EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).OrderBy(x => x).ToArray();
    static long? RefId(JsonElement p) => p.GetProperty("reference").ValueKind == JsonValueKind.Null ? null : p.GetProperty("reference").GetProperty("id").GetInt64();

    [Fact]
    public async Task Phone_plan_follows_the_zone_choice_with_its_own_reference_and_offers_the_recommended_and_next_best()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Deck amp", kind: "analog"); await using var b = await FakePc.StartAsync(f, "pc-b", "Deck PC");
        await using var c = await FakePc.StartAsync(f, "pc-c", "Kitchen", kind: "analog");
        await a.WaitConnected(); await b.WaitConnected(); await c.WaitConnected();
        for (int i = 0; i < 200 && S.Zones.Zones().Count(z => z.Connected && z.Outputs.Any(o => o.Active)) < 3; i++) await Task.Delay(50);   // every speaker playing to an output (under load this lags the connect)
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long dA = dev["pc-a"], dB = dev["pc-b"], dC = dev["pc-c"];
        long deck = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Roof deck", deviceIds = new[] { dA, dB } })).Json()).GetProperty("id").GetInt64();
        (await admin.PutAsJsonAsync("/api/v1/calibration/reference", new { zoneId = dC })).EnsureSuccessStatusCode();   // the (internal) house reference: Kitchen

        // Calibrate on the PC picked the zone: the phone gets the zone's speakers only; no reference yet -> none set, the recommended one offered
        var tok = (await (await admin.PostAsJsonAsync("/api/v1/calibration/phone-link", new { scope = deck.ToString() })).Json()).GetProperty("token").GetString()!;
        using var phone = new HttpClient { BaseAddress = new Uri(f.Base) }; phone.DefaultRequestHeaders.Add(CalPhoneApi.Header, tok);
        var p = await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan");
        Assert.Equal(deck.ToString(), p.GetProperty("scope").GetString()); Assert.True(p.GetProperty("scopeSet").GetBoolean());
        Assert.Null(RefId(p)); Assert.Equal(new[] { dA, dB }.OrderBy(x => x).ToArray(), Ids(p));
        Assert.Equal(dA, p.GetProperty("recommended").GetProperty("id").GetInt64()); Assert.StartsWith("Wired output", p.GetProperty("recommended").GetProperty("reason").GetString());
        Assert.Null((await Groups(admin))["Roof deck"].GetProperty("referenceId").GetInt64OrNull());   // never set by itself
        Assert.Contains(p.GetProperty("zones").EnumerateArray(), z => z.GetProperty("id").GetInt64() == deck);

        // one tap on the phone: Deck amp becomes the zone's reference (saved like the PC's "Set as reference"); the plan measures Deck PC against it
        Assert.Equal(HttpStatusCode.OK, (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/reference", new { zoneId = dA })).StatusCode);
        Assert.Equal(dA, (await Groups(admin))["Roof deck"].GetProperty("referenceId").GetInt64());
        p = await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan");
        Assert.Equal(dA, RefId(p)); Assert.Equal(new[] { dB }, Ids(p));
        Assert.Equal(dC, S.Zones.ReferenceZoneId);   // the house reference is untouched

        // Whole house on the phone: every speaker against the house reference (as before)
        var all = await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan?scope=all");
        Assert.Equal("all", all.GetProperty("scope").GetString()); Assert.Equal(dC, RefId(all)); Assert.Equal(new[] { dA, dB }.OrderBy(x => x).ToArray(), Ids(all));
        // ... and the PC follows a change made on the phone (or the other way round)
        Assert.Equal(HttpStatusCode.OK, (await phone.PutAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/scope", new { scope = "all" })).StatusCode);
        Assert.Equal("all", (await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan")).GetProperty("scope").GetString());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/v1/calibration/phone-link/{tok}/scope", new { scope = deck.ToString() })).StatusCode);
        Assert.Equal(deck.ToString(), (await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan")).GetProperty("scope").GetString());

        // the zone's reference goes offline: it stays the reference (connected=false) and the next best is offered as a one-session stand-in
        await a.DisposeAsync();
        for (int i = 0; i < 160 && S.Zones.Zone(dA)!.Connected; i++) await Task.Delay(50);
        p = await phone.GetJson($"/api/v1/calibration/phone-link/{tok}/plan");
        Assert.Equal(dA, RefId(p)); Assert.False(p.GetProperty("reference").GetProperty("connected").GetBoolean());
        Assert.Equal(dB, p.GetProperty("nextBest").GetProperty("id").GetInt64());
        var sess = await phone.PostAsJsonAsync("/api/v1/calibration/sessions", new { mode = "phone", referenceZoneId = dB, micSource = "phone", micProcessing = "raw", linkToken = tok });
        Assert.True(sess.IsSuccessStatusCode, await sess.Content.ReadAsStringAsync());   // the stand-in measures this session
        Assert.Equal(dB, (await sess.Json()).GetProperty("referenceZoneId").GetInt64());
        Assert.Equal(dA, (await Groups(admin))["Roof deck"].GetProperty("referenceId").GetInt64());   // the saved reference did not change
    }

    [Fact]
    public async Task A_regular_users_link_cannot_choose_or_change_and_keeps_its_own_speaker_against_its_zone_reference()
    {
        await using var f = await ServerFixture.StartAsync(); f.SkipEverywhere(); var admin = f.As(f.Token(Role.Admin)); var S = f.Server.S;
        await using var a = await FakePc.StartAsync(f, "pc-a", "Deck amp", kind: "analog"); await using var b = await FakePc.StartAsync(f, "pc-b", "Deck PC");
        await a.WaitConnected(); await b.WaitConnected();
        for (int i = 0; i < 200 && S.Zones.Zones().Count(z => z.Connected && z.Outputs.Any(o => o.Active)) < 2; i++) await Task.Delay(50);   // every speaker playing to an output (under load this lags the connect)
        var dev = (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
        long dA = dev["pc-a"], dB = dev["pc-b"];
        long deck = (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name = "Roof deck", deviceIds = new[] { dA, dB } })).Json()).GetProperty("id").GetInt64();
        Assert.Null(S.Zones.SetZoneReference(deck, dA));
        var l = CalPhoneApi.Create(false, DateTimeOffset.UtcNow, dB);
        using var phone = new HttpClient { BaseAddress = new Uri(f.Base) }; phone.DefaultRequestHeaders.Add(CalPhoneApi.Header, l.Token);
        var p = await phone.GetJson($"/api/v1/calibration/phone-link/{l.Token}/plan?scope=all");
        Assert.Equal(dA, RefId(p)); Assert.Equal(new[] { dB }, Ids(p));   // their own speaker against its zone's reference, whatever is asked
        Assert.Equal(JsonValueKind.Null, p.GetProperty("scope").ValueKind); Assert.Equal(0, p.GetProperty("zones").GetArrayLength());
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.PutAsJsonAsync($"/api/v1/calibration/phone-link/{l.Token}/scope", new { scope = "all" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{l.Token}/reference", new { zoneId = dB })).StatusCode);
        Assert.Equal(dA, S.Zones.ZoneReferenceMap()[deck]);
        // an admin's link code cannot be steered with another link's code
        var adminTok = CalPhoneApi.Create(true, DateTimeOffset.UtcNow).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await phone.PostAsJsonAsync($"/api/v1/calibration/phone-link/{adminTok}/reference", new { zoneId = dB })).StatusCode);
    }

    static async Task<Dictionary<string, JsonElement>> Groups(HttpClient c) => (await c.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
}

static class JsonNullExt { public static long? GetInt64OrNull(this JsonElement e) => e.ValueKind == JsonValueKind.Number ? e.GetInt64() : null; }
