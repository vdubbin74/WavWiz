using System.Net;
using System.Text.Json;
namespace WavWiz.Core.Discovery;

/// <summary>What a WavWiz server tells a player that asks "who is a WavWiz server?". No secrets: only what a LAN neighbor could see anyway.</summary>
public sealed record ServerBeacon(string Id, string Name, string Host, int HttpPort, int HttpsPort, int AudioPort, string Version)
{
    public const string Probe = "UNISON?1";
    private static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    public byte[] ToUdp() => System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { app = "unison", v = 1, id = Id, name = Name, host = Host, httpPort = HttpPort, httpsPort = HttpsPort, audioPort = AudioPort, version = Version }, J));

    public static ServerBeacon? FromUdp(ReadOnlySpan<byte> data, IPAddress? sender = null)
    {
        try
        {
            using var d = JsonDocument.Parse(data.ToArray()); var r = d.RootElement;
            if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("app", out var a) || a.GetString() != "unison") return null;
            string host = r.TryGetProperty("host", out var h) && h.GetString() is { Length: > 0 } hs && IPAddress.TryParse(hs, out var hip) && !IPAddress.IsLoopback(hip) && !hip.Equals(IPAddress.Any) ? hs : sender?.ToString() ?? "";
            if (host.Length == 0) return null;
            int Int(string n, int def) => r.TryGetProperty(n, out var v) && v.TryGetInt32(out var i) && i is > 0 and < 65536 ? i : def;
            return new ServerBeacon(r.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "", r.TryGetProperty("name", out var nm) ? nm.GetString() ?? host : host, host,
                Int("httpPort", WavWizInfo.DefaultHttpPort), Int("httpsPort", WavWizInfo.DefaultHttpsPort), Int("audioPort", WavWizInfo.DefaultAudioPort), r.TryGetProperty("version", out var ver) ? ver.GetString() ?? "" : "");
        }
        catch { return null; }
    }

    /// <summary>mDNS answer for "_unison._tcp.local": PTR + SRV + TXT + A (RFC 6763).</summary>
    public List<DnsWire.Record> ToMdns(IPAddress ip)
    {
        var svc = WavWizInfo.MdnsService + ".local"; var safe = new string(Name.Where(c => c is not ('.' or '\0')).ToArray()); if (safe.Length == 0) safe = "WavWiz"; if (safe.Length > 40) safe = safe[..40];
        var inst = safe + "." + svc; var host = (new string(Host.Where(char.IsLetterOrDigit).ToArray()) is { Length: > 0 } hh ? hh : "unison") + ".local";
        return new()
        {
            DnsWire.Ptr(svc, inst), DnsWire.Srv(inst, host, HttpPort), DnsWire.Txt(inst, new[] { "id=" + Id, "name=" + Name, "v=" + Version, "http=" + HttpPort, "https=" + HttpsPort, "audio=" + AudioPort }), DnsWire.A(host, ip),
        };
    }

    public static ServerBeacon? FromMdns(DnsWire.Message m)
    {
        var svc = WavWizInfo.MdnsService + ".local";
        foreach (var ptr in m.Records.Where(r => r.Type == DnsWire.TypePtr && string.Equals(r.Name, svc, StringComparison.OrdinalIgnoreCase)))
        {
            var inst = DnsWire.NameOf(ptr.Data);
            var srv = m.Records.FirstOrDefault(r => r.Type == DnsWire.TypeSrv && string.Equals(r.Name, inst, StringComparison.OrdinalIgnoreCase)); if (srv == null) continue;
            var txt = m.Records.FirstOrDefault(r => r.Type == DnsWire.TypeTxt && string.Equals(r.Name, inst, StringComparison.OrdinalIgnoreCase));
            var (port, target) = DnsWire.SrvOf(srv.Data);
            var a = m.Records.FirstOrDefault(r => r.Type == DnsWire.TypeA && string.Equals(r.Name, target, StringComparison.OrdinalIgnoreCase) && r.Data.Length == 4); if (a == null) continue;
            var kv = txt != null ? DnsWire.TxtOf(txt.Data) : new();
            int I(string k, int d) => kv.TryGetValue(k, out var s) && int.TryParse(s, out var i) && i is > 0 and < 65536 ? i : d;
            var ip = new IPAddress(a.Data);
            return new ServerBeacon(kv.GetValueOrDefault("id", ""), kv.GetValueOrDefault("name", inst.Split('.')[0]), ip.ToString(), port, I("https", WavWizInfo.DefaultHttpsPort), I("audio", WavWizInfo.DefaultAudioPort), kv.GetValueOrDefault("v", ""));
        }
        return null;
    }
}
