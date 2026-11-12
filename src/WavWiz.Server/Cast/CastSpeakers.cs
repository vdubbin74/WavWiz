using System.Text.Json;
using WavWiz.Server.Api;
namespace WavWiz.Server.Cast;

/// <summary>
/// 0.7.0 F169: Cast devices as regular Speakers (player "cast:&lt;id&gt;", link_type 'cast'), the same model as AirPlaySpeakers (F170): a successful
/// add writes the player / zone / output rows, the speaker card's volume, mute, on/off and delay reach the sink, Forget disconnects, and
/// added devices are remembered in setting "cast.speakers" and reconnected after a restart or a drop. A failed connect writes nothing.
/// ZoneManager's External* hooks are chained (AirPlay keeps its own handling for "airplay:" ids).
/// </summary>
public static class CastSpeakers
{
    public const string Key = "cast.speakers";
    public sealed record Saved(string Key, string? Endpoint, string Name);

    public static string? KeyOf(string playerId) => playerId.StartsWith("cast:") ? playerId["cast:".Length..] : null;
    internal static List<Saved> Load(Services s) { try { return JsonSerializer.Deserialize<List<Saved>>(s.Db.Setting(Key) ?? "[]") ?? new(); } catch { return new(); } }
    static void Store(Services s, List<Saved> l) => s.Db.SetSetting(Key, JsonSerializer.Serialize(l));
    static readonly object Gate = new();

    public static void Attach(Services s, Action<string>? log)
    {
        var z = s.Zones;
        var online = z.ExternalOnline; var patched = z.ExternalPatched; var removed = z.ExternalRemoved;
        z.ExternalOnline = pid => KeyOf(pid) is string k ? s.CastOut?.IsConnected(k) == true : online?.Invoke(pid) == true;
        z.ExternalPatched = pid => { if (KeyOf(pid) != null) _ = Push(s, pid); else patched?.Invoke(pid); };
        z.ExternalRemoved = pid =>
        {
            if (KeyOf(pid) is not string k) { removed?.Invoke(pid); return; }
            lock (Gate) Store(s, Load(s).Where(x => x.Key != k).ToList());
            s.Db.Exec("DELETE FROM output_device WHERE id=$d", ("$d", pid));
            if (s.CastOut != null) _ = s.CastOut.DisconnectAsync(k);
        };
        if (Load(s).Count > 0) Reconnect(s, log, Load(s).Select(x => x.Key).ToList(), firstDelayMs: 4000);
    }

    /// <summary>Background reconnect of remembered devices (startup, or after a drop): every 30 s for up to 20 min, until forgotten.</summary>
    public static void Reconnect(Services s, Action<string>? log, List<string> keys, int firstDelayMs = 5000)
    {
        _ = Task.Run(async () =>
        {
            CastApi.Ensure(s);
            var left = keys.ToList();
            for (int round = 0; left.Count > 0 && round < 40 && !s.Stop.IsCancellationRequested; round++)
            {
                try { await Task.Delay(round == 0 ? firstDelayMs : 30000, s.Stop.Token); } catch { return; }
                foreach (var k in left.ToList())
                {
                    var sv = Load(s).FirstOrDefault(x => x.Key == k); if (sv == null) { left.Remove(k); continue; }   // forgotten meanwhile
                    if (CastApi.Outs(s).IsConnected(k)) { left.Remove(k); continue; }
                    try { var o = await CastApi.Outs(s).ConnectAsync(sv.Key, sv.Endpoint, 0, 50, default, subscribe: false, displayName: sv.Name); Register(s, o, sv.Endpoint); await Push(s, o.Sink.Id); left.Remove(k); log?.Invoke($"cast {k}: reconnected"); }
                    catch (Exception e) { if (round == 0) log?.Invoke($"cast {k}: reconnect failed ({e.Message}), retrying"); }
                }
            }
        });
    }

    public static void Register(Services s, CastOutputs.Out o, string? endpoint)
    {
        var pid = CastOutputs.PlayerId(o.Key); var now = DateTimeOffset.UtcNow.ToString("O"); var db = s.Db;
        db.Exec("INSERT INTO player(id,name,machine_name,app_version,last_seen_at,link_type) VALUES($i,$n,$m,$v,$t,'cast') ON CONFLICT(id) DO UPDATE SET machine_name=$m,app_version=$v,last_seen_at=$t,link_type='cast'",
            ("$i", pid), ("$n", o.Name), ("$m", "Cast " + o.Address), ("$v", o.Kind), ("$t", now));
        bool isNew = Convert.ToInt32(db.Scalar("SELECT COUNT(*) FROM zone WHERE player_id=$p", ("$p", pid))) == 0;
        if (isNew) s.Zones.AdoptFirstSpeaker(db.Insert("INSERT INTO zone(name,player_id,sort,volume,active_output_device_id) VALUES($n,$p,(SELECT COALESCE(MAX(sort),0)+1 FROM zone),$v,$p)", ("$n", o.Name), ("$p", pid), ("$v", (double)o.Volume)));   // 0.6.8 zone fix: the first speaker of a fresh setup goes into Everywhere
        db.Exec("INSERT INTO output_device(id,kind,friendly_name) VALUES($d,'other',$n) ON CONFLICT(id) DO UPDATE SET friendly_name=$n", ("$d", pid), ("$n", o.Name));
        db.Exec("INSERT INTO output_endpoint(output_device_id,player_id,win_endpoint_id,last_seen_at,connected) VALUES($d,$d,'cast',$t,1) ON CONFLICT(player_id,win_endpoint_id) DO UPDATE SET last_seen_at=$t,connected=1", ("$d", pid), ("$t", now));
        lock (Gate) { var l = Load(s).Where(x => x.Key != o.Key).ToList(); l.Add(new Saved(o.Key, endpoint, o.Name)); Store(s, l); }
        s.Links?.Apply(pid);
        _ = Push(s, pid);
        s.Events.Publish("zones");
    }

    /// <summary>Card state -> sink: on/off (group membership), volume (0 when muted), delay (saved manual/ear calibration).</summary>
    public static async Task Push(Services s, string pid)
    {
        if (KeyOf(pid) is not string k || s.CastOut is not { } outs || !outs.IsConnected(k)) return;
        var z = s.Zones.Zones().FirstOrDefault(x => x.PlayerId == pid); if (z == null) return;
        outs.SetEnabled(k, z.Enabled);
        await outs.SetVolumeAsync(k, z.Muted ? 0 : (int)Math.Round(z.Volume));
        var o = z.Outputs.FirstOrDefault(); if (o != null && !o.NotCalibrated && double.IsFinite(o.LatencyMs)) outs.SetDelay(k, (int)Math.Round(o.LatencyMs));
    }
}
