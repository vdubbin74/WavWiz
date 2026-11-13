using System.Net;
using System.Text.Json;
using WavWiz.Server.Features;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Tests;

/// <summary>0.7.0 (t1915u–t1917u): restore onto a fresh install remaps already-paired speakers, keeps this server's identity,
/// loads the restored zones into the playback registry (queue add / drop no longer get "no such zone"), and adopts a placeholder when that player pairs later.</summary>
public class Restore070Tests
{
    static async Task Until(Func<bool> ok, string what) { for (int i = 0; i < 100 && !ok(); i++) await Task.Delay(50); Assert.True(ok(), what); }
    static async Task<Dictionary<string, long>> Devices(HttpClient admin) =>
        (await admin.GetJson("/api/v1/zones")).EnumerateArray().ToDictionary(z => z.GetProperty("playerId").GetString()!, z => z.GetProperty("id").GetInt64());
    static async Task<Dictionary<string, JsonElement>> Groups(HttpClient admin) =>
        (await admin.GetJson("/api/v1/groups")).EnumerateArray().ToDictionary(z => z.GetProperty("name").GetString()!);
    static async Task<long> MakeZone(HttpClient admin, string name, params long[] devs) =>
        (await (await admin.PostAsJsonAsync("/api/v1/groups", new { name, deviceIds = devs })).Json()).GetProperty("id").GetInt64();
    static string Sid(ServerFixture f) => f.Server.S.ServerId;

    [Fact]
    public void Device_id_prefix_rewrites_the_player_part_only()
    {
        var old = "83b47ca3e61149e8b8bca7c2978c5f0c"; var neu = "5cdf9fa4589d4e2792fe194bcfd016a1";
        var id = $"ep:{old}:{{0.0.0.00000000}}.{{3de5a164-64d5-4b6c-b7dc-18925ca8008e}}";
        Assert.Equal($"ep:{neu}:{{0.0.0.00000000}}.{{3de5a164-64d5-4b6c-b7dc-18925ca8008e}}", BackupService.RewriteDeviceId(id, old, neu));
        Assert.Equal(("83b47ca3e61149e8b8bca7c2978c5f0c", "{0.0.0.00000000}.{3de5a164-64d5-4b6c-b7dc-18925ca8008e}"), BackupService.SplitDeviceId(id));
    }

