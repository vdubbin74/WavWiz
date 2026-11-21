using System.Net;
using WavWiz.Server.Media;
namespace WavWiz.Server.Tests;

/// <summary>0.7.2 A: the shared live limiter on AirPlay / Spotify Connect input. It runs on the <see cref="LiveFeed"/> AFTER the boost
/// (<see cref="LiveFeed.Gain"/>), before the house mix, so a boosted loud track does not clip. Setting live.limiter, default on.</summary>
public class Release072LimiterTests
{
    private static float[] Sine(double amp, int frames)
    {
        var b = new float[frames * 2];
        for (int i = 0; i < frames; i++) b[i * 2] = b[i * 2 + 1] = (float)(amp * Math.Sin(2 * Math.PI * 300 * i / 48000));
        return b;
    }
    private static float[] ReadAll(LiveFeed f, int frames)
    {
        using var d = f.OpenDecoder(); var outBuf = new float[frames * 2]; int got = 0;
        while (got < frames) { int n = d.Read(outBuf.AsSpan(got * 2), Math.Min(4800, frames - got)); if (n == 0) break; got += n; }
        return outBuf.AsSpan(0, got * 2).ToArray();
    }

    [Fact]
    public void A_full_scale_track_boosted_6_dB_is_held_at_the_ceiling()
    {
        var f = new LiveFeed { TargetMs = 100 }; f.WriteFloat(Sine(1.0, 48000), 48000);
        f.Gain = (float)Math.Pow(10, 6 / 20.0);
        var y = ReadAll(f, 24000);
        Assert.NotEmpty(y);
        Assert.True(y.Max(Math.Abs) <= Math.Pow(10, -0.3 / 20) + 1e-6, $"peak {y.Max(Math.Abs)}");
        Assert.True(f.LimiterReductionDb > 0);
    }

    [Fact]
    public void Limiter_off_still_never_passes_0_dBFS()
    {
        var f = new LiveFeed { TargetMs = 100, Limit = false }; f.WriteFloat(Sine(1.0, 48000), 48000);
        f.Gain = 2f;
        var y = ReadAll(f, 24000);
        Assert.Equal(1f, y.Max());
        Assert.Equal(0.0, f.LimiterReductionDb);
    }

    [Fact]
    public void Unboosted_normal_level_audio_is_untouched()
    {
        var x = Sine(0.5, 48000);
        var f = new LiveFeed { TargetMs = 100 }; f.WriteFloat(x, 48000);
        var y = ReadAll(f, 24000);
        for (int i = 0; i < y.Length; i++) Assert.Equal(x[i], y[i]);
    }

    [Fact]
    public async Task Setting_defaults_on_and_turning_it_off_reaches_every_receiver_feed_at_once()
    {
        await using var f = await ServerFixture.StartAsync(); var admin = f.As(f.Token(Role.Admin));
        Assert.True(LiveLimiter.Enabled(f.Server.S.Db));
        Assert.True(f.Server.S.AirPlay!.Feed.Limit);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["live.limiter"] = false })).StatusCode);
        Assert.False(f.Server.S.AirPlay!.Feed.Limit);
        if (f.Server.S.Spotify is { } sp) Assert.False(sp.Feed.Limit);
        f.Server.S.AirPlay!.OnLine("INIT 0 2 44100");                    // a new session keeps the saved choice
        Assert.False(f.Server.S.AirPlay!.Feed.Limit);
        f.Server.S.AirPlay!.OnLine("STOP");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["live.limiter"] = true })).StatusCode);
        Assert.True(f.Server.S.AirPlay!.Feed.Limit);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/v1/settings", new Dictionary<string, object> { ["live.limiter"] = 1 })).StatusCode);
    }
}
