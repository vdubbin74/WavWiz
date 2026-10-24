namespace WavWiz.Core.Stream;

/// <summary>
/// 0.4.9 F77: 96 kHz -> 48 kHz for players that cannot take Studio Max (old builds, web pages, a device whose mix rate is below 88.2 kHz).
/// Linear-phase windowed-sinc low-pass (cut-off 22 kHz, Blackman, 95 taps) evaluated CENTERED on each output sample with one frame of
/// look-ahead, so the 48 kHz copy has ZERO delay against the 96 kHz stream: a fallback speaker stays sample-aligned with the rest of the zone.
/// Push a 96 kHz frame, get the 48 kHz version of the PREVIOUS frame back; <see cref="Flush"/> returns the last one (silence look-ahead).
/// </summary>
public sealed class HalfbandDecimator
{
    public const int Half = 47;                       // taps on each side of the centre
    private static readonly float[] H = Design();
    private readonly int _in;                         // stereo frames per 96 kHz frame
    private readonly float[] _w;                      // [prev | cur | next] interleaved stereo
    private int _have;                                // frames pushed (0, 1, 2+)

    public HalfbandDecimator(int framesIn) { _in = framesIn; _w = new float[framesIn * 3 * 2]; }

    private static float[] Design()
    {
        int n = 2 * Half + 1; var h = new float[n]; double fc = 22_000.0 / 96_000.0, sum = 0;
        for (int i = 0; i < n; i++)
        {
            int k = i - Half; double s = k == 0 ? 2 * fc : Math.Sin(2 * Math.PI * fc * k) / (Math.PI * k);
            double w = 0.42 - 0.5 * Math.Cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.Cos(4 * Math.PI * i / (n - 1));
            h[i] = (float)(s * w); sum += s * w;
        }
        for (int i = 0; i < n; i++) h[i] = (float)(h[i] / sum);   // unity gain at DC
        return h;
    }

    public void Reset() { Array.Clear(_w); _have = 0; }

    /// <summary>Push one 96 kHz frame (interleaved stereo, <c>framesIn</c> frames). Returns the previous frame at 48 kHz, or null for the first push.</summary>
    public float[]? Push(ReadOnlySpan<float> frame96)
    {
        int n2 = _in * 2;
        Array.Copy(_w, n2, _w, 0, n2 * 2);           // shift: cur -> prev, next -> cur
        frame96[..n2].CopyTo(_w.AsSpan(n2 * 2));
        _have++;
        return _have >= 2 ? Centre() : null;
    }

    /// <summary>The last pushed frame at 48 kHz (end of the source: silence after it). Null when nothing is pending.</summary>
    public float[]? Flush()
    {
        if (_have == 0) return null;
        int n2 = _in * 2;
        Array.Copy(_w, n2, _w, 0, n2 * 2); Array.Clear(_w, n2 * 2, n2);
        _have = 0;
        var r = Centre(); return r;
    }

    private float[] Centre()
    {
        int outN = _in / 2; var o = new float[outN * 2];
        for (int j = 0; j < outN; j++)
        {
            int c = _in + 2 * j; double l = 0, r = 0;
            for (int k = -Half; k <= Half; k++) { int x = (c + k) * 2; float hk = H[k + Half]; l += hk * _w[x]; r += hk * _w[x + 1]; }
            o[2 * j] = (float)l; o[2 * j + 1] = (float)r;
        }
        return o;
    }
}
