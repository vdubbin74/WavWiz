using System.Collections.Concurrent;
using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
namespace WavWiz.Server;

public enum Role { None = 0, View = 1, Control = 2, Admin = 3, Player = 10 }

/// <param name="Elevated">0.2.0: a paired (view/control) session that signed in as admin in place ("Sign in as admin"). Role is then Admin and BaseRole the paired role.</param>
public sealed record AuthInfo(Role Role, string Name, long TokenId, string? PlayerId, bool Elevated = false, Role BaseRole = Role.None)
{
    public bool IsAdmin => Role == Role.Admin;
}

/// <summary>
/// Tokens, admin password, pairing codes and rate limits (spec 13). Tokens are 32 random bytes, stored only as SHA-256 hashes.
/// The admin password is PBKDF2-SHA256. First-run setup is accepted only from this PC itself, so a neighbor on the LAN can never claim a fresh server.
/// </summary>
public sealed class AuthService
{
    private const int Pbkdf2Iterations = 210_000;
    private readonly Db _db;
    private readonly ConcurrentDictionary<string, (string Code, DateTimeOffset Expires)> _pairing = new();
    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _fails = new();
    private readonly Func<DateTimeOffset> _now;

    public AuthService(Db db, Func<DateTimeOffset>? now = null) { _db = db; _now = now ?? (() => DateTimeOffset.UtcNow); }

    public bool SetupRequired => _db.Setting("admin.password") == null;

