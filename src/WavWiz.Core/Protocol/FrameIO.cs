
namespace WavWiz.Core.Protocol;

public static class FrameIO
{
    public static async Task<(Header H, byte[] Payload)> ReadAsync(System.IO.Stream s, CancellationToken ct)
    {
        var head = new byte[Wire.HeaderSize];
        await s.ReadExactlyAsync(head, ct);
        if (!Wire.TryReadHeader(head, out var h, out var err)) throw new InvalidDataException(err);
        var payload = new byte[h.PayloadLen];
        if (payload.Length > 0) await s.ReadExactlyAsync(payload, ct);
        return (h, payload);
    }

    public static async Task WriteAsync(System.IO.Stream s, byte[] message, CancellationToken ct)
    {
        await s.WriteAsync(message, ct);
        await s.FlushAsync(ct);
    }
}
