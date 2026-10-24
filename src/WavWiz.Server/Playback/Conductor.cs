using WavWiz.Core.Clock;
using WavWiz.Core.Stream;
using WavWiz.Server.Library;
using WavWiz.Server.Media;
namespace WavWiz.Server.Playback;

public enum PlayState { Stopped, Playing, Paused }

public sealed record NowPlaying(string State, int Index, long PositionMs, long DurationMs, QueueItem? Item, string? LiveTitle, string? Notice, bool Shuffle, string Repeat, long Version, int NextIndex = -1, QueueItem? NextTrack = null);

/// <summary>
/// Owns the queue and the house stream (spec 5.1, 10). One lock serializes the StreamEngine (single-threaded by contract); a 10 ms timer pumps it.
/// Pause = STOP_AT with a short fade and remember the position; resume starts a new epoch from there (every zone restarts together).
/// </summary>
public sealed class Conductor : IDisposable
{
    public readonly IMonotonicClock Clock; public readonly StreamEngine Engine; private readonly Db _db; private readonly EventHub _events; private readonly string _ffmpeg;
    private readonly object _l = new();
    private readonly List<QueueItem> _queue = new();
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
    /// <summary>0.4.0: <paramref name="key"/> names the feed when more than one receiver of a kind can feed this group (one AirPlay/Spotify name per zone). The queue item keeps the key in Location; null = the kind itself (0.3.9).</summary>
    public void RegisterFeed(string kind, LiveFeed feed, string? key = null) { lock (_l) _feeds[key ?? kind] = feed; }
    public void UnregisterFeed(string key, LiveFeed feed) { lock (_l) { if (_feeds.TryGetValue(key, out var f) && ReferenceEquals(f, feed)) _feeds.Remove(key); } }
    private bool TryFeed(QueueItem it, out LiveFeed f) => _feeds.TryGetValue(it.Location, out f!) || _feeds.TryGetValue(it.Kind, out f!);

    /// <summary>A phone started sending (AirPlay session / Spotify playing): the house plays it in every zone. The queue that was there comes back when the sender leaves.</summary>
    public void BeginLive(string kind, string title, string artist = "", string album = "", string? artUrl = null, string? key = null)
    {
        lock (_l)
        {
            var cur = _index >= 0 && _index < _queue.Count ? _queue[_index] : null;
            var loc = key ?? kind;
            if (cur?.Kind == kind && cur.Location == loc && _state == PlayState.Playing) return;
            if (cur == null || !IsReceiver(cur.Kind)) _beforeLive = (new List<QueueItem>(_queue), _index);
            var item = cur?.Kind == kind && cur.Location == loc ? cur : new QueueItem(0, kind, loc, title, artist, album, 0, null, null, null, artUrl);
            _queue.Clear(); _queue.Add(item.Id == 0 ? WithId(item) : item);
            StartAt(0, 0); Pub("queue");
        }
    }

    /// <summary>New title/artist/artwork from the sender.</summary>
    public void UpdateLive(string kind, Func<QueueItem, QueueItem> change, string? key = null)
    {
        lock (_l)
        {
            int i = _queue.FindIndex(q => q.Kind == kind && q.Location == (key ?? kind)); if (i < 0) return;
            _queue[i] = change(_queue[i]) with { Id = _queue[i].Id, Kind = kind, Location = _queue[i].Location };
            Bump(); Pub("now"); Pub("queue");
        }
    }

    /// <summary>The sender disconnected: stop and put the previous queue back (stopped).</summary>
    public void EndLive(string kind, string? key = null)
    {
        lock (_l)
        {
            if (!_queue.Any(q => q.Kind == kind && q.Location == (key ?? kind))) return;
            if (_state != PlayState.Stopped) { Engine.Stop(30_000); DisposeSourceLater(); }
            _state = PlayState.Stopped; _queue.Clear(); _pausedMs = 0; _index = 0;
            if (_beforeLive is { } b) { _queue.AddRange(b.Queue); _index = Math.Clamp(b.Index, 0, Math.Max(0, _queue.Count - 1)); }
            _beforeLive = null; Bump(); Pub("queue"); Pub("now");
        }
    }

