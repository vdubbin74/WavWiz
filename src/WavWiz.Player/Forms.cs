using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using WavWiz.Core;
using WavWiz.Core.Discovery;
using WavWiz.PlayerCore;
using WavWiz.PlayerCore.Discovery;
namespace WavWiz.Player;

/// <summary>
/// Visible "connect to server" dialog (the only place a pairing code is typed; never from a hidden window).
/// 0.0.2: the player looks for the server by itself (mDNS + UDP broadcast + a quick subnet check); the person only types the 6-digit code.
/// Typing an address stays available under "My server isn't listed" - and even then only the address (no http://, no port).
/// </summary>
public sealed class ConnectForm : Form
{
    // 0.0.3: no fixed pixel sizes here. Design values are for 96 dpi; AutoScaleMode.Dpi scales them for the monitor and the UI-size setting adds its own factor (U()).
    private readonly ListBox _list = new() { IntegralHeight = false };
    private readonly TextBox _host = new() { Visible = false };
    private readonly TextBox _code = new() { MaxLength = 6 };
    private readonly Label _status = new() { AutoSize = true };
    private readonly Label _msg = new() { AutoSize = true, ForeColor = Color.Firebrick };
    private readonly double _k; private int U(int px) => (int)Math.Round(px * _k);
    private readonly LinkLabel _manual = new() { Text = "My server isn't listed - type its address", AutoSize = true };
    private readonly Button _again = new() { Text = "Search again", AutoSize = true };
    private readonly Label _hostHint = new() { Text = "Just the address, like 192.168.1.10 - no http:// and no port.", AutoSize = true, ForeColor = Color.DimGray, Visible = false };
    private readonly PlayerSettings _s; private readonly bool _serverIsHere; private readonly List<ServerBeacon> _found = new();
    private CancellationTokenSource? _cts;

    public string? Host { get; private set; }
    public ServerBeacon? Beacon { get; private set; }
    public int? ManualPort { get; private set; }
    public string? Code => string.IsNullOrWhiteSpace(_code.Text) ? null : _code.Text.Trim();

