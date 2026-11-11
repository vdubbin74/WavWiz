using System.Runtime.InteropServices;
namespace WavWiz.PlayerCore.Linux;

/// <summary>
/// 0.7.0 Linux/Pi local output: the few alsa-lib (libasound.so.2, LGPL-2.1, dynamically linked from the OS) PCM calls WavWiz needs.
/// Signatures from the alsa-lib reference (https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m.html):
///   int snd_pcm_open(snd_pcm_t **pcm, const char *name, snd_pcm_stream_t stream, int mode)
///   int snd_pcm_set_params(snd_pcm_t*, snd_pcm_format_t, snd_pcm_access_t, unsigned channels, unsigned rate, int soft_resample, unsigned latency_us)
///   int snd_pcm_get_params(snd_pcm_t*, snd_pcm_uframes_t *buffer_size, snd_pcm_uframes_t *period_size)
///   snd_pcm_sframes_t snd_pcm_writei(snd_pcm_t*, const void *buffer, snd_pcm_uframes_t size)
///   int snd_pcm_delay(snd_pcm_t*, snd_pcm_sframes_t *delayp)            (write-to-DAC latency in frames)
///   int snd_pcm_recover(snd_pcm_t*, int err, int silent)                (handles -EINTR, -EPIPE underrun, -ESTRPIPE suspend)
///   snd_pcm_state_t snd_pcm_state(snd_pcm_t*);  int snd_pcm_drop(snd_pcm_t*);  int snd_pcm_close(snd_pcm_t*);  const char *snd_strerror(int)
/// snd_pcm_sframes_t / snd_pcm_uframes_t are C long / unsigned long = nint / nuint on 64-bit Linux (the only Linux targets: x64, arm64).
/// </summary>
internal static partial class AlsaNative
{
    public const string Lib = "libasound.so.2";
    public const int StreamPlayback = 0;              // SND_PCM_STREAM_PLAYBACK
    public const int AccessRwInterleaved = 3;         // SND_PCM_ACCESS_RW_INTERLEAVED
    public const int FormatS16Le = 2, FormatS32Le = 10, FormatFloatLe = 14;   // SND_PCM_FORMAT_*
    public const int StatePrepared = 2, StateRunning = 3, StateXrun = 4, StateSuspended = 7, StateDisconnected = 8;
    public const int ENODEV = 19, EPIPE = 32, ESTRPIPE = 86, EBADFD = 77, EAGAIN = 11, EBUSY = 16, ENOENT = 2;

    [DllImport(Lib)] public static extern int snd_pcm_open(out IntPtr pcm, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int stream, int mode);
    [DllImport(Lib)] public static extern int snd_pcm_set_params(IntPtr pcm, int format, int access, uint channels, uint rate, int softResample, uint latencyUs);
    [DllImport(Lib)] public static extern int snd_pcm_get_params(IntPtr pcm, out nuint bufferSize, out nuint periodSize);
    [DllImport(Lib)] public static extern unsafe nint snd_pcm_writei(IntPtr pcm, void* buffer, nuint frames);
    [DllImport(Lib)] public static extern int snd_pcm_delay(IntPtr pcm, out nint delay);
    [DllImport(Lib)] public static extern int snd_pcm_recover(IntPtr pcm, int err, int silent);
    [DllImport(Lib)] public static extern int snd_pcm_state(IntPtr pcm);
    [DllImport(Lib)] public static extern int snd_pcm_drop(IntPtr pcm);
    [DllImport(Lib)] public static extern int snd_pcm_close(IntPtr pcm);
    [DllImport(Lib)] private static extern IntPtr snd_strerror(int err);

    public static string Error(int err) { try { return Marshal.PtrToStringUTF8(snd_strerror(err)) ?? ("error " + err); } catch { return "error " + err; } }

    private static int _avail = -1;
    /// <summary>True when libasound.so.2 can be loaded (Linux with alsa-lib installed: libasound2 / libasound2t64).</summary>
    public static bool Available
    {
        get
        {
            if (_avail >= 0) return _avail == 1;
            bool ok = OperatingSystem.IsLinux() && NativeLibrary.TryLoad(Lib, out var h) && h != IntPtr.Zero;
            _avail = ok ? 1 : 0; return ok;
        }
    }
}