    [Fact]
    public async Task Restore_onto_a_fresh_install_remaps_paired_speakers_keeps_server_id_and_accepts_queue_adds()
    {
        byte[] file; string living, kitchen;
        await using (var a = await ServerFixture.StartAsync())
        {
            var admin = a.As(a.Token(Role.Admin));
            await using var pcA = await FakePc.StartAsync(a, "old-living", "Living room");
            await using var pcB = await FakePc.StartAsync(a, "old-kitchen", "Kitchen");
            await pcA.WaitConnected(); await pcB.WaitConnected();
            await Until(() => a.Server.S.Zones.Zones().Count == 2, "speakers on A");
            var dev = await Devices(admin);
            long basement = await MakeZone(admin, "Basement", dev["old-living"], dev["old-kitchen"]);
            await admin.PostAsJsonAsync("/api/v1/radio", new { name = "KEXP", url = "https://kexp.example/stream" });
            a.Server.S.Db.SetSetting("airplay.hwaddr", "\"AA:AA:AA:AA:AA:AA\"");
            var r = await admin.GetAsync("/api/v1/backup"); r.EnsureSuccessStatusCode();
            file = await r.Content.ReadAsByteArrayAsync();
            living = "Living room"; kitchen = "Kitchen";
            Assert.True(basement > 0);
        }
        await using var b = await ServerFixture.StartAsync();
        var badm = b.As(b.Token(Role.Admin));
        var beforeId = Sid(b);
        b.Server.S.Db.SetSetting("airplay.hwaddr", "\"BB:BB:BB:BB:BB:BB\"");
        await using var fresh = await FakePc.StartAsync(b, "new-living", "Living room");
        await fresh.WaitConnected();
        await Until(() => b.Server.S.Zones.Zones().Count == 1, "fresh speaker");
        var pv = await (await badm.PostAsync("/api/v1/backup/preview", new ByteArrayContent(file))).Json();
        Assert.Equal(BackupService.PairingNote, pv.GetProperty("pairingNote").GetString());
        var reattach = pv.GetProperty("willReattach").EnumerateArray().Select(x => x.GetString()).ToList();
        var need = pv.GetProperty("needPairing").EnumerateArray().Select(x => x.GetString()).ToList();
        Assert.Contains(living, reattach);
        Assert.Contains(kitchen, need);
        var imp = await badm.PostAsync("/api/v1/backup/import", new ByteArrayContent(file));
        Assert.Equal(HttpStatusCode.OK, imp.StatusCode);
        Assert.Equal(beforeId, Sid(b));
        Assert.Equal("\"BB:BB:BB:BB:BB:BB\"", b.Server.S.Db.Setting("airplay.hwaddr"));
        // the imported server.id must not have replaced this install's id in the database either
        var stored = System.Text.Json.JsonSerializer.Deserialize<string>(b.Server.S.Db.Setting("server.id")!)!;
        Assert.Equal(beforeId, stored);

        var groups = await Groups(badm);
        Assert.True(groups.ContainsKey("Basement"), "restored zone is listed");
        var basementId = groups["Basement"].GetProperty("id").GetInt64();
        var zs = (await badm.GetJson("/api/v1/zones")).EnumerateArray().ToList();
        var livingRow = zs.Single(z => z.GetProperty("name").GetString() == "Living room");
        Assert.Equal("new-living", livingRow.GetProperty("playerId").GetString());
        var kitchenRow = zs.Single(z => z.GetProperty("name").GetString() == "Kitchen");
        Assert.Equal("old-kitchen", kitchenRow.GetProperty("playerId").GetString()); // placeholder until it pairs

        // t1916/t1917: adding (and the drop path, same POST) to the restored zone must not 404 "no such zone"
        var radio = (await badm.GetJson("/api/v1/radio")).EnumerateArray().First(x => x.GetProperty("name").GetString() == "KEXP").GetProperty("id").GetInt64();
        var addG = await badm.PostAsJsonAsync("/api/v1/queue/add", new { kind = "radio", id = radio, zoneId = "g:" + basementId });
        Assert.Equal(HttpStatusCode.OK, addG.StatusCode);
        var own = "zg:" + basementId;
        Assert.True(b.Server.S.Registry.Exists(own) || b.Server.S.Links.ResolveZone("g:" + basementId, false) != null, "playback group is loaded");
        var addZ = await badm.PostAsJsonAsync("/api/v1/queue/add", new { kind = "radio", id = radio, zoneId = own });
        Assert.NotEqual(HttpStatusCode.NotFound, addZ.StatusCode); // either played in its own group or in the house group after resolve

        // later pairing of the other PC takes over the placeholder (t1915: no need to Forget + re-add)
        await using var later = await FakePc.StartAsync(b, "new-kitchen", "Kitchen");
        await later.WaitConnected();
        await Until(() => b.Server.S.Zones.Zones().Any(z => z.PlayerId == "new-kitchen"), "Kitchen remapped on pair");
        var after = (await badm.GetJson("/api/v1/zones")).EnumerateArray().Single(z => z.GetProperty("name").GetString() == "Kitchen");
        Assert.Equal("new-kitchen", after.GetProperty("playerId").GetString());
        Assert.Equal(kitchenRow.GetProperty("id").GetInt64(), after.GetProperty("id").GetInt64()); // same device row, EQ/delays stay
        var addAgain = await badm.PostAsJsonAsync("/api/v1/queue/add", new { kind = "radio", id = radio, zoneId = "g:" + basementId });
        Assert.Equal(HttpStatusCode.OK, addAgain.StatusCode);
    }
}