    public ConnectForm(PlayerSettings s, string? message = null, bool serverIsHere = false)
    {
        _s = s; _serverIsHere = serverIsHere; _k = UiScale.ExtraFactor(s.UiScale);
        AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
        if (_k > 1.0) Font = new Font(Font.FontFamily, (float)(Font.Size * _k));
        _list.Size = new Size(U(420), U(70)); _host.Width = U(260); _code.Width = U(140); _code.Font = new Font(Font.FontFamily, 16f * (float)_k); _status.MaximumSize = _msg.MaximumSize = new Size(U(420), 0);
        Text = $"Connect to WavWiz - {WavWizInfo.DisplayName}"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(U(14));
        try { using var st = typeof(ConnectForm).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) Icon = new Icon(st); } catch { }
        var t = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        t.Controls.Add(new Label { Text = "WavWiz servers on your network:", AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont!, FontStyle.Bold) });
        t.Controls.Add(_status); t.Controls.Add(_list); t.Controls.Add(_again); t.Controls.Add(_manual); t.Controls.Add(_hostHint); t.Controls.Add(_host);
        t.Controls.Add(new Label { Text = "Pairing code (6 digits):", AutoSize = true, Margin = new Padding(3, U(12), 3, 0) }); t.Controls.Add(_code);
        t.Controls.Add(new Label { Text = serverIsHere ? "The WavWiz server is on this PC, so no code is needed." : "On a PC or phone, open WavWiz > Settings > Players > Pair a PC to see the code.", AutoSize = true, MaximumSize = new Size(U(420), 0), ForeColor = Color.DimGray });
        t.Controls.Add(_msg);
        var ok = new Button { Text = "Connect", AutoSize = true }; var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        var fl = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Width = U(420) }; fl.Controls.Add(cancel); fl.Controls.Add(ok); t.Controls.Add(fl);
        Controls.Add(t); AcceptButton = ok; CancelButton = cancel;
        if (message != null) _msg.Text = message;
        _code.KeyPress += (_, e) => { if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar)) e.Handled = true; };
        _manual.LinkClicked += (_, _) => { _host.Visible = _hostHint.Visible = true; _host.Focus(); };
        _again.Click += async (_, _) => await SearchAsync();
        ok.Click += (_, _) => TryAccept();
        if (!string.IsNullOrWhiteSpace(s.ServerHost)) _host.Text = s.ServerHost;
        Shown += async (_, _) => { await SearchAsync(); _code.Focus(); };
        FormClosed += (_, _) => { try { _cts?.Cancel(); } catch { } };
    }

    private async Task SearchAsync()
    {
        _cts?.Cancel(); _cts = new CancellationTokenSource(); var ct = _cts.Token;
        _again.Enabled = false; _status.Text = "Looking for WavWiz on your network..."; _msg.Text = ""; _list.Items.Clear(); _found.Clear();
        try
        {
            var r = await ServerFinder.FindAsync(TimeSpan.FromSeconds(7), new ServerFinder.Options(WantedId: string.IsNullOrEmpty(_s.ServerId) ? null : _s.ServerId), ct);
            if (ct.IsCancellationRequested || IsDisposed) return;
            _found.AddRange(r);
            foreach (var b in r) _list.Items.Add($"WavWiz on {b.Name}   ({b.Host})");
            if (!string.IsNullOrWhiteSpace(_s.ServerHost) && !r.Any(b => b.Host == _s.ServerHost)) { _list.Items.Add($"Last used: {_s.ServerHost}"); _found.Add(null!); }
            if (_list.Items.Count > 0) _list.SelectedIndex = Math.Max(0, _found.FindIndex(b => b != null && b.Id == _s.ServerId));
            _status.Text = r.Count == 0 ? "No WavWiz server answered. Is the server PC on and on the same home network? Press Search again, or type its address below." : r.Count == 1 ? "Found your WavWiz server." : $"Found {r.Count} WavWiz servers. Pick yours.";
            if (r.Count == 0) { _host.Visible = _hostHint.Visible = true; }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { _status.Text = "Searching did not work (" + e.Message + "). Type the server's address below."; _host.Visible = _hostHint.Visible = true; }
        finally { if (!IsDisposed) _again.Enabled = true; }
    }

    private void TryAccept()
    {
        _msg.Text = "";
        string? host = null; ServerBeacon? beacon = null; int? port = null;
        if (_host.Visible && _host.Text.Trim().Length > 0)
        {
            host = PairingClient.NormalizeHost(_host.Text, out port);
            if (host == null) { _msg.Text = "That address does not look right. Use something like 192.168.1.10."; return; }
        }
        else if (_list.SelectedIndex >= 0)
        {
            beacon = _found[_list.SelectedIndex]; host = beacon?.Host ?? _s.ServerHost;
            if (string.IsNullOrEmpty(host)) { _msg.Text = "That server did not tell us its address. Type it below."; _host.Visible = _hostHint.Visible = true; return; }
        }
        else { _msg.Text = "Pick your WavWiz server from the list, or type its address."; return; }
        if (!_serverIsHere && (Code == null || Code.Length != 6)) { _msg.Text = "Type the 6-digit pairing code."; _code.Focus(); return; }
        Host = host; Beacon = beacon; ManualPort = port; DialogResult = DialogResult.OK; Close();
    }
}

