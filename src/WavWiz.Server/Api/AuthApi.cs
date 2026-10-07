using System.Text.Json;
using WavWiz.Core;
namespace WavWiz.Server.Api;

public static class AuthApi
{
    public static void Map(RouteGroupBuilder g, Services s)
    {
        g.MapGet("/ping", (HttpContext c) => { c.Response.Headers["Access-Control-Allow-Origin"] = "*"; return Results.Json(new { ok = true, app = "unison", version = WavWizInfo.Version, https = c.Request.IsHttps }); }).Anon();
        g.MapGet("/discover", (HttpContext c) => { c.Response.Headers["Access-Control-Allow-Origin"] = "*"; var b = s.Beacon(); return Results.Json(new { app = "unison", id = b.Id, name = b.Name, host = string.IsNullOrEmpty(b.Host) ? c.Connection.LocalIpAddress?.ToString() : b.Host, httpPort = b.HttpPort, httpsPort = b.HttpsPort, audioPort = b.AudioPort, version = b.Version }); }).Anon();

        g.MapPost("/auth/ws-ticket", (HttpContext c) => Results.Json(new { ticket = s.Auth.IssueWsTicket(c.Who()!) })).Req(Role.View);

        g.MapGet("/auth/state", (HttpContext c) =>
        {
            var w = c.Who();
            return Results.Json(new
            {
                appVersion = WavWizInfo.Version, channel = WavWizInfo.Channel, display = WavWizInfo.DisplayName, beta = true,
                setupRequired = s.Auth.SetupRequired, thisMachine = AuthService.IsThisMachine(c.Connection.RemoteIpAddress),
                authenticated = w != null && w.Role != Role.Player, role = w?.Role.ToString().ToLowerInvariant(), name = w?.Name,
                https = c.Request.IsHttps, tlsEnabled = s.Ca.Enabled, serverName = s.ServerName ?? Environment.MachineName, serverId = s.ServerId,
            });
        }).Anon();

        // First run: ONLY from the PC running the server, and only while no password exists. Nothing secret is generated or displayed by the installer.
        g.MapPost("/auth/setup", async (HttpContext c) =>
        {
            if (!s.Auth.SetupRequired) return Ext.Bad("Setup is already done.", 409);
            if (!AuthService.IsThisMachine(c.Connection.RemoteIpAddress)) return Ext.Bad("First-time setup can only be done on the PC that runs the WavWiz server. Open WavWiz there and set the password.", 403);
            var b = await c.Request.Body();
            var err = s.Auth.SetPassword(b.Str("password") ?? ""); if (err != null) return Ext.Bad(err);
            c.SetSession(s.Auth.CreateToken("Browser on server PC", Role.Admin));
            return Results.Json(new { ok = true });
        }).Anon();

        g.MapPost("/auth/login", async (HttpContext c) =>
        {
            var ip = c.Client();
            if (s.Auth.IsLimited(ip)) return Ext.Bad("Too many attempts. Wait a minute and try again.", 429);
            var b = await c.Request.Body();
            if (s.Auth.SetupRequired) return Ext.Bad("Set the password first (on the server PC).", 409);
            if (!s.Auth.CheckPassword(b.Str("password") ?? "")) { s.Auth.NoteFailure(ip); return Ext.Bad("That password is not right.", 401); }
            var tok = s.Auth.CreateToken("Browser " + ip, Role.Admin); c.SetSession(tok);
            return Results.Json(new { ok = true, token = b.Bool("wantToken") == true ? tok : null });
        }).Anon();

        g.MapPost("/auth/logout", (HttpContext c) =>
        {
            var w = c.Who(); if (w != null && c.Request.Cookies.ContainsKey("unison_session")) s.Auth.Revoke(w.TokenId);
            c.Response.Cookies.Delete("unison_session", new CookieOptions { Path = "/" }); return Results.Json(new { ok = true });
        }).Req(Role.View);

        g.MapPost("/pairing/code", () => { var (code, exp) = s.Auth.NewPairingCode(); return Results.Json(new { code, expires = exp }); }).Req(Role.Admin);

        g.MapPost("/auth/pair", async (HttpContext c) =>
        {
            var ip = c.Client(); if (s.Auth.IsLimited(ip)) return Ext.Bad("Too many attempts. Wait a minute and try again.", 429);
            var b = await c.Request.Body(); var code = (b.Str("code") ?? "").Trim();
            if (!s.Auth.ConsumePairingCode(code)) { s.Auth.NoteFailure(ip); return Ext.Bad("That code is wrong or has expired. Ask for a new one.", 401); }
            var name = (b.Str("name") ?? "Phone"); if (name.Length > 40) name = name[..40];
            var tok = s.Auth.CreateToken(name, Role.Control); c.SetSession(tok, 365);
            return Results.Json(new { ok = true, role = "control", token = b.Bool("wantToken") == true ? tok : null });
        }).Anon();

        // A player proves it is on this PC (loopback) or presents a pairing code; it receives a token that can ONLY open the audio connection.
        g.MapPost("/auth/pair-player", async (HttpContext c) =>
        {
            var ip = c.Client(); var b = await c.Request.Body();
            var pid = b.Str("playerId") ?? ""; if (pid.Length is 0 or > 64 || !pid.All(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_')) return Ext.Bad("bad player id");
            bool local = !s.Cfg.TestTreatAllClientsAsRemote && AuthService.IsThisMachine(c.Connection.RemoteIpAddress);
            if (!local)
            {
                if (s.Auth.IsLimited(ip)) return Ext.Bad("Too many attempts. Wait a minute and try again.", 429);
                if (!s.Auth.ConsumePairingCode((b.Str("code") ?? "").Trim())) { s.Auth.NoteFailure(ip); return Ext.Bad("That code is wrong or has expired. Create a new one in Settings > Pair a PC.", 401); }
            }
            s.Db.Exec("UPDATE api_token SET revoked=1 WHERE player_id=$p", ("$p", pid));
            var tok = s.Auth.CreateToken("Player " + (b.Str("name") ?? pid), Role.Player, pid);
            return Results.Json(new { ok = true, token = tok, audioPort = s.Audio.Port, clockPort = s.Clock.Port });
        }).Anon();

        g.MapGet("/tokens", () => Results.Json(s.Db.Query("SELECT id,name,role,created_at,last_used_at,revoked,player_id FROM api_token ORDER BY id DESC LIMIT 200",
            r => new { id = r.GetInt64(0), name = r.GetString(1), role = r.GetString(2), createdAt = r.GetString(3), lastUsedAt = r.IsDBNull(4) ? null : r.GetString(4), revoked = r.GetInt32(5) != 0, playerId = r.IsDBNull(6) ? null : r.GetString(6) }))).Req(Role.Admin);

        g.MapPost("/tokens", async (HttpContext c) =>
        {
            var b = await c.Request.Body(); var role = (b.Str("role") ?? "").ToLowerInvariant();
            if (role is not ("view" or "control" or "admin")) return Ext.Bad("role must be view, control or admin");
            var name = (b.Str("name") ?? "").Trim(); if (name.Length is 0 or > 60) return Ext.Bad("name must be 1-60 characters");
            return Results.Json(new { token = s.Auth.CreateToken(name, Enum.Parse<Role>(role, true)), note = "Copy it now. It cannot be shown again." });
        }).Req(Role.Admin);

        // Revoke a token. For a player token the open connection is also closed with "unauthorized" (the running player shows "not paired"); ?removeFromList=1 also forgets the device.
        g.MapDelete("/tokens/{id:long}", (long id, HttpContext c) =>
        {
            var pid = s.Db.Scalar("SELECT player_id FROM api_token WHERE id=$i", ("$i", id)) as string;
            if (pid != null && c.Request.Query["removeFromList"] == "1") { s.Auth.Revoke(id); s.Zones.RemovePlayer(pid); return Results.Json(new { ok = true, removed = true }); }
            s.Auth.Revoke(id); if (pid != null) { s.Audio.Get(pid)?.CloseUnauthorized(); s.Events.Publish("zones"); }
            return Results.Json(new { ok = true });
        }).Req(Role.Admin);

        g.MapPost("/auth/password", async (HttpContext c) =>
        {
            var b = await c.Request.Body();
            if (!s.Auth.CheckPassword(b.Str("current") ?? "")) { s.Auth.NoteFailure(c.Client()); return Ext.Bad("The current password is not right.", 401); }
            var err = s.Auth.SetPassword(b.Str("password") ?? ""); return err != null ? Ext.Bad(err) : Results.Json(new { ok = true });
        }).Req(Role.Admin);

        // 0.1.2: forgot-password on the server PC only — clears admin.password (library kept) and optionally sets a new one ≥8 chars.
        g.MapPost("/auth/reset-password", async (HttpContext c) =>
        {
            if (!AuthService.IsThisMachine(c.Connection.RemoteIpAddress))
                return Ext.Bad("The admin password can only be reset on the PC that runs the WavWiz server.", 403);
            var b = await c.Request.Body();
            var neu = b.Str("password") ?? "";
            if (neu.Length == 0)
            {
                s.Auth.ClearPassword();
                c.Response.Cookies.Delete("unison_session", new CookieOptions { Path = "/" });
                return Results.Json(new { ok = true, setupRequired = true });
            }
            var err = s.Auth.SetPassword(neu); if (err != null) return Ext.Bad(err);
            c.SetSession(s.Auth.CreateToken("Browser on server PC", Role.Admin));
            return Results.Json(new { ok = true, setupRequired = false });
        }).Anon();
    }
}
