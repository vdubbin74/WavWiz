using WavWiz.Core.Clock;
using WavWiz.Core.Stream;
using WavWiz.Server.Library;
using WavWiz.Server.Media;
namespace WavWiz.Server.Playback;

public enum PlayState { Stopped, Playing, Paused }

public sealed record NowPlaying(string State, int Index, long PositionMs, long DurationMs, QueueItem? Item, string? LiveTitle, string? Notice, bool Shuffle, string Repeat, long Version);

/// <summary>
/// Owns the queue and the house stream (spec 5.1, 10). One lock serializes the StreamEngine (single-threaded by contract); a 10 ms timer pumps it.
/// Pause = STOP_AT with a short fade and remember the position; resume starts a new epoch from there (every zone restarts together).
/// </summary>
public sealed class Conductor : IDisposable
{
    public readonly IMonotonicClock Clock; public readonly StreamEngine Engine; private readonly Db _db; private readonly EventHub _events; private readonly string _ffmpeg;
    private readonly object _l = new();
    private readonly List<QueueItem> _queue = new(); private List<QueueItem>? _unshuffled;
    private QueueSource? _source; private RadioDecoder? _radio;
    private PlayState _state = PlayState.Stopped; private int _index; private long _pausedMs; private RepeatMode _repeat = RepeatMode.Off; private bool _shuffle;
    private long _idSeq = 1, _version; private string? _liveTitle, _notice;
    private readonly Timer _timer; private int _lastIndexReported = -2; private PlayState _lastStateReported = PlayState.Stopped;
    public int LeadMs { get; set; } = 600;
    public Func<QueueItem, long, IPcmDecoder>? OpenOverride { get; set; }          // tests

    // ---------------- 0.1.1: live receivers (AirPlay, Spotify Connect) ----------------
    private readonly Dictionary<string, LiveFeed> _feeds = new(); private (List<QueueItem> Queue, int Index)? _beforeLive; private bool _lastLiveActive;
    public static bool IsReceiver(string? kind) => kind is "airplay" or "spotify";
    public static bool IsLive(string? kind) => kind == "radio" || IsReceiver(kind);
    public void RegisterFeed(string kind, LiveFeed feed) { lock (_l) _feeds[kind] = feed; }

    /// <summary>A phone started sending (AirPlay session / Spotify playing): the house plays it in every zone. The queue that was there comes back when the sender leaves.</summary>
    public void BeginLive(string kind, string title, string artist = "", string album = "", string? artUrl = null)
    {
        lock (_l)
        {
            var cur = _index >= 0 && _index < _queue.Count ? _queue[_index] : null;
            if (cur?.Kind == kind && _state == PlayState.Playing) return;
            if (cur == null || !IsReceiver(cur.Kind)) _beforeLive = (new List<QueueItem>(_queue), _index);
            var item = cur?.Kind == kind ? cur : new QueueItem(0, kind, kind, title, artist, album, 0, null, null, null, artUrl);
            _queue.Clear(); _queue.Add(item.Id == 0 ? WithId(item) : item); _unshuffled = null;
            StartAt(0, 0); _events.Publish("queue", null);
        }
    }

    /// <summary>New title/artist/artwork from the sender.</summary>
    public void UpdateLive(string kind, Func<QueueItem, QueueItem> change)
    {
        lock (_l)
        {
            int i = _queue.FindIndex(q => q.Kind == kind); if (i < 0) return;
            _queue[i] = change(_queue[i]) with { Id = _queue[i].Id, Kind = kind };
            Bump(); _events.Publish("now", null); _events.Publish("queue", null);
        }
    }

    /// <summary>The sender disconnected: stop and put the previous queue back (stopped).</summary>
    public void EndLive(string kind)
    {
        lock (_l)
        {
            if (!_queue.Any(q => q.Kind == kind)) return;
            if (_state != PlayState.Stopped) { Engine.Stop(30_000); DisposeSourceLater(); }
            _state = PlayState.Stopped; _queue.Clear(); _pausedMs = 0; _index = 0;
            if (_beforeLive is { } b) { _queue.AddRange(b.Queue); _index = Math.Clamp(b.Index, 0, Math.Max(0, _queue.Count - 1)); }
            _beforeLive = null; Bump(); _events.Publish("queue", null); _events.Publish("now", null);
        }
    }

