using System.Text.RegularExpressions;
using WavWiz.Core.Protocol;
namespace WavWiz.PlayerCore.Linux;

/// <summary>One ALSA playback device. <see cref="OpenName"/> is what snd_pcm_open gets: "plughw:CARD=&lt;id&gt;,DEV=&lt;n&gt;" (the plug layer converts the
/// sample format/rate/channels the card can't do natively) or a PCM name such as "default" (PipeWire / PulseAudio / dmix route through it).</summary>
public sealed record AlsaDevice(string EndpointId, string OpenName, string Name, string Kind, int Card = -1, int Device = -1, string? CardId = null);

/// <summary>
/// 0.7.0: the `aplay -l` equivalent, read from procfs (/proc/asound/cards + /proc/asound/pcm; a card with /proc/asound/cardN/usbid is a USB device),
/// which needs no extra library and is the same data aplay prints. Pure parsing is separate (unit-tested with real Pi / USB / HDMI samples).
/// Endpoint ids use the card's stable <b>id</b> (e.g. "Headphones", "vc4hdmi0", "Device"), not its index, so a saved choice survives a reboot
/// that re-orders USB cards.
/// </summary>
public static class AlsaDevices
{
    public const string DefaultEndpoint = "alsa:default";
    private static readonly Regex CardLine = new(@"^\s*(\d+)\s+\[([^\]]+)\]\s*:\s*(\S+)\s*-\s*(.*)$", RegexOptions.CultureInvariant);
    private static readonly Regex PcmLine = new(@"^(\d+)-(\d+):\s*([^:]*?)\s*:\s*([^:]*?)\s*:(.*)$", RegexOptions.CultureInvariant);

    public sealed record Card(int Index, string Id, string Driver, string Name, string LongName);
    public sealed record Pcm(int Card, int Device, string Id, string Name, bool Playback);

    public static List<Card> ParseCards(string text)
    {
        var res = new List<Card>(); var lines = text.Replace("\r", "").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            var m = CardLine.Match(lines[i]); if (!m.Success) continue;
            var longName = i + 1 < lines.Length && !CardLine.IsMatch(lines[i + 1]) ? lines[i + 1].Trim() : "";
            res.Add(new Card(int.Parse(m.Groups[1].Value), m.Groups[2].Value.Trim(), m.Groups[3].Value.Trim(), m.Groups[4].Value.Trim(), longName));
        }
        return res;
    }

    public static List<Pcm> ParsePcm(string text)
    {
        var res = new List<Pcm>();
        foreach (var raw in text.Replace("\r", "").Split('\n'))
        {
            var m = PcmLine.Match(raw.Trim()); if (!m.Success) continue;
            res.Add(new Pcm(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), m.Groups[3].Value.Trim(), m.Groups[4].Value.Trim(), m.Groups[5].Value.Contains("playback", StringComparison.Ordinal)));
        }
        return res;
    }

    /// <summary>WavWiz output kind (Wire.OutputInfo: hdmi|spdif|bluetooth|analog|usb|other) from the card/PCM names. Pi 4/5: "vc4-hdmi" (HDMI), "bcm2835 Headphones" (jack).</summary>
    public static string KindOf(Card c, Pcm? p, bool usb)
    {
        var s = $"{c.Id} {c.Driver} {c.Name} {c.LongName} {p?.Id} {p?.Name}";
        if (usb || c.Driver.Equals("USB-Audio", StringComparison.OrdinalIgnoreCase)) return "usb";
        if (Regex.IsMatch(s, @"hdmi|displayport|\bDP\b", RegexOptions.IgnoreCase)) return "hdmi";
        if (Regex.IsMatch(s, @"s/?pdif|iec958|toslink|optical|\bdigital\b", RegexOptions.IgnoreCase)) return "spdif";
        if (Regex.IsMatch(s, @"bluez|bluetooth", RegexOptions.IgnoreCase)) return "bluetooth";
        if (Regex.IsMatch(s, @"headphone|analog|bcm2835|line out|speaker|hifiberry|dac|codec|alc\d|hda intel", RegexOptions.IgnoreCase)) return "analog";
        return "other";
    }

    /// <summary>Playback devices: "default" first (when present), then one per card/device. <paramref name="isUsb"/> = card index has a usbid file.</summary>
    public static List<AlsaDevice> Build(string cardsText, string pcmText, Func<int, bool> isUsb, bool includeDefault, IEnumerable<string>? extraNames = null)
    {
        var cards = ParseCards(cardsText); var pcms = ParsePcm(pcmText).Where(p => p.Playback).ToList();
        var res = new List<AlsaDevice>();
        if (includeDefault) res.Add(new AlsaDevice(DefaultEndpoint, "default", "System default output", "other"));
        foreach (var p in pcms)
        {
            var c = cards.FirstOrDefault(x => x.Index == p.Card); if (c == null) continue;
            bool usb = isUsb(c.Index);
            var kind = KindOf(c, p, usb);
            // Pi HDMI: card "vc4hdmi0" pcm "MAI PCM i2s-hifi-0" -> "HDMI 1"; jack: "Headphones"; USB DAC: its product name
            string nice = kind == "hdmi" && Regex.Match(c.Id + " " + c.Name, @"hdmi-?(\d)", RegexOptions.IgnoreCase) is { Success: true } hm ? "HDMI " + (int.Parse(hm.Groups[1].Value) + 1)
                        : !string.IsNullOrWhiteSpace(c.Name) ? c.Name : c.Id;
            if (pcms.Count(x => x.Card == p.Card) > 1 && !string.IsNullOrWhiteSpace(p.Name) && !nice.Contains(p.Name, StringComparison.OrdinalIgnoreCase)) nice += " - " + p.Name;
            res.Add(new AlsaDevice($"alsa:hw:{c.Id},{p.Device}", $"plughw:CARD={c.Id},DEV={p.Device}", nice, kind, c.Index, p.Device, c.Id));
        }
        foreach (var n in extraNames ?? Array.Empty<string>())
        {
            var name = n.Trim(); if (name.Length == 0 || res.Any(r => r.OpenName == name)) continue;
            res.Add(new AlsaDevice("alsa:pcm:" + name, name, "ALSA " + name, "other"));
        }
        return res;
    }
}

