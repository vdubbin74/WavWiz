using System.Net;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.Extensions.FileProviders;
using WavWiz.Core;
using WavWiz.Server.Api;
namespace WavWiz.Server.Host;

/// <summary>Composition root: everything is wired here so the same code runs as the Windows service, from the console and inside tests.</summary>
public sealed class WavWizServer : IAsyncDisposable
{
    public Services S { get; private set; } = null!;
    public WebApplication App { get; private set; } = null!;
    public string HttpUrl { get; private set; } = ""; public string? HttpsUrl { get; private set; }
    private Timer? _tick; private Timer? _rescan; private FileLog _log = null!;

    public static async Task<WavWizServer> StartAsync(ServerConfig cfg, string[]? args = null, bool windowsService = false)
    {
        cfg.Validate();
        Directory.CreateDirectory(cfg.DataDir);
        var u = new WavWizServer(); u._log = new FileLog(Path.Combine(cfg.DataDir, "logs"));
        u._log.Write($"WavWiz server {WavWizInfo.DisplayName} starting; data {cfg.DataDir}; bind {cfg.BindAddress}");

        var db = new Db(cfg.DbPath); db.Migrate();
        var ffmpeg = cfg.ResolveFfmpeg();
        var events = new EventHub(); var auth = new AuthService(db);
        var lib = new Library.LibraryService(db);
        var cond = new Playback.Conductor(db, events, ffmpeg) { LeadMs = cfg.LeadMs };
        var clockHost = new Net.ClockHost(cfg, cond.Clock); clockHost.Start();
        var audio = new Net.AudioHost(cfg, auth, cond.Clock, clockHost) { Log = u._log.Write }; audio.Start();
        var dsp = new Dsp.DspService(db);
        var zones = new Zones.ZoneManager(db, audio, cond, events, dsp) { Log = u._log.Write };
        var cal = new Calibration.CalibrationService(db, cond.Clock, zones, audio, events);
        var ca = new Tls.LocalCa(cfg.DataDir);
        var s = new Services { Cfg = cfg, Db = db, Auth = auth, Events = events, Library = lib, Conductor = cond, Audio = audio, Clock = clockHost, Zones = zones, Dsp = dsp, Cal = cal, Ca = ca, Art = new Library.ArtService(lib, cfg.DataDir, ffmpeg), FfmpegPath = ffmpeg };
        u.S = s; cond.Engine.FrameTap = s.Viz.OnFrame;
        s.Scenes = new Features.SceneService(db, zones, events);
        s.Schedules = new Features.ScheduleService(db, zones, cond, events);
        s.Speakers = new Features.SpeakerFollowService(db, zones, dsp, events) { Log = u._log.Write };
        s.RadioFinder = new Features.RadioFinderService(db);
        s.TagFix = new Features.TagFixService(db, lib, s.Art, events, ffmpeg);
        s.CdRip = new Features.CdRipService(db, cfg, lib, events, ffmpeg);
        zones.AfterOutputsChanged = () => s.Speakers.OnOutputsChanged();
        s.ServerId = db.Setting("server.id") is string sid0 && sid0.Length > 4 ? System.Text.Json.JsonSerializer.Deserialize<string>(sid0)! : NewServerId(db);
        s.Discovery = new Net.DiscoveryHost(cfg, () => s.Beacon(), u._log.Write);
        // 0.1.1: AirPlay (always on) + Spotify Connect (admin add-on, off by default), both advertised by our own mDNS responder where needed
        s.Nas = new Library.NasLogon(db); _ = Task.Run(() => { try { s.Nas.EnsureAll(true); } catch { } });     // 0.1.3: connect saved NAS shares early
        s.AirPlay = new Receivers.AirPlayReceiver(s, u._log.Write); s.Spotify = new Receivers.SpotifyReceiver(s, u._log.Write);
        s.Discovery.Extra = (host, ip) => new[] { s.AirPlay is { Running: true } ap ? ap.MdnsRecords(host, ip) : null, s.Spotify?.MdnsRecords(host, ip) }.Where(g => g != null).Select(g => g!);
        s.Discovery.Start();
        if (!System.Net.IPAddress.IsLoopback(System.Net.IPAddress.Parse(cfg.BindAddress.Trim('[', ']'))) || cfg.TestTreatAllClientsAsRemote) { s.AirPlay.Start(); s.Spotify.Apply(); }
        _ = Task.Run(async () => { for (int i = 0; i < 20 && !(s.AirPlay?.Ready ?? true); i++) await Task.Delay(500); if (s.AirPlay?.Ready == true) s.Discovery?.AnnounceSoon(); });

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args ?? Array.Empty<string>(), ContentRootPath = AppContext.BaseDirectory });
        if (windowsService) builder.Host.UseWindowsService(o => o.ServiceName = WavWizInfo.ServiceName);
        builder.Logging.ClearProviders(); builder.Logging.AddProvider(u._log.Provider); builder.Logging.SetMinimumLevel(LogLevel.Warning);
        var bindIp = IPAddress.Parse(cfg.BindAddress);
        builder.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false; k.Limits.MaxRequestBodySize = 16 * 1024 * 1024; k.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);
            k.Listen(bindIp, cfg.HttpPort);
            k.Listen(bindIp, cfg.HttpsPort, o => o.UseHttps(new HttpsConnectionAdapterOptions { ServerCertificateSelector = (_, _) => ca.CurrentServerCert(bindIp), SslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13 }));
        });
        var app = builder.Build(); u.App = app;

        // ---- pipeline ----
        app.Use(async (c, next) =>
        {
            // spec 13: only LAN sources, even if a port were reachable some other way
            if (!AuthService.IsPrivateSource(c.Connection.RemoteIpAddress, cfg.ExtraAllowedSubnets)) { c.Response.StatusCode = 403; return; }
            var h = c.Response.Headers;
            h["X-Content-Type-Options"] = "nosniff"; h["X-Frame-Options"] = "DENY"; h["Referrer-Policy"] = "no-referrer"; h["Cache-Control"] = c.Request.Path.StartsWithSegments("/api") ? "no-store" : h["Cache-Control"];
            // 0.0.7: no 'unsafe-eval' any more (it was only needed by the MilkDrop/butterchurn preset compiler, which was removed). Inline scripts stay blocked; LAN-only.
            h["Content-Security-Policy"] = c.Request.Path.StartsWithSegments("/tls") ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" : "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            if (RedirectPolicy.ShouldRedirect(c.Request.Method, c.Request.Path.Value ?? "/", c.Request.IsHttps, s.Db.Setting("tls.redirect") == "true", ca.Enabled, (!s.Cfg.TestTreatAllClientsAsRemote && AuthService.IsThisMachine(c.Connection.RemoteIpAddress)), c.Request.Headers.UserAgent.ToString()))
            { c.Response.Redirect($"https://{c.Request.Host.Host}:{cfg.HttpsPort}{c.Request.Path}{c.Request.QueryString}", false); return; }
            await next();
        });

        var web = string.IsNullOrWhiteSpace(cfg.WebRoot) ? Path.Combine(AppContext.BaseDirectory, "wwwroot") : cfg.WebRoot;
        if (Directory.Exists(web))
        {
            var fp = new PhysicalFileProvider(web);
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fp });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = fp, OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache" });
        }
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.UseRouting();
        app.Use(async (c, next) =>
        {
            var ep = c.GetEndpoint(); var need = ep?.Metadata.GetMetadata<RoleRequirement>();
            string path = c.Request.Path.Value ?? "";
            bool guarded = path.StartsWith("/api/") || path == "/ws" || path.StartsWith("/ws/");
            if (need is { Public: true }) { Authenticate(c, s, null); await next(); return; }
            if (!guarded && need == null) { await next(); return; }
            if (need == null) { c.Response.StatusCode = 404; return; }            // fail closed: an endpoint without a declared role is unreachable
            bool viaCookie = Authenticate(c, s, need.Need);
            var who = c.Who();
            if (who == null) { c.Response.StatusCode = 401; await c.Response.WriteAsJsonAsync(new { error = "sign in required" }); return; }
            if (!AuthService.Allows(who.Role, need.Need)) { c.Response.StatusCode = 403; await c.Response.WriteAsJsonAsync(new { error = "your access level does not allow this" }); return; }
            // cookie-authenticated browsers: block cross-site writes and WebSocket hijacking
            if (viaCookie && (!HttpMethods.IsGet(c.Request.Method) && !HttpMethods.IsHead(c.Request.Method) || c.WebSockets.IsWebSocketRequest))
            {
                var origin = c.Request.Headers.Origin.ToString();
                if (origin.Length == 0 && !c.WebSockets.IsWebSocketRequest || origin.Length > 0 && (!Uri.TryCreate(origin, UriKind.Absolute, out var ou) || !string.Equals(ou.Authority, c.Request.Host.Value, StringComparison.OrdinalIgnoreCase)))
                { c.Response.StatusCode = 403; await c.Response.WriteAsJsonAsync(new { error = "cross-site request refused" }); return; }
            }
            await next();
        });
        app.UseEndpoints(_ => { });
        var api = app.MapGroup("/api/v1");
        AuthApi.Map(api, s); PlaybackApi.Map(api, s); ZoneApi.Map(api, s); SystemApi.Map(api, app, s); LibraryApi.Map(api, s); DiagnosticsApi.Map(api, s); FeaturesApi.Map(api, s); HealthApi.Map(api, s);
        if (Directory.Exists(web)) app.MapFallback(async c => { c.Response.StatusCode = 404; await c.Response.WriteAsync("Not found"); }).Anon();

        await app.StartAsync();
        var addrs = app.Urls; u.HttpUrl = $"http://{cfg.BindAddress}:{PortOf(app, false, cfg)}"; u.HttpsUrl = $"https://{cfg.BindAddress}:{PortOf(app, true, cfg)}";
        if (cfg.HttpPort == 0) cfg.HttpPort = PortOf(app, false, cfg); if (cfg.HttpsPort == 0) cfg.HttpsPort = PortOf(app, true, cfg);      // ephemeral ports (tests): every page and the discovery answer must say the real port
        int nasTick = 0;
        u._tick = new Timer(_ => { if (++nasTick % 300 == 0 && s.Nas != null) _ = Task.Run(() => { try { s.Nas.EnsureAll(); } catch { } }); if (events.Count > 0) events.Publish("tick"); try { s.Schedules.Tick(DateTimeOffset.Now); } catch (Exception ex) { u._log.Write("schedule: " + ex.Message); } }, null, 1000, 1000);
        if ((lib.TrackCount() == 0 || lib.NeedsUpgradeScan()) && Convert.ToInt32(db.Scalar("SELECT COUNT(*) FROM library_root")) > 0) SystemApi.StartScan(s);
        u._rescan = new Timer(_ =>
        {
            var h = db.Setting("library.rescanHours"); if (h != null && double.TryParse(h, System.Globalization.CultureInfo.InvariantCulture, out var hrs) && hrs > 0 && !s.Scanning) SystemApi.StartScan(s);
        }, null, TimeSpan.FromHours(1), TimeSpan.FromHours(1));
        u._log.Write($"listening on {u.HttpUrl} and {u.HttpsUrl}; audio {audio.Port}; clock {clockHost.Port}");
        return u;
    }

    private static string NewServerId(Db db) { var id = Guid.NewGuid().ToString("N"); db.SetSetting("server.id", System.Text.Json.JsonSerializer.Serialize(id)); return id; }

    private static int PortOf(WebApplication app, bool https, ServerConfig cfg)
    {
        var feature = app.Services.GetService<Microsoft.AspNetCore.Hosting.Server.IServer>()?.Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>();
        var addr = feature?.Addresses.Select(a => new Uri(a.Replace("[::]", "localhost"))).FirstOrDefault(a => (a.Scheme == "https") == https);
        return addr?.Port ?? (https ? cfg.HttpsPort : cfg.HttpPort);
    }

    /// <summary>Returns true when the identity came from the session cookie (then CSRF/Origin rules apply).</summary>
    private static bool Authenticate(HttpContext c, Services s, Role? need)
    {
        string? token = null; bool cookie = false;
        var h = c.Request.Headers.Authorization.ToString();
        if (h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) token = h[7..].Trim();
        else if (c.Request.Cookies.TryGetValue("unison_session", out var ck)) { token = ck; cookie = true; }
        var info = s.Auth.Validate(token);
        if (info == null && c.WebSockets.IsWebSocketRequest && c.Request.Query["ticket"].ToString() is { Length: > 0 } tk && s.Auth.RedeemWsTicket(tk) is { } ti)
        { c.Items["auth"] = ti; return true; }      // ticket came from a cookie-authenticated fetch: the same Origin rule applies
        if (info != null) c.Items["auth"] = info;
        return cookie && info != null;
    }

    public async ValueTask DisposeAsync()
    {
        _tick?.Dispose(); _rescan?.Dispose(); S.Stop.Cancel(); S.Discovery?.Dispose(); S.AirPlay?.Dispose(); S.Spotify?.Dispose();
        try { await App.StopAsync(TimeSpan.FromSeconds(3)); } catch { }
        await S.Audio.DisposeAsync(); S.Clock.Dispose(); S.Conductor.Dispose();
        await App.DisposeAsync(); _log.Dispose();
    }
}

