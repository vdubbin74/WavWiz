using WavWiz.Core.Stream;
namespace WavWiz.Server.Media;

public enum RepeatMode { Off, All, One }

public sealed record QueueItem(long Id, string Kind /* track|radio */, string Location /* file path or stream URL */, string Title, string Artist, string Album, long DurationMs, long? RefId, string? Genre = null, int? Year = null, string? ArtUrl = null);

/// <summary>
/// Turns a queue into one continuous sample stream. Gapless: when a decoder is exhausted the NEXT decoder (started as soon as the current one's reader
/// finished) continues in the same Read call, so the join is sample-exact (spec 5.1, 10.3). Records item boundaries so the UI knows what is playing at
/// a given point of the house timeline. A file that cannot be decoded is skipped (logged), never turned into silence.
/// </summary>
public sealed class QueueSource : ISampleSource, IDisposable
{
    private readonly IReadOnlyList<QueueItem> _items; private readonly Func<QueueItem, long, IPcmDecoder> _open; private volatile RepeatMode _repeat;
    public RepeatMode Repeat { get => _repeat; set { _repeat = value; var n = _next; _next = null; _nextIndex = -1; n?.Dispose(); } }
    private int _index; private IPcmDecoder? _cur, _next; private int _nextIndex = -1; private long _frames; private int _consecutiveFailures;
    private readonly object _l = new(); private bool _ended; private bool _disposed;
    public readonly List<(long StartFrame, int Index, long StartOffsetMs)> Boundaries = new();
    public event Action<QueueItem, string>? ItemFailed;

    // 0.3.0 crossfade (Settings > Playback, 0-12 s, 0 = off). The house stream is mixed BEFORE it is sent, so sync/delay across speakers is unchanged.
    // Never between consecutive tracks of the same album (gapless stays sample-exact), never for radio/live items, never on Repeat One.
    public Func<int> CrossfadeMs { get; set; } = () => 0;
    private IPcmDecoder? _xf; private long _xfPos, _xfTotal, _fadeInLeft, _fadeInTotal; private long _curFrames; private float[] _tmp = Array.Empty<float>();

    /// <summary>True when the join from item a to item b must stay gapless (same album, consecutive): no crossfade there.</summary>
    public static bool SameAlbumGapless(QueueItem a, QueueItem b) =>
        !string.IsNullOrWhiteSpace(a.Album) && string.Equals(a.Album, b.Album, StringComparison.OrdinalIgnoreCase) && string.Equals(a.Artist ?? "", b.Artist ?? "", StringComparison.OrdinalIgnoreCase) || a.Kind != "track" || b.Kind != "track";

    public QueueSource(IReadOnlyList<QueueItem> items, int startIndex, long startMs, RepeatMode repeat, Func<QueueItem, long, IPcmDecoder> open)
    {
        _items = items; _open = open; _repeat = repeat; _index = startIndex;
        if (items.Count == 0 || startIndex < 0 || startIndex >= items.Count) { _ended = true; return; }
        _cur = Open(startIndex, startMs);
        lock (_l) Boundaries.Add((0, startIndex, startMs));
    }

    private IPcmDecoder Open(int index, long startMs) => _open(_items[index], startMs);
    private int? NextIndex(int i) => _repeat == RepeatMode.One ? i : i + 1 < _items.Count ? i + 1 : _repeat == RepeatMode.All ? 0 : null;

    public bool Ended => _ended;
    public int CurrentIndex { get { lock (_l) return _index; } }

    public int Read(Span<float> dst, int frames)
    {
        int got = 0;
        while (got < frames && !_ended && !_disposed)
        {
            var cur = _cur;
            if (cur == null) { _ended = true; break; }
            if (_xf == null && _fadeInLeft == 0) TryStartCrossfade();
            if (_next == null && _xf == null && cur is IReaderDone { ReaderDone: true } && NextIndex(_index) is int pre && pre != _index) { _nextIndex = pre; _next = SafeOpen(pre); }   // gapless: start the next decoder as soon as this one has read its last byte
            int n = cur.Read(dst[(got * 2)..], frames - got);
            if (n > 0) MixCrossfade(dst.Slice(got * 2, n * 2), n);
            got += n; _curFrames += n;
            if (n > 0) { _consecutiveFailures = 0; continue; }
            if (cur.Finished && _xf != null)
            {   // the old track ended during the crossfade: the incoming one carries on, its fade-in finishes on its own
                cur.Dispose(); _fadeInTotal = _xfTotal; _fadeInLeft = Math.Max(0, _xfTotal - _xfPos); _curFrames = _xfPos;
                lock (_l) { _cur = _xf; } _xf = null; _consecutiveFailures = 0; continue;
            }
            if (!cur.Finished) break;          // nothing available right now (slow share / radio): the stream pads silence only when frames are due
            if (cur.Error != null) ItemFailed?.Invoke(_items[_index], cur.Error);   // a file that cannot be decoded is skipped and reported
            if (cur.Error != null) _consecutiveFailures++; else _consecutiveFailures = 0;
            cur.Dispose();
            if (_consecutiveFailures >= Math.Max(_items.Count, 3)) { _ended = true; _cur = null; break; }
            var nx = NextIndex(_index);
            if (nx == null) { _cur = null; _ended = true; break; }
            int idx = nx.Value;
            var dec = _next != null && _nextIndex == idx ? _next : SafeOpen(idx);
            _next = null; _nextIndex = -1;
            lock (_l) { _index = idx; _cur = dec; Boundaries.Add((_frames + got, idx, 0)); } _curFrames = 0;
        }
        _frames += got;
        return got;
    }