    private bool LiveActiveNoLock(QueueItem? it) => it != null && IsReceiver(it.Kind) && _feeds.TryGetValue(it.Kind, out var f) && f.Active;

    public Conductor(Db db, EventHub events, string ffmpeg, IMonotonicClock? clock = null)
    {
        _db = db; _events = events; _ffmpeg = ffmpeg; Clock = clock ?? new StopwatchClock(); Engine = new StreamEngine(Clock);
        _timer = new Timer(_ => Tick(), null, 10, 10);
    }

    // ---------------- engine-facing (subscribe/unsubscribe go through the same lock) ----------------
    public void Subscribe(IStreamSubscriber s) { lock (_l) Engine.Subscribe(s); }
    public void Unsubscribe(string id) { lock (_l) Engine.Unsubscribe(id); }
    /// <summary>0.1.3 receiver health: who the house stream is sending to right now.</summary>
    public List<IStreamSubscriber> Subscribers() { lock (_l) return Engine.Subscribers.ToList(); }
    /// <summary>The house is playing a receiver item whose sender stopped sending more than a minute ago.</summary>
    public string? StaleLiveKind()
    {
        lock (_l)
        {
            var cur = _index >= 0 && _index < _queue.Count ? _queue[_index] : null;
            return cur != null && IsReceiver(cur.Kind) && _feeds.TryGetValue(cur.Kind, out var f) && (f.DataAgeMs ?? long.MaxValue) > 60_000 ? cur.Kind : null;
        }
    }

    private IPcmDecoder Open(QueueItem it, long startMs)
    {
        if (OpenOverride != null) return OpenOverride(it, startMs);
        if (IsReceiver(it.Kind)) return _feeds.TryGetValue(it.Kind, out var feed) ? feed.OpenDecoder() : throw new InvalidOperationException(it.Kind + " receiver is not running");
        if (it.Kind == "radio")
        {
            var r = new RadioDecoder(_ffmpeg, it.Location);
            r.Metadata += t => { _liveTitle = t; Bump(); _events.Publish("now", null); };
            r.Status += t => { _notice = t == "Connecting..." ? null : t; };
            _radio = r; return r;
        }
        var dec = new FfmpegDecoder(_ffmpeg, it.Location, startMs);
        // 0.1.3 ReplayGain + iTunSMPB end trim (tags read off the stream thread)
        var mode = ReplayGainMode(); bool albumCtx = mode == "auto" && AlbumContextNoLock(it); var path = it.Location;
        return new ShapedDecoder(dec, Task.Run(() => { var t = TagReader(path); return (Loudness.Gain(t, mode, albumCtx), Loudness.ValidFrames(t, startMs)); }));
    }

    /// <summary>Tests can swap the tag reader.</summary>
    public Func<string, TrackTags> TagReader { get; set; } = Loudness.Read;
    public string ReplayGainMode() { try { return Loudness.NormMode(_db.Setting("playback.replayGain")); } catch { return Loudness.DefaultMode; } }
    /// <summary>Auto mode uses album gain when the queue is playing this album in order (a neighbour is from the same album, shuffle off).</summary>
    private bool AlbumContextNoLock(QueueItem it)
    {
        if (_shuffle || string.IsNullOrWhiteSpace(it.Album)) return false;
        int i = _queue.FindIndex(q => q.Id == it.Id); if (i < 0) return false;
        bool Same(int j) => j >= 0 && j < _queue.Count && string.Equals(_queue[j].Album, it.Album, StringComparison.OrdinalIgnoreCase) && _queue[j].Kind == it.Kind;
        return Same(i - 1) || Same(i + 1);
    }

