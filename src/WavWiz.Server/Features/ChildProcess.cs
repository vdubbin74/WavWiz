using System.Diagnostics;
using System.Text;
namespace WavWiz.Server.Features;

/// <summary>Starts a child process, always drains stdout/stderr (avoids the classic pipe-buffer deadlock),
/// and can cancel, stall-timeout, or total-timeout the run.</summary>
public static class ChildProcess
{
    public sealed record Result(int ExitCode, string Stdout, string Stderr, bool TimedOut, bool Cancelled, bool Stalled);

    public static Task<Result> RunAsync(
        string file, string arguments, CancellationToken ct,
        TimeSpan? totalTimeout = null, TimeSpan? stallTimeout = null,
        Action<string>? onStderrLine = null, Action? onActivity = null,
        Encoding? encoding = null, Action<Process>? onStarted = null)
    {
        var psi = new ProcessStartInfo(file, arguments)
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        return RunAsync(psi, ct, totalTimeout, stallTimeout, onStderrLine, onActivity, encoding, onStarted);
    }

    /// <summary>Same as the string-arguments overload, but uses ArgumentList so paths like E:\ are not corrupted by quotes.</summary>
    public static Task<Result> RunAsync(
        string file, IEnumerable<string> arguments, CancellationToken ct,
        TimeSpan? totalTimeout = null, TimeSpan? stallTimeout = null,
        Action<string>? onStderrLine = null, Action? onActivity = null,
        Encoding? encoding = null, Action<Process>? onStarted = null)
    {
        var psi = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        foreach (var a in arguments) psi.ArgumentList.Add(a);
        return RunAsync(psi, ct, totalTimeout, stallTimeout, onStderrLine, onActivity, encoding, onStarted);
    }

    static async Task<Result> RunAsync(
        ProcessStartInfo psi, CancellationToken ct,
        TimeSpan? totalTimeout, TimeSpan? stallTimeout,
        Action<string>? onStderrLine, Action? onActivity,
        Encoding? encoding, Action<Process>? onStarted)
    {
        if (encoding != null) { psi.StandardOutputEncoding = encoding; psi.StandardErrorEncoding = encoding; }
        var stdout = new StringBuilder(); var stderr = new StringBuilder();
        var gate = new object();
        var last = DateTime.UtcNow;
        // StringBuilder is not thread-safe. OutputDataReceived / ErrorDataReceived run on
        // thread-pool threads, and ToString() used to race with AppendLine at exit, throwing
        // ArgumentOutOfRangeException (parameter 'chunkLength') and failing the rip after a
        // successful track read.
        void Activity(string? line, StringBuilder buf)
        {
            lock (gate)
            {
                last = DateTime.UtcNow;
                if (line != null) buf.AppendLine(line);
            }
            try { onActivity?.Invoke(); } catch { /* activity is advisory */ }
        }
        string Snap(StringBuilder buf) { lock (gate) return buf.ToString(); }

        using var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        p.OutputDataReceived += (_, e) => { if (e.Data != null) Activity(e.Data, stdout); };
        p.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null)
            {
                Activity(e.Data, stderr);
                try { onStderrLine?.Invoke(e.Data); } catch { /* progress must not fail the run */ }
            }
            else Activity(null, stderr);
        };
        p.Exited += (_, _) => { try { tcs.TrySetResult(p.ExitCode); } catch { tcs.TrySetResult(-1); } };

        try { if (!p.Start()) return new Result(-1, "", "did not start", false, false, false); }
        catch (Exception ex) { return new Result(-1, "", ex.Message, false, false, false); }
        try { onStarted?.Invoke(p); } catch { /* tracker must never break the run */ }
        p.BeginOutputReadLine(); p.BeginErrorReadLine();

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (totalTimeout is TimeSpan tot && tot > TimeSpan.Zero) linked.CancelAfter(tot);

        var stall = stallTimeout ?? TimeSpan.Zero;
        try
        {
            while (true)
            {
                if (tcs.Task.IsCompleted) break;
                if (linked.IsCancellationRequested) break;
                DateTime lastCopy;
                lock (gate) lastCopy = last;
                if (stall > TimeSpan.Zero && DateTime.UtcNow - lastCopy > stall)
                {
                    TryKill(p);
                    await SafeWait(p);
                    return new Result(-1, Snap(stdout), Snap(stderr), false, false, true);
                }
                var slice = stall > TimeSpan.Zero ? TimeSpan.FromMilliseconds(Math.Min(500, stall.TotalMilliseconds / 2)) : TimeSpan.FromMilliseconds(200);
                var done = await Task.WhenAny(tcs.Task, Task.Delay(slice, CancellationToken.None));
                if (done == tcs.Task) break;
            }
        }
        catch (OperationCanceledException) { /* below */ }

        if (!tcs.Task.IsCompleted)
        {
            TryKill(p); await SafeWait(p);
            bool cancelled = ct.IsCancellationRequested;
            return new Result(-1, Snap(stdout), Snap(stderr), !cancelled, cancelled, false);
        }
        // Exited can fire before redirected stdout/stderr have been fully read. WaitForExitAsync
        // drains those pipes; then we snapshot under the same lock as AppendLine.
        await SafeWait(p);
        return new Result(tcs.Task.Result, Snap(stdout), Snap(stderr), false, false, false);
    }

    public static void TryKill(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); } catch { }
    }

    static async Task SafeWait(Process p)
    {
        try { await p.WaitForExitAsync(); } catch { }
    }
}