/// <summary>
/// 0.7.0 Linux/Pi: this machine's ALSA outputs for the in-server local player (and any future Linux Player). Polls procfs every 3 s for
/// plug/unplug (USB DACs, HDMI), like the WASAPI provider. <c>WAVWIZ_ALSA_DEVICES</c> / server.json alsaDevices adds extra PCM names from
/// ~/.asoundrc or /etc/asound.conf (e.g. a softvol or a loopback; server.json alsaDevices), also used by tests ("null", "file:...").
/// </summary>
public sealed class AlsaOutputProvider : IOutputProvider, IDisposable
{
    private readonly WavWiz.Core.Clock.IMonotonicClock _clock; private readonly string _proc; private readonly string[] _extra; private readonly bool _default;
    private readonly Timer? _poll; private string _sig = "";
    public event Action? DevicesChanged;
    public int Rate { get; init; } = 48000;
    public int LatencyUs { get; init; } = 100_000;

    public AlsaOutputProvider(WavWiz.Core.Clock.IMonotonicClock clock, string procAsound = "/proc/asound", IEnumerable<string>? extraNames = null, bool includeDefault = true, bool poll = true)
    {
        _clock = clock; _proc = procAsound; _extra = (extraNames ?? Array.Empty<string>()).ToArray(); _default = includeDefault;
        _sig = Signature();
        if (poll) _poll = new Timer(_ => { try { var s = Signature(); if (s != _sig) { _sig = s; DevicesChanged?.Invoke(); } } catch { } }, null, 3000, 3000);
    }


    private static string Read(string p) { try { return File.Exists(p) ? File.ReadAllText(p) : ""; } catch { return ""; } }

    public IReadOnlyList<AlsaDevice> Devices()
    {
        var cards = Read(Path.Combine(_proc, "cards")); var pcm = Read(Path.Combine(_proc, "pcm"));
        bool hasCards = cards.Trim().Length > 0 && !cards.Contains("no soundcards", StringComparison.OrdinalIgnoreCase);
        return AlsaDevices.Build(cards, pcm, i => File.Exists(Path.Combine(_proc, $"card{i}", "usbid")), _default && hasCards, _extra);
    }

    public IReadOnlyList<OutputInfo> List() => Devices().Select(d => new OutputInfo(d.EndpointId, d.Name, d.Kind, null, true, false, null, null, d.CardId)).ToList();

    /// <summary>Prefer the system default (PipeWire/Pulse/dmix), else the first card (Pi: the headphone jack is card 0 on Pi 4; Pi 5 has HDMI only).</summary>
    public string? DefaultEndpointId => Devices().FirstOrDefault()?.EndpointId;

    public IAudioSink Open(string endpointId, SinkRender render)
    {
        var d = Devices().FirstOrDefault(x => x.EndpointId == endpointId) ?? throw new InvalidOperationException("output not available: " + endpointId);
        return new AlsaSink(d.OpenName, render, _clock, Rate, LatencyUs);
    }

    private string Signature() => string.Join('|', Devices().Select(d => d.EndpointId));
    public void Dispose() => _poll?.Dispose();
}
