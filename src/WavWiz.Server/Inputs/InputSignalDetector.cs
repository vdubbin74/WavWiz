namespace WavWiz.Server.Inputs;

/// <summary>
/// 0.7.2: watches an input's peak level over time (pure: no clock of its own, the caller passes the time). Used for Turntable mode on Aux in:
/// <list type="bullet">
/// <item>needle drop: the level stays above <see cref="StartDb"/> for <see cref="StartHoldMs"/> (a couple of seconds) -> <see cref="Update"/> says "started";</item>
/// <item>end of a side: after that, the level stays below <see cref="QuietDb"/> for <see cref="StopHoldMs"/> (25 s - long enough to be the run-out groove,
/// not the few-second gap between tracks) -> "ended";</item>
/// <item>phono-level check: while a signal is present, if no peak in the last <see cref="PhonoWindowMs"/> reached <see cref="PhonoDb"/>, the turntable is
/// probably plugged in without a phono preamp (<see cref="PhonoLow"/>). It is only a warning - nothing is boosted to "fix" it.</item>
/// </list>
/// </summary>
public sealed class InputSignalDetector
{
    /// <summary>Above this a signal counts as music (dBFS peak). A raw phono cartridge (no preamp) still clears it, so the warning can show.</summary>
    public double StartDb { get; init; } = -48;
    /// <summary>Below this the input counts as quiet (a little lower than <see cref="StartDb"/>, so a level right at the edge does not flap).</summary>
    public double QuietDb { get; init; } = -52;
    public int StartHoldMs { get; init; } = 2000;
    /// <summary>Approved range 20-30 s; 25 s by default.</summary>
    public int StopHoldMs { get; init; } = 25_000;
    /// <summary>Line-level music peaks well above this; a cartridge straight into a line input peaks around -40..-30 dBFS.</summary>
    public double PhonoDb { get; init; } = -30;
    public int PhonoWindowMs { get; init; } = 8000;

    private long _aboveSince = -1, _belowSince = -1, _signalSince = -1;
    private readonly Queue<(long T, double Db)> _recent = new();
    /// <summary>A signal is present (needle down / music playing) - true from "started" until "ended".</summary>
    public bool Signal { get; private set; }
    /// <summary>Signal present for at least the phono window and no peak in that window reached <see cref="PhonoDb"/>.</summary>
    public bool PhonoLow { get; private set; }

    public void Reset() { _aboveSince = _belowSince = _signalSince = -1; _recent.Clear(); Signal = false; PhonoLow = false; }

    /// <summary>Feed one level reading. Returns whether a signal just started (needle drop) or just ended (end of side).</summary>
    public (bool Started, bool Ended) Update(double peakDb, long nowMs)
    {
        if (!double.IsFinite(peakDb)) peakDb = -120;
        bool started = false, ended = false;
        if (!Signal)
        {
            if (peakDb >= StartDb) { if (_aboveSince < 0) _aboveSince = nowMs; if (nowMs - _aboveSince >= StartHoldMs) { Signal = true; started = true; _signalSince = nowMs; _belowSince = -1; } }
            else _aboveSince = -1;
        }
        else
        {
            if (peakDb < QuietDb) { if (_belowSince < 0) _belowSince = nowMs; if (nowMs - _belowSince >= StopHoldMs) { Signal = false; ended = true; _aboveSince = -1; _signalSince = -1; } }
            else _belowSince = -1;
        }
        // phono check over the trailing window, only while music plays (quiet passages and track gaps are ignored)
        if (Signal && peakDb >= QuietDb) _recent.Enqueue((nowMs, peakDb));
        while (_recent.Count > 0 && nowMs - _recent.Peek().T > PhonoWindowMs) _recent.Dequeue();
        PhonoLow = Signal && _signalSince >= 0 && nowMs - _signalSince >= PhonoWindowMs && _recent.Count > 0 && _recent.Max(x => x.Db) < PhonoDb;
        if (!Signal) _recent.Clear();
        return (started, ended);
    }
}
