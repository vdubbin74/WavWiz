namespace WavWiz.Server.Playback;

/// <summary>
/// Visualizer feed (0.0.2): keeps a short history of 1024-sample mono 8-bit waveform windows, one per 20 ms audio frame, stamped with the
/// server time at which that audio is heard. /ws/viz clients read the window for "now" (minus their own delay), so the picture follows the music.
/// The browser never needs a copy of the audio. Pure data; no network here.
/// </summary>
public sealed class VizHub
{
    public const int Window = 1024;
    private readonly object _l = new();
    private readonly List<(long At, byte[] Data)> _ring = new();
    private readonly float[] _mono = new float[Window], _left = new float[Window], _right = new float[Window];
    /// <summary>0.0.8: 4 bytes after the waveform: rms L, rms R, peak L, peak R in dBFS over the window, coded as (dB + 72) * 255 / 72 (0 = -72 dBFS or quieter).
    /// The VU meters show true stereo; older pages read only the first 1024 bytes.</summary>
    public const int Extra = 4;
    private const long KeepUs = 8_000_000;

    public void OnFrame(long playAtUs, ReadOnlySpan<float> st)
    {
        int n = st.Length / 2; if (n <= 0) return;
        lock (_l)
        {
            if (n >= Window) { for (int i = 0; i < Window; i++) { int j = n - Window + i; _left[i] = st[2 * j]; _right[i] = st[2 * j + 1]; _mono[i] = 0.5f * (st[2 * j] + st[2 * j + 1]); } }
            else
            {
                Array.Copy(_mono, n, _mono, 0, Window - n); Array.Copy(_left, n, _left, 0, Window - n); Array.Copy(_right, n, _right, 0, Window - n);
                for (int i = 0; i < n; i++) { _left[Window - n + i] = st[2 * i]; _right[Window - n + i] = st[2 * i + 1]; _mono[Window - n + i] = 0.5f * (st[2 * i] + st[2 * i + 1]); }
            }
            while (_ring.Count > 0 && _ring[^1].At >= playAtUs + 40_000) _ring.RemoveAt(_ring.Count - 1);   // a new epoch (seek/skip) re-stamps time: drop the old future
            var b = new byte[Window + Extra];
            for (int i = 0; i < Window; i++) { float v = _mono[i] * 128f + 128f; b[i] = (byte)(v < 0 ? 0 : v > 255 ? 255 : v); }
            Stats(_left, out var rl, out var pl); Stats(_right, out var rr, out var pr);
            b[Window] = Db(rl); b[Window + 1] = Db(rr); b[Window + 2] = Db(pl); b[Window + 3] = Db(pr);
            _ring.Add((playAtUs + (long)(n * 1e6 / 48000.0), b));          // window ENDS at the end of this frame
            int drop = 0; while (drop < _ring.Count && _ring[drop].At < playAtUs - KeepUs) drop++;
            if (drop > 0) _ring.RemoveRange(0, drop);
        }
    }

    private static void Stats(float[] x, out double rms, out double peak)
    {
        double s = 0, p = 0; for (int i = 0; i < x.Length; i++) { double v = x[i]; s += v * v; if (Math.Abs(v) > p) p = Math.Abs(v); }
        rms = Math.Sqrt(s / x.Length); peak = p;
    }
    public static byte Db(double amp) { double db = 20 * Math.Log10(Math.Max(1e-6, amp)); return (byte)Math.Round(Math.Clamp((db + 72) * 255 / 72, 0, 255)); }

    public void Clear() { lock (_l) _ring.Clear(); }

    /// <summary>The latest window whose audio has been heard by server time <paramref name="serverUs"/>; null when nothing is due (stopped, paused or not yet started).</summary>
    public byte[]? At(long serverUs, long maxAgeUs = 120_000)
    {
        lock (_l)
        {
            int lo = 0, hi = _ring.Count - 1, best = -1;
            while (lo <= hi) { int m = (lo + hi) / 2; if (_ring[m].At <= serverUs) { best = m; lo = m + 1; } else hi = m - 1; }
            if (best < 0 || serverUs - _ring[best].At > maxAgeUs) return null;
            return _ring[best].Data;
        }
    }
}