    private void Tick()
    {
        try
        {
            lock (_l)
            {
                if (_state == PlayState.Playing && Engine.Playing) Engine.Pump();
                long now = Clock.NowUs;
                if (Engine.Playing && Engine.StopAtUs != long.MaxValue && now > Engine.StopAtUs + 200_000)
                {
                    // the stop time has passed (pause, stop or natural end of queue)
                    bool natural = _state == PlayState.Playing;
                    Engine.Halt();
                    if (natural) { _state = PlayState.Stopped; _index = Math.Max(0, Math.Min(_index, _queue.Count - 1)); _pausedMs = 0; DisposeSource(); }
                }
                if (_state == PlayState.Playing && _source != null)
                {
                    int idx = CurrentIndexNoLock();
                    if (idx != _lastIndexReported) { _liveTitle = null; }
                }
                var curItem = _index >= 0 && _index < _queue.Count ? _queue[_index] : null;
                bool liveActive = LiveActiveNoLock(curItem);
                if (liveActive != _lastLiveActive) { _lastLiveActive = liveActive; if (curItem != null && IsReceiver(curItem.Kind)) { Bump(); _events.Publish("now", null); } }
                if (_index != _lastIndexReported || _state != _lastStateReported)
                {
                    _lastIndexReported = _index; _lastStateReported = _state; Bump();
                    _events.Publish("now", null);
                }
            }
        }
        catch (Exception e) { Console.Error.WriteLine("conductor tick: " + e.Message); }
    }

    private int CurrentIndexNoLock()
    {
        if (_source == null) return _index;
        long frame = Engine.PositionSamplesAt(Clock.NowUs);
        var loc = _source.Locate(frame);
        if (loc.Index >= 0 && loc.Index < _queue.Count) _index = loc.Index;
        return _index;
    }

    private void Bump() => Interlocked.Increment(ref _version);
    private void DisposeSource() { try { _source?.Dispose(); } catch { } _source = null; _radio = null; }

    // ---------------- queue building ----------------
    public List<QueueItem> TracksToItems(IEnumerable<long> ids)
    {
        var res = new List<QueueItem>();
        foreach (var id in ids)
        {
            var r = _db.Query("SELECT id,path,title,artist,album,duration_ms,genre,year FROM track WHERE id=$i AND missing=0",
                x => new QueueItem(0, "track", x.GetString(1), x.GetString(2), x.GetString(3), x.GetString(4), x.GetInt64(5), x.GetInt64(0), x.IsDBNull(6) ? null : x.GetString(6), x.IsDBNull(7) ? null : x.GetInt32(7)), ("$i", id)).FirstOrDefault();
            if (r != null) res.Add(r);
        }
        return res;
    }

    public QueueItem? StationToItem(long id) => _db.Query("SELECT id,name,url,logo_url FROM radio_station WHERE id=$i",
        x => new QueueItem(0, "radio", x.GetString(2), x.GetString(1), "Internet radio", "", 0, x.GetInt64(0), null, null, x.IsDBNull(3) ? null : x.GetString(3)), ("$i", id)).FirstOrDefault();

    public static QueueItem UrlItem(string url, string name) => new(0, "radio", url, string.IsNullOrWhiteSpace(name) ? url : name, "Internet radio", "", 0, null);

    private QueueItem WithId(QueueItem q) => q with { Id = _idSeq++ };

    // ---------------- transport ----------------
    /// <summary>Replace the queue and start playing at <paramref name="index"/>.</summary>
    public void PlayItems(IEnumerable<QueueItem> items, int index = 0, long startMs = 0)
    {
        lock (_l)
        {
            _queue.Clear(); _queue.AddRange(items.Select(WithId)); _unshuffled = null;
            if (_shuffle) ApplyShuffle(keepFirst: Math.Clamp(index, 0, Math.Max(0, _queue.Count - 1)), out index);
            StartAt(index, startMs);
        }
    }

    private void StartAt(int index, long startMs)
    {
        DisposeSource();
        if (_queue.Count == 0) { Engine.Stop(0); _state = PlayState.Stopped; Bump(); return; }
        index = Math.Clamp(index, 0, _queue.Count - 1);
        _index = index; _liveTitle = null; _notice = null;
        _source = new QueueSource(_queue, index, startMs, _repeat, Open);
        _source.ItemFailed += (it, err) => { _notice = $"Skipped \"{it.Title}\": {err}"; _events.Publish("notice", new { message = _notice }); };
        Engine.Play(_source, LeadMs * 1000L);
        _state = PlayState.Playing; _pausedMs = startMs;
        Bump(); _events.Publish("now", null);
    }

