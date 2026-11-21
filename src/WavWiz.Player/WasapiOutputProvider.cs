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
        var res = new List<OutputInfo>(); var def = DefaultEndpointId;
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
                    bool? empty = d.State == DeviceState.Unplugged ? true : ff is 3 or 5 || LocalSyncName(name) ? JackProbe.Empty(d) : null;   // 0.7.2 t2186u: only headsets are probed
                    res.Add(new OutputInfo(d.ID, name, kind, addr, d.State == DeviceState.Active, false, null, null, container, ff, d.ID == def, empty));   // 0.7.2 t2183u: form factor + Windows default
                }
            }
        }
        catch { /* enumeration failed (audio service restarting): return what we have */ }
        return res;
    }

    private static bool LocalSyncName(string name) => WavWiz.PlayerCore.LocalSyncRules.IsHeadset(new OutputInfo("", name, "", null, true, false));
    private static string SafeName(MMDevice d) { try { return d.FriendlyName; } catch { return d.ID; } }
    private static string? Prop(MMDevice d, PropertyKey k)
    {
        try { return d.Properties.Contains(k) ? d.Properties[k].Value?.ToString() : null; } catch { return null; }
    }

    public IAudioSink Open(string endpointId, SinkRender render) => new WasapiSink(endpointId, render, _clock);

    private string Signature() => string.Join('|', List().Select(o => o.EndpointId + (o.Connected ? '+' : '-')));

    public void Dispose() { _poll.Dispose(); _enum.Dispose(); }
}

/// <summary>
/// 0.7.2 t2186u: "is anything plugged into this output's jack?" from Windows' jack detection (DeviceTopology: the endpoint's connector 0 ->
/// the adapter part it connects to -> IKsJackDescription). True only when Windows reports every jack empty; null when it can't tell (USB /
/// wireless headsets have no jack, drivers without jack detection report IsConnected = TRUE, any COM failure), and callers treat null as in use.
/// NAudio's own IKsJackDescription declares GetJackDescription as returning a string, which is wrong, so the RCW NAudio activated is cast to the
/// correct declaration below (same IID; the RCW QueryInterfaces for it).
/// Interface + struct from Microsoft's devicetopology.h, as documented at
/// https://learn.microsoft.com/windows/win32/api/devicetopology/nn-devicetopology-iksjackdescription (IID 4509F757-2D46-4637-8E62-CE7DB944F57B:
/// GetJackCount(UINT*), GetJackDescription(UINT, KSJACK_DESCRIPTION*)) and .../ns-devicetopology-ksjack_description (seven 32-bit fields,
/// IsConnected last: "For devices that do not support jack-presence detection, this member is always TRUE").
/// </summary>
internal static class JackProbe
{
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct KSJACK_DESCRIPTION { public uint ChannelMapping, Color, ConnectionType, GeoLocation, GenLocation, PortConnection; public int IsConnected; }

    [System.Runtime.InteropServices.ComImport, System.Runtime.InteropServices.Guid("4509F757-2D46-4637-8E62-CE7DB944F57B"),
     System.Runtime.InteropServices.InterfaceType(System.Runtime.InteropServices.ComInterfaceType.InterfaceIsIUnknown)]
    private interface IKsJackDescription
    {
        [System.Runtime.InteropServices.PreserveSig] int GetJackCount(out uint jacks);
        [System.Runtime.InteropServices.PreserveSig] int GetJackDescription(uint jack, out KSJACK_DESCRIPTION description);
    }

    public static bool? Empty(MMDevice d)
    {
        try
        {
            var topo = d.DeviceTopology; if (topo.ConnectorCount == 0) return null;
            var jd = topo.GetConnector(0).ConnectedTo.Part.JackDescription; if (jd == null) return null;
            var raw = typeof(KsJackDescription).GetField("ksJackDescriptionInterface", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)?.GetValue(jd);
            if (raw is not IKsJackDescription k || k.GetJackCount(out var n) != 0 || n == 0) return null;
            for (uint i = 0; i < n; i++) { if (k.GetJackDescription(i, out var j) != 0) return null; if (j.IsConnected != 0) return false; }
            return true;
        }
        catch { return null; }
    }
}
