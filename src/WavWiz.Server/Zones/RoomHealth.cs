using System.Collections.Concurrent;
using WavWiz.Core.Protocol;
using WavWiz.Server.Net;
namespace WavWiz.Server.Zones;

public sealed record RoomEvent(DateTimeOffset At, string Kind, string Text);
public sealed record RoomState(string State, string Text, string? Detail, DateTimeOffset? Since, int Drops, int Reconnects, int UnderrunEvents, DateTimeOffset? LastDropAt, DateTimeOffset? LastUnderrunAt);

/// <summary>
/// Per-room connection health (0.0.2): remembers drops, reconnects and underruns with timestamps, turns them into one visible state per room
/// (ok / buffering / dropped / reconnecting / offline / idle) and writes every event to the server log. Memory only; the log file keeps the history.
/// </summary>
public sealed class RoomHealth
{
    private sealed class T
    {
        public readonly object L = new(); public readonly List<RoomEvent> Events = new();
        public DateTimeOffset? ConnectedAt, LostAt, LastDropAt, LastUnderrunAt; public int Drops, Reconnects, UnderrunEvents, SeenUnderruns, SeenUnderrunEvents; public bool EverConnected; public string? LastReason;
        public bool Buffering; public DateTimeOffset? BufferingSince;
    }
    private readonly ConcurrentDictionary<string, T> _t = new();
    public Action<string>? Log;
    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;
    private T Of(string id) => _t.GetOrAdd(id, _ => new T());

    private void Add(string id, T t, string kind, string text)
    {
        lock (t.L) { t.Events.Add(new RoomEvent(Now(), kind, text)); if (t.Events.Count > 100) t.Events.RemoveAt(0); }
        Log?.Invoke($"room {id}: {kind}: {text}");
    }

    public void Connected(string id, string name, string link, string remote)
    {
        var t = Of(id); bool re;
        lock (t.L) { re = t.EverConnected; t.EverConnected = true; t.ConnectedAt = Now(); t.SeenUnderruns = 0; t.SeenUnderrunEvents = 0; if (re) t.Reconnects++; }
        string gap = t.LostAt is { } l ? $" after {(Now() - l).TotalSeconds:0.#} s offline" : "";
        Add(id, t, re ? "reconnected" : "connected", $"{name} connected from {remote} ({link}){gap}");
        lock (t.L) t.LostAt = null;
    }

    public void Disconnected(string id, string name, string reason)
    {
        var t = Of(id); TimeSpan up;
        lock (t.L) { up = t.ConnectedAt is { } c ? Now() - c : TimeSpan.Zero; t.LostAt = Now(); t.LastDropAt = Now(); t.Drops++; t.LastReason = reason; t.Buffering = false; }
        Add(id, t, "dropped", $"{name} disconnected after {up.TotalSeconds:0} s: {reason}");
    }

    /// <summary>Called for every 1 Hz status; logs a line only when underruns/rebuffering happened.</summary>
    public void Status(string id, string name, PlayerStatus st, bool streamPlaying)
    {
        var t = Of(id); int newEvents = 0;
        lock (t.L)
        {
            int ev = st.UnderrunEvents > 0 ? st.UnderrunEvents : (st.Underruns > t.SeenUnderruns ? t.SeenUnderrunEvents + 1 : t.SeenUnderrunEvents);   // 0.0.1 players only report the block count
            if (ev > t.SeenUnderrunEvents) { newEvents = ev - t.SeenUnderrunEvents; t.UnderrunEvents += newEvents; t.LastUnderrunAt = Now(); }
            t.SeenUnderrunEvents = Math.Max(t.SeenUnderrunEvents, ev); t.SeenUnderruns = Math.Max(t.SeenUnderruns, st.Underruns);
        }
        if (newEvents > 0) Add(id, t, "underrun", $"{name}: audio ran out {newEvents}x (buffer {st.BufferMs:0} ms, link {st.LinkType}, resyncs {st.HardResyncs})");
        bool buffering = streamPlaying && (st.BufferMs < 250 || !st.Playing);
        lock (t.L) { if (buffering && !t.Buffering) t.BufferingSince = Now(); t.Buffering = buffering; }
    }

    public RoomState State(string id, bool connected, PlayerStatus? st, bool streamPlaying, long streamAgeMs)
    {
        var t = Of(id); var now = Now();
        lock (t.L)
        {
            RoomState S(string s, string text, string? d = null, DateTimeOffset? since = null) => new(s, text, d, since, t.Drops, t.Reconnects, t.UnderrunEvents, t.LastDropAt, t.LastUnderrunAt);
            if (!connected)
            {
                if (t.LostAt is { } lost)
                {
                    var age = (now - lost).TotalSeconds;
                    if (age <= 10) return S("dropped", "DROPPED", t.LastReason, lost);
                    if (age <= 600) return S("reconnecting", "RECONNECTING", "Waiting for this PC to come back. " + (t.LastReason ?? ""), lost);
                }
                return S("offline", "OFFLINE", null, t.LostAt);
            }
            if (t.LastUnderrunAt is { } u && (now - u).TotalSeconds < 6) return S("buffering", "BUFFERING", "Audio just ran out; it is catching up.", u);
            if (streamPlaying && st != null && streamAgeMs > 4000 && (st.BufferMs < 250 || !st.Playing)) return S("buffering", "BUFFERING", $"Only {st.BufferMs:0} ms of audio buffered - the network may be slow.", t.BufferingSince);
            return S(streamPlaying ? "ok" : "idle", streamPlaying ? "OK" : "READY");
        }
    }

    public void Note(string id, string text) => Add(id, Of(id), "info", text);
    public List<RoomEvent> Events(string id) { var t = Of(id); lock (t.L) return t.Events.AsEnumerable().Reverse().ToList(); }
    public void Forget(string id) => _t.TryRemove(id, out _);
}
