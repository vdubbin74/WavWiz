namespace WavWiz.Core.Playback;

/// <summary>
/// Last processing step before the device (spec 5.2 step 5): the per-speaker DSP chain incl. zone volume and the limiter.
/// Must be allocation-free and lock-free on the audio thread (spec 11.5).
/// </summary>
public interface IAudioProcessor
{
    void Process(Span<float> interleavedStereo, int frames);
    /// <summary>Latency the chain adds in microseconds (0 for the IIR chain). Added to the sync target (spec 11.6).</summary>
    long LatencyUs { get; }
}

public sealed class PassThroughProcessor : IAudioProcessor
{
    public void Process(Span<float> interleavedStereo, int frames) { }
    public long LatencyUs => 0;
}