/// <summary>The web UI inside the app (WebView2). Falls back to the default browser if the WebView2 runtime is not installed.
/// 0.0.8 ("Open player" showed a blank gray window on the server PC): the window is dark from the first frame, loads the same address as the desktop shortcut,
/// never silently cancels a navigation, and shows a readable page with "Try again" / "Open in my browser" when the page cannot load, the WebView2 engine
/// cannot start in time, or its browser/renderer process dies (all of these used to leave only the gray form background).</summary>
public sealed class WebUiForm : Form
{
    private static readonly Color Dark = Color.FromArgb(11, 13, 18);
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 13, 18) }; private readonly PlayerSettings _set; private string _url = "";
    private FormBorderStyle _prevBorder; private FormWindowState _prevState; private bool _full; private bool _loadedOnce; private int _retries;
    private readonly System.Windows.Forms.Timer _watch = new() { Interval = 20000 };

    public WebUiForm(PlayerSettings s)
    {
        _set = s; Text = WavWizInfo.DisplayName; StartPosition = FormStartPosition.Manual; BackColor = Dark;
        AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
        try { using var st = typeof(WebUiForm).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) Icon = new Icon(st); } catch { }
        Controls.Add(_web);
        // size = a 1280x820 (96 dpi) design scaled for THIS monitor, never larger than its work area (a 4K TV at 250 % is only 1536x864 CSS pixels)
        Load += async (_, _) => { FitToScreen(); await InitAsync(); };
        DpiChanged += (_, _) => { ApplyZoom(); SyncWebView(); };
        // 0.3.2 F14: snapped / maximized / restored / moved across monitors -> re-lay out the WebView2 so it never goes black
        Resize += (_, _) => SyncWebView(); Move += (_, _) => SyncWebView(); ResizeEnd += (_, _) => SyncWebView();
        _watch.Tick += (_, _) => { _watch.Stop(); if (!_loadedOnce) ShowProblem("WavWiz did not answer in time.", "The window waited 20 seconds for " + _url + "."); };
        FormClosed += (_, _) => { _watch.Dispose(); };
    }

    /// <summary>The address this window loads (server PC: the desktop shortcut's address from first-run-url.txt).</summary>
    public static string UiAddress(PlayerSettings s)
    {
        string? fr = null; bool here = false;
        try { here = !string.IsNullOrWhiteSpace(s.ServerHost) && PairingClient.IsThisMachine(s.ServerHost); } catch { }
        try { var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WavWiz", "first-run-url.txt"); if (File.Exists(p)) fr = File.ReadAllText(p); } catch { }
        var u = UiUrl.Resolve(s.ServerHost, s.HttpPort, here, fr);
        return u.Length == 0 ? u : UiUrl.WithRemote(u, false);   // 0.3.2 F3: Remote mode is gone; ?remote=0 also clears a remembered 0.3.x choice in the page
    }

    public static void OpenInBrowser(string url) { try { if (url.Length > 0) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); } catch { } }

    private void FitToScreen()
    {
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea; var (w, h) = UiScale.FitWindow(1280, 820, DeviceDpi / 96.0, wa.Width, wa.Height);
        Size = new Size(w, h); Location = new Point(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2);
    }

    /// <summary>0.2.5: a screen to open once the page has loaded ("calibrate" = Calibrate speakers), as the address's #fragment.</summary>
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string? StartScreen { get; set; }
    /// <summary>0.3.2 F3: the page asked for the mini player.</summary>
    public event Action<bool>? MiniRequested;   // true = toggle (Alt+M): close the mini player when it is open
    /// <summary>0.3.5 J15: the page reports whether Jukebox is running (tray shows Start or Stop Jukebox...).</summary>
    public event Action<bool>? JukeboxState;
    /// <summary>0.3.0 §2: reload at a new address (remote mode on/off).</summary>
    public void Navigate(string url) { try { _url = url; if (_web.CoreWebView2 != null && url.Length > 0) _web.CoreWebView2.Navigate(url); } catch { } }

    internal static void ShowOsd(string json)
    {
        try { using var d = System.Text.Json.JsonDocument.Parse(json); var r = d.RootElement; string? G(string n) => r.TryGetProperty(n, out var v) ? v.GetString() : null; OsdForm.Flash(G("text") ?? "", G("bg"), G("ink"), G("line")); } catch { }
    }
    /// <summary>0.3.8 L45: a global media key arrived (the page runs the action and answers with an on-screen indicator).</summary>
    public void PostMedia(string key) { try { _web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(new { cmd = "media", key })); } catch { } }
    public void OpenScreen(string screen)
    {
        try
        {
            // 0.3.5 J15: Start / Stop Jukebox from the tray only change the page's #hash (no reload, the page asks the usual questions)
            if (_web.CoreWebView2 != null && screen.StartsWith("jukebox", StringComparison.Ordinal)) { _ = _web.CoreWebView2.ExecuteScriptAsync("location.hash='" + (screen == "jukebox-stop" ? "jukebox-stop" : "jukebox") + "'"); return; }
            if (_web.CoreWebView2 != null && _url.Length > 0) _web.CoreWebView2.Navigate(UiUrl.WithScreen(_url, screen)); else StartScreen = screen;
        }
        catch { }
    }

    /// <summary>Applies the UI-size setting to the page (WebView2 draws at the monitor scale by itself; this is the extra zoom).</summary>
    public void ApplyZoom() { try { if (_web.CoreWebView2 != null) _web.ZoomFactor = UiScale.WebZoom(_set.UiScale); } catch { } }

    /// <summary>0.3.2 F10: the first run after a version change empties the WebView2 HTTP cache (0.3.0 cached scrambled covers for 7 days).
    /// Cookies / sign-in and local storage (theme, panels) are kept.</summary>
    internal static bool VersionChanged(string folder, string version)
    {
        var marker = Path.Combine(folder, "wavwiz-cache.version");
        try { if (File.Exists(marker) && File.ReadAllText(marker).Trim() == version) return false; } catch { }
        return true;
    }
    private static async Task ClearCacheOnVersionChange(CoreWebView2 cw, string folder)
    {
        if (!VersionChanged(folder, WavWizInfo.Version)) return;
        try
        {
            await cw.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage | CoreWebView2BrowsingDataKinds.ServiceWorkers);
            Directory.CreateDirectory(folder); File.WriteAllText(Path.Combine(folder, "wavwiz-cache.version"), WavWizInfo.Version);
        }
        catch { }
    }

    private async Task InitAsync()
    {
        _url = UiAddress(_set);
        if (_url.Length == 0) { ShowProblem("No WavWiz server is set up yet.", "Right-click the tray icon and choose 'Server & pairing...'."); return; }
        _watch.Start();
        try
        {
            var folder = Path.Combine(PlayerSettings.Dir, "webview");
            var env = await CoreWebView2Environment.CreateAsync(null, folder);
            await _web.EnsureCoreWebView2Async(env);
            var cw = _web.CoreWebView2;
            cw.Settings.UserAgent = cw.Settings.UserAgent + " WavWizPlayer/" + WavWizInfo.Version;      // the server never redirects this app to https (0.0.1 bug)
            cw.Settings.IsStatusBarEnabled = false;
            cw.NewWindowRequested += (_, e) => { e.Handled = true; if (!UiUrl.IsInternal(_url, e.Uri)) OpenInBrowser(e.Uri); };
            cw.NavigationStarting += (_, e) =>
            {
                if (e.Uri.StartsWith("wavwiz-browser:", StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; OpenInBrowser(_url); return; }
                if (!UiUrl.IsInternal(_url, e.Uri, WavWizInfo.DefaultHttpsPort)) { e.Cancel = true; OpenInBrowser(e.Uri); }
            };
            cw.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess) { _loadedOnce = true; _retries = 0; _watch.Stop(); return; }
                if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;           // our own cancel / a reload
                _watch.Stop(); ShowProblem("WavWiz could not be reached.", $"{_url} answered: {e.WebErrorStatus}. Is the WavWiz server running on that PC?");
            };
            cw.ProcessFailed += (_, e) =>
            {
                // the page's renderer or the GPU process died (graphics driver reset): reload once or twice, then explain instead of leaving a gray window
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) { BeginInvoke(() => { OpenInBrowser(_url); Close(); }); return; }
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.GpuProcessExited) { BeginInvoke(SyncWebView); return; }   // 0.3.2 F14: WebView2 restarts its GPU process; re-lay out the surface
                if (_retries++ < 2) { try { BeginInvoke(() => cw.Navigate(_url)); } catch { } }
                else BeginInvoke(() => ShowProblem("The WavWiz window stopped drawing.", "The page's display process ended (" + e.ProcessFailedKind + ")."));
            };
            cw.DocumentTitleChanged += (_, _) => Text = $"{cw.DocumentTitle} - {WavWizInfo.DisplayName}";
            cw.WebMessageReceived += (_, e) => { try { var j = e.WebMessageAsJson; if (j.Contains("\"mini\"")) MiniRequested?.Invoke(j.Contains("\"toggle\"")); else if (j.Contains("\"jukebox\"")) JukeboxState?.Invoke(j.Contains("\"running\":true")); else if (j.Contains("\"osd\"")) ShowOsd(j); } catch { } };   // 0.3.2 F3: Devices > Mini player; 0.3.5 J15: Jukebox on/off for the tray
            cw.ContainsFullScreenElementChanged += (_, _) => SetFull(cw.ContainsFullScreenElement);       // visualizer full screen
            ApplyZoom();
            await ClearCacheOnVersionChange(cw, folder);
            cw.Navigate(StartScreen != null ? UiUrl.WithScreen(_url, StartScreen) : _url);
        }
        catch (Exception)
        {
            _watch.Stop(); OpenInBrowser(_url); Close();
        }
    }

    /// <summary>A plain, readable page inside the window (never a gray void) with Try again / Open in my browser.</summary>
    private void ShowProblem(string title, string detail)
    {
        if (IsDisposed) return;
        var cw = _web.CoreWebView2;
        if (cw == null) { if (MessageBox.Show(this, title + "\n\n" + detail + "\n\nOpen WavWiz in your web browser instead?", WavWizInfo.DisplayName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes) OpenInBrowser(_url); Close(); return; }
        string E(string x) => System.Net.WebUtility.HtmlEncode(x);
        var html = "<!doctype html><html><head><meta charset='utf-8'><style>body{background:#0b0d12;color:#e8eaf0;font:15px Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}"
            + "div{max-width:520px;border:1px solid #2a2f3a;padding:24px;border-radius:4px;background:#121620}a{display:inline-block;margin:14px 10px 0 0;padding:8px 14px;border:1px solid #FF3C00;color:#e8eaf0;text-decoration:none;border-radius:3px}</style></head>"
            + $"<body><div><h2>{E(title)}</h2><p>{E(detail)}</p><a href='{E(_url)}'>Try again</a><a href='wavwiz-browser:'>Open in my browser</a></div></body></html>";
        try { cw.NavigateToString(html); } catch { }
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (WebViewSync.Needs(m.Msg)) SyncWebView();
    }
    /// <summary>0.3.2 F14: bounds = the client area, then tell WebView2 its parent moved (DPI / monitor change) and repaint.</summary>
    internal void SyncWebView()
    {
        try
        {
            if (_web.IsDisposed || WindowState == FormWindowState.Minimized) return;
            if (_web.Bounds != ClientRectangle) _web.Bounds = ClientRectangle;
            NotifyParentMoved(_web);
            _web.Invalidate(); _web.Update();
        }
        catch { }
    }
    /// <summary>The WinForms control keeps its CoreWebView2Controller private; NotifyParentWindowPositionChanged lives there.</summary>
    internal static void NotifyParentMoved(WebView2 w)
    {
        try
        {
            var p = typeof(WebView2).GetProperty("CoreWebView2Controller", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
            if (p?.GetValue(w) is CoreWebView2Controller c) { c.NotifyParentWindowPositionChanged(); if (!c.IsVisible) c.IsVisible = true; }
        }
        catch { }
    }

    private void SetFull(bool on)
    {
        if (on == _full) return; _full = on;
        if (on) { _prevBorder = FormBorderStyle; _prevState = WindowState; FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Normal; WindowState = FormWindowState.Maximized; }
        else { FormBorderStyle = _prevBorder; WindowState = _prevState; }
    }
}

/// <summary>About WavWiz Player: version, credits, privacy in one line, and the license files. A plain visible dialog (no hidden windows).</summary>
/// <summary>0.3.2 F3: the mini player - a small borderless window (420x72, slim 300x48) with /mini.html. Movable by the art / empty space,
/// parks at the top of the desktop, pin = always on top, remembers where it was. It plays nothing itself (the Player's one speaker stream
/// keeps playing; opening or closing it never adds or removes a stream - F2).</summary>
public sealed class MiniPlayerForm : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 13, 18) };
    private readonly PlayerSettings _set; private readonly Action _openFull;
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    public MiniPlayerForm(PlayerSettings s, Action openFull)
    {
        _set = s; _openFull = openFull; Text = "WavWiz mini player"; FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = true; StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.Dpi; TopMost = s.MiniPinned; Opacity = MiniPlayer.ClampOpacity(s.MiniOpacity); BackColor = Color.FromArgb(11, 13, 18);
        try { using var st = typeof(MiniPlayerForm).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) Icon = new Icon(st); } catch { }
        Controls.Add(_web);
        double k = DeviceDpi / 96.0; int w = (int)Math.Round((s.MiniSlim ? MiniPlayer.SlimWidth : MiniPlayer.Width) * k), h = (int)Math.Round((s.MiniSlim ? MiniPlayer.SlimHeight : MiniPlayer.Height) * k);
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        var (x, y) = MiniPlayer.Place((wa.X, wa.Y, wa.Width, wa.Height), w, h, s.MiniX, s.MiniY, Screen.AllScreens.Select(sc => (sc.WorkingArea.X, sc.WorkingArea.Y, sc.WorkingArea.Width, sc.WorkingArea.Height)));
        Bounds = new Rectangle(x, y, w, h);
        Load += async (_, _) => await InitAsync();
        ResizeEnd += (_, _) => Remember(); Move += (_, _) => WebUiForm.NotifyParentMoved(_web);
        FormClosing += (_, _) => Remember();
    }
    private void Remember()
    {
        var wa = Screen.FromControl(this).WorkingArea; var y = MiniPlayer.SnapTop((wa.X, wa.Y, wa.Width, wa.Height), Top); if (y != Top) Top = y;
        _set.MiniX = Left; _set.MiniY = Top; _set.Save();
    }
    private async Task InitAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(PlayerSettings.Dir, "webview"));
            await _web.EnsureCoreWebView2Async(env);
            var cw = _web.CoreWebView2;
            cw.Settings.UserAgent = cw.Settings.UserAgent + " WavWizPlayer/" + WavWizInfo.Version + " WavWizMini";
            cw.Settings.AreDefaultContextMenusEnabled = false; cw.Settings.IsStatusBarEnabled = false;
            cw.WebMessageReceived += (_, e) => OnMessage(e.WebMessageAsJson);
            cw.Navigate(MiniPlayer.Url(WebUiForm.UiAddress(_set)));
        }
        catch { Close(); }
    }
    /// <summary>0.3.5 J17: the mini player's right-click menu. Transparency presets apply at once (real window transparency: Form.Opacity on the
    /// whole layered window) and are saved; the page is told so its own slider and Settings stay in step.</summary>
    private void ShowMenu()
    {
        var m = new ContextMenuStrip();
        var tr = new ToolStripMenuItem("Transparency");
        foreach (var pct in new[] { 100, 90, 80, 70, 60, 50, 40, 30 })
        {
            var it = new ToolStripMenuItem(pct == 100 ? "100 % (solid)" : $"{pct} %") { Checked = Math.Abs(_set.MiniOpacity - pct / 100.0) < 0.026 };
            it.Click += (_, _) => { var v = MiniPlayer.ClampOpacity(pct / 100.0); Opacity = v; _set.MiniOpacity = v; _set.Save(); Post(new { cmd = "opacity", value = v }); };
            tr.DropDownItems.Add(it);
        }
        m.Items.Add(tr);
        var top = new ToolStripMenuItem("Keep on top") { Checked = TopMost };
        top.Click += (_, _) => { TopMost = !TopMost; _set.MiniPinned = TopMost; _set.Save(); Post(new { cmd = "pin", on = TopMost }); };
        m.Items.Add(top);
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Open the full app", null, (_, _) => _openFull()) { ShortcutKeyDisplayString = "Alt+H" });
        m.Items.Add(new ToolStripMenuItem("Close", null, (_, _) => Close()) { ShortcutKeyDisplayString = "Alt+M" });
        m.Closed += (_, _) => BeginInvoke(new Action(() => m.Dispose()));
        m.Show(Cursor.Position);
    }
    public void PostMedia(string key) => Post(new { cmd = "media", key });
    private void Post(object o) { try { _web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(o)); } catch { } }
    private void OnMessage(string json)
    {
        try
        {
            using var d = System.Text.Json.JsonDocument.Parse(json); var r = d.RootElement; var cmd = r.TryGetProperty("cmd", out var c) ? c.GetString() : null;
            switch (cmd)
            {
                case "drag": ReleaseCapture(); SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero); Remember(); break;
                case "pin": TopMost = r.TryGetProperty("on", out var on) && on.GetBoolean(); _set.MiniPinned = TopMost; _set.Save(); break;
                case "ready": if (r.TryGetProperty("pinned", out var p)) { TopMost = p.GetBoolean() || _set.MiniPinned; } if (r.TryGetProperty("opacity", out var o0) && o0.TryGetDouble(out var ov0)) { _set.MiniOpacity = MiniPlayer.ClampOpacity(ov0); _set.Save(); } break;
                case "opacity":   // 0.3.3 G4b; 0.3.5 J17: "save" carries the chosen value (100 % too), "value" what to show now (solid while hovered)
                    if (r.TryGetProperty("value", out var o) && o.TryGetDouble(out var ov)) { Opacity = MiniPlayer.ClampOpacity(ov); }
                    if (r.TryGetProperty("save", out var sv) && sv.TryGetDouble(out var svv)) { var keep = MiniPlayer.ClampOpacity(svv); if (Math.Abs(keep - _set.MiniOpacity) > 0.001) { _set.MiniOpacity = keep; _set.Save(); } }
                    else if (r.TryGetProperty("value", out var o1) && o1.TryGetDouble(out var ov1) && ov1 < 1) { _set.MiniOpacity = MiniPlayer.ClampOpacity(ov1); _set.Save(); }
                    break;
                case "menu": ShowMenu(); break;   // 0.3.5 J17: right-click menu with a labeled Transparency submenu
                case "osd": WebUiForm.ShowOsd(json); break;
                case "full": _openFull(); break;
                case "close": Close(); break;
            }
        }
        catch { }
    }
}

