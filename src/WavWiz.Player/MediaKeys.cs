using System.Runtime.InteropServices;
namespace WavWiz.Player;

/// <summary>0.3.8 L45: global media keys (play/pause, next, previous, mute, volume up/down) while the Player runs, even with the window minimized or in the tray.
/// Uses RegisterHotKey with NO modifiers on exactly those virtual keys (no keyboard hook, nothing else is captured). If another app already owns a key, that key is skipped
/// (logged by the caller). The keys are forwarded to the web page (WebView2 stays alive when minimized), which runs the same actions as the on-screen buttons.</summary>
internal sealed class MediaKeys : NativeWindow, IDisposable
{
    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr h, int id);
    private const int WM_HOTKEY = 0x0312;
    private static readonly (int Id, uint Vk, string Key)[] Keys =
    {
        (1, 0xB3, "playpause"), (2, 0xB0, "next"), (3, 0xB1, "prev"), (4, 0xAD, "mute"), (5, 0xAE, "voldown"), (6, 0xAF, "volup"),
    };
    public event Action<string>? Pressed;
    public readonly List<string> Failed = new();
    public MediaKeys()
    {
        CreateHandle(new CreateParams());
        foreach (var k in Keys) if (!RegisterHotKey(Handle, k.Id, 0, k.Vk)) Failed.Add(k.Key);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY) { var id = m.WParam.ToInt32(); foreach (var k in Keys) if (k.Id == id) { Pressed?.Invoke(k.Key); break; } }
        base.WndProc(ref m);
    }
    public void Dispose() { foreach (var k in Keys) { try { UnregisterHotKey(Handle, k.Id); } catch { } } try { DestroyHandle(); } catch { } }
}

/// <summary>A small themed on-screen indicator ("Volume 45%") shown for a moment at the bottom center of the screen. Colors come from the web page's theme.</summary>
internal sealed class OsdForm : Form
{
    private static OsdForm? _cur; private readonly System.Windows.Forms.Timer _t = new() { Interval = 1400 };
    private readonly Label _l = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Fill, Font = new Font("Segoe UI", 13f, FontStyle.Bold) };
    private OsdForm(string text, Color bg, Color ink, Color line)
    {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual; Size = new Size(260, 56);
        BackColor = line; Padding = new Padding(1); _l.BackColor = bg; _l.ForeColor = ink; _l.Text = text; Controls.Add(_l);
        var wa = Screen.PrimaryScreen!.WorkingArea; Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Bottom - Height - 80);
        _t.Tick += (_, _) => { _t.Stop(); Close(); }; _t.Start();
    }
    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80 | 0x20; return p; } }   // NOACTIVATE | TOOLWINDOW | TRANSPARENT (click-through)
    public static void Flash(string text, string? bg, string? ink, string? line)
    {
        Color C(string? s, Color d) { try { return string.IsNullOrEmpty(s) ? d : ColorTranslator.FromHtml(s); } catch { return d; } }
        try { _cur?.Close(); } catch { }
        _cur = new OsdForm(text, C(bg, Color.FromArgb(27, 31, 35)), C(ink, Color.White), C(line, Color.FromArgb(255, 60, 0))); _cur.FormClosed += (_, _) => _cur = null; _cur.Show();
    }
}
