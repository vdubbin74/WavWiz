using System.Buffers.Binary;
using System.Text.Json;
namespace WavWiz.Core.Protocol;

public enum MsgType : byte
{
    Hello = 1, Welcome = 2, Audio = 3, Epoch = 4, StopAt = 5, ZoneUpdate = 6, PlayerStatus = 7,
    CalCmd = 8, CalResult = 9, Bye = 10, Outputs = 11, DspConfig = 12,
}

public readonly record struct Header(byte Version, MsgType Type, ushort Flags, uint Seq, uint PayloadLen);

/// <summary>One 20 ms (960 sample) frame of decoded stereo audio, as scheduled by the server (spec 5.1).</summary>
public sealed record AudioFrame(long PlayAtUs, uint Epoch, int SampleCount, float[] Samples /* interleaved L,R */);

/// <summary>
/// Audio channel wire format (spec 6.1). Header = u32 magic 'UNSN' | u8 version=1 | u8 type | u16 flags | u32 seq | u32 payloadLen,
/// little-endian. AUDIO / EPOCH / STOP_AT payloads are binary (hot path); the other control messages carry UTF-8 JSON
/// (decision: easier to version and test; they are small and infrequent).
/// </summary>
public static class Wire
{
    public const uint Magic = 0x4E53_4E55; // bytes 'U','N','S','N' little-endian
    public const byte ProtocolVersion = 1;
    public const int HeaderSize = 16;
    public const uint MaxPayload = 1 << 20; // 1 MiB: refuse absurd lengths from a confused or hostile peer
    public const int SampleRate = 48000;
    public const int FrameSamples = 960;
    public const int Channels = 2;

