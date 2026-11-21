using WavWiz.Server.Api;
using WavWiz.Server.Playback;

namespace WavWiz.Server.Announce;

/// <summary>
/// 0.7.2 Announce (hold-to-talk). Anyone with Control rights holds the Announce button on a PC or a phone (the phone over HTTPS: browsers only open
/// the microphone on a secure page) and talks; the page streams its microphone here and every speaker in the chosen zone (or Everywhere) hears a
/// chime (on by default, setting <c>announce.chime</c>) and then the voice, with the music turned down 12 dB - never paused or skipped - and faded
/// back up after the talker lets go. One talker at a time. The voice rides the house stream, so all rooms hear it together, a buffer behind the talker.
/// </summary>
public sealed class AnnounceService : IDisposable
{
    public const string ChimeKey = "announce.chime";
    public const string Everywhere = "everywhere";
    /// <summary>No audio for this long = the page went away without saying so: end the announcement.</summary>
    public const int IdleEndMs = 4000;
    public const string BusyText = "Someone else is announcing right now";
    public const string NoSpeakersText = "No speaker is playing in that zone";

    public sealed class Session
    {
        public required string Id; public required string By; public required string? Zone;
        public required List<(Conductor Cond, AnnounceMixer Mix)> Mixers;
        public long LastDataMs; public bool Ended;
        public bool Done => Mixers.All(m => m.Mix.Done);
    }

    private readonly Services _s; private readonly object _l = new(); private Session? _cur; private readonly Timer _tick; private int _seq;
    public Func<long> NowMs { get; set; } = () => Environment.TickCount64;

    public AnnounceService(Services s) { _s = s; _tick = new Timer(_ => { try { Tick(); } catch (Exception e) { _s.Log?.Invoke("announce: " + e.Message); } }, null, 500, 500); }

    /// <summary>Saved setting; anything but an explicit <c>false</c> means on.</summary>
    public bool ChimeDefault() { try { return _s.Db.Setting(ChimeKey)?.Trim() != "false"; } catch { return true; } }

    /// <summary>The groups a target means: "everywhere" = every group a speaker is listening to; "g:&lt;zone id&gt;" / a group id = that zone's group;
    /// null = the house group. Groups nobody listens to are left out.</summary>
    public List<Conductor> Targets(string? zone)
    {
        IEnumerable<Conductor> list;
        if (zone == Everywhere) list = _s.Registry.Live();
        else if (zone == null) list = new[] { _s.Conductor };
        else { var gid = _s.Links.ResolveZone(zone, forPlay: true); if (gid == null) return new(); list = _s.Registry.Get(gid) is { } c ? new[] { c } : Array.Empty<Conductor>(); }
        return list.Distinct().Where(c => c.Subscribers().Count > 0).ToList();
    }

    /// <summary>Starts an announcement. Returns the session, or an error for the page.</summary>
    public (Session? Session, string? Error) Begin(string by, string? zone, bool? chime = null)
    {
        lock (_l)
        {
            if (_cur is { Ended: false } busy && NowMs() - busy.LastDataMs < IdleEndMs) return (null, $"{BusyText} ({busy.By})");
            if (zone != null && zone != Everywhere && _s.Links.ResolveZone(zone, forPlay: true) == null) return (null, "no such zone");
            var targets = Targets(zone); if (targets.Count == 0) return (null, NoSpeakersText);
            _cur?.Mixers.ForEach(m => m.Mix.End());
            bool ch = chime ?? ChimeDefault();
            var ses = new Session { Id = "a" + Interlocked.Increment(ref _seq), By = by, Zone = zone, Mixers = targets.Select(c => (c, new AnnounceMixer(ch))).ToList(), LastDataMs = NowMs() };
            foreach (var (c, m) in ses.Mixers) c.BeginAnnounce(m);
            _cur = ses;
            Publish(ses, true);
            return (ses, null);
        }
    }

    /// <summary>Microphone audio from the page: 16-bit mono PCM at <paramref name="rate"/>.</summary>
    public void Push(Session ses, ReadOnlySpan<byte> pcm16, int rate)
    {
        if (ses.Ended || pcm16.Length < 2) return;
        var x = AnnounceMixer.FromPcm16(pcm16, rate);
        ses.LastDataMs = NowMs();
        foreach (var (_, m) in ses.Mixers) m.Push(x);
    }

    /// <summary>The talker let go (or the page left): the voice plays out, then the music fades back.</summary>
    public void End(Session ses)
    {
        lock (_l)
        {
            if (ses.Ended) return; ses.Ended = true;
            foreach (var (_, m) in ses.Mixers) m.End();
            if (ReferenceEquals(_cur, ses)) Publish(ses, false);
        }
    }

    public object Status()
    {
        lock (_l) { var c = _cur; bool on = c is { Ended: false };
            return new { active = on, by = on ? c!.By : null, zone = on ? c!.Zone : null, chime = ChimeDefault(), duckDb = AnnounceMixer.DefaultDuckDb, maxSeconds = AnnounceMixer.MaxVoiceSeconds }; }
    }

    private void Tick()
    {
        Session? stale = null;
        lock (_l) { if (_cur is { Ended: false } c && NowMs() - c.LastDataMs > IdleEndMs) stale = c; if (_cur is { Ended: true } d && d.Done) _cur = null; }
        if (stale != null) End(stale);
    }

    private void Publish(Session ses, bool active) => _s.Events.Publish("announce", new { active, by = ses.By, zone = ses.Zone });

    public void Dispose() { _tick.Dispose(); lock (_l) _cur?.Mixers.ForEach(m => m.Mix.End()); }
}
