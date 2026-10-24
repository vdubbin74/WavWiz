namespace WavWiz.PlayerCore;

/// <summary>0.4.9 F71: the calibration test sound plays at its own volume (full by default), never limited by the speaker's max-volume cap or
/// its (maybe tiny) zone volume. The guard remembers the real volume / mute once, holds zone updates that arrive meanwhile (they become the
/// value to restore), and always puts them back: after the sound, on cancel / "restore", on failure (Run's finally) and by the safety timer.</summary>
public sealed class CalVolumeGuard
{
    private readonly Func<double> _getVol; private readonly Func<bool> _getMuted; private readonly Action<double> _setVol; private readonly Action<bool> _setMuted;
    private readonly object _l = new(); private bool _active, _muted; private double _vol;
    public CalVolumeGuard(Func<double> getVol, Func<bool> getMuted, Action<double> setVol, Action<bool> setMuted) { _getVol = getVol; _getMuted = getMuted; _setVol = setVol; _setMuted = setMuted; }
    public bool Active { get { lock (_l) return _active; } }
    /// <summary>The volume / mute that will come back when the calibration sound ends.</summary>
    public (double Volume, bool Muted) Saved { get { lock (_l) return (_vol, _muted); } }
    public void Begin(double testVolume)
    {
        lock (_l) { if (!_active) { _vol = _getVol(); _muted = _getMuted(); _active = true; } _setMuted(false); _setVol(Math.Clamp(double.IsFinite(testVolume) ? testVolume : 100, 0, 100)); }
    }
    /// <summary>A zone volume / mute update from the server. While the test sound is on it is kept for the restore (true = held, do not apply).</summary>
    public bool Hold(double volume, bool muted) { lock (_l) { if (!_active) return false; _vol = volume; _muted = muted; return true; } }
    public void End() { lock (_l) { if (!_active) return; _active = false; _setVol(_vol); _setMuted(_muted); } }
    public async Task Run(double testVolume, Func<Task> body) { Begin(testVolume); try { await body(); } finally { End(); } }
}