    public static void WriteHeader(Span<byte> dst, MsgType type, uint seq, uint payloadLen, ushort flags = 0)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(dst, Magic);
        dst[4] = ProtocolVersion;
        dst[5] = (byte)type;
        BinaryPrimitives.WriteUInt16LittleEndian(dst[6..], flags);
        BinaryPrimitives.WriteUInt32LittleEndian(dst[8..], seq);
        BinaryPrimitives.WriteUInt32LittleEndian(dst[12..], payloadLen);
    }

    public static bool TryReadHeader(ReadOnlySpan<byte> src, out Header header, out string? error)
    {
        header = default; error = null;
        if (src.Length < HeaderSize) { error = "short header"; return false; }
        if (BinaryPrimitives.ReadUInt32LittleEndian(src) != Magic) { error = "bad magic (not a WavWiz peer)"; return false; }
        byte ver = src[4];
        if (ver != ProtocolVersion) { error = $"unsupported protocol version {ver}"; return false; }
        byte type = src[5];
        if (type is < 1 or > 12) { error = $"unknown message type {type}"; return false; }
        uint len = BinaryPrimitives.ReadUInt32LittleEndian(src[12..]);
        if (len > MaxPayload) { error = $"payload too large ({len})"; return false; }
        header = new Header(ver, (MsgType)type, BinaryPrimitives.ReadUInt16LittleEndian(src[6..]), BinaryPrimitives.ReadUInt32LittleEndian(src[8..]), len);
        return true;
    }

    // ---- 24-bit PCM ----
    public static void FloatToPcm24(ReadOnlySpan<float> src, Span<byte> dst)
    {
        for (int i = 0; i < src.Length; i++)
        {
            float f = src[i];
            if (f > 1f) f = 1f; else if (f < -1f) f = -1f;
            int v = (int)MathF.Round(f * 8388607f);
            dst[i * 3] = (byte)v; dst[i * 3 + 1] = (byte)(v >> 8); dst[i * 3 + 2] = (byte)(v >> 16);
        }
    }

    public static void Pcm24ToFloat(ReadOnlySpan<byte> src, Span<float> dst)
    {
        for (int i = 0; i < dst.Length; i++)
        {
            int v = src[i * 3] | (src[i * 3 + 1] << 8) | (src[i * 3 + 2] << 16);
            if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
            dst[i] = v / 8388608f;
        }
    }

    // ---- AUDIO: i64 playAtUs | u32 epoch | u16 sampleCount | pcm24 stereo ----
    public static byte[] EncodeAudio(uint seq, long playAtUs, uint epoch, ReadOnlySpan<float> interleaved)
    {
        int count = interleaved.Length / Channels;
        int payload = 8 + 4 + 2 + interleaved.Length * 3;
        var buf = new byte[HeaderSize + payload];
        WriteHeader(buf, MsgType.Audio, seq, (uint)payload);
        BinaryPrimitives.WriteInt64LittleEndian(buf.AsSpan(HeaderSize), playAtUs);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(HeaderSize + 8), epoch);
        BinaryPrimitives.WriteUInt16LittleEndian(buf.AsSpan(HeaderSize + 12), (ushort)count);
        FloatToPcm24(interleaved, buf.AsSpan(HeaderSize + 14));
        return buf;
    }

    public static bool TryDecodeAudio(ReadOnlySpan<byte> payload, out AudioFrame? frame, out string? error)
    {
        frame = null; error = null;
        if (payload.Length < 14) { error = "short AUDIO payload"; return false; }
        long playAt = BinaryPrimitives.ReadInt64LittleEndian(payload);
        uint epoch = BinaryPrimitives.ReadUInt32LittleEndian(payload[8..]);
        int count = BinaryPrimitives.ReadUInt16LittleEndian(payload[12..]);
        if (payload.Length != 14 + count * Channels * 3) { error = "AUDIO length does not match sampleCount"; return false; }
        var samples = new float[count * Channels];
        Pcm24ToFloat(payload[14..], samples);
        frame = new AudioFrame(playAt, epoch, count, samples);
        return true;
    }

    // ---- EPOCH: u32 epoch | i64 startUs ----
    public static byte[] EncodeEpoch(uint seq, uint epoch, long startUs)
    {
        var buf = new byte[HeaderSize + 12];
        WriteHeader(buf, MsgType.Epoch, seq, 12);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(HeaderSize), epoch);
        BinaryPrimitives.WriteInt64LittleEndian(buf.AsSpan(HeaderSize + 4), startUs);
        return buf;
    }

    public static bool TryDecodeEpoch(ReadOnlySpan<byte> p, out uint epoch, out long startUs)
    {
        epoch = 0; startUs = 0;
        if (p.Length != 12) return false;
        epoch = BinaryPrimitives.ReadUInt32LittleEndian(p);
        startUs = BinaryPrimitives.ReadInt64LittleEndian(p[4..]);
        return true;
    }

    // ---- STOP_AT: u32 epoch | i64 atUs ----
    public static byte[] EncodeStopAt(uint seq, uint epoch, long atUs)
    {
        var buf = new byte[HeaderSize + 12];
        WriteHeader(buf, MsgType.StopAt, seq, 12);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(HeaderSize), epoch);
        BinaryPrimitives.WriteInt64LittleEndian(buf.AsSpan(HeaderSize + 4), atUs);
        return buf;
    }

    public static bool TryDecodeStopAt(ReadOnlySpan<byte> p, out uint epoch, out long atUs)
        => TryDecodeEpoch(p, out epoch, out atUs);

    // ---- JSON control messages ----
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static byte[] EncodeJson<T>(MsgType type, uint seq, T body)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(body, Json);
        var buf = new byte[HeaderSize + json.Length];
        WriteHeader(buf, type, seq, (uint)json.Length);
        json.CopyTo(buf.AsSpan(HeaderSize));
        return buf;
    }

    public static T? DecodeJson<T>(ReadOnlySpan<byte> payload) => JsonSerializer.Deserialize<T>(payload, Json);
}

