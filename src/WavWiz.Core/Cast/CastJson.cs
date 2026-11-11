using System.Text.Json;
using System.Text.Json.Nodes;
namespace WavWiz.Core.Cast;

/// <summary>JSON payloads for the connection / heartbeat / receiver / media namespaces (developers.google.com/cast/docs/media/messages). Pure.</summary>
public static class CastJson
{
    public static string Connect() => """{"type":"CONNECT","origin":{},"userAgent":"WavWiz"}""";
    public static string Close() => """{"type":"CLOSE"}""";
    public static string Ping() => """{"type":"PING"}""";
    public static string Pong() => """{"type":"PONG"}""";
    public static string GetStatus(int rid) => Obj(rid, "GET_STATUS").ToJsonString();
    public static string Launch(int rid, string appId) { var o = Obj(rid, "LAUNCH"); o["appId"] = appId; return o.ToJsonString(); }
    public static string StopApp(int rid, string sessionId) { var o = Obj(rid, "STOP"); o["sessionId"] = sessionId; return o.ToJsonString(); }
    /// <summary>Device (system) volume, 0..1. Not the stream volume: Google says stream volume must not be used for the volume slider.</summary>
    public static string SetVolume(int rid, double level) { var o = Obj(rid, "SET_VOLUME"); o["volume"] = new JsonObject { ["level"] = Math.Round(Math.Clamp(level, 0, 1), 3) }; return o.ToJsonString(); }
    public static string SetMuted(int rid, bool muted) { var o = Obj(rid, "SET_VOLUME"); o["volume"] = new JsonObject { ["muted"] = muted }; return o.ToJsonString(); }
    public static string MediaCmd(int rid, string type, long mediaSessionId) { var o = Obj(rid, type); o["mediaSessionId"] = mediaSessionId; return o.ToJsonString(); }

    /// <summary>LOAD a LIVE stream into the Default Media Receiver with MusicTrackMediaMetadata (metadataType 3).</summary>
    public static string Load(int rid, string url, string contentType, string? title, string? artist, string? album, string? imageUrl)
    {
        var md = new JsonObject { ["metadataType"] = 3 };
        if (!string.IsNullOrEmpty(title)) md["title"] = title;
        if (!string.IsNullOrEmpty(artist)) md["artist"] = artist;
        if (!string.IsNullOrEmpty(album)) md["albumName"] = album;
        if (!string.IsNullOrEmpty(imageUrl)) md["images"] = new JsonArray(new JsonObject { ["url"] = imageUrl });
        var o = Obj(rid, "LOAD");
        o["media"] = new JsonObject { ["contentId"] = url, ["contentType"] = contentType, ["streamType"] = "LIVE", ["metadata"] = md };
        o["autoplay"] = true;
        return o.ToJsonString();
    }

    static JsonObject Obj(int rid, string type) => new() { ["type"] = type, ["requestId"] = rid };

    public static string? TypeOf(string? json) { try { return json == null ? null : JsonNode.Parse(json)?["type"]?.GetValue<string>(); } catch (JsonException) { return null; } }
    public static int RequestIdOf(string? json) { try { var n = json == null ? null : JsonNode.Parse(json)?["requestId"]; return n == null ? 0 : n.GetValue<int>(); } catch (Exception) { return 0; } }

    /// <summary>RECEIVER_STATUS -> the running app (if any), and the device volume.</summary>
    public sealed record ReceiverStatus(string? AppId, string? SessionId, string? TransportId, string? DisplayName, double? Level, bool? Muted);
    public static ReceiverStatus? ParseReceiverStatus(string json)
    {
        try
        {
            var st = JsonNode.Parse(json)?["status"]; if (st == null) return null;
            var app = st["applications"]?.AsArray().FirstOrDefault();
            var vol = st["volume"];
            return new ReceiverStatus(app?["appId"]?.GetValue<string>(), app?["sessionId"]?.GetValue<string>(), app?["transportId"]?.GetValue<string>(), app?["displayName"]?.GetValue<string>(),
                vol?["level"]?.GetValue<double>(), vol?["muted"]?.GetValue<bool>());
        }
        catch (Exception) { return null; }
    }

    /// <summary>MEDIA_STATUS -> (mediaSessionId, playerState, idleReason) of the first entry.</summary>
    public sealed record MediaStatus(long MediaSessionId, string PlayerState, string? IdleReason);
    public static MediaStatus? ParseMediaStatus(string json)
    {
        try
        {
            var s = JsonNode.Parse(json)?["status"]?.AsArray().FirstOrDefault(); if (s == null) return null;
            return new MediaStatus(s["mediaSessionId"]?.GetValue<long>() ?? 0, s["playerState"]?.GetValue<string>() ?? "IDLE", s["idleReason"]?.GetValue<string>());
        }
        catch (Exception) { return null; }
    }
}