public sealed class AboutForm : Form
{
    public AboutForm(PlayerSettings s)
    {
        double k = UiScale.ExtraFactor(s.UiScale); int U(int px) => (int)Math.Round(px * k);
        AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi; if (k > 1.0) Font = new Font(Font.FontFamily, (float)(Font.Size * k));
        Text = "About WavWiz Player"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(U(14));
        try { using var st = typeof(AboutForm).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) Icon = new Icon(st); } catch { }
        var t = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        t.Controls.Add(new Label { Text = WavWizInfo.DisplayName, AutoSize = true, Font = new Font(Font.FontFamily, Font.Size * 1.5f, FontStyle.Bold) });
        t.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(U(460), 0), Margin = new Padding(3, U(8), 3, U(8)), Text =
            "Whole-home music, in sync.\n\nThis is a BETA build: expect rough edges and please report anything odd.\nNo cloud account, no analytics, no telemetry. WavWiz doesn't open ports to the internet.\nInternet radio, tag and cover lookups and Spotify Connect (if you switch it on) use the internet.\n\n" +
            "Credits: FFmpeg (LGPL, decodes your music), NAudio (MIT), QRCoder (MIT), TagLib# (LGPL), SQLite, the .NET runtime and Microsoft WebView2, Nunito font (OFL).\n" +
            "WavWiz is not endorsed by or affiliated with the FFmpeg project, Winamp or Microsoft." });
        var lic = new Button { Text = "Open the license files", AutoSize = true }; var ok = new Button { Text = "Close", AutoSize = true, DialogResult = DialogResult.OK };
        lic.Click += (_, _) => OpenLicenses();
        var fl = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Width = U(460) }; fl.Controls.Add(ok); fl.Controls.Add(lic); t.Controls.Add(fl);
        Controls.Add(t); AcceptButton = CancelButton = ok;
    }

    private static void OpenLicenses()
    {
        try
        {
            var dir = AppContext.BaseDirectory; string? found = null;
            for (int i = 0; i < 3 && dir != null; i++, dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar)))     // ...\Player -> ...\licenses
            { var c = Path.Combine(dir, "licenses"); if (Directory.Exists(c)) { found = c; break; } }
            if (found != null) System.Diagnostics.Process.Start("explorer.exe", found); else MessageBox.Show("The license files are in the 'licenses' folder of the WavWiz installation (C:\\Program Files\\WavWiz\\licenses), and on the WavWiz web page under Settings > About.", "WavWiz");
        }
        catch { }
    }
}
