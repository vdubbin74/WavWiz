using System.Text.Json;
using WavWiz.Server.Api;

namespace WavWiz.Server.AirPlay;

/// <summary>
/// F170 (0.6.0): an added AirPlay output is a real Speaker. A successful connect writes a player row + zone row ("airplay:&lt;key&gt;",
/// no zone group = Unassigned) and an output device/endpoint so the speaker card's delay works; the zone layout then routes it like any
/// Player (ZoneLinks.Apply). Speaker card volume / mute / on-off reach the sink through ZoneManager.External*; Forget disconnects it.
/// Added speakers are remembered in setting "airplay.speakers" and reconnected after a restart (retrying while the speaker is away).
/// A failed connect writes nothing, so there is no orphan row.
/// </summary>
public static class AirPlaySpeakers
{
    public const string Key = "airplay.speakers";
    public sealed record Saved(string Key, string? Endpoint, string Name);

    static string? KeyOf(string playerId) => playerId.StartsWith("airplay:") ? playerId["airplay:".Length..] : null;
    static List<Saved> Load(Services s) { try { return JsonSerializer.Deserialize<List<Saved>>(s.Db.Setting(Key) ?? "[]") ?? new(); } catch { return new(); } }
    static void Store(Services s, List<Saved> l) => s.Db.SetSetting(Key, JsonSerializer.Serialize(l));

    /// <summary>Wires ZoneManager to the AirPlay outputs and starts reconnecting saved speakers in the background.</summary>
    public static void Attach(Services s, Action<string>? log)
    {
        var z = s.Zones;
        z.ExternalOnline = pid => KeyOf(pid) is string k && s.AirPlayOut?.IsConnected(k) == true;
        z.ExternalPatched = pid => { if (KeyOf(pid) != null) _ = Push(s, pid); };
        z.ExternalRemoved = pid =>
        {
            if (KeyOf(pid) is not string k) return;
            lock (Gate) Store(s, Load(s).Where(x => x.Key != k).ToList());
            s.Db.Exec("DELETE FROM output_device WHERE id=$d", ("$d", pid));
            if (s.AirPlayOut != null) _ = s.AirPlayOut.DisconnectAsync(k);
        };
        var saved = Load(s); if (saved.Count == 0) return;
        _ = Task.Run(async () =>
        {
            AirPlaySenderApi.Ensure(s);
            var left = saved.ToList();
            for (int round = 0; left.Count > 0 && round < 40 && !s.Stop.IsCancellationRequested; round++)
            {
                try { await Task.Delay(round == 0 ? 4000 : 30000, s.Stop.Token); } catch { return; }
                foreach (var sv in left.ToList())
                {
                    if (!Load(s).Any(x => x.Key == sv.Key)) { left.Remove(sv); continue; }   // forgotten meanwhile
                    try { var o = await AirPlaySenderApi.Outs(s).ConnectAsync(sv.Key, sv.Endpoint, 0, 50); Register(s, o, sv.Endpoint); left.Remove(sv); log?.Invoke($"airplay {sv.Key}: reconnected"); }
                    catch (Exception e) { if (round == 0) log?.Invoke($"airplay {sv.Key}: reconnect failed ({e.Message}), retrying"); }
                }
            }
        });
    }

    static readonly object Gate = new();

    /// <summary>Called after a successful connect: create/update the speaker rows, remember it, route it and apply the card's volume/mute/on-off.</summary>
    public static void Register(Services s, AirPlayOutputs.Out o, string? endpoint)
    {
        var pid = AirPlayOutputs.PlayerId(o.Key); var now = DateTimeOffset.UtcNow.ToString("O"); var db = s.Db;
        db.Exec("INSERT INTO player(id,name,machine_name,app_version,last_seen_at,link_type) VALUES($i,$n,$m,$v,$t,'airplay') ON CONFLICT(id) DO UPDATE SET machine_name=$m,app_version=$v,last_seen_at=$t,link_type='airplay'",
            ("$i", pid), ("$n", o.Name), ("$m", "AirPlay " + o.Address), ("$v", o.Kind), ("$t", now));
        bool isNew = Convert.ToInt32(db.Scalar("SELECT COUNT(*) FROM zone WHERE player_id=$p", ("$p", pid))) == 0;
        if (isNew) db.Insert("INSERT INTO zone(name,player_id,sort,volume,active_output_device_id) VALUES($n,$p,(SELECT COALESCE(MAX(sort),0)+1 FROM zone),$v,$p)", ("$n", o.Name), ("$p", pid), ("$v", (double)o.Volume));
        db.Exec("INSERT INTO output_device(id,kind,friendly_name) VALUES($d,'other',$n) ON CONFLICT(id) DO UPDATE SET friendly_name=$n", ("$d", pid), ("$n", o.Name));
        db.Exec("INSERT INTO output_endpoint(output_device_id,player_id,win_endpoint_id,last_seen_at,connected) VALUES($d,$d,'airplay',$t,1) ON CONFLICT(player_id,win_endpoint_id) DO UPDATE SET last_seen_at=$t,connected=1", ("$d", pid), ("$t", now));
        lock (Gate) { var l = Load(s).Where(x => x.Key != o.Key).ToList(); l.Add(new Saved(o.Key, endpoint, o.Name)); Store(s, l); }
        s.Links?.Apply(pid);
        _ = Push(s, pid);
        s.Events.Publish("zones");
    }

    /// <summary>Card state -> sink: on/off (group membership), volume (0 when muted), delay (saved manual/ear calibration).</summary>
    public static async Task Push(Services s, string pid)
    {
        if (KeyOf(pid) is not string k || s.AirPlayOut is not { } outs || !outs.IsConnected(k)) return;
        var z = s.Zones.Zones().FirstOrDefault(x => x.PlayerId == pid); if (z == null) return;
        outs.SetEnabled(k, z.Enabled);
        await outs.SetVolumeAsync(k, z.Muted ? 0 : (int)Math.Round(z.Volume));
        var o = z.Outputs.FirstOrDefault(); if (o != null && !o.NotCalibrated && double.IsFinite(o.LatencyMs)) outs.SetDelay(k, (int)Math.Round(o.LatencyMs));
    }
}