    private void TryStartCrossfade()
    {
        int ms; try { ms = Math.Clamp(CrossfadeMs(), 0, 12_000); } catch { ms = 0; }
        if (ms <= 0 || _repeat == RepeatMode.One) return;
        var it = _items[_index]; if (it.DurationMs <= 0 || it.Kind != "track") return;
        long remainMs = it.DurationMs - (_curFrames * 1000 / 48000) - CurStartMs();
        if (remainMs > ms || remainMs < 200) return;
        if (NextIndex(_index) is not int nx || nx == _index) return;
        if (SameAlbumGapless(it, _items[nx]) && (nx == _index + 1)) return;
        if (it.Kind != "track" || _items[nx].Kind != "track") return;
        var dec = _next != null && _nextIndex == nx ? _next : SafeOpen(nx);
        if (ReferenceEquals(dec, _next)) { _next = null; _nextIndex = -1; } else { var old = _next; _next = null; _nextIndex = -1; old?.Dispose(); }
        _xf = dec; _xfPos = 0; _xfTotal = Math.Max(1, remainMs * 48);
        lock (_l) { _index = nx; Boundaries.Add((_frames + 0, nx, 0)); }   // Now Playing moves to the incoming track as the fade starts
    }
    private long CurStartMs() { lock (_l) { var b = Boundaries.LastOrDefault(); return b.Index == _index ? b.StartOffsetMs : 0; } }

    /// <summary>Equal-power mix of the incoming track into dst while a crossfade runs; the fade-in tail after the old track ended.</summary>
    private void MixCrossfade(Span<float> dst, int n)
    {
        if (_xf != null)
        {
            if (_tmp.Length < n * 2) _tmp = new float[n * 2];
            var t = _tmp.AsSpan(0, n * 2); t.Clear();
            int m = 0; while (m < n) { int r = _xf.Read(t[(m * 2)..], n - m); if (r <= 0) break; m += r; }
            for (int i = 0; i < n; i++)
            {
                double x = Math.Clamp((double)(_xfPos + i) / _xfTotal, 0, 1);
                float go = (float)Math.Cos(x * Math.PI / 2), gi = (float)Math.Sin(x * Math.PI / 2);
                dst[2 * i] = dst[2 * i] * go + t[2 * i] * gi; dst[2 * i + 1] = dst[2 * i + 1] * go + t[2 * i + 1] * gi;
            }
            _xfPos += n;
        }
        else if (_fadeInLeft > 0)
        {
            for (int i = 0; i < n && _fadeInLeft > 0; i++, _fadeInLeft--)
            { float g = (float)Math.Sin(Math.Clamp(1 - (double)_fadeInLeft / _fadeInTotal, 0, 1) * Math.PI / 2); dst[2 * i] *= g; dst[2 * i + 1] *= g; }
        }
    }

    private IPcmDecoder SafeOpen(int index)
    {
        try { return Open(index, 0); }
        catch (Exception e) { ItemFailed?.Invoke(_items[index], e.Message); return new FailedDecoder(e.Message); }
    }

    /// <summary>Item playing at a position (frames since the start of this source), with the offset into that item.</summary>
    public (int Index, long OffsetMs) Locate(long frame)
    {
        lock (_l)
        {
            var b = Boundaries.LastOrDefault(x => x.StartFrame <= Math.Max(0, frame));
            if (b == default && Boundaries.Count == 0) return (0, 0);
            return (b.Index, b.StartOffsetMs + (Math.Max(0, frame) - b.StartFrame) * 1000 / 48000);
        }
    }

    /// <summary>The queue list was edited while playing. <paramref name="map"/> maps an old index to its new index (null = removed). The pre-opened next decoder is dropped and re-chosen.</summary>
    public void Reindex(Func<int, int?> map, int newCurrent)
    {
        lock (_l)
        {
            _index = newCurrent;
            for (int i = 0; i < Boundaries.Count; i++) { var b = Boundaries[i]; Boundaries[i] = (b.StartFrame, map(b.Index) ?? -1, b.StartOffsetMs); }
        }
        var n = _next; _next = null; _nextIndex = -1; n?.Dispose();
    }

    public void Dispose() { _disposed = true; _cur?.Dispose(); _next?.Dispose(); _xf?.Dispose(); }

    private sealed class FailedDecoder : IPcmDecoder
    {
        public FailedDecoder(string e) { Error = e; }
        public int Read(Span<float> dst, int frames) => 0;
        public bool Finished => true;
        public string? Error { get; }
        public void Dispose() { }
    }
}