    public void Pause()
    {
        lock (_l)
        {
            if (_state != PlayState.Playing) return;
            var np = NowNoLock(); _pausedMs = np.PositionMs; _index = np.Index;
            bool live = _queue.Count > _index && IsLive(_queue[_index].Kind);
            Engine.Stop(30_000);                  // 30 ms: the player fades to silence
            _state = PlayState.Paused; if (live) _pausedMs = 0;
            DisposeSourceLater(); Bump(); _events.Publish("now", null);
        }
    }

    private void DisposeSourceLater() { var s = _source; _source = null; _radio = null; Task.Delay(500).ContinueWith(_ => { try { s?.Dispose(); } catch { } }); }

    public void Resume()
    {
        lock (_l)
        {
            if (_state == PlayState.Playing) return;
            if (_queue.Count == 0) return;
            StartAt(_index, _pausedMs);
        }
    }

    public void Stop()
    {
        lock (_l)
        {
            if (_state == PlayState.Stopped) return;
            Engine.Stop(30_000); _state = PlayState.Stopped; _pausedMs = 0; DisposeSourceLater(); Bump(); _events.Publish("now", null);
        }
    }

    public void Next() { lock (_l) { if (_queue.Count == 0 || IsReceiver(_queue[Math.Clamp(_index, 0, _queue.Count - 1)].Kind)) return; int i = CurrentIndexNoLock() + 1; if (i >= _queue.Count) { if (_repeat == RepeatMode.All) i = 0; else { Stop(); return; } } StartAt(i, 0); } }

    public void Prev()
    {
        lock (_l)
        {
            if (_queue.Count == 0) return;
            var np = NowNoLock(); int i = np.Index; if (IsReceiver(np.Item?.Kind)) return;
            if (np.PositionMs < 3000 && i > 0) i--; else if (np.PositionMs < 3000 && _repeat == RepeatMode.All) i = _queue.Count - 1;
            StartAt(i, 0);
        }
    }

    public void Jump(int index) { lock (_l) { if (index >= 0 && index < _queue.Count) StartAt(index, 0); } }

    public bool Seek(long ms)
    {
        lock (_l)
        {
            if (_queue.Count == 0) return false;
            var np = NowNoLock();
            if (np.Item == null || IsLive(np.Item.Kind)) return false;            // live streams cannot seek
            ms = Math.Clamp(ms, 0, Math.Max(0, np.DurationMs - 500));
            if (_state == PlayState.Paused) { _pausedMs = ms; Bump(); _events.Publish("now", null); return true; }
            StartAt(np.Index, ms); return true;
        }
    }

    public void SetRepeat(RepeatMode m)
    {
        lock (_l)
        {
            _repeat = m;
            if (_source != null) _source.Repeat = m;
            Bump(); _events.Publish("now", null);
        }
    }


    public void SetShuffle(bool on)
    {
        lock (_l)
        {
            if (on == _shuffle) return;
            _shuffle = on;
            if (_queue.Count > 0)
            {
                CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
                if (on) ApplyShuffle(_index, out _);
                else if (_unshuffled != null) { var ids = _queue.Select(q => q.Id).ToHashSet(); var ord = _unshuffled.Where(q => ids.Contains(q.Id)).ToList(); _unshuffled = null; _queue.Clear(); _queue.AddRange(ord); }
                Remap(old, _index);
            }
            Bump(); _events.Publish("queue", null); _events.Publish("now", null);
        }
    }

    private void ApplyShuffle(int keepFirst, out int newIndex)
    {
        _unshuffled = new List<QueueItem>(_queue);
        if (_queue.Count == 0) { newIndex = 0; return; }
        var cur = _queue[Math.Clamp(keepFirst, 0, _queue.Count - 1)];
        var rest = _queue.Where(q => q.Id != cur.Id).OrderBy(_ => Random.Shared.Next()).ToList();
        _queue.Clear(); _queue.Add(cur); _queue.AddRange(rest); newIndex = 0;
    }

