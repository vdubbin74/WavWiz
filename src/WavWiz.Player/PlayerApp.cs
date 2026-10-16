using Microsoft.Win32;
using WavWiz.Core;
using WavWiz.Core.Clock;
using WavWiz.Core.Discovery;
using WavWiz.PlayerCore;
using WavWiz.PlayerCore.Discovery;
namespace WavWiz.Player;

internal sealed class PlayerApp : ApplicationContext
{
    private readonly PlayerSettings _s; private readonly DpapiSecretStore _secrets = new(); private readonly StopwatchClock _clock = new();
    private readonly WasapiOutputProvider _outputs; private readonly WasapiMicProvider _mics; private PlayerClient? _client; private readonly NotifyIcon _tray; private readonly ContextMenuStrip _menu = new();
    private readonly CancellationTokenSource _cts = new(); private WebUiForm? _web; private readonly SynchronizationContext _ui = SynchronizationContext.Current ?? new SynchronizationContext();
    private readonly string _logPath = Path.Combine(PlayerSettings.Dir, "logs", "player.log");

    private readonly bool _showWindow;
    private readonly EventWaitHandle _showEvt = new(false, EventResetMode.AutoReset, StartArgs.ShowEventName);
    private readonly EventWaitHandle _exitEvt = new(false, EventResetMode.ManualReset, StartArgs.ExitEventName);

