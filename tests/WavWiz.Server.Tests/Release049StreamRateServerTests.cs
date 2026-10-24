using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.4.9 F77: the queue source's position/crossfade math follows the stream rate (96 kHz Studio Max), not a fixed 48 kHz.</summary>
public class Release049StreamRateServerTests
{
    private sealed class Pcm : IPcmDecoder
    {
        private long _left; public Pcm(long frames) { _left = frames; }
        public int Read(Span<float> dst, int frames) { int n = (int)Math.Min(frames, _left); dst[..(n * 2)].Fill(0.1f); _left -= n; return n; }
        public bool Finished => _left == 0; public string? Error => null; public void Dispose() { }
    }
    private static QueueItem T(long id, long ms) => new(id, "track", "/x" + id, "t" + id, "a", "al" + id, ms, id);

    [Theory]
    [InlineData(48000)]
    [InlineData(96000)]
    public void Locate_reports_milliseconds_at_the_source_rate(int rate)
    {
        var items = new[] { T(1, 2000), T(2, 2000) };
        var q = new QueueSource(items, 0, 0, RepeatMode.Off, (it, _) => new Pcm(rate * 2)) { Rate = rate };
        var buf = new float[rate / 50 * 2]; long got = 0;
        while (got < rate * 3) { int n = q.Read(buf, rate / 50); if (n == 0) break; got += n; }
        Assert.Equal((0, 1500L), q.Locate(rate * 3 / 2));          // 1.5 s into song 1
        Assert.Equal((1, 500L), q.Locate(rate * 5 / 2));           // 0.5 s into song 2
    }
}
