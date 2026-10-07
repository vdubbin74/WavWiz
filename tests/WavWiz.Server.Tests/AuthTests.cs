using System.Net;
namespace WavWiz.Server.Tests;

public class AuthTests
{
    private static (AuthService A, Db D, Func<DateTimeOffset> Now, Action<TimeSpan> Adv) Make(TempDir t)
    {
        var db = new Db(t.File("u.db")); db.Migrate(); var now = DateTimeOffset.Parse("2026-10-04T12:00:00Z");
        return (new AuthService(db, () => now), db, () => now, d => now += d);
    }

    [Fact]
    public void Passwords_are_salted_pbkdf2_and_never_stored_in_clear()
    {
        var h1 = AuthService.HashPassword("correct horse battery", 1000); var h2 = AuthService.HashPassword("correct horse battery", 1000);
        Assert.NotEqual(h1, h2); Assert.DoesNotContain("correct", h1);
        Assert.True(AuthService.VerifyPassword("correct horse battery", h1)); Assert.False(AuthService.VerifyPassword("wrong", h1));
        Assert.False(AuthService.VerifyPassword("x", "garbage")); Assert.False(AuthService.VerifyPassword("x", ""));
        using var t = new TempDir(); var (a, db, _, _) = Make(t);
        Assert.True(a.SetupRequired); Assert.NotNull(a.SetPassword("short")); Assert.True(a.SetupRequired);
        Assert.Null(a.SetPassword("a long enough password")); Assert.False(a.SetupRequired);
        Assert.True(a.CheckPassword("a long enough password")); Assert.False(a.CheckPassword("nope"));
        Assert.DoesNotContain("a long enough password", db.Setting("admin.password")!);
    }

    [Fact]
    public void Tokens_are_stored_hashed_validate_by_role_and_can_be_revoked()
    {
        using var t = new TempDir(); var (a, db, _, _) = Make(t);
        var tok = a.CreateToken("kitchen phone", Role.Control);
        Assert.Equal(0L, db.Scalar("SELECT COUNT(*) FROM api_token WHERE token_hash=$t", ("$t", tok)));            // plain token is not in the db
        var info = a.Validate(tok)!; Assert.Equal(Role.Control, info.Role); Assert.Equal("kitchen phone", info.Name);
        Assert.Null(a.Validate(tok + "x")); Assert.Null(a.Validate(null)); Assert.Null(a.Validate(new string('a', 500)));
        a.Revoke(info.TokenId); Assert.Null(a.Validate(tok));
    }

    [Theory]
    [InlineData(Role.View, Role.View, true)] [InlineData(Role.View, Role.Control, false)] [InlineData(Role.View, Role.Admin, false)]
    [InlineData(Role.Control, Role.View, true)] [InlineData(Role.Control, Role.Control, true)] [InlineData(Role.Control, Role.Admin, false)]
    [InlineData(Role.Admin, Role.Admin, true)] [InlineData(Role.Admin, Role.Control, true)]
    [InlineData(Role.Player, Role.View, false)] [InlineData(Role.Player, Role.Control, false)] [InlineData(Role.Player, Role.Admin, false)] [InlineData(Role.Player, Role.None, true)]
    public void Role_matrix(Role have, Role need, bool ok) => Assert.Equal(ok, AuthService.Allows(have, need));

    [Fact]
    public void Pairing_codes_are_six_digits_single_use_and_expire_after_five_minutes()
    {
        using var t = new TempDir(); var (a, _, _, adv) = Make(t);
        var (c, exp) = a.NewPairingCode(); Assert.Matches("^[0-9]{6}$", c);
        Assert.False(a.ConsumePairingCode("000000x")); Assert.True(a.ConsumePairingCode(c)); Assert.False(a.ConsumePairingCode(c));
        var (c2, _) = a.NewPairingCode(); adv(TimeSpan.FromMinutes(5.1)); Assert.False(a.ConsumePairingCode(c2));
    }

    [Fact]
    public void Five_failures_a_minute_lock_a_client_out_until_the_minute_passes()
    {
        using var t = new TempDir(); var (a, _, _, adv) = Make(t);
        for (int i = 0; i < 4; i++) { Assert.False(a.IsLimited("1.2.3.4")); a.NoteFailure("1.2.3.4"); }
        Assert.False(a.IsLimited("1.2.3.4")); a.NoteFailure("1.2.3.4"); Assert.True(a.IsLimited("1.2.3.4")); Assert.False(a.IsLimited("5.6.7.8"));
        adv(TimeSpan.FromSeconds(61)); Assert.False(a.IsLimited("1.2.3.4"));
    }

    [Theory]
    [InlineData("192.168.1.20", true)] [InlineData("10.1.2.3", true)] [InlineData("172.16.5.5", true)] [InlineData("172.31.255.1", true)] [InlineData("172.32.0.1", false)]
    [InlineData("127.0.0.1", true)] [InlineData("169.254.9.9", true)] [InlineData("8.8.8.8", false)] [InlineData("100.64.1.1", false)] [InlineData("::1", true)]
    [InlineData("fe80::1", true)] [InlineData("2001:db8::1", false)] [InlineData("::ffff:192.168.1.5", true)] [InlineData("::ffff:8.8.4.4", false)]
    public void Only_private_sources_may_talk_to_the_server(string ip, bool ok) => Assert.Equal(ok, AuthService.IsPrivateSource(IPAddress.Parse(ip)));

    [Fact]
    public void Extra_subnets_are_honored_and_null_is_refused()
    {
        Assert.False(AuthService.IsPrivateSource(IPAddress.Parse("100.64.1.1")));
        Assert.True(AuthService.IsPrivateSource(IPAddress.Parse("100.64.1.1"), new[] { "100.64.0.0/10" }));
        Assert.False(AuthService.IsPrivateSource(null));
        Assert.True(AuthService.IsThisMachine(IPAddress.Loopback)); Assert.True(AuthService.IsThisMachine(IPAddress.IPv6Loopback)); Assert.False(AuthService.IsThisMachine(IPAddress.Parse("8.8.8.8")));
    }

    [Fact]
    public void Server_config_refuses_all_interfaces_unless_opted_in_and_is_BOM_tolerant()
    {
        var c = new ServerConfig { BindAddress = "0.0.0.0" };
        Assert.Throws<InvalidOperationException>(() => c.Validate());
        c.AllowAllInterfaces = true; c.Validate();
        Assert.Throws<InvalidOperationException>(() => new ServerConfig { BindAddress = "::" }.Validate());
        Assert.Throws<InvalidOperationException>(() => new ServerConfig { BindAddress = "not an ip" }.Validate());
        using var t = new TempDir(); var cfg = new ServerConfig { DataDir = t.Path, BindAddress = "192.168.1.5" }; cfg.Save();
        var bytes = File.ReadAllBytes(cfg.ConfigPath); Assert.False(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB);          // BOM-less
        File.WriteAllBytes(cfg.ConfigPath, new byte[] { 0xEF, 0xBB, 0xBF }.Concat(bytes).ToArray());
        Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", t.Path);
        try { Assert.Equal("192.168.1.5", ServerConfig.Load().BindAddress); } finally { Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", null); }
    }
}