    /// <summary>After the queue list was edited: tell the playing source where every old index went. Entries have stable ids, so we map old index -> id -> new index.</summary>
    private void Remap(List<QueueItem> old, int fallbackCurrent)
    {
        var curId = _index >= 0 && _index < old.Count ? old[_index].Id : -1;
        int ni = _queue.FindIndex(q => q.Id == curId); if (ni < 0) ni = Math.Clamp(fallbackCurrent, 0, Math.Max(0, _queue.Count - 1));
        _index = ni;
        _source?.Reindex(i => i >= 0 && i < old.Count ? (_queue.FindIndex(q => q.Id == old[i].Id) is var k && k >= 0 ? k : null) : null, ni);
    }

    // ---------------- queue editing ----------------
    public void Add(IEnumerable<QueueItem> items, bool next)
    {
        lock (_l)
        {
            var list = items.Select(WithId).ToList(); if (list.Count == 0) return;
            CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            if (next && _queue.Count > 0) _queue.InsertRange(Math.Min(_queue.Count, _index + 1), list); else _queue.AddRange(list);
            _unshuffled = null; Remap(old, _index);
            Bump(); _events.Publish("queue", null);
        }
    }

    public bool Remove(int index)
    {
        lock (_l)
        {
            if (index < 0 || index >= _queue.Count) return false;
            int cur = CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            _queue.RemoveAt(index); _unshuffled = null;
            if (index == cur && _state == PlayState.Playing)
            {
                if (_queue.Count == 0) { Engine.Stop(30_000); _state = PlayState.Stopped; DisposeSourceLater(); }
                else StartAt(Math.Min(index, _queue.Count - 1), 0);
            }
            else Remap(old, index < cur ? cur - 1 : cur);
            Bump(); _events.Publish("queue", null); _events.Publish("now", null); return true;
        }
    }

    public bool Move(int from, int to)
    {
        lock (_l)
        {
            if (from < 0 || from >= _queue.Count || to < 0 || to >= _queue.Count || from == to) return false;
            CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            var it = _queue[from]; _queue.RemoveAt(from); _queue.Insert(to, it); _unshuffled = null;
            Remap(old, _index); Bump(); _events.Publish("queue", null); return true;
        }
    }

    public void Clear() { lock (_l) { if (_state != PlayState.Stopped) { Engine.Stop(30_000); DisposeSourceLater(); } _state = PlayState.Stopped; _queue.Clear(); _unshuffled = null; _index = 0; _pausedMs = 0; Bump(); _events.Publish("queue", null); _events.Publish("now", null); } }

    // ---------------- state ----------------
    public IReadOnlyList<QueueItem> Queue() { lock (_l) return _queue.ToList(); }
    public NowPlaying Now() { lock (_l) return NowNoLock(); }
    public PlayState State { get { lock (_l) return _state; } }
    public bool Shuffle { get { lock (_l) return _shuffle; } }
    public RepeatMode Repeat { get { lock (_l) return _repeat; } }

    private NowPlaying NowNoLock()
    {
        int idx = _state == PlayState.Playing ? CurrentIndexNoLock() : _index;
        var item = idx >= 0 && idx < _queue.Count ? _queue[idx] : null;
        long pos = _pausedMs;
        if (_state == PlayState.Playing && _source != null)
        {
            var loc = _source.Locate(Math.Max(0, Engine.PositionSamplesAt(Clock.NowUs)));
            pos = loc.OffsetMs;
        }
        var state = _state.ToString().ToLowerInvariant();
        if (_state == PlayState.Playing && item != null && IsReceiver(item.Kind) && !LiveActiveNoLock(item)) state = "paused";      // paused on the phone; the house keeps the stream open
        return new NowPlaying(state, idx, pos, item?.DurationMs ?? 0, item, item?.Kind == "radio" ? (_liveTitle ?? _radio?.NowPlaying) : null, _notice, _shuffle, _repeat.ToString().ToLowerInvariant(), Interlocked.Read(ref _version));
    }

    public void Dispose() { _timer.Dispose(); lock (_l) { DisposeSource(); } }
}