    private bool LiveActiveNoLock(QueueItem? it) => it != null && IsReceiver(it.Kind) && TryFeed(it, out var f) && f.Active;

    /// <summary>0.4.0: the playback group this Conductor belongs to ("default" = the house group, today's behavior). Events it publishes carry it as zoneId.</summary>
    public string GroupId { get; }
    public const string DefaultGroupId = "default";
    /// <summary>The setting that holds this group's last queue. The default group keeps the 0.3.7 key, so an existing blob is its saved queue (no copy needed, and a downgrade still finds it).</summary>
    public string LastQueueSettingKey => GroupId == DefaultGroupId ? LastQueueKey : LastQueueKey + "." + GroupId;
    private void Pub(string type) => _events.Publish(type, new { zoneId = GroupId });

    /// <summary>All groups share ONE monotonic clock (players sync to it); pass the default group's clock when creating another group.</summary>
    public Conductor(Db db, EventHub events, string ffmpeg, IMonotonicClock? clock = null, string groupId = DefaultGroupId)
    {
        _db = db; _events = events; _ffmpeg = ffmpeg; Clock = clock ?? new StopwatchClock(); Engine = new StreamEngine(Clock); GroupId = groupId;
        _timer = new Timer(_ => Tick(), null, Timeout.Infinite, Timeout.Infinite);      // 0.4.0: lazy - nothing wakes up while this group is idle
    }

    // ---------------- 0.4.0 lazy pump: the 10 ms timer only runs while this group has something to pump or report ----------------
    private bool _armed;
    private void Arm() { if (_armed || _disposed) return; _armed = true; try { _timer.Change(10, 10); } catch (ObjectDisposedException) { } }
    private void DisarmNoLock() { if (!_armed) return; _armed = false; try { _timer.Change(Timeout.Infinite, Timeout.Infinite); } catch (ObjectDisposedException) { } }
    private bool _disposed;
    /// <summary>True while the pump timer is scheduled (tests and the perf harness: an idle group must be false).</summary>
    public bool PumpArmed { get { lock (_l) return _armed; } }
    public bool IsIdle { get { lock (_l) return _state != PlayState.Playing && !Engine.Playing && _source == null; } }

    // ---------------- engine-facing (subscribe/unsubscribe go through the same lock) ----------------
    public void Subscribe(IStreamSubscriber s) { lock (_l) Engine.Subscribe(s); }
    public void Unsubscribe(string id) { lock (_l) Engine.Unsubscribe(id); }
    /// <summary>0.4.0: the device moves to another group; it fades out of this one's stream immediately.</summary>
    public void Release(string id) { lock (_l) Engine.Release(id, 30_000); }
    /// <summary>0.1.3 receiver health: who the house stream is sending to right now.</summary>
    public List<IStreamSubscriber> Subscribers() { lock (_l) return Engine.Subscribers.ToList(); }
    /// <summary>The house is playing a receiver item whose sender stopped sending more than a minute ago.</summary>
    public string? StaleLiveKind()
    {
        lock (_l)
        {
            var cur = _index >= 0 && _index < _queue.Count ? _queue[_index] : null;
            return cur != null && IsReceiver(cur.Kind) && TryFeed(cur, out var f) && (f.DataAgeMs ?? long.MaxValue) > 60_000 ? cur.Kind : null;
        }
    }