/// <summary>Small rolling file log (5 MB x 3). Never logs tokens, passwords or request bodies.</summary>
public sealed class FileLog : IDisposable
{
    private readonly string _dir; private readonly object _l = new(); private StreamWriter? _w; private long _size;
    public ILoggerProvider Provider { get; }
    public FileLog(string dir) { _dir = dir; Directory.CreateDirectory(dir); Provider = new P(this); }
    private string Path_ => System.IO.Path.Combine(_dir, "wavwiz-server.log");

    public void Write(string line)
    {
        lock (_l)
        {
            try
            {
                if (_w == null) { _w = new StreamWriter(new FileStream(Path_, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new System.Text.UTF8Encoding(false)) { AutoFlush = true }; _size = new FileInfo(Path_).Length; }
                var text = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} {line}";
                _w.WriteLine(text); _size += text.Length + 2;
                if (_size > 5_000_000) Roll();
            }
            catch { }
        }
    }

    private void Roll()
    {
        _w?.Dispose(); _w = null;
        for (int i = 2; i >= 1; i--) { var from = i == 1 ? Path_ : Path_ + "." + (i - 1); var to = Path_ + "." + i; try { if (File.Exists(to)) File.Delete(to); if (File.Exists(from)) File.Move(from, to); } catch { } }
    }

    public void Dispose() { lock (_l) { _w?.Dispose(); _w = null; } }

    private sealed class P : ILoggerProvider
    {
        private readonly FileLog _f; public P(FileLog f) { _f = f; }
        public ILogger CreateLogger(string category) => new L(_f, category);
        public void Dispose() { }
        private sealed class L : ILogger
        {
            private readonly FileLog _f; private readonly string _c; public L(FileLog f, string c) { _f = f; _c = c; }
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel l) => l >= LogLevel.Warning;
            public void Log<TState>(LogLevel l, EventId id, TState st, Exception? ex, Func<TState, Exception?, string> f) => _f.Write($"[{l}] {_c}: {f(st, ex)}{(ex != null ? " | " + ex.GetType().Name + ": " + ex.Message : "")}");
        }
    }
}
