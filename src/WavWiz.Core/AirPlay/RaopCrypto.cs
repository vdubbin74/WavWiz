using System.Security.Cryptography;

namespace WavWiz.Core.AirPlay;

/// <summary>
/// AirPlay 1 et=1 payload protection: a per-session AES-128 key, RSA-OAEP(SHA-1) wrapped with the AirPort Express
/// public key (a public interoperability constant), and AES-CBC over the whole 16-byte blocks of each audio payload
/// with the IV reset per packet; any trailing partial block is sent clear.
/// </summary>
public static class RaopCrypto
{
    /// <summary>AirPort Express RSA public key (SubjectPublicKeyInfo, base64).</summary>
    public const string AirPortPublicKey =
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA59dE8qLieItsH1WgjrcF" +
        "RKj6eUWqi+bGLOX1HL3U3GhC/j0Qg90u3sG/1CUtwC5vOYvfDmFI6oSFXi5ELabW" +
        "JmT2dKHzBJKa3k9ok+8t9ucRqMd6DZHJ2YCCLlDRKSKv6kDqnw4UwPdpOMXziC/A" +
        "Mj3Z/lUVX1G7WSHCAWKf1zNS1eLvqr+boEjXuBOitnZ/bDzPHrTOZz0Dew0uowxf" +
        "/+sG+NCK3eQJVxqcaJ/vEHKIVd2M+5qL71yJQ+87X6oV3eaYvt3zWZYD6z5vYTcr" +
        "tij2VZ9Zmni/UAaHqn9JdsBWLUEpVviYnhimNVvYFZeCXg/IdTQ+x4IRdiXNv5hE" +
        "ewIDAQAB";

    public static byte[] WrapKey(byte[] aesKey)
    {
        using var rsa = RSA.Create();
        rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(AirPortPublicKey), out _);
        return rsa.Encrypt(aesKey, RSAEncryptionPadding.OaepSHA1);
    }

    /// <summary>Encrypts whole blocks of <paramref name="payload"/> in place (CBC, fresh IV each packet).</summary>
    public static void EncryptPayload(Aes aes, byte[] iv, Span<byte> payload)
    {
        int n = payload.Length & ~15;
        if (n == 0) return;
        var enc = aes.EncryptCbc(payload[..n], iv, PaddingMode.None);
        enc.CopyTo(payload);
    }

    public static Aes MakeAes(byte[] key) { var a = Aes.Create(); a.Key = key; return a; }
}
