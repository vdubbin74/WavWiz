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
        DpiChanged += (_, _) => ApplyZoom();
        _watch.Tick += (_, _) => { _watch.Stop(); if (!_loadedOnce) ShowProblem("WavWiz did not answer in time.", "The window waited 20 seconds for " + _url + "."); };
        FormClosed += (_, _) => { _watch.Dispose(); };
    }

    /// <summary>The address this window loads (server PC: the desktop shortcut's address from first-run-url.txt).</summary>
    public static string UiAddress(PlayerSettings s)
    {
        string? fr = null; bool here = false;
        try { here = !string.IsNullOrWhiteSpace(s.ServerHost) && PairingClient.IsThisMachine(s.ServerHost); } catch { }
        try { var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WavWiz", "first-run-url.txt"); if (File.Exists(p)) fr = File.ReadAllText(p); } catch { }
        return UiUrl.Resolve(s.ServerHost, s.HttpPort, here, fr);
    }

    public static void OpenInBrowser(string url) { try { if (url.Length > 0) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); } catch { } }

    private void FitToScreen()
    {
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea; var (w, h) = UiScale.FitWindow(1280, 820, DeviceDpi / 96.0, wa.Width, wa.Height);
        Size = new Size(w, h); Location = new Point(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2);
    }

    /// <summary>Applies the UI-size setting to the page (WebView2 draws at the monitor scale by itself; this is the extra zoom).</summary>
    public void ApplyZoom() { try { if (_web.CoreWebView2 != null) _web.ZoomFactor = UiScale.WebZoom(_set.UiScale); } catch { } }

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
                if (_retries++ < 2) { try { BeginInvoke(() => cw.Navigate(_url)); } catch { } }
                else BeginInvoke(() => ShowProblem("The WavWiz window stopped drawing.", "The page's display process ended (" + e.ProcessFailedKind + ")."));
            };
            cw.DocumentTitleChanged += (_, _) => Text = $"{cw.DocumentTitle} - {WavWizInfo.DisplayName}";
            cw.ContainsFullScreenElementChanged += (_, _) => SetFull(cw.ContainsFullScreenElement);       // visualizer full screen
            ApplyZoom();
            cw.Navigate(_url);
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

    private void SetFull(bool on)
    {
        if (on == _full) return; _full = on;
        if (on) { _prevBorder = FormBorderStyle; _prevState = WindowState; FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Normal; WindowState = FormWindowState.Maximized; }
        else { FormBorderStyle = _prevBorder; WindowState = _prevState; }
    }
}

/// <summary>About WavWiz Player: version, credits, privacy in one line, and the license files. A plain visible dialog (no hidden windows).</summary>
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
            "Whole-home music, in sync.\n\nThis is a BETA build: expect rough edges and please report anything odd.\nLAN only - no accounts, no telemetry, nothing leaves your network.\n\n" +
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
