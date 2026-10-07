using WavWiz.Core.Protocol;
namespace WavWiz.PlayerCore;

/// <summary>Called by the sink's audio thread once per period; dacLocalUs = local monotonic time at which the first frame reaches the DAC.</summary>
public delegate int SinkRender(Span<float> interleavedStereo, int frames, long dacLocalUs);

public interface IAudioSink : IDisposable
{
    int MixRate { get; }
    /// <summary>Latency the driver reports for this output pipeline (informational; the render callback already gets the DAC time).</summary>
    double ReportedLatencyMs { get; }
    void Start();
    /// <summary>Raised from the audio thread when the device goes away or fails (unplugged, Bluetooth off, driver reset). The player stays up and asks the user to pick another output.</summary>
    event Action<string>? Faulted;
}

/// <summary>This PC's outputs and how to open one. WASAPI in the Windows app; a capture sink in tests and headless mode.</summary>
public interface IOutputProvider
{
    IReadOnlyList<OutputInfo> List();
    /// <summary>Open (but do not start) a sink for the endpoint. Throws if the device is gone.</summary>
    IAudioSink Open(string endpointId, SinkRender render);
    string? DefaultEndpointId { get; }
}

/// <summary>Per-user secret storage (DPAPI on Windows, a 0600 file elsewhere).</summary>
public interface ISecretStore
{
    string? Load(string name);
    void Save(string name, string value);
    void Delete(string name);
}
