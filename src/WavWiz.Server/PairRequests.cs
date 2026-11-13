using System.Collections.Concurrent;
using System.Security.Cryptography;
namespace WavWiz.Server;

/// <summary>
/// 0.6.9 #15: approval-based pairing. A Player PC (or a Player window without a session) asks to join; the request shows up at once for every
/// administrator, who approves or denies it. Nothing is granted until an administrator approves:
///  - the requester gets a random 32-byte secret that only it knows (stored here as a SHA-256 hash); polling needs id + secret,
///  - a short 4-digit match code (derived from the secret) is shown on both screens so the admin can tell which PC is asking,
///  - tokens are minted only on approval and handed out exactly once, then the request is forgotten,
///  - requests expire after <see cref="Ttl"/>; at most <see cref="MaxPerClient"/> open requests per address and <see cref="MaxOpen"/> in total.
/// The Player (audio) token stays Role.Player (never elevated, see AuthService.Validate/Elevate); the window session is a normal paired
/// Control session, exactly what "Pair with code" already gives a phone.
/// </summary>
public sealed class PairRequests
{
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    public const int MaxOpen = 20, MaxPerClient = 3;
    public enum Kind { Player, Window }
    public enum Status { Pending, Approved, Denied, Expired }

    public sealed class Entry
    {
        public required string Id, SecretHash, Name, Machine, Client, Match; public string? PlayerId; public Kind Kind;
        public DateTimeOffset Created, Expires; public Status Status = Status.Pending;
        public string? PlayerToken, UiToken; public string? DecidedBy;
    }

    private readonly ConcurrentDictionary<string, Entry> _all = new();
    private readonly object _l = new();
    public Func<DateTimeOffset> Now = () => DateTimeOffset.UtcNow;

    public static string MatchOf(string secret) { var h = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("match:" + secret)); return (BitConverter.ToUInt32(h, 0) % 10000).ToString("D4"); }

    private void Sweep() { var now = Now(); foreach (var (k, e) in _all) if (e.Expires <= now) _all.TryRemove(k, out _); }

    /// <returns>(entry, secret) or (null, error).</returns>
    public (Entry? E, string? SecretOrError) Create(Kind kind, string? playerId, string name, string machine, string client)
    {
        lock (_l)
        {
            Sweep();
            // a player asking again replaces its own older pending request (a restarted player must not pile up cards)
            if (playerId != null) foreach (var (k, o) in _all) if (o.PlayerId == playerId && o.Kind == kind && o.Status == Status.Pending) _all.TryRemove(k, out _);
            if (_all.Values.Count(e => e.Status == Status.Pending) >= MaxOpen) return (null, "Too many requests are waiting. Ask the administrator to approve or deny them first.");
            if (_all.Values.Count(e => e.Status == Status.Pending && e.Client == client) >= MaxPerClient) return (null, "This device already has requests waiting. Wait for the administrator.");
            var secret = NewSecret();
            var now = Now();
            var e = new Entry { Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant(), SecretHash = AuthService.Hash(secret), Name = Clean(name, 40), Machine = Clean(machine, 64), Client = client, Match = MatchOf(secret), PlayerId = playerId, Kind = kind, Created = now, Expires = now + Ttl };
            _all[e.Id] = e; return (e, secret);
        }
    }

    public List<Entry> Pending() { lock (_l) { Sweep(); return _all.Values.Where(e => e.Status == Status.Pending).OrderBy(e => e.Created).ToList(); } }

    /// <summary>Admin decision. <paramref name="mint"/> creates the tokens (called once, only on approve).</summary>
    public Entry? Decide(string id, bool approve, string by, Func<Entry, (string? Player, string? Ui)> mint)
    {
        lock (_l)
        {
            Sweep();
            if (!_all.TryGetValue(id, out var e) || e.Status != Status.Pending) return null;
            e.DecidedBy = by;
            if (approve) { var (p, u) = mint(e); e.PlayerToken = p; e.UiToken = u; e.Status = Status.Approved; } else e.Status = Status.Denied;
            e.Expires = Now() + TimeSpan.FromMinutes(5);   // the requester has 5 minutes to collect the answer
            return e;
        }
    }

    /// <summary>The requester asks how it went. Wrong secret = "not found" (never says whether the id exists). Approved/denied answers are given once.</summary>
    public (Status Status, Entry? E) Poll(string id, string secret)
    {
        lock (_l)
        {
            Sweep();
            if (!_all.TryGetValue(id, out var e) || !CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(e.SecretHash), System.Text.Encoding.ASCII.GetBytes(AuthService.Hash(secret ?? ""))))
                return (Status.Expired, null);
            if (e.Status != Status.Pending) _all.TryRemove(id, out _);
            return (e.Status, e);
        }
    }

    private static string NewSecret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    private static string Clean(string? s, int max) { var t = new string((s ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim(); return t.Length > max ? t[..max] : t; }
}
