using System.Text.RegularExpressions;
using NAudio.CoreAudioApi;
using WavWiz.Core.Clock;
using WavWiz.Core.Protocol;
using WavWiz.PlayerCore;
namespace WavWiz.Player;

/// <summary>
/// This PC's render endpoints with a best-effort kind and Bluetooth identity (spec 14/17).
/// UNVERIFIED ON WINDOWS: the property keys below (form factor, controller device id, container id) are the documented ones but are untested against real
/// Bluetooth/HDMI hardware. When no Bluetooth address can be read the server falls back to a per-PC key and the user can link the endpoint by hand.
/// </summary>
public sealed class WasapiOutputProvider : IOutputProvider, IDisposable
{
    private readonly IMonotonicClock _clock; private readonly MMDeviceEnumerator _enum = new(); private readonly System.Threading.Timer _poll; private string _sig = "";
    public event Action? DevicesChanged;

    private static readonly PropertyKey FormFactor = new(new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), 0);
    private static readonly PropertyKey ControllerDeviceId = new(new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc"), 2);
    private static readonly PropertyKey ContainerId = new(new Guid("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c"), 2);
    private static readonly PropertyKey EnumeratorName = new(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);

    public WasapiOutputProvider(IMonotonicClock clock)
    {
        _clock = clock;
        // device arrival/removal is detected by polling every 3 s (plug, unplug, Bluetooth connect/disconnect): robust, cheap, and no COM callback to keep alive
        _sig = Signature(); _poll = new System.Threading.Timer(_ => { try { var s = Signature(); if (s != _sig) { _sig = s; DevicesChanged?.Invoke(); } } catch { } }, null, 3000, 3000);
    }

    public string? DefaultEndpointId
    {
        get { try { return _enum.TryGetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia, out var d) ? d?.ID : null; } catch { return null; } }
    }

    public IReadOnlyList<OutputInfo> List()
    {
        var res = new List<OutputInfo>();
        try
        {
            foreach (var d in _enum.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active | DeviceState.Unplugged))
            {
                using (d)
                {
                    string name = SafeName(d); string? controller = Prop(d, ControllerDeviceId), container = Prop(d, ContainerId), enumerator = Prop(d, EnumeratorName);
                    int ff = int.TryParse(Prop(d, FormFactor), out var f) ? f : 10;
                    bool bt = (controller?.Contains("BTHENUM", StringComparison.OrdinalIgnoreCase) ?? false) || (controller?.Contains("BTHHFENUM", StringComparison.OrdinalIgnoreCase) ?? false)
                              || (controller?.Contains("BTHLE", StringComparison.OrdinalIgnoreCase) ?? false) || (enumerator?.StartsWith("BTH", StringComparison.OrdinalIgnoreCase) ?? false)
                              || name.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase) || name.Contains("Hands-Free", StringComparison.OrdinalIgnoreCase);
                    string kind = bt ? "bluetooth" : ff switch { 9 => "hdmi", 8 => "spdif", 1 or 2 or 3 or 5 => "analog", _ => name.Contains("USB", StringComparison.OrdinalIgnoreCase) ? "usb" : "other" };
                    string? addr = bt ? Regex.Match(controller ?? "", @"(?:DEV_|_)([0-9A-Fa-f]{12})(?![0-9A-Fa-f])").Groups[1].Value is { Length: 12 } m ? string.Join(":", Enumerable.Range(0, 6).Select(i => m.Substring(i * 2, 2))).ToUpperInvariant() : null : null;
                    res.Add(new OutputInfo(d.ID, name, kind, addr, d.State == DeviceState.Active, false, null, null, container));
                }
            }
        }
        catch { /* enumeration failed (audio service restarting): return what we have */ }
        return res;
    }

    private static string SafeName(MMDevice d) { try { return d.FriendlyName; } catch { return d.ID; } }
    private static string? Prop(MMDevice d, PropertyKey k)
    {
        try { return d.Properties.Contains(k) ? d.Properties[k].Value?.ToString() : null; } catch { return null; }
    }

    public IAudioSink Open(string endpointId, SinkRender render) => new WasapiSink(endpointId, render, _clock);

    private string Signature() => string.Join('|', List().Select(o => o.EndpointId + (o.Connected ? '+' : '-')));

    public void Dispose() { _poll.Dispose(); _enum.Dispose(); }
}
