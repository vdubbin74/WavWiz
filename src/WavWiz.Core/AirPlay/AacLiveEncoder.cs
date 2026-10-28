using System.Diagnostics;
using System.Threading.Channels;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// Live AAC-LC encoder for AirPlay 2 buffered audio, using the ffmpeg WavWiz already bundles: 16-bit stereo 44.1 kHz
/// PCM in on stdin, ADTS out on stdout; the ADTS headers are stripped so each <see cref="Frames"/> item is one raw
/// AAC access unit of 1024 frames. ffmpeg's AAC encoder adds <see cref="PrimingFrames"/> of delay, which senders
/// remove from the RTP timeline so AAC speakers stay in step with ALAC/WavWiz outputs.
/// </summary>
public sealed class AacLiveEncoder : IAsyncDisposable
{
    public const int FramesPerPacket = 1024, PrimingFrames = 1024;
    readonly Process _p; readonly Task _reader, _err;
    readonly Channel<byte[]> _frames = Channel.CreateUnbounded<byte[]>(new() { SingleReader = true });
    public ChannelReader<byte[]> Frames => _frames.Reader;
    public long FramesOut;

    public AacLiveEncoder(string ffmpegPath, int bitrateKbps = 256)
    {
        var psi = new ProcessStartInfo(ffmpegPath)
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-probesize", "32", "-analyzeduration", "0", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "pipe:0",
                                  "-c:a", "aac", "-profile:a", "aac_low", "-b:a", $"{bitrateKbps}k", "-flush_packets", "1", "-f", "adts", "pipe:1" })
            psi.ArgumentList.Add(a);
        _p = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg did not start");
        _reader = Task.Run(ReadLoop);
        _err = Task.Run(async () => { try { await _p.StandardError.ReadToEndAsync(); } catch { } });
    }

    /// <summary>Queue interleaved stereo PCM (any length).</summary>
    public async ValueTask WriteAsync(ReadOnlyMemory<short> pcm, CancellationToken ct = default)
    {
        var b = new byte[pcm.Length * 2];
        System.Runtime.InteropServices.MemoryMarshal.AsBytes(pcm.Span).CopyTo(b);
        await _p.StandardInput.BaseStream.WriteAsync(b, ct);
        await _p.StandardInput.BaseStream.FlushAsync(ct);
    }

    async Task ReadLoop()
    {
        var s = _p.StandardOutput.BaseStream; var hdr = new byte[7];
        try
        {
            while (true)
            {
                if (!await Fill(s, hdr, 7)) break;
                if (hdr[0] != 0xFF || (hdr[1] & 0xF0) != 0xF0) throw new InvalidDataException("ADTS sync lost");
                bool crc = (hdr[1] & 1) == 0;
                int len = ((hdr[3] & 3) << 11) | (hdr[4] << 3) | (hdr[5] >> 5);
                int hl = crc ? 9 : 7;
                if (crc) { var c = new byte[2]; if (!await Fill(s, c, 2)) break; }
                var au = new byte[len - hl]; if (!await Fill(s, au, au.Length)) break;
                FramesOut++;
                await _frames.Writer.WriteAsync(au);
            }
        }
        catch (Exception e) { _frames.Writer.TryComplete(e); return; }
        _frames.Writer.TryComplete();
    }
    static async Task<bool> Fill(System.IO.Stream s, byte[] b, int n) { int g = 0; while (g < n) { int r = await s.ReadAsync(b.AsMemory(g, n - g)); if (r == 0) return false; g += r; } return true; }

    /// <summary>Wrap a raw AAC-LC 44.1 kHz stereo access unit in a 7-byte ADTS header (for decoding/inspection).</summary>
    public static byte[] Adts(ReadOnlySpan<byte> au)
    {
        int n = au.Length + 7; var b = new byte[n];
        b[0] = 0xFF; b[1] = 0xF1; b[2] = (byte)((1 << 6) | (4 << 2)); b[3] = (byte)((2 << 6) | (n >> 11));
        b[4] = (byte)(n >> 3); b[5] = (byte)(((n & 7) << 5) | 0x1F); b[6] = 0xFC; au.CopyTo(b.AsSpan(7)); return b;
    }

    public async ValueTask DisposeAsync()
    {
        try { _p.StandardInput.Close(); } catch { }
        try { await _reader.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        try { if (!_p.HasExited) _p.Kill(); } catch { }
        _p.Dispose();
    }
}
