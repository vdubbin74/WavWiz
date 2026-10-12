using WavWiz.Core.Protocol;
namespace WavWiz.Core.Calibration;

/// <summary>
/// 0.2.5 PC-mic calibration: a Player records its microphone natively (WASAPI) and sends the recording to the server over its normal audio connection,
/// as base64 16-bit mono in parts small enough for one control message (the wire refuses payloads over 1 MiB).
/// </summary>
public static class MicPcm
{
    /// <summary>Samples per part: 2 s at 48 kHz = 192 KB of PCM, 256 KB as base64.</summary>
    public const int PartSamples = 96_000;

    public static List<CalResult> Encode(string sessionId, string req, string micId, float[] mono, int rate, long startServerUs)
    {
        int parts = Math.Max(1, (mono.Length + PartSamples - 1) / PartSamples); var res = new List<CalResult>(parts);
        for (int p = 0; p < parts; p++)
        {
            int off = p * PartSamples, n = Math.Min(PartSamples, mono.Length - off); var b = new byte[Math.Max(0, n) * 2];
            for (int i = 0; i < n; i++) { short v = (short)Math.Clamp(MathF.Round(mono[off + i] * 32767f), -32768f, 32767f); b[2 * i] = (byte)v; b[2 * i + 1] = (byte)(v >> 8); }
            res.Add(new CalResult(sessionId, "mic-data", null, req, p, parts, startServerUs, rate, Convert.ToBase64String(b), MicId: micId));
        }
        return res;
    }

    public static float[] Decode(IEnumerable<CalResult> partsInAnyOrder)
    {
        var parts = partsInAnyOrder.OrderBy(x => x.Part).ToList(); var all = new List<float>(parts.Count * PartSamples);
        foreach (var p in parts)
        {
            var b = Convert.FromBase64String(p.Pcm16 ?? "");
            for (int i = 0; i + 1 < b.Length; i += 2) all.Add((short)(b[i] | (b[i + 1] << 8)) / 32768f);
        }
        return all.ToArray();
    }

    /// <summary>Peak level in dBFS (-100 for silence), for the live input meter.</summary>
    public static double PeakDb(ReadOnlySpan<float> x) { float p = 0; foreach (var v in x) p = Math.Max(p, Math.Abs(v)); return p <= 1e-5f ? -100 : Math.Round(20 * Math.Log10(p), 1); }
}

/// <summary>
/// 0.2.5: which kind of microphone a Windows capture endpoint is, from the same properties the outputs use (spec: wired mics fully supported and
/// recommended; Bluetooth mics allowed but flagged, never blocked). Pure, so it is unit tested on Linux.
/// </summary>
public static class MicKinds
{
    public const string BluetoothWarning = "Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended.";

    public static bool IsBluetooth(string name, string? controllerId, string? enumerator)
        => Has(controllerId, "BTHENUM") || Has(controllerId, "BTHHFENUM") || Has(controllerId, "BTHLE") || Has(controllerId, "BTHA2DP")
           || (enumerator?.StartsWith("BTH", StringComparison.OrdinalIgnoreCase) ?? false)
           || Has(name, "Bluetooth") || Has(name, "Hands-Free") || Has(name, "Handsfree") || Has(name, "AirPods");

    /// <param name="formFactor">EndpointFormFactor: 2 line level, 4 microphone, 5 headset, 6 handset, 10 unknown.</param>
    public static string Classify(string name, string? controllerId, string? enumerator, int formFactor)
    {
        if (IsBluetooth(name, controllerId, enumerator)) return "bluetooth";
        if (Has(name, "Focusrite") || Has(name, "Scarlett") || Has(name, "UMC") || Has(name, "Behringer") || Has(name, "MOTU") || Has(name, "Audient") || Has(name, "PreSonus") || Has(name, "Audio Interface")) return "interface";
        if ((enumerator?.Equals("USB", StringComparison.OrdinalIgnoreCase) ?? false) || Has(controllerId, "USB\\") || Has(name, "USB")) return "usb";
        if (Has(name, "Microphone Array") || Has(name, "Internal") || Has(name, "Built-in") || Has(name, "Webcam") || Has(name, "Camera")) return "builtin";
        if (formFactor is 2 or 4 or 5 or 6 || Has(name, "Line In") || Has(name, "Mic In") || Has(name, "Front Mic") || Has(name, "Rear Mic")) return "analog";
        return "other";
    }

    /// <summary>The mic to pre-select: the remembered one if it is still there, else the Windows default unless that is Bluetooth and a wired one exists, else the first wired one.</summary>
    public static MicInfo? Choose(IReadOnlyList<MicInfo> mics, string? remembered)
    {
        if (mics.Count == 0) return null;
        if (remembered != null && mics.FirstOrDefault(m => m.Id == remembered) is { } r) return r;
        var wired = mics.Where(m => !m.Bluetooth).ToList();
        return wired.FirstOrDefault(m => m.Default) ?? wired.FirstOrDefault(m => m.Kind is "usb" or "interface") ?? wired.FirstOrDefault() ?? mics.FirstOrDefault(m => m.Default) ?? mics[0];
    }

    public static string Describe(MicInfo m) => m.Kind switch
    {
        "usb" => "USB mic", "interface" => "audio interface", "builtin" => "built-in mic", "analog" => "wired mic", "bluetooth" => "Bluetooth (hands-free)", _ => "mic",
    };

    private static bool Has(string? s, string what) => s?.Contains(what, StringComparison.OrdinalIgnoreCase) ?? false;
}
