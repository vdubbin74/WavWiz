using System.Text.Json;
namespace WavWiz.Server.Tests;

/// <summary>0.7.3 Direct (no processing) is part of the speaker's preset: the server's Parse / Normalize keeps it, old presets read as off.</summary>
public class Direct073ServerTests
{
    [Fact]
    public void Parse_keeps_direct_and_old_presets_are_off()
    {
        var (on, err) = WavWiz.Server.Dsp.DspService.Parse(JsonDocument.Parse("{\"name\":\"Mine\",\"direct\":true,\"bass\":{\"gainDb\":6,\"hz\":100}}").RootElement);
        Assert.Null(err); Assert.True(on!.Direct); Assert.Equal(6.0, on.Bass.GainDb);
        var (old, _) = WavWiz.Server.Dsp.DspService.Parse(JsonDocument.Parse("{\"name\":\"Old\"}").RootElement);
        Assert.False(old!.Direct);
        Assert.Contains("\"direct\":true", JsonSerializer.Serialize(on, WavWiz.Server.Dsp.DspService.J));
    }
}