// ---- JSON message bodies (shape is the contract; fields only get added, never repurposed) ----
public sealed record Hello(string PlayerId, string? DeviceToken, string AppVersion, string[] Codecs, int MaxRate, string LinkType /* ethernet|wifi|unknown */, string Name = "", string MachineName = "");
public sealed record Welcome(string StreamId, string Codec, int SampleRate, int Channels, int BitDepth, int FrameSamples, long ServerTimeUs, int BufferMs,
    string ServerVersion, string Channel, uint ClockSessionId = 0, string ClockKey = "", int ClockPort = 47802);
public sealed record ZoneUpdate(double Volume, bool Muted, bool Enabled, string? ActiveOutputId, double LatencyMs, string LatencySource /* measured|estimated|manual|default-guess|none */,
    long? DspRevision, bool NotCalibrated = false, bool RecheckDue = false);
public sealed record PlayerStatus(double BufferMs, double ClockOffsetUs, double ClockSkewPpm, long RttUs, double SyncErrorMs, double RatioPpm, int Underruns, int HardResyncs,
    string? ActiveOutputId, double LatencyMs, string LinkType, double DspLatencyUs, double LimiterReductionDb, int ClipCount, bool Playing = false, int UnderrunEvents = 0, int Reconnects = 0, string? Note = null);
public sealed record Bye(string Reason);
/// <summary>kind = hdmi|spdif|bluetooth|analog|usb|other.</summary>
public sealed record OutputInfo(string EndpointId, string Name, string Kind, string? BtAddress, bool Connected, bool Active, double? WinLatencyMs = null, string? Codec = null, string? ContainerId = null);
/// <summary>0.2.5: Mics = this PC's capture endpoints (null from 0.2.4 and older players).</summary>
public sealed record OutputsMsg(OutputInfo[] Outputs, string? Reason = null, MicInfo[]? Mics = null);
/// <summary>0.2.5: a microphone (WASAPI capture endpoint) on a Player PC. kind = usb|analog|builtin|interface|bluetooth|other; Bluetooth mics are allowed but flagged
/// (Windows switches a Bluetooth headset to its hands-free mode, which adds its own unknown delay).</summary>
public sealed record MicInfo(string Id, string Name, string Kind, bool Bluetooth, bool Default = false);
/// <summary>Full DSP parameters or bypass for an output device (spec 11.7). Preset is the DspPreset JSON.</summary>
public sealed record DspConfig(string OutputDeviceId, long Revision, bool Bypass, System.Text.Json.JsonElement? Preset, bool Preview = false);
/// <summary>action = play-pattern: play the calibration chirp pattern on the active output at server time AtUs (saved offset 0, EQ bypassed).
/// 0.2.5 PC-mic calibration (older players ignore these actions): mic-list (answer with the mics), mic-record (record MicId from server time AtUs
/// to ToUs and send it back as mic-data parts tagged Req), mic-level (live input meter for MicId; LevelDb > 0 = on, else off; stops by itself after 60 s).</summary>
public sealed record CalCmd(string Action, string SessionId, long AtUs, double LevelDb = -20, string? Label = null, string? MicId = null, long ToUs = 0, string? Req = null, double TestVolume = -1);
// 0.3.7 L20: TestVolume (0-100, play-pattern only): the Player plays the test sound at THIS volume (its normal zone volume is restored afterwards) - the zone's own volume used to scale the test sound
// down by up to 50 dB. The server has already applied the zone's max-volume lock to it. -1 = leave the zone volume alone (older servers).
/// <summary>0.2.5 adds the PC-mic replies: Status mic-list (Mics), mic-level (PeakDb), mic-data (Req, Part of Parts, StartServerUs of the recording's first sample,
/// Rate, Pcm16 = base64 little-endian 16-bit mono), mic-error (Req, Note).</summary>
public sealed record CalResult(string SessionId, string Status, string? Note, string? Req = null, int Part = 0, int Parts = 0, long StartServerUs = 0, int Rate = 0,
    string? Pcm16 = null, MicInfo[]? Mics = null, double? PeakDb = null, string? MicId = null);
