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
    private readonly WasapiOutputProvider _outputs; private PlayerClient? _client; private readonly NotifyIcon _tray; private readonly ContextMenuStrip _menu = new();
    private readonly CancellationTokenSource _cts = new(); private WebUiForm? _web; private readonly SynchronizationContext _ui = SynchronizationContext.Current ?? new SynchronizationContext();
    private readonly string _logPath = Path.Combine(PlayerSettings.Dir, "logs", "player.log");

    public PlayerApp()
    {
        _s = PlayerSettings.Load(); Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
        _outputs = new WasapiOutputProvider(_clock);
        _tray = new NotifyIcon { Icon = MakeIcon(), Text = Tip("Starting"), ContextMenuStrip = _menu, Visible = true };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenUi(); };
        _menu.Opening += (_, _) => BuildMenu();
        ApplyAutostart();
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
            _client = new PlayerClient(new PlayerClientOptions
            {
                Host = _s.ServerHost, HostProvider = () => _s.ServerHost, AudioPort = _s.AudioPort, PlayerId = _s.PlayerId, Name = _s.Name, LinkType = _s.ResolveLinkType(), Token = () => _secrets.Load("token"),
                Clock = _clock, Outputs = _outputs, CacheFile = Path.Combine(PlayerSettings.Dir, "zone-cache.json"),
            });
            _client.Log += Log;
            _client.StateChanged += st => _ui.Post(_ => OnState(st), null);
            _client.ServerUnreachable += n => { Log($"server unreachable ({n} attempts); looking for it on the network"); _ = RefindAsync(); };
            _outputs.DevicesChanged += () => { try { _ = _client?.SendOutputsAsync("devices"); } catch { } };
            _ = Task.Run(() => _client.RunAsync(_cts.Token));
        }
        catch (Exception e) { Log("start failed: " + e); _tray.ShowBalloonTip(5000, WavWizInfo.DisplayName, "WavWiz Player could not start: " + e.Message, ToolTipIcon.Error); }
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
        _menu.Items.Add(new ToolStripMenuItem("Open in my web browser", null, (_, _) => WebUiForm.OpenInBrowser(WebUiForm.UiAddress(_s))));
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
        _menu.Items.Add(new ToolStripMenuItem("Server && pairing...", null, (_, _) => Repair()));
        var auto = new ToolStripMenuItem("Start with Windows") { Checked = _s.StartWithWindows, CheckOnClick = true }; auto.Click += (_, _) => { _s.StartWithWindows = auto.Checked; _s.Save(); ApplyAutostart(); }; _menu.Items.Add(auto);
        _menu.Items.Add(new ToolStripMenuItem("Open log folder", null, (_, _) => { try { System.Diagnostics.Process.Start("explorer.exe", Path.GetDirectoryName(_logPath)!); } catch { } }));
        var sizeMenu = new ToolStripMenuItem("Display size");
        foreach (var c in UiScale.Choices) { var v = c; var it = new ToolStripMenuItem(UiScale.Label(v)) { Checked = UiScale.Normalize(_s.UiScale) == v }; it.Click += (_, _) => SetUiScale(v); sizeMenu.DropDownItems.Add(it); }
        _menu.Items.Add(sizeMenu);
        _menu.Items.Add(new ToolStripMenuItem("About WavWiz (BETA)...", null, (_, _) => { using var a = new AboutForm(_s); a.ShowDialog(); }));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => ExitApp()));
    }

    private bool _notPaired;
    /// <summary>Display size (Auto, 100-300 %): saved, applied to the open window at once and to dialogs opened later.</summary>
    private void SetUiScale(int v) { _s.UiScale = UiScale.Normalize(v); _s.Save(); _web?.ApplyZoom(); }
    /// <summary>"Pair again": forgets the old token and restarts the player, which then shows the connection dialog (or pairs by itself when the server is on this PC).</summary>
    private void PairAgain() { _secrets.Delete("token"); Application.Restart(); }

    private void Repair()
    {
        using var f = new ConnectForm(_s, null, !string.IsNullOrWhiteSpace(_s.ServerHost) && PairingClient.IsThisMachine(_s.ServerHost)); if (f.ShowDialog() != DialogResult.OK) return;
        _s.ServerHost = f.Host!; if (f.Beacon is { } bc) { _s.ServerId = bc.Id; _s.ServerName = bc.Name; if (bc.HttpPort > 0) _s.HttpPort = bc.HttpPort; if (bc.AudioPort > 0) _s.AudioPort = bc.AudioPort; } else { _s.ServerId = ""; _s.ServerName = ""; if (f.ManualPort is int mp) _s.HttpPort = mp; }
        _s.Save(); _secrets.Delete("token"); _tray.ShowBalloonTip(4000, WavWizInfo.DisplayName, "Restart WavWiz Player to pair with the new settings.", ToolTipIcon.Info);
        Application.Restart();
    }

    private void OpenUi()
    {
        if (_web is { IsDisposed: false }) { if (_web.WindowState == FormWindowState.Minimized) _web.WindowState = FormWindowState.Normal; _web.Activate(); return; }
        _web = new WebUiForm(_s); _web.Show();
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

    private void ExitApp() { _cts.Cancel(); _tray.Visible = false; try { _client?.DisposeAsync().AsTask().Wait(1500); } catch { } _outputs.Dispose(); ExitThread(); }

    /// <summary>The final WavWiz logo (embedded multi-size .ico); Windows picks the size that fits the tray.</summary>
    private static Icon MakeIcon()
    {
        try { using var st = typeof(PlayerApp).Assembly.GetManifestResourceStream("wavwiz.ico"); if (st != null) return new Icon(st, SystemInformation.SmallIconSize); } catch { }
        return SystemIcons.Application;
    }
}