    private IPcmDecoder Open(QueueItem it, long startMs)
    {
        if (OpenOverride != null) return OpenOverride(it, startMs);
        if (IsReceiver(it.Kind)) return TryFeed(it, out var feed) ? feed.OpenDecoder() : throw new InvalidOperationException(it.Kind + " receiver is not running");
        if (it.Kind == "radio")
        {
            var r = new RadioDecoder(_ffmpeg, it.Location);
            r.Metadata += t => { _liveTitle = t; Bump(); Pub("now"); };
            r.Status += t => { _notice = t == "Connecting..." ? null : t; };
            _radio = r; return r;
        }
        var dec = new FfmpegDecoder(_ffmpeg, it.Location, startMs, rate: _openRate);
        // 0.1.3 ReplayGain + iTunSMPB end trim (tags read off the stream thread)
        var mode = ReplayGainMode(); bool albumCtx = mode == "auto" && AlbumContextNoLock(it); var path = it.Location;
        return new ShapedDecoder(dec, Task.Run(() => { var t = TagReader(path); return (Loudness.Gain(t, mode, albumCtx), Loudness.ValidFrames(t, startMs)); }));
    }

    /// <summary>Tests can swap the tag reader.</summary>
    public Func<string, TrackTags> TagReader { get; set; } = Loudness.Read;
    /// <summary>0.3.0: Settings > Playback > Crossfade, 0-12 s, 0 (off) by default.</summary>
    public int CrossfadeMsSetting() { try { return double.TryParse(_db.Setting("playback.crossfadeSec"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? (int)Math.Round(Math.Clamp(v, 0, 12) * 1000) : 0; } catch { return 0; } }
    private int _openRate = 48000;
    /// <summary>0.4.9 F77: Settings > Playback > Streaming quality: 48000 (Studio, default) or 96000 (Studio Max). Read at every new epoch (play, seek, skip).</summary>
    public int StreamRateSetting() { try { return int.TryParse(_db.Setting("playback.streamRate"), out var v) ? WavWiz.Core.Protocol.Wire.NormalizeRate(v) : 48000; } catch { return 48000; } }
    /// <summary>Studio Max only for a queue of files: radio and AirPlay/Spotify are 48 kHz (or less) at the source, so they stay at 48 kHz.</summary>
    public int EpochRate(IReadOnlyList<QueueItem> q) => q.Count > 0 && q.All(i => i.Kind == "track") ? StreamRateSetting() : 48000;
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
                if (liveActive != _lastLiveActive) { _lastLiveActive = liveActive; if (curItem != null && IsReceiver(curItem.Kind)) { Bump(); Pub("now"); } }
                if (_index != _lastIndexReported || _state != _lastStateReported)
                {
                    _lastIndexReported = _index; _lastStateReported = _state; Bump();
                    Pub("now");
                }
                // 0.4.0: nothing to pump or report -> stop the timer (an idle group costs no wakeups, no decoder, no pump)
                if (_state != PlayState.Playing && !Engine.Playing && !(curItem != null && IsReceiver(curItem.Kind)) && _index == _lastIndexReported && _state == _lastStateReported) DisarmNoLock();
            }
        }
        catch (Exception e) { Console.Error.WriteLine("conductor tick: " + e.Message); }
    }

    private int CurrentIndexNoLock()
    {
        if (_source == null) return _index;
        long frame = Engine.PositionSamplesAt(Clock.NowUs);
        var loc = _source.Locate(frame);
        if (loc.Index >= 0 && loc.Index < _queue.Count) { _index = loc.Index; NoteCurrent(); }
        return _index;
    }

    private void Bump() { Interlocked.Increment(ref _version); Arm(); }
    private void DisposeSource() { try { _source?.Dispose(); } catch { } _source = null; _radio = null; }

    // ---------------- queue building ----------------
    public List<QueueItem> TracksToItems(IEnumerable<long> ids)
    {
        var res = new List<QueueItem>();
        foreach (var id in ids)
        {
            var r = _db.Query("SELECT id,path,title,artist,album,duration_ms,genre,year,track_no FROM track WHERE id=$i AND missing=0",
                x => new QueueItem(0, "track", x.GetString(1), x.GetString(2), x.GetString(3), x.GetString(4), x.GetInt64(5), x.GetInt64(0), x.IsDBNull(6) ? null : x.GetString(6), x.IsDBNull(7) ? null : x.GetInt32(7), null, x.IsDBNull(8) ? null : x.GetInt32(8)), ("$i", id)).FirstOrDefault();
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
            _queue.Clear(); _queue.AddRange(items.Select(WithId)); ResetShuffleState();   // 0.4.2: shuffle never reorders the list; it only picks what plays next
            StartAt(index, startMs);
        }
    }

    private void StartAt(int index, long startMs)
    {
        DisposeSource();
        if (_queue.Count == 0) { Engine.Stop(0); _state = PlayState.Stopped; Bump(); return; }
        index = Math.Clamp(index, 0, _queue.Count - 1);
        _index = index; _liveTitle = null; _notice = null;
        _openRate = EpochRate(_queue); _source = new QueueSource(_queue, index, startMs, _repeat, Open) { CrossfadeMs = CrossfadeMsSetting, Rate = _openRate }; NoteCurrent(); _source.Picker = _shuffle ? PickNext : null;
        _source.ItemFailed += (it, err) => { _notice = $"Skipped \"{it.Title}\": {err}"; _events.Publish("notice", new { message = _notice, zoneId = GroupId }); };
        Engine.Play(_source, LeadMs * 1000L);
        _state = PlayState.Playing; _pausedMs = startMs;
        Bump(); Pub("now");
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
            DisposeSourceLater(); Bump(); Pub("now");
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
            Engine.Stop(30_000); _state = PlayState.Stopped; _pausedMs = 0; DisposeSourceLater(); Bump(); Pub("now");
        }
    }

    public void Next() { lock (_l) { if (_queue.Count == 0 || IsReceiver(_queue[Math.Clamp(_index, 0, _queue.Count - 1)].Kind)) return; int i = CurrentIndexNoLock() + 1; if (_shuffle) { if (PickNext(i - 1) is int pk) { StartAt(pk, 0); return; } Stop(); return; } if (i >= _queue.Count) { if (_repeat == RepeatMode.All) i = 0; else { Stop(); return; } } StartAt(i, 0); } }

    public void Prev()
    {
        lock (_l)
        {
            if (_queue.Count == 0) return;
            var np = NowNoLock(); int i = np.Index; if (IsReceiver(np.Item?.Kind)) return;
            if (_shuffle && np.PositionMs < 3000 && PopHistory() is int back) { StartAt(back, 0); return; }   // 0.4.2: Previous = what actually played, not the list neighbor
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
            if (_state == PlayState.Paused) { _pausedMs = ms; Bump(); Pub("now"); return true; }
            StartAt(np.Index, ms); return true;
        }
    }

    public void SetRepeat(RepeatMode m)
    {
        lock (_l)
        {
            _repeat = m;
            if (_source != null) _source.Repeat = m;
            Bump(); Pub("now");
        }
    }


    /// <summary>0.4.2: shuffle is a PLAY MODE of this zone's queue, not an edit of it: the stored list keeps its order. On = the next song is picked at random from the songs not yet played in this cycle (no repeats until all have played, then a new cycle); Previous walks back through what actually played; off = normal order continues from the current song.</summary>
    public void SetShuffle(bool on)
    {
        lock (_l)
        {
            if (on == _shuffle) return;
            _shuffle = on;
            if (_queue.Count > 0) CurrentIndexNoLock();
            lock (_shl) { _picked = null; if (on) { _played.Clear(); if (_index >= 0 && _index < _queue.Count) _played.Add(_queue[_index].Id); } }
            if (_source != null) _source.Picker = on ? PickNext : null;
            Bump(); Pub("queue"); Pub("now");
        }
    }

    // ---- 0.4.2 shuffle state (per zone queue): the ids played in this cycle, the history stack of what actually played, the pre-picked next song ----
    private readonly object _shl = new(); private readonly HashSet<long> _played = new(); private readonly List<long> _history = new(); private long _curNoted = -1; private (long Cur, long Pick)? _picked;
    public const int HistoryMax = 500;
    private void ResetShuffleState() { lock (_shl) { _played.Clear(); _history.Clear(); _curNoted = -1; _picked = null; } }
    /// <summary>The song now playing is recorded once (history stack + played set), whatever started it: auto-advance, Next, a click in the list.</summary>
    private void NoteCurrent()
    {
        lock (_shl)
        {
            if (_index < 0 || _index >= _queue.Count) return; var id = _queue[_index].Id; if (id == _curNoted) return;
            _curNoted = id; _played.Add(id); _picked = null;
            if (_history.Count == 0 || _history[^1] != id) { _history.Add(id); if (_history.Count > HistoryMax) _history.RemoveRange(0, _history.Count - HistoryMax); }
        }
    }
    /// <summary>The queue index of the random next song for the song at <paramref name="i"/>: not played yet in this cycle; none left -> a new cycle (Repeat All) or null (end). The pick is remembered so the gapless pre-open and the real advance agree.</summary>
    private int? PickNext(int i)
    {
        lock (_shl)
        {
            if (i < 0 || i >= _queue.Count) return null; var cur = _queue[i].Id;
            if (_picked is { } p && p.Cur == cur) { var k = _queue.FindIndex(q => q.Id == p.Pick); if (k >= 0) return k; }
            var cand = new List<int>(); for (int j = 0; j < _queue.Count; j++) if (j != i && !_played.Contains(_queue[j].Id) && !IsReceiver(_queue[j].Kind)) cand.Add(j);
            if (cand.Count == 0)
            {
                if (_repeat != RepeatMode.All) return null;
                _played.Clear(); _played.Add(cur); for (int j = 0; j < _queue.Count; j++) if (j != i && !IsReceiver(_queue[j].Kind)) cand.Add(j);
                if (cand.Count == 0) return i;
            }
            int pick = cand[Random.Shared.Next(cand.Count)]; _picked = (cur, _queue[pick].Id); return pick;
        }
    }
    /// <summary>Previous in shuffle: drop the current song from the history and return the queue index of the one that played before it (null = no usable history).</summary>
    private int? PopHistory()
    {
        lock (_shl)
        {
            if (_history.Count > 0 && _index >= 0 && _index < _queue.Count && _history[^1] == _queue[_index].Id) _history.RemoveAt(_history.Count - 1);
            while (_history.Count > 0)
            {
                var id = _history[^1]; var k = _queue.FindIndex(q => q.Id == id);
                if (k < 0) { _history.RemoveAt(_history.Count - 1); continue; }
                _history.RemoveAt(_history.Count - 1); _curNoted = -1; return k;   // NoteCurrent pushes it again when it starts
            }
            return null;
        }
    }
    /// <summary>Test / UI view: ids played in this cycle and the history stack (oldest first).</summary>
    public (long[] Played, long[] History) ShuffleState() { lock (_shl) return (_played.ToArray(), _history.ToArray()); }

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
            Remap(old, _index);
            Bump(); Pub("queue"); Pub("now");
        }
    }

    public bool Remove(int index)
    {
        lock (_l)
        {
            if (index < 0 || index >= _queue.Count) return false;
            int cur = CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            _queue.RemoveAt(index);
            if (index == cur && _state == PlayState.Playing)
            {
                if (_queue.Count == 0) { Engine.Stop(30_000); _state = PlayState.Stopped; DisposeSourceLater(); }
                else StartAt(Math.Min(index, _queue.Count - 1), 0);
            }
            else Remap(old, index < cur ? cur - 1 : cur);
            Bump(); Pub("queue"); Pub("now"); return true;
        }
    }

    /// <summary>0.3.3 G12: insert at a queue position (drag from the Library to the drop line). at &lt; 0 or past the end appends.</summary>
    public void Insert(IEnumerable<QueueItem> items, int at)
    {
        lock (_l)
        {
            var list = items.Select(WithId).ToList(); if (list.Count == 0) return;
            CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            if (at < 0 || at > _queue.Count) at = _queue.Count;
            _queue.InsertRange(at, list); Remap(old, _index);
            Bump(); Pub("queue"); Pub("now");
        }
    }
    public bool Move(int from, int to)
    {
        lock (_l)
        {
            if (from < 0 || from >= _queue.Count || to < 0 || to >= _queue.Count || from == to) return false;
            CurrentIndexNoLock(); var old = new List<QueueItem>(_queue);
            var it = _queue[from]; _queue.RemoveAt(from); _queue.Insert(to, it);
            Remap(old, _index); Bump(); Pub("queue"); Pub("now"); return true;
        }
    }

    public void Clear() { lock (_l) { if (_state != PlayState.Stopped) { Engine.Stop(30_000); DisposeSourceLater(); } _state = PlayState.Stopped; _queue.Clear(); ResetShuffleState(); _index = 0; _pausedMs = 0; Bump(); Pub("queue"); Pub("now"); } }

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
        int nx = item == null ? -1 : UpcomingNoLock(idx);
        return new NowPlaying(state, idx, pos, item?.DurationMs ?? 0, item, item?.Kind == "radio" ? (_liveTitle ?? _radio?.NowPlaying) : null, _notice, _shuffle, _repeat.ToString().ToLowerInvariant(), Interlocked.Read(ref _version),
            nx, nx >= 0 && nx < _queue.Count ? _queue[nx] : null);
    }
    /// <summary>0.4.9 F73: the song that will really play when this one ends - the server is the source of truth for "Up next". Shuffle: the remembered
    /// pick (made now if there is none yet; the same pick the gapless pre-open, the auto-advance and Next use). Off: the list neighbour (Repeat All wraps).
    /// Repeat One repeats the current song. -1 = nothing follows.</summary>
    private int UpcomingNoLock(int idx)
    {
        if (idx < 0 || idx >= _queue.Count || IsReceiver(_queue[idx].Kind)) return -1;
        if (_repeat == RepeatMode.One) return idx;
        if (_shuffle) return PickNext(idx) ?? -1;
        return idx + 1 < _queue.Count ? idx + 1 : _repeat == RepeatMode.All ? 0 : -1;
    }

    // ---------------- 0.3.7 L15: the last queue, track and position survive an unexpected exit (restored PAUSED, with a small note) ----------------
    private Timer? _persistTimer; private string? _lastSaved;
    public const string LastQueueKey = "playback.lastQueue";
    public void EnablePersistence() { RestoreLast(); _persistTimer ??= new Timer(_ => SaveLast(), null, 2000, 2000); }
    public string BuildLastJson()
    {
        lock (_l)
        {
            var np = NowNoLock();
            var real = _queue.Where(q => !IsReceiver(q.Kind)).ToList();
            var items = real.Select(q => new { k = q.Kind, id = q.RefId, u = q.RefId == null ? q.Location : null, t = q.RefId == null ? q.Title : null }).ToList();
            int idx = Math.Clamp(np.Index, 0, Math.Max(0, items.Count - 1));
            // 0.4.2: the list is saved in its real order (shuffle never permutes it); the shuffle flag, the songs played in this cycle and the history are saved as positions in that list
            int[] played, hist; lock (_shl) { played = real.Select((q, i) => (q, i)).Where(x => _played.Contains(x.q.Id)).Select(x => x.i).ToArray(); hist = _history.Select(h => real.FindIndex(q => q.Id == h)).Where(i => i >= 0).ToArray(); }
            int pick = -1; lock (_shl) if (_shuffle && _picked is { } pk && np.Item != null && pk.Cur == np.Item.Id) pick = real.FindIndex(q => q.Id == pk.Pick);   // 0.4.9 F73: the advertised next song survives a restart
            return System.Text.Json.JsonSerializer.Serialize(new { v = 2, index = idx, posMs = np.State == "stopped" ? 0 : np.PositionMs, shuffle = _shuffle, played, hist, pick, items });
        }
    }
    /// <summary>0.4.1: a removed zone's saved queue goes with it, so a new zone that reuses the id starts empty.</summary>
    public void ForgetSaved() { try { _db.DeleteSetting(LastQueueSettingKey); _lastSaved = null; } catch { } }
    public void SaveLast() { try { var json = BuildLastJson(); if (json != _lastSaved) { _db.SetSetting(LastQueueSettingKey, json); _lastSaved = json; } } catch { /* a failed save never disturbs playback */ } }
    /// <summary>Puts the saved queue back (paused at the saved track and position). Returns the number of tracks restored.</summary>
    public int RestoreLast()
    {
        try
        {
            var raw = _db.Setting(LastQueueSettingKey); if (string.IsNullOrWhiteSpace(raw)) return 0;
            using var doc = System.Text.Json.JsonDocument.Parse(raw); var root = doc.RootElement;
            if (!root.TryGetProperty("items", out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array) return 0;
            var list = new List<QueueItem>(); int want = root.TryGetProperty("index", out var ix) ? ix.GetInt32() : 0, newIdx = 0;
            int pos = 0; var posToList = new Dictionary<int, int>();
            foreach (var e in arr.EnumerateArray())
            {
                var kind = e.GetProperty("k").GetString(); long? id = e.TryGetProperty("id", out var idp) && idp.ValueKind == System.Text.Json.JsonValueKind.Number ? idp.GetInt64() : null;
                QueueItem? it = null;
                if (kind == "track" && id != null) it = TracksToItems(new[] { id.Value }).FirstOrDefault();
                else if (kind == "radio" && id != null) it = StationToItem(id.Value);
                else if (kind == "radio" && e.TryGetProperty("u", out var up) && up.GetString() is { Length: > 0 } url) it = UrlItem(url, e.TryGetProperty("t", out var tp) ? tp.GetString() ?? "" : "");
                if (pos == want) newIdx = list.Count;
                if (it != null) { posToList[pos] = list.Count; list.Add(it); }
                pos++;
            }
            if (list.Count == 0) return 0;
            long posMs = root.TryGetProperty("posMs", out var pm) ? pm.GetInt64() : 0;
            lock (_l)
            {
                if (_queue.Count > 0) return 0;
                _queue.AddRange(list.Select(WithId)); _index = Math.Clamp(newIdx, 0, _queue.Count - 1); ResetShuffleState();
                try
                {   // 0.4.2: a v2 save carries the play mode; an older save (v1: shuffle was never saved, and a shuffled-in-place list is kept exactly as it was) just starts with shuffle off
                    _shuffle = root.TryGetProperty("shuffle", out var shf) && shf.ValueKind == System.Text.Json.JsonValueKind.True;
                    lock (_shl)
                    {
                        if (root.TryGetProperty("played", out var pl) && pl.ValueKind == System.Text.Json.JsonValueKind.Array) foreach (var e in pl.EnumerateArray()) if (posToList.TryGetValue(e.GetInt32(), out var li)) _played.Add(_queue[li].Id);
                        if (root.TryGetProperty("hist", out var hs) && hs.ValueKind == System.Text.Json.JsonValueKind.Array) foreach (var e in hs.EnumerateArray()) if (posToList.TryGetValue(e.GetInt32(), out var li)) _history.Add(_queue[li].Id);
                        if (_shuffle) _played.Add(_queue[_index].Id);
                        if (_shuffle && root.TryGetProperty("pick", out var pk) && pk.ValueKind == System.Text.Json.JsonValueKind.Number && posToList.TryGetValue(pk.GetInt32(), out var pli) && pli != _index) { _picked = (_queue[_index].Id, _queue[pli].Id); _curNoted = _queue[_index].Id; }
                    }
                }
                catch { _shuffle = false; }
                _pausedMs = _queue[_index].Kind == "radio" ? 0 : Math.Clamp(posMs, 0, Math.Max(0, _queue[_index].DurationMs - 1000)); _state = PlayState.Paused;
                _notice = $"Restored your last queue ({_queue.Count} track{(_queue.Count == 1 ? "" : "s")}), paused where you left off."; Bump();
            }
            Pub("queue"); Pub("now"); return list.Count;
        }
        catch { return 0; }
    }

    public void Dispose() { _disposed = true; _persistTimer?.Dispose(); SaveLast(); _timer.Dispose(); lock (_l) { DisposeSource(); } }
}