    /// <param name="showWindow">0.2.2 T7: false only for the sign-in auto-start (--autostart / --background / --tray / --minimized).</param>
    public PlayerApp(bool showWindow = true)
    {
        _showWindow = showWindow;
        _s = PlayerSettings.Load(); Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
        // 0.3.5 J16: the tray Display size (the Player window's extra zoom on top of Windows scaling) is NOT the same setting as Settings >
        // Appearance size (the page's own Small / Default / Large); both multiplied. With the tray item gone, an old extra zoom could no longer be
        // changed, so it goes back to Auto (follow Windows) once; Settings > Appearance is the one size control from now on.
        if (_s.UiScale != UiScale.Auto) { Log($"tray Display size {_s.UiScale}% retired -> Auto (Settings > Appearance has the size now)"); _s.UiScale = UiScale.Auto; _s.Save(); }
        _outputs = new WasapiOutputProvider(_clock);
        _mics = new WasapiMicProvider(_clock);        // 0.2.5 PC-mic calibration (native WASAPI capture)
        _tray = new NotifyIcon { Icon = MakeIcon(), Text = Tip("Starting"), ContextMenuStrip = _menu, Visible = true };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenUi(); };
        _menu.Opening += (_, _) => BuildMenu();
        ApplyAutostart();
        // 0.2.2 T7/T11: a second manual launch shows the window; the installer asks the Player to exit before it replaces the files.
        // Session end / Restart Manager (installer's CloseApplications) also exits cleanly.
        var watch = new Thread(() =>
        {
            var hs = new WaitHandle[] { _exitEvt, _showEvt };
            while (true)
            {
                int i; try { i = WaitHandle.WaitAny(hs); } catch { return; }
                if (i == 0) { Log("exit requested (installer or --exit)"); _ui.Post(_ => ExitApp(), null); return; }
                _ui.Post(_ => OpenUi(), null);
            }
        }) { IsBackground = true, Name = "single-instance" };
        watch.Start();
        SystemEvents.SessionEnded += (_, _) => _ui.Post(_ => ExitApp(), null);
        _ = StartAsync();
    }

    private static string Tip(string status) { var t = $"{WavWizInfo.DisplayName} - {status}"; return t.Length > 63 ? t[..63] : t; }

    private void Log(string m) { try { File.AppendAllText(_logPath, $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} {m}\n"); } catch { } }

    private async Task StartAsync()
    {
        try
        {
            string? token = _secrets.Load("token");
            string? problem = null;
            while (token == null)
            {
                string? code = null;
                bool here = !string.IsNullOrWhiteSpace(_s.ServerHost) && PairingClient.IsThisMachine(_s.ServerHost);
                ServerBeacon? beacon = null;
                if (!here || problem != null)
                {
                    using var f = new ConnectForm(_s, problem, here);
                    if (f.ShowDialog() != DialogResult.OK) { ExitThread(); return; }
                    code = f.Code; beacon = f.Beacon;
                    _s.ServerHost = f.Host!;
                    if (beacon != null) { _s.ServerId = beacon.Id; _s.ServerName = beacon.Name; if (beacon.HttpPort > 0) _s.HttpPort = beacon.HttpPort; if (beacon.AudioPort > 0) _s.AudioPort = beacon.AudioPort; }
                    else if (f.ManualPort is int mp) _s.HttpPort = mp;
                    _s.Save();
                }
                Log($"pairing with {_s.ServerHost}:{_s.HttpPort}");
                var r = await PairingClient.PairAsync(_s.ServerHost, _s.HttpPort, _s.PlayerId, _s.Name, code, _cts.Token);
                if (r.Token != null) { _secrets.Save("token", r.Token); token = r.Token; if (r.AudioPort > 0) _s.AudioPort = r.AudioPort; }
                else { problem = r.Error; Log("pairing failed: " + r.Error); }
            }
            if (string.IsNullOrEmpty(_s.ServerId))
            {
                var who = await PairingClient.WhoAreYouAsync(_s.ServerHost, _s.HttpPort, _cts.Token);
                if (who.Id != null) { _s.ServerId = who.Id; if (who.Name != null) _s.ServerName = who.Name; }
            }
            _s.Save();
            if (_s.RemoteMode) { _s.RemoteMode = false; _s.Save(); Log("remote mode retired in 0.3.2 (mini player replaces it): this PC plays again"); }
            if (_client != null) { Log("player already running - not starting a second stream"); return; }   // 0.3.2 F2: one stream per output
            _client = new PlayerClient(new PlayerClientOptions
            {
                Host = _s.ServerHost, HostProvider = () => _s.ServerHost, AudioPort = _s.AudioPort, PlayerId = _s.PlayerId, Name = _s.Name, LinkType = _s.ResolveLinkType(), Token = () => _secrets.Load("token"),
                Clock = _clock, Outputs = _outputs, Mics = _mics, CacheFile = Path.Combine(PlayerSettings.Dir, "zone-cache.json"),
            });
            _client.Log += Log;
            _client.StateChanged += st => _ui.Post(_ => OnState(st), null);
            _client.ServerUnreachable += n => { Log($"server unreachable ({n} attempts); looking for it on the network"); _ = RefindAsync(); };
            _outputs.DevicesChanged += () => { try { _ = _client?.SendOutputsAsync("devices"); } catch { } };
            _ = Task.Run(() => _client.RunAsync(_cts.Token));
            if (_showWindow) _ui.Post(_ => OpenUi(), null);       // 0.2.2 T7: a Start menu / desktop launch opens the window
        }
        catch (Exception e) { Log("start failed: " + e); _tray.ShowBalloonTip(5000, WavWizInfo.DisplayName, "WavWiz Player could not start: " + e.Message, ToolTipIcon.Error); }
    }

    private MiniPlayerForm? _mini;
    /// <summary>0.3.2 F3: the mini player (replaces Remote mode). It never touches the speaker stream (F2).</summary>
    private void OpenMini(bool fromAppMenu = false)
    {
        if (_exiting) return;
        var plan = MiniPlayer.OpenPlan(fromAppMenu, _s.MiniPinned);   // 0.3.7 L31: chosen from the app's menu -> always on top AND the main window steps aside (Home on the mini player brings it back)
        if (_mini is { IsDisposed: false }) { _mini.Show(); _mini.TopMost = plan.TopMost; _mini.Activate(); }
        else { if (plan.TopMost && !_s.MiniPinned) { _s.MiniPinned = true; _s.Save(); } _mini = new MiniPlayerForm(_s, () => OpenUi()); _mini.FormClosed += (_, _) => _mini = null; _mini.Show(); }
        if (plan.MinimizeMain && _web is { IsDisposed: false }) _web.WindowState = FormWindowState.Minimized;
    }

    private int _refinding;
    /// <summary>The server is not answering: it may have a new IP address (router handed out another one). Find it by its id and switch over.</summary>
    private async Task RefindAsync()
    {
        if (string.IsNullOrEmpty(_s.ServerId) || Interlocked.Exchange(ref _refinding, 1) == 1) return;
        try
        {
            var r = await ServerFinder.FindAsync(TimeSpan.FromSeconds(6), new ServerFinder.Options(WantedId: _s.ServerId, Log: Log), _cts.Token);
            var b = r.FirstOrDefault(x => x.Id == _s.ServerId);
            if (b == null) { Log("server not found on the network (it may be switched off)"); return; }
            if (!string.IsNullOrEmpty(b.Host) && b.Host != _s.ServerHost)
            {
                Log($"server moved: {_s.ServerHost} -> {b.Host}"); _s.ServerHost = b.Host; if (b.HttpPort > 0) _s.HttpPort = b.HttpPort; _s.Save();
                _ui.Post(_ => _tray.ShowBalloonTip(4000, WavWizInfo.DisplayName, $"Found WavWiz at its new address ({b.Host}). Reconnecting.", ToolTipIcon.Info), null);
            }
        }
        catch (Exception e) { Log("re-find failed: " + e.Message); }
        finally { Interlocked.Exchange(ref _refinding, 0); }
    }

    private void OnState(PlayerState st)
    {
        string text = st.Health == "reconnecting" || st.Error != null && !st.Connected ? "Reconnecting..." : st.Health == "buffering" ? "Buffering..." : st.Connected ? (st.ActiveOutputId == null ? "No output selected" : st.NotCalibrated ? "Connected - not calibrated" : "Connected") : st.Status;
        // the server forgot this PC / revoked its token: show "not paired" and offer to pair again (the client stops retrying by itself)
        if (st.NotPaired && !_notPaired)
        {
            _notPaired = true; _secrets.Delete("token"); text = "Not paired";
            _tray.ShowBalloonTip(8000, WavWizInfo.DisplayName, "This PC was removed from WavWiz (or its pairing was revoked). Right-click the tray icon and choose 'Pair again...'.", ToolTipIcon.Warning);
        }
        if (_notPaired) text = "Not paired";
        _tray.Text = Tip(text);
        if (st.Error != null && st.ActiveOutputId == null && st.Connected) _tray.ShowBalloonTip(6000, WavWizInfo.DisplayName, st.Error, ToolTipIcon.Warning);
    }

    private void BuildMenu()
    {
        _menu.Items.Clear();
        _menu.Items.Add(new ToolStripMenuItem(WavWizInfo.DisplayName) { Enabled = false });
        var st = _client?.State;
        if (_notPaired) _menu.Items.Add(new ToolStripMenuItem("Not paired - Pair again...", null, (_, _) => PairAgain()) { Font = new Font(SystemFonts.MenuFont!, FontStyle.Bold) });
        _menu.Items.Add(new ToolStripMenuItem(st == null ? "Starting..." : st.Connected ? $"Connected to {(string.IsNullOrEmpty(_s.ServerName) ? _s.ServerHost : _s.ServerName)} ({_s.ServerHost})" : $"Not connected ({st.Status})") { Enabled = false });
        if (st is { Connected: true }) _menu.Items.Add(new ToolStripMenuItem(st.NotCalibrated ? $"Delay: ~{st.LatencyMs:0} ms - NOT calibrated" : $"Delay: +{st.LatencyMs:0} ms ({st.LatencySource})") { Enabled = false });
        _menu.Items.Add(new ToolStripSeparator());
        var open = new ToolStripMenuItem("Open player...", null, (_, _) => OpenUi()) { Font = new Font(SystemFonts.MenuFont!, FontStyle.Bold), ToolTipText = "Opens WavWiz (sign in as Player or Administrator)" }; _menu.Items.Add(open);
        // 0.3.5 J15/J16 (next-menus-tray.png): Start Jukebox... (Stop Jukebox... while it runs, with the usual confirm in the page)
        _menu.Items.Add(new ToolStripMenuItem(_jukeboxOn ? "Stop Jukebox..." : "Start Jukebox...", null, (_, _) => OpenUi(_jukeboxOn ? "jukebox-stop" : "jukebox")) { ToolTipText = _jukeboxOn ? "Guests can no longer add songs. The music keeps playing." : "Guests add songs from their phones (administrator)" });
        _menu.Items.Add(new ToolStripMenuItem("Mini player", null, (_, _) => OpenMini()) { ToolTipText = "A small window with play / pause, next, seek and volume. Pin it to keep it on top." });
        _menu.Items.Add(new ToolStripMenuItem("Calibrate speakers...", null, (_, _) => OpenUi("calibrate")) { ToolTipText = "Measure every speaker's delay with this PC's microphone (or your phone)" });
        var outs = new ToolStripMenuItem("Output (speaker on this PC)");
        if (_client != null)
            foreach (var o in _client.ListOutputs())
            {
                var item = new ToolStripMenuItem($"{o.Name}  -  {(o.Connected ? _client.DescribeOutput(o.EndpointId) : "not connected")}") { Checked = o.Active, Enabled = o.Connected };
                var id = o.EndpointId; item.Click += (_, _) => Task.Run(() => _client!.SwitchOutput(id));
                outs.DropDownItems.Add(item);
            }
        if (outs.DropDownItems.Count == 0) outs.DropDownItems.Add(new ToolStripMenuItem("No outputs found") { Enabled = false });
        _menu.Items.Add(outs);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Open in my web browser", null, (_, _) => WebUiForm.OpenInBrowser(WebUiForm.UiAddress(_s))));
        _menu.Items.Add(new ToolStripMenuItem("Server && pairing...", null, (_, _) => Repair()));
        var auto = new ToolStripMenuItem("Start with Windows") { Checked = _s.StartWithWindows, CheckOnClick = true }; auto.Click += (_, _) => { _s.StartWithWindows = auto.Checked; _s.Save(); ApplyAutostart(); }; _menu.Items.Add(auto);
        _menu.Items.Add(new ToolStripMenuItem("Open log folder", null, (_, _) => { try { System.Diagnostics.Process.Start("explorer.exe", Path.GetDirectoryName(_logPath)!); } catch { } }));
        // 0.3.5 J2/J16: Display size left the tray (Settings > Appearance > Theme has the size); About is Settings > About
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => ExitApp()));
    }

    private bool _notPaired;
    private volatile bool _jukeboxOn;   // 0.3.5 J15: reported by the page (WebUiForm.JukeboxState)
    /// <summary>"Pair again": forgets the old token and restarts the player, which then shows the connection dialog (or pairs by itself when the server is on this PC).</summary>
    private void PairAgain() { _secrets.Delete("token"); Application.Restart(); }

    private void Repair()
    {
        using var f = new ConnectForm(_s, null, !string.IsNullOrWhiteSpace(_s.ServerHost) && PairingClient.IsThisMachine(_s.ServerHost)); if (f.ShowDialog() != DialogResult.OK) return;
        _s.ServerHost = f.Host!; if (f.Beacon is { } bc) { _s.ServerId = bc.Id; _s.ServerName = bc.Name; if (bc.HttpPort > 0) _s.HttpPort = bc.HttpPort; if (bc.AudioPort > 0) _s.AudioPort = bc.AudioPort; } else { _s.ServerId = ""; _s.ServerName = ""; if (f.ManualPort is int mp) _s.HttpPort = mp; }
        _s.Save(); _secrets.Delete("token"); _tray.ShowBalloonTip(4000, WavWizInfo.DisplayName, "Restart WavWiz Player to pair with the new settings.", ToolTipIcon.Info);
        Application.Restart();
    }

    /// <param name="screen">0.2.5: "calibrate" opens the Calibrate speakers screen (tray "Calibrate speakers...").</param>
    private void OpenUi(string? screen = null)
    {
        if (_exiting) return;
        if (_web is { IsDisposed: false })
        {
            if (screen != null) _web.OpenScreen(screen);
            if (!_web.Visible) _web.Show();
            if (_web.WindowState == FormWindowState.Minimized) _web.WindowState = FormWindowState.Normal;
            // 0.2.2 T7: bring it to the front even when another app has the focus (a second launch from the Start menu)
            _web.TopMost = true; _web.Activate(); _web.BringToFront(); _web.TopMost = false; return;
        }
        _web = new WebUiForm(_s) { StartScreen = screen }; _web.MiniRequested += () => _ui.Post(_ => OpenMini(fromAppMenu: true), null); _web.JukeboxState += on => _jukeboxOn = on; _web.Show(); _web.Activate();
    }

    private void ApplyAutostart()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (k == null) return;
            k.DeleteValue("UnisonPlayer", false);           // 0.0.2 value, replaced by the WavWiz one
            if (_s.StartWithWindows) k.SetValue("WavWizPlayer", $"\"{Application.ExecutablePath}\" --background"); else k.DeleteValue("WavWizPlayer", false);
        }
        catch { }
    }

    private bool _exiting;
    private void ExitApp() { if (_exiting) return; _exiting = true; try { _mini?.Close(); } catch { } try { _web?.Close(); } catch { } _cts.Cancel(); _tray.Visible = false; try { _client?.DisposeAsync().AsTask().Wait(1500); } catch { } _outputs.Dispose(); ExitThread(); }

    /// <summary>The final WavWiz logo (embedded multi-size .ico); Windows picks the size that fits the tray.</summary>
    private static Icon MakeIcon()
    {
        try { using var st = typeof(PlayerApp).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) return new Icon(st, SystemInformation.SmallIconSize); } catch { }
        return SystemIcons.Application;
    }
}
