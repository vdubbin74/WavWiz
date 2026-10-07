using System.Diagnostics;
namespace WavWiz.Server.Receivers;

/// <summary>
/// 0.1.1: supervises one bundled receiver executable (wavwiz-airplay.exe, librespot.exe) as a separate child process: raw PCM on stdout,
/// text events on stderr, restarted with backoff (2 s .. 60 s) if it exits. Closing its stdin / killing it stops it.
/// </summary>
public sealed class ReceiverProcess : IDisposable
{
    private readonly string _name, _exe; private readonly Func<IEnumerable<string>> _args; private readonly Action<byte[], int> _onPcm; private readonly Action<string> _onLine;
    private readonly Action<string>? _log; private Process? _p; private CancellationTokenSource? _cts; private readonly object _l = new();
    public bool Running { get { lock (_l) return _p is { HasExited: false }; } }
    public bool Wanted { get; private set; }
    public string? LastError { get; private set; }
    public int Restarts { get; private set; }
    public DateTimeOffset? StartedAt { get; private set; }
    public Action? Exited { get; set; }

    public ReceiverProcess(string name, string exe, Func<IEnumerable<string>> args, Action<byte[], int> onPcm, Action<string> onLine, Action<string>? log)
    { _name = name; _exe = exe; _args = args; _onPcm = onPcm; _onLine = onLine; _log = log; }

    public bool Installed => File.Exists(_exe);

    public void Start()
    {
        lock (_l)
        {
            if (Wanted) return;
            Wanted = true; _cts = new CancellationTokenSource(); var ct = _cts.Token;
            if (!Installed) { LastError = $"{Path.GetFileName(_exe)} is not installed"; return; }
            KillStrays();
            _ = Task.Run(() => Supervise(ct));
        }
    }

    public void Stop()
    {
        lock (_l)
        {
            Wanted = false; _cts?.Cancel();
            try { _p?.StandardInput.Close(); } catch { }
            try { if (_p is { HasExited: false }) _p.Kill(true); } catch { }
            _p = null; StartedAt = null;
        }
    }

    /// <summary>A helper left behind by a crashed server still holds its port: end it (only processes with our exe name from our folder).</summary>
    private void KillStrays()
    {
        try
        {
            foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(_exe)))
                try { if (string.Equals(p.MainModule?.FileName, _exe, StringComparison.OrdinalIgnoreCase)) p.Kill(true); } catch { }
        }
        catch { }
    }

    private async Task Supervise(CancellationToken ct)
    {
        int attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            var started = DateTime.UtcNow;
            try
            {
                var psi = new ProcessStartInfo(_exe) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(_exe)! };
                foreach (var a in _args()) psi.ArgumentList.Add(a);
                var p = Process.Start(psi) ?? throw new InvalidOperationException("did not start");
                lock (_l) { if (ct.IsCancellationRequested) { try { p.Kill(true); } catch { } return; } _p = p; StartedAt = DateTimeOffset.Now; }
                _log?.Invoke($"{_name}: started (pid {p.Id})");
                var err = Task.Run(async () => { string? line; while ((line = await p.StandardError.ReadLineAsync()) != null) { try { _onLine(line); } catch (Exception e) { _log?.Invoke($"{_name}: event error {e.Message}"); } } });
                var buf = new byte[16384]; var so = p.StandardOutput.BaseStream; int n;
                while ((n = await so.ReadAsync(buf, ct)) > 0) _onPcm(buf, n);
                await p.WaitForExitAsync(ct); await err;
                LastError = $"exited with code {p.ExitCode}";
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { LastError = e.Message; }
            lock (_l) { _p = null; StartedAt = null; }
            if (ct.IsCancellationRequested) break;
            try { Exited?.Invoke(); } catch { }
            _log?.Invoke($"{_name}: {LastError}; restarting");
            Restarts++; attempt = DateTime.UtcNow - started > TimeSpan.FromMinutes(2) ? 0 : attempt + 1;
            try { await Task.Delay(Math.Min(60_000, 2000 << Math.Min(attempt, 5)), ct); } catch { break; }
        }
    }

    public void Dispose() => Stop();
}
