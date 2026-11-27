namespace WavWiz.Server.Tests;

/// <summary>0.7.3: input labels carry the PC's name ("PCBOXV2 · Speakers (what you hear)"), not "This PC" - a phone could not tell which PC that was.</summary>
public class InputsPcName073Tests
{
    [Fact]
    public void Labels_name_the_pc()
    {
        Assert.Equal("PCBOXV2 · Speakers (what you hear)", WavWiz.Server.Inputs.InputService.SourceLabel("PCBOXV2", "loopback"));
        Assert.Equal("PCBOXV2 · Microphone", WavWiz.Server.Inputs.InputService.SourceLabel("PCBOXV2", "mic"));
        Assert.Equal("PCBOXV2 · Speakers", WavWiz.Server.Inputs.InputService.DefaultName(new WavWiz.Core.Protocol.InputInfo("x", "This PC · Speakers (what you hear)", "loopback"), "PCBOXV2"));
        Assert.Equal("HyperX QuadCast", WavWiz.Server.Inputs.InputService.DefaultName(new WavWiz.Core.Protocol.InputInfo("m", "HyperX QuadCast", "mic"), "PCBOXV2"));
        Assert.Equal("Aux in", WavWiz.Server.Inputs.InputService.DefaultName(new WavWiz.Core.Protocol.InputInfo("a", "Line In", "aux"), "PCBOXV2"));
    }
}
