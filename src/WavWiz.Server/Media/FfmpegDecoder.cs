using System.Diagnostics;
namespace WavWiz.Server.Media;

/// <summary>
/// Decodes any file ffmpeg understands to 48 kHz stereo float32 (spec 5.1). ffmpeg runs as a child process (crash isolation); a background thread
/// fills a ring so the stream thread never blocks on a slow share. Read-only: ffmpeg only opens the file for reading. No window, no stdin.
/// </summary>
public sealed class FfmpegDecoder : IPcmDecoder, IReaderDone
{
    private readonly Process _p; private readonly PcmRing _ring = new(48000 * 8); private readonly Thread _t;
    private readonly CancellationTokenSource _cts = new();
    private volatile bool _eof; private long _lastDataTicks = Environment.TickCount64; private string _stderr = "";
    public string? Error { get; private set; }
    public string Path { get; }

    public FfmpegDecoder(string ffmpeg, string path, long startMs = 0, int stallSeconds = 20)
    {
        Path = path;
        var psi = new ProcessStartInfo(ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in new[] { "-nostdin", "-hide_banner", "-loglevel", "error" }) psi.ArgumentList.Add(a);
        if (startMs > 0) { psi.ArgumentList.Add("-ss"); psi.ArgumentList.Add((startMs / 1000.0).ToString("F3", System.Globalization.CultureInfo.InvariantCulture)); }
        foreach (var a in new[] { "-i", path, "-vn", "-sn", "-dn", "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1" }) psi.ArgumentList.Add(a);
        try { _p = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg did not start"); }
        catch (Exception e) { Error = "cannot start ffmpeg: " + e.Message; _eof = true; _p = null!; _t = null!; return; }
        _p.StandardInput.Close();
        _p.ErrorDataReceived += (_, e) => { if (e.Data != null && _stderr.Length < 2000) _stderr += e.Data + "\n"; };
        _p.BeginErrorReadLine();
        _t = new Thread(() => Pump(stallSeconds)) { IsBackground = true, Name = "ffmpeg-reader" };
        _t.Start();
    }

    private void Pump(int stallSeconds)
    {
        var s = _p.StandardOutput.BaseStream; var bytes = new byte[48000 * 8 / 4]; int have = 0; var floats = new float[bytes.Length / 4];
        try
        {
            var readTask = (Task<int>?)null;
            while (!_cts.IsCancellationRequested)
            {
                readTask ??= s.ReadAsync(bytes.AsMemory(have, bytes.Length - have), _cts.Token).AsTask();
                if (!readTask.Wait(1000)) { if (Environment.TickCount64 - _lastDataTicks > stallSeconds * 1000L) { Error = "decoder stalled (no data for " + stallSeconds + " s)"; try { _p.Kill(true); } catch { } break; } continue; }
                int n = readTask.Result; readTask = null;
                if (n <= 0) break;
                _lastDataTicks = Environment.TickCount64;
                have += n; int whole = have / 8 * 8;    // whole stereo frames (2 ch * 4 bytes)
                if (whole > 0)
                {
                    Buffer.BlockCopy(bytes, 0, floats, 0, whole);
                    if (!_ring.Write(floats.AsSpan(0, whole / 4), _cts.Token)) break;
                    Buffer.BlockCopy(bytes, whole, bytes, 0, have - whole); have -= whole;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Error ??= e.Message; }
        try { if (!_p.HasExited && !_cts.IsCancellationRequested) _p.WaitForExit(2000); } catch { }
        if (Error == null && _p.HasExited && _p.ExitCode != 0 && _ring.Count == 0 && _stderr.Length > 0) Error = _stderr.Trim();
        _eof = true;
    }

    public int Read(Span<float> dst, int frames) => _ring.Read(dst, frames);
    public bool Finished => _eof && _ring.Count == 0;
    public int Buffered => _ring.Count;
    public bool ReaderDone => _eof;

    public void Dispose()
    {
        _cts.Cancel();
        try { if (_p != null && !_p.HasExited) _p.Kill(true); } catch { }
        try { _t?.Join(1000); } catch { }
        try { _p?.Dispose(); } catch { }
    }
}
