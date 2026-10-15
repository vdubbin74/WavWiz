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
    public const int Levels = 4;
    /// <summary>0.3.6 K11: then 10 octave-band levels centered on the EQ's own labels (31 62 125 250 500 1k 2k 4k 8k 16k Hz), each the band's RMS in dBFS coded like the stats above.
    /// They come from an 8192-point FFT (5.9 Hz per bin, so 31 Hz and 62 Hz really are separate) over the last 8192 samples; the browser's 1024-point FFT (47 Hz per bin) cannot do that.</summary>
    public const int Bands = 10, FftSize = 8192;
    public static readonly double[] BandHz = { 31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
    public const int Extra = Levels + Bands;
    private readonly float[] _hist = new float[FftSize];
    private readonly double[] _fr = new double[FftSize], _fi = new double[FftSize], _win = BuildWindow(), _cos = new double[FftSize / 2], _sin = new double[FftSize / 2];
    private readonly byte[] _bands = new byte[Bands];
    private static double[] BuildWindow() { var w = new double[FftSize]; for (int i = 0; i < FftSize; i++) w[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (FftSize - 1)); return w; }
    private const long KeepUs = 8_000_000;
    public VizHub() { for (int i = 0; i < FftSize / 2; i++) { _cos[i] = Math.Cos(-2 * Math.PI * i / FftSize); _sin[i] = Math.Sin(-2 * Math.PI * i / FftSize); } }

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
            // rolling mono history for the band analysis (newest sample last)
            if (n >= FftSize) { for (int i = 0; i < FftSize; i++) { int j = n - FftSize + i; _hist[i] = 0.5f * (st[2 * j] + st[2 * j + 1]); } }
            else { Array.Copy(_hist, n, _hist, 0, FftSize - n); for (int i = 0; i < n; i++) _hist[FftSize - n + i] = 0.5f * (st[2 * i] + st[2 * i + 1]); }
            var b = new byte[Window + Extra];
            for (int i = 0; i < Window; i++) { float v = _mono[i] * 128f + 128f; b[i] = (byte)(v < 0 ? 0 : v > 255 ? 255 : v); }
            Stats(_left, out var rl, out var pl); Stats(_right, out var rr, out var pr);
            b[Window] = Db(rl); b[Window + 1] = Db(rr); b[Window + 2] = Db(pl); b[Window + 3] = Db(pr);
            AnalyzeBands(_bands); Array.Copy(_bands, 0, b, Window + Levels, Bands);
            _ring.Add((playAtUs + (long)(n * 1e6 / 48000.0), b));          // window ENDS at the end of this frame
            int drop = 0; while (drop < _ring.Count && _ring[drop].At < playAtUs - KeepUs) drop++;
            if (drop > 0) _ring.RemoveRange(0, drop);
        }
    }

    /// <summary>Octave-band RMS (dBFS, coded) of the last 8192 mono samples: Hann window, power summed over each band's bins (edges fc/sqrt2 .. fc*sqrt2).</summary>
    private void AnalyzeBands(byte[] outBands)
    {
        double e = 0; for (int i = 0; i < FftSize; i++) { double v = _hist[i]; e += v * v; }
        if (e < 1e-9) { Array.Clear(outBands); return; }
        for (int i = 0; i < FftSize; i++) { _fr[i] = _hist[i] * _win[i]; _fi[i] = 0; }
        Fft(_fr, _fi);
        const double sumW2 = 3.0 * FftSize / 8.0, sr = 48000.0, binHz = sr / FftSize;
        for (int b = 0; b < Bands; b++)
        {
            double lo = BandHz[b] / Math.Sqrt(2), hi = Math.Min(BandHz[b] * Math.Sqrt(2), sr / 2 - binHz), p = 0;
            int k0 = Math.Max(1, (int)Math.Ceiling(lo / binHz)), k1 = Math.Min(FftSize / 2 - 1, (int)Math.Floor(hi / binHz));
            for (int k = k0; k <= k1; k++) p += _fr[k] * _fr[k] + _fi[k] * _fi[k];
            double ms = 2.0 * p / ((double)FftSize * sumW2);
            outBands[b] = Db(Math.Sqrt(ms));
        }
    }
    private void Fft(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++) { int bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); } }
        for (int len = 2; len <= n; len <<= 1)
        {
            int half = len / 2, step = n / len;
            for (int i = 0; i < n; i += len)
                for (int k = 0; k < half; k++)
                {
                    double wr = _cos[k * step], wi = _sin[k * step]; int a = i + k, c = a + half;
                    double xr = re[c] * wr - im[c] * wi, xi = re[c] * wi + im[c] * wr;
                    re[c] = re[a] - xr; im[c] = im[a] - xi; re[a] += xr; im[a] += xi;
                }
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