    // ---- password ----
    public static string HashPassword(string password, int iterations = Pbkdf2Iterations)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(h)}";
    }

    public static bool VerifyPassword(string password, string stored)
    {
        var p = stored.Split('$');
        if (p.Length != 4 || p[0] != "pbkdf2" || !int.TryParse(p[1], out var it)) return false;
        var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), Convert.FromBase64String(p[2]), it, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(h, Convert.FromBase64String(p[3]));
    }

    public string? SetPassword(string password)
    {
        if (password.Length < 8) return "The password must be at least 8 characters.";
        _db.SetSetting("admin.password", System.Text.Json.JsonSerializer.Serialize(HashPassword(password)));
        return null;
    }

    /// <summary>0.1.2: remove admin.password so SetupRequired is true again. Does not touch library tables.</summary>
    public void ClearPassword() => _db.Exec("DELETE FROM setting WHERE key=$k", ("$k", "admin.password"));

    public bool CheckPassword(string password)
    {
        var json = _db.Setting("admin.password");
        return json != null && VerifyPassword(password, System.Text.Json.JsonSerializer.Deserialize<string>(json)!);
    }

    // ---- tokens ----
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public string CreateToken(string name, Role role, string? playerId = null)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        _db.Exec("INSERT INTO api_token(name,role,token_hash,created_at,player_id) VALUES($n,$r,$h,$t,$p)",
            ("$n", name), ("$r", role.ToString().ToLowerInvariant()), ("$h", Hash(token)), ("$t", _now().ToString("O")), ("$p", playerId));
        return token;
    }

    public AuthInfo? Validate(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 128) return null;
        var rows = _db.Query("SELECT id,name,role,revoked,player_id,elevated FROM api_token WHERE token_hash=$h",
            r => (Id: r.GetInt64(0), Name: r.GetString(1), Role: r.GetString(2), Revoked: r.GetInt32(3) != 0, Player: r.IsDBNull(4) ? null : r.GetString(4), Elevated: r.GetInt32(5) != 0), ("$h", Hash(token)));
        if (rows.Count != 1 || rows[0].Revoked) return null;
        if (!Enum.TryParse<Role>(rows[0].Role, true, out var role)) return null;
        _db.Exec("UPDATE api_token SET last_used_at=$t WHERE id=$i", ("$t", _now().ToString("O")), ("$i", rows[0].Id));
        // 0.2.0: an elevated paired session acts as Admin until "Leave admin mode"; a Player token can never be elevated
        bool elevated = rows[0].Elevated && role is Role.View or Role.Control;
        return new AuthInfo(elevated ? Role.Admin : role, rows[0].Name, rows[0].Id, rows[0].Player, elevated, role);
    }

    /// <summary>0.2.0 "Sign in as admin…": raises THIS token to admin (same token, same cookie, so the browser's speaker and pairing are kept).</summary>
    public string? Elevate(AuthInfo who, string password)
    {
        if (who.Role == Role.Player) return "a player connection cannot sign in as admin";
        if (who.IsAdmin) return null;
        if (!CheckPassword(password)) return "That password is not right.";
        _db.Exec("UPDATE api_token SET elevated=1 WHERE id=$i", ("$i", who.TokenId)); return null;
    }

    /// <summary>0.2.0 "Leave admin mode": back to the paired role. A plain admin sign-in (no paired role underneath) has nothing to fall back to.</summary>
    public string? LeaveAdmin(AuthInfo who)
    {
        if (!who.Elevated) return "This session was opened with the administrator password, so there is no paired role to go back to. Use Sign out instead.";
        _db.Exec("UPDATE api_token SET elevated=0 WHERE id=$i", ("$i", who.TokenId)); return null;
    }

    // ---- 0.0.7: short-lived WebSocket tickets. iOS Safari does not reliably send the SameSite session cookie on the WebSocket handshake over plain http,
    // so the page asks for a one-time ticket with a normal same-origin fetch and passes it as ?ticket= (60 s, single use, never logged).
    private readonly ConcurrentDictionary<string, (AuthInfo Who, DateTimeOffset Expires)> _wsTickets = new();
    public string IssueWsTicket(AuthInfo who)
    {
        var now = _now();
        foreach (var k in _wsTickets.Where(kv => kv.Value.Expires < now).Select(kv => kv.Key).ToList()) _wsTickets.TryRemove(k, out _);
        var t = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        _wsTickets[t] = (who, now.AddSeconds(60)); return t;
    }
    public AuthInfo? RedeemWsTicket(string? ticket)
    {
        if (string.IsNullOrEmpty(ticket) || ticket.Length > 96) return null;
        if (!_wsTickets.TryRemove(ticket, out var e) || e.Expires < _now()) return null;
        return e.Who;
    }

    public void Revoke(long id) => _db.Exec("UPDATE api_token SET revoked=1 WHERE id=$i", ("$i", id));

    public static bool Allows(Role have, Role need) => have == Role.Player ? need == Role.None : (int)have >= (int)need;

    // ---- pairing (6-digit code, 5 min, single use) ----
    public (string Code, DateTimeOffset Expires) NewPairingCode()
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var exp = _now().AddMinutes(5);
        _pairing[code] = (code, exp);
        foreach (var k in _pairing.Where(kv => kv.Value.Expires < _now()).Select(kv => kv.Key).ToList()) _pairing.TryRemove(k, out _);
        return (code, exp);
    }

    public bool ConsumePairingCode(string code)
    {
        if (!_pairing.TryGetValue(code ?? "", out var e) || e.Expires < _now()) return false;
        return _pairing.TryRemove(code!, out _);
    }

    // ---- brute-force limiter: 5 failures per minute per client ----
    public bool IsLimited(string client)
    {
        if (!_fails.TryGetValue(client, out var l)) return false;
        lock (l) { l.RemoveAll(t => t < _now().AddMinutes(-1)); return l.Count >= 5; }
    }

    public void NoteFailure(string client)
    {
        var l = _fails.GetOrAdd(client, _ => new List<DateTimeOffset>());
        lock (l) l.Add(_now());
    }

    // ---- network source policy ----
    private static readonly (IPAddress Net, int Bits)[] PrivateRanges =
    {
        (IPAddress.Parse("10.0.0.0"), 8), (IPAddress.Parse("172.16.0.0"), 12), (IPAddress.Parse("192.168.0.0"), 16),
        (IPAddress.Parse("169.254.0.0"), 16), (IPAddress.Parse("127.0.0.0"), 8), (IPAddress.Parse("fc00::"), 7), (IPAddress.Parse("fe80::"), 10), (IPAddress.IPv6Loopback, 128),
    };

    public static bool InSubnet(IPAddress ip, IPAddress net, int bits)
    {
        var a = ip.GetAddressBytes(); var b = net.GetAddressBytes();
        if (a.Length != b.Length) return false;
        int full = bits / 8, rem = bits % 8;
        for (int i = 0; i < full; i++) if (a[i] != b[i]) return false;
        return rem == 0 || ((a[full] ^ b[full]) >> (8 - rem)) == 0;
    }

    /// <summary>Spec 13 "source filtering": only RFC 1918 / link-local / loopback (and configured subnets) may talk to WavWiz, even if a listener is reachable.</summary>
    public static bool IsPrivateSource(IPAddress? ip, IEnumerable<string>? extra = null)
    {
        if (ip == null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (PrivateRanges.Any(r => InSubnet(ip, r.Net, r.Bits))) return true;
        foreach (var s in extra ?? Array.Empty<string>())
        {
            var p = s.Split('/');
            if (p.Length == 2 && IPAddress.TryParse(p[0], out var n) && int.TryParse(p[1], out var bits) && InSubnet(ip, n, bits)) return true;
        }
        return false;
    }

    /// <summary>True when the request comes from this very PC (loopback or one of its own addresses).</summary>
    public static bool IsThisMachine(IPAddress? ip)
    {
        if (ip == null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return true;
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces().SelectMany(n => n.GetIPProperties().UnicastAddresses).Any(u => u.Address.Equals(ip));
        }
        catch { return false; }
    }
}
