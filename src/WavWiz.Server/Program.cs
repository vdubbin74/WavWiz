using Microsoft.Extensions.Hosting.WindowsServices;
using WavWiz.Core;
using WavWiz.Server;
using WavWiz.Server.Host;

// wavwiz-server [--data-dir <path>] [--bind <ip>]    (as a Windows service: installed and configured by the installer)
try
{
    for (int i = 0; i < args.Length - 1; i++)
    {
        if (args[i] == "--data-dir") Environment.SetEnvironmentVariable("WAVWIZ_DATA_DIR", args[i + 1]);
        if (args[i] == "--bind") Environment.SetEnvironmentVariable("WAVWIZ_BIND", args[i + 1]);
    }
    if (args.Contains("--version")) { Console.WriteLine(WavWizInfo.DisplayName); return 0; }
    var cfg = ServerConfig.Load();
    bool svc = WindowsServiceHelpers.IsWindowsService();
    await using var server = await WavWizServer.StartAsync(cfg, args, svc);
    if (!svc) Console.WriteLine($"{WavWizInfo.DisplayName} - listening on {server.HttpUrl} (Ctrl+C to stop)");
    await server.App.WaitForShutdownAsync();
    return 0;
}
catch (Exception e)
{
    Console.Error.WriteLine("WavWiz server could not start: " + e.Message);
    try { Directory.CreateDirectory(ServerConfig.DefaultDataDir()); File.AppendAllText(Path.Combine(ServerConfig.DefaultDataDir(), "startup-error.txt"), $"{DateTimeOffset.Now:O} {e}\n"); } catch { }
    return 1;
}

public partial class Program { }
