using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using WavWiz.Core.Cast;
namespace WavWiz.Core.Tests;

/// <summary>In-process stand-in for a Cast device's CASTV2 endpoint (plain TCP, no TLS): answers the connection / heartbeat / receiver / media
/// namespaces the way the Google docs describe, records what it got, and can fetch the LOADed URL like a real receiver would. Not a real device.</summary>
public sealed class FakeCastReceiver : IAsyncDisposable
{
    readonly TcpListener _tcp = new(IPAddress.Loopback, 0); readonly CancellationTokenSource _cts = new();
    System.IO.Stream? _s; readonly SemaphoreSlim _tx = new(1, 1); readonly bool _tls;
    public IPEndPoint Ep => (IPEndPoint)_tcp.LocalEndpoint;
    public readonly List<CastMessage> Got = new();
    public string? AppId, LoadedUrl, LoadedType; public double Level = 0.3; public int Pings, Launches, Loads, Stops;
    public bool RefuseLaunch, FailLoad, FetchStream; public int FetchBytes = 48000 * 4;
    public byte[]? Fetched; public readonly TaskCompletionSource<byte[]> FetchDone = new(TaskCreationOptions.RunContinuationsAsynchronously);
    /// <param name="tls">0.7.0: also speak TLS like a real device (self-signed certificate, as Cast devices present).</param>
    public FakeCastReceiver(bool tls = false) { _tls = tls; _tcp.Start(); _ = Task.Run(Run); }

    static System.Security.Cryptography.X509Certificates.X509Certificate2 SelfSigned()
    {
        using var rsa = System.Security.Cryptography.RSA.Create(2048);
        var req = new System.Security.Cryptography.X509Certificates.CertificateRequest("CN=fake-cast-device", rsa, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pkcs1);
        using var c = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(2));
        return System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadPkcs12(c.Export(System.Security.Cryptography.X509Certificates.X509ContentType.Pfx), null);
    }

    async Task Run()
    {
        try
        {
            using var c = await _tcp.AcceptTcpClientAsync(_cts.Token); System.IO.Stream ns = c.GetStream();
            if (_tls) { var ssl = new System.Net.Security.SslStream(ns, false); await ssl.AuthenticateAsServerAsync(SelfSigned()); ns = ssl; }
            _s = ns;
            while (!_cts.IsCancellationRequested)
            {
                var m = await CastProto.ReadAsync(_s, _cts.Token); if (m == null) return;
                lock (Got) Got.Add(m);
                var j = JsonNode.Parse(m.PayloadUtf8 ?? "{}")!; var type = (string?)j["type"]; int rid = (int?)j["requestId"] ?? 0;
                switch (m.Namespace)
                {
                    case CastProto.NsHeartbeat: if (type == "PING") { Pings++; await Reply(m, CastJson.Pong()); } break;
                    case CastProto.NsReceiver:
                        if (type == "LAUNCH") { Launches++; if (RefuseLaunch) { await Reply(m, $$"""{"type":"LAUNCH_ERROR","requestId":{{rid}},"reason":"NOT_ALLOWED"}"""); break; } AppId = (string?)j["appId"]; }
                        if (type == "SET_VOLUME" && j["volume"]?["level"] is { } lv) Level = (double)lv;
                        if (type == "STOP") { Stops++; AppId = null; }
                        await Reply(m, Status(rid));
                        break;
                    case CastProto.NsMedia:
                        if (type == "LOAD")
                        {
                            Loads++; LoadedUrl = (string?)j["media"]?["contentId"]; LoadedType = (string?)j["media"]?["contentType"];
                            if (FailLoad) { await Reply(m, $$"""{"type":"LOAD_FAILED","requestId":{{rid}}}"""); break; }
                            if (FetchStream && LoadedUrl != null) _ = Task.Run(Fetch);
                            await Reply(m, $$"""{"type":"MEDIA_STATUS","requestId":{{rid}},"status":[{"mediaSessionId":1,"playerState":"BUFFERING","currentTime":0}]}""");
                        }
                        break;
                }
            }
        }
        catch (Exception) { }
    }

    async Task Fetch()
    {
        try
        {
            using var h = new HttpClient(); using var r = await h.GetAsync(LoadedUrl, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
            LoadedType = r.Content.Headers.ContentType?.MediaType ?? LoadedType;
            using var st = await r.Content.ReadAsStreamAsync(_cts.Token); var buf = new byte[FetchBytes]; int got = 0;
            while (got < buf.Length) { int n = await st.ReadAsync(buf.AsMemory(got), _cts.Token); if (n == 0) break; got += n; }
            Fetched = buf[..got]; FetchDone.TrySetResult(Fetched);
        }
        catch (Exception e) { FetchDone.TrySetException(e); }
    }

    string Status(int rid)
    {
        var apps = AppId == null ? "[]" : "[{\"appId\":\"" + AppId + "\",\"displayName\":\"Default Media Receiver\",\"sessionId\":\"sess-1\",\"transportId\":\"web-7\"}]";
        return "{\"type\":\"RECEIVER_STATUS\",\"requestId\":" + rid + ",\"status\":{\"applications\":" + apps + ",\"volume\":{\"level\":" + Level.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"muted\":false}}}";
    }

    Task Reply(CastMessage to, string json) => Send(new CastMessage(to.DestinationId, to.SourceId, to.Namespace, json));
    public async Task Send(CastMessage m)
    {
        if (_s == null) return; var f = CastProto.Frame(m);
        await _tx.WaitAsync(); try { await _s.WriteAsync(f); } finally { _tx.Release(); }
    }
    /// <summary>A spontaneous MEDIA_STATUS broadcast (requestId 0) from the app.</summary>
    public Task Broadcast(string state, string? idle) => Send(new CastMessage("web-7", "*", CastProto.NsMedia,
        "{\"type\":\"MEDIA_STATUS\",\"requestId\":0,\"status\":[{\"mediaSessionId\":1,\"playerState\":\"" + state + "\"" + (idle == null ? "" : ",\"idleReason\":\"" + idle + "\"") + "}]}"));
    public void Drop() { try { _s?.Dispose(); } catch { } }
    public int Count(string ns, string type) { lock (Got) return Got.Count(m => m.Namespace == ns && (m.PayloadUtf8 ?? "").Contains($"\"type\":\"{type}\"")); }
    public ValueTask DisposeAsync() { _cts.Cancel(); try { _s?.Dispose(); } catch { } _tcp.Stop(); return ValueTask.CompletedTask; }
}
