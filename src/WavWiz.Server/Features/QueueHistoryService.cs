using System.Text.Json;
using System.Text.Json.Nodes;
using WavWiz.Server.Playback;
namespace WavWiz.Server.Features;

/// <summary>Queue undo + Recent queues. Before Clear / Play now (replace) / Move to another zone the whole queue is snapshotted; the newest snapshot is the
/// one Undo puts back (one level), and up to 10 per playback group are kept as Recent queues (saved in the database). Linked boxes share one group, so one history.</summary>
public sealed class QueueHistoryService
{
    public const int Max = 10;
    private readonly Db _db; private readonly EventHub _ev; private readonly object _l = new();
    public Func<DateTimeOffset> Clock { get; set; } = () => DateTimeOffset.UtcNow;
    public QueueHistoryService(Db db, EventHub ev) { _db = db; _ev = ev; }
    private static string Key(string gid) => "queue.recent." + gid;
    public sealed record Snap(string Id, DateTimeOffset At, string Reason, int Count, List<string> Titles, string Json);
    private readonly Dictionary<string, Snap> _undo = new();
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);

    public List<Snap> Recent(string gid)
    {
        try { if (_db.Setting(Key(gid)) is { } j) return JsonSerializer.Deserialize<List<Snap>>(j, J) ?? new(); } catch { } return new();
    }
    private void Save(string gid, List<Snap> l) => _db.SetSetting(Key(gid), JsonSerializer.Serialize(l.Take(Max).ToList(), J));

    /// <summary>Snapshot the group's queue before a destructive change. Returns the undo token, or null for an empty queue.</summary>
    public string? Snapshot(Conductor cd, string reason)
    {
        var q = cd.Queue().Where(x => !Conductor.IsReceiver(x.Kind)).ToList(); if (q.Count == 0) return null;
        var snap = new Snap(Guid.NewGuid().ToString("N")[..12], Clock(), reason, q.Count, q.Take(3).Select(x => string.IsNullOrWhiteSpace(x.Artist) ? x.Title : $"{x.Title} - {x.Artist}").ToList(), cd.BuildLastJson());
        lock (_l)
        {
            _undo[cd.GroupId] = snap;
            var l = Recent(cd.GroupId); var same = l.FirstOrDefault(x => Items(x.Json) == Items(snap.Json));
            if (same != null) l.Remove(same);   // the same list again only moves to the top
            l.Insert(0, snap); Save(cd.GroupId, l);
        }
        _ev.Publish("queue.recent"); return snap.Id;
    }
    private static string Items(string json) { try { return JsonNode.Parse(json)?["items"]?.ToJsonString() ?? json; } catch { return json; } }

    /// <summary>Undo: puts back the newest snapshot (token must match when given; a newer action wins). Snapshots the current queue first so the undo can itself be undone.</summary>
    public (int Restored, string? NewToken, string? Error) Undo(Conductor cd, string? token)
    {
        Snap? s; lock (_l) _undo.TryGetValue(cd.GroupId, out s);
        if (s == null || (!string.IsNullOrEmpty(token) && token != s.Id)) return (0, null, "Nothing to undo (a newer change replaced it).");
        lock (_l) _undo.Remove(cd.GroupId);
        return Put(cd, s, "Put the queue back");
    }
    public (int Restored, string? NewToken, string? Error) Restore(Conductor cd, string id)
    {
        var s = Recent(cd.GroupId).FirstOrDefault(x => x.Id == id); if (s == null) return (0, null, "That recent queue is gone.");
        return Put(cd, s, "Restored a recent queue");
    }
    private (int, string?, string?) Put(Conductor cd, Snap s, string verb)
    {
        var tok = Snapshot(cd, "Before restore");
        var n = cd.RestoreSnapshot(s.Json, $"{verb} ({s.Count} item{(s.Count == 1 ? "" : "s")}). Press Play to continue.");
        return n == 0 ? (0, tok, "None of those songs are in the library any more.") : (n, tok, null);
    }
    public void Forget(string gid) { lock (_l) _undo.Remove(gid); _db.DeleteSetting(Key(gid)); }
}
