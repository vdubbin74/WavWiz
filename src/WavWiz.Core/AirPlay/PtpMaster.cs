using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// Minimal IEEE 1588 / 802.1AS grandmaster for AirPlay 2 timing, written from the public standard's message layouts:
/// unicast Announce (1 s) on port 320, two-step Sync (port 319) + Follow_Up (port 320) every 125 ms, and Delay_Resp
/// for any Delay_Req a follower sends. PTP time = a monotonic nanosecond clock anchored to Unix time at start, so
/// every AirPlay 2 speaker in a session shares WavWiz's timeline. Ports 319/320 must be bindable (Windows: always;
/// Linux: root or ip_unprivileged_port_start).
/// </summary>
public sealed class PtpMaster : IDisposable
{
    public ulong ClockId { get; }
    readonly UdpClient? _ev, _gen; readonly long _epochNs; readonly Stopwatch _sw = Stopwatch.StartNew();
    readonly List<IPAddress> _peers = new(); readonly object _lk = new();
    readonly CancellationTokenSource _cts = new(); Task? _tx, _rx;
    ushort _syncSeq, _annSeq;
    public long SyncsSent, DelayReqs;

    public PtpMaster(IPAddress local, ulong? clockId = null)
    {
        ClockId = clockId ?? (0x5757000000000000UL | (ulong)Random.Shared.NextInt64(0, 1L << 40));
        _ev = new UdpClient(new IPEndPoint(local, 319)); _gen = new UdpClient(new IPEndPoint(local, 320));
        _epochNs = (DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks) * 100;
    }

    /// <summary>Message builder only (no sockets): for tests and packet inspection.</summary>
    public PtpMaster(ulong clockId) { ClockId = clockId; _epochNs = (DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks) * 100; }

    /// <summary>Current PTP time in nanoseconds.</summary>
    public ulong NowNs => (ulong)(_epochNs + (long)(_sw.ElapsedTicks * (1e9 / Stopwatch.Frequency)));

    public void AddPeer(IPAddress ip) { lock (_lk) if (!_peers.Contains(ip)) _peers.Add(ip); }
    public void RemovePeer(IPAddress ip) { lock (_lk) _peers.Remove(ip); }
    IPAddress[] Peers() { lock (_lk) return _peers.ToArray(); }

    public void Start() { if (_ev == null) throw new InvalidOperationException("builder-only PtpMaster"); _tx = Task.Run(() => TxLoop(_cts.Token)); _rx = Task.Run(() => RxLoop(_cts.Token)); }

    async Task TxLoop(CancellationToken ct)
    {
        int tick = 0;
        while (!ct.IsCancellationRequested)
        {
            foreach (var p in Peers())
            {
                try
                {
                    if (tick % 8 == 0) await _gen!.SendAsync(Announce(_annSeq), new IPEndPoint(p, 320), ct);
                    ulong t = NowNs;
                    await _ev!.SendAsync(Sync(_syncSeq), new IPEndPoint(p, 319), ct);
                    await _gen!.SendAsync(FollowUp(_syncSeq, t), new IPEndPoint(p, 320), ct);
                    Interlocked.Increment(ref SyncsSent);
                }
                catch (SocketException) { }
            }
            if (tick % 8 == 0) _annSeq++;
            _syncSeq++; tick++;
            try { await Task.Delay(125, ct); } catch (OperationCanceledException) { }
        }
    }

    async Task RxLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await _ev!.ReceiveAsync(ct); } catch { return; }
            ulong t = NowNs;
            var b = r.Buffer;
            if (b.Length >= 44 && (b[0] & 0xF) == 1) // Delay_Req
            {
                Interlocked.Increment(ref DelayReqs);
                try { await _gen!.SendAsync(DelayResp(b, t), new IPEndPoint(r.RemoteEndPoint.Address, 320), ct); } catch (SocketException) { }
            }
        }
    }

    // ---- message builders (IEEE 1588-2008 common header: 34 bytes) ----
    byte[] Header(int type, int len, ushort seq, byte control, sbyte logInterval, ushort flags)
    {
        var b = new byte[len];
        b[0] = (byte)(0x10 | type); b[1] = 2; BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(2), (ushort)len);
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(6), flags);
        BinaryPrimitives.WriteUInt64BigEndian(b.AsSpan(20), ClockId);
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(28), 1);
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(30), seq);
        b[32] = control; b[33] = (byte)logInterval; return b;
    }
    public static void Timestamp(Span<byte> d, ulong ns)
    {
        ulong sec = ns / 1_000_000_000; uint nano = (uint)(ns % 1_000_000_000);
        BinaryPrimitives.WriteUInt16BigEndian(d, (ushort)(sec >> 32));
        BinaryPrimitives.WriteUInt32BigEndian(d[2..], (uint)sec);
        BinaryPrimitives.WriteUInt32BigEndian(d[6..], nano);
    }
    public static ulong ReadTimestamp(ReadOnlySpan<byte> d) =>
        (((ulong)BinaryPrimitives.ReadUInt16BigEndian(d) << 32) | BinaryPrimitives.ReadUInt32BigEndian(d[2..])) * 1_000_000_000 + BinaryPrimitives.ReadUInt32BigEndian(d[6..]);

    public byte[] Sync(ushort seq) => Header(0x0, 44, seq, 0, -3, 0x0208); // twoStep | ptpTimescale
    public byte[] FollowUp(ushort seq, ulong ns)
    {
        var b = Header(0x8, 76, seq, 2, -3, 0x0008);
        Timestamp(b.AsSpan(34), ns);
        // 802.1AS Follow_Up information TLV: organization extension, 00-80-C2 / 00-00-01, all-zero rate/phase fields.
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(44), 0x0003); BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(46), 28);
        b[48] = 0x00; b[49] = 0x80; b[50] = 0xC2; b[53] = 1;
        return b;
    }
    public byte[] Announce(ushort seq)
    {
        var b = Header(0xB, 76, seq, 5, 0, 0x0008);
        BinaryPrimitives.WriteInt16BigEndian(b.AsSpan(44), 37); // currentUtcOffset
        b[47] = 248;                                            // grandmasterPriority1 (as a typical sender)
        b[48] = 248; b[49] = 0xFE; BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(50), 0xFFFF); // class, accuracy unknown, variance
        b[52] = 248;                                            // grandmasterPriority2
        BinaryPrimitives.WriteUInt64BigEndian(b.AsSpan(53), ClockId);
        b[63] = 0xA0;                                           // timeSource = internal oscillator
        BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(64), 0x0008); BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(66), 8); // path trace
        BinaryPrimitives.WriteUInt64BigEndian(b.AsSpan(68), ClockId);
        return b;
    }
    public byte[] DelayResp(byte[] req, ulong rxNs)
    {
        ushort seq = BinaryPrimitives.ReadUInt16BigEndian(req.AsSpan(30));
        var b = Header(0x9, 54, seq, 3, -3, 0x0008);
        Array.Copy(req, 8, b, 8, 8); // echo correctionField
        Timestamp(b.AsSpan(34), rxNs);
        Array.Copy(req, 20, b, 44, 10); // requestingPortIdentity
        return b;
    }

    public void Dispose() { _cts.Cancel(); try { Task.WaitAll(new[] { _tx, _rx }.Where(t => t != null).ToArray()!, 1000); } catch { } _ev?.Dispose(); _gen?.Dispose(); }
}
