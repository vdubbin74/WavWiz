<#
.SYNOPSIS  Post-copy setup run by the WavWiz installer (installer\WavWiz.iss) as the installing, elevated user. Windows PowerShell 5.1 compatible.
.PARAMETER Root       Install folder ({app}) containing Server\ and/or Player\ (already copied) and scripts\.
.PARAMETER Role       server | player | both
.PARAMETER LanIp      The home-network address the server listens on (chosen in the wizard; never 0.0.0.0).
.PARAMETER ServerHost For a Player-only install: the server's address. With role both the player uses this PC's server address.
.PARAMETER NoDialog   1 = silent install: do not show windows (notices are still written to setup-notices.txt).
.PARAMETER NoStart    1 = do not start the service (used by tests / advanced users).
.PARAMETER DoneFile   The wizard deletes this file first; setup.ps1 writes the exit code into it as its very last act. The wizard polls it, so it can show the current step and never wait forever.
.NOTES     Never touches Windows Defender or any security setting; never writes a secret to a log, the registry or an argument list. NOT run on Windows yet (docs/INSTALLER.md).
#>
[CmdletBinding()]
param(
    [string]$Root = '', [ValidateSet('server', 'player', 'both')][string]$Role = 'both', [string]$LanIp = '', [string]$ServerHost = '',
    [int]$HttpPort = 47800, [int]$HttpsPort = 47443, [int]$AudioPort = 47801, [int]$ClockPort = 47802,
    [int]$NoDialog = 0, [int]$NoStart = 0, [string]$SetupVersion = '', [string]$DoneFile = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
if (-not $Root) { Write-Host 'setup.ps1 needs -Root <install folder>.'; exit 2 }   # no Mandatory attribute: a missing value must never turn into a prompt
$global:WavWizThrowOnStop = $true
function Write-Done([int]$code) { if ($DoneFile) { try { [IO.File]::WriteAllText($DoneFile, [string]$code, (New-Object Text.UTF8Encoding($false))) } catch { } } }
$ServerLimitSec = 240; $PlayerLimitSec = 90
try {
    Start-InstallLog
    try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'setup.pid') ([string]$PID) } catch { }   # lets the wizard stop this process if it ever hangs
    foreach ($f in 'setup-notices.txt', 'first-run-url.txt', 'last-setup-error.txt') { try { Remove-Item -LiteralPath (Join-Path (Get-WavWizDataRoot) $f) -Force -ErrorAction SilentlyContinue } catch { } }
    Set-Step 'setup: starting'
    Say "== WavWiz BETA setup ($(Get-Date -Format s)) version=$SetupVersion role=$Role lanIp=$LanIp =="
    if (-not (Test-IsAdmin)) { Stop-Setup 'Setup must run elevated (the installer requests administrator rights).' }
    Set-Step 'setup: checking the installed files'
    $pf = Get-PreflightReport -Root $Root -Role $Role
    foreach ($n in $pf.Notes) { Say "preflight: $n" }
    if ($pf.Problems.Count -gt 0) { throw ("Pre-flight check failed - no service, rule or setting was touched:`r`n" + (($pf.Problems | ForEach-Object { " - $_" }) -join "`r`n")) }
    $notices = New-Object System.Collections.Generic.List[string]; $bind = ''; $port = $HttpPort

    # 0.0.3: an earlier "Unison" install (service, data folder, firewall rules, autostart, program folder) is moved over first, so that everything below sees the WavWiz layout
    Set-Step 'setup: checking for an earlier Unison installation'
    $mig = Invoke-LegacyMigration -NewRoot $Root
    foreach ($n in $mig.Notes) { $notices.Add([string]$n) }
    if ($mig.Found) { $notices.Add('Upgraded from Unison: your library, settings, administrator password and paired players were kept. This PC and your phones use WavWiz now; PCs running the old Unison Player keep working until you update them.') }

    if ($Role -in 'server', 'both') {
        if (-not $LanIp) {
            # a re-run without an explicit address keeps the address already in server.json; detection is only for a first install
            $cfgFile = Join-Path (Get-WavWizDataRoot) 'server.json'; $haveAddr = $false
            if (Test-Path -LiteralPath $cfgFile) { try { $haveAddr = [bool]((Read-TextFile $cfgFile) | ConvertFrom-Json).bindAddress } catch { } }
            if ($haveAddr) { Say 'No address was passed; keeping the address in the existing server.json.' }
            else { $LanIp = Get-LanIPv4 10; if ($LanIp) { Say "No address was passed; detected $LanIp." } }
        }
        Set-Step 'setup: server install (own process, 240 s limit)'
        $sp = @{ Root = $Root; LanIp = $LanIp; HttpPort = $HttpPort; HttpsPort = $HttpsPort; AudioPort = $AudioPort; ClockPort = $ClockPort; NonInteractive = $true }
        if ($NoStart) { $sp.NoStart = $true }
        $r = Invoke-SubScript -Script (Join-Path $PSScriptRoot 'install-server.ps1') -Params $sp -TimeoutSec $ServerLimitSec -Label 'server install'
        foreach ($o in $r.Objects) {
            if ($o.Kind -eq 'notice') { $notices.Add([string]$o.Value) }
            elseif ($o.Kind -eq 'info' -and $o.Name -eq 'bindAddress') { $bind = [string]$o.Value }
            elseif ($o.Kind -eq 'info' -and $o.Name -eq 'httpPort') { $port = [int]$o.Value }
        }
        Set-Step 'setup: server install finished'
    }
    if ($Role -in 'player', 'both') {
        $host2 = $ServerHost; if ($Role -eq 'both' -and $bind) { $host2 = $bind }
        Set-Step 'setup: player install (own process, 90 s limit)'
        $pp = @{ Root = $Root; ServerHost = $host2; HttpPort = $port; AudioPort = $AudioPort; NonInteractive = $true }
        $r = Invoke-SubScript -Script (Join-Path $PSScriptRoot 'install-player.ps1') -Params $pp -TimeoutSec $PlayerLimitSec -Label 'player install'
        foreach ($o in $r.Objects) { if ($o.Kind -eq 'notice') { $notices.Add([string]$o.Value) } }
        Set-Step 'setup: player install finished'
    }
    if ($bind) { try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'first-run-url.txt') ("http://${bind}:$port/") } catch { } }
    if ($notices.Count -gt 0) {
        # shown by the installer wizard itself (a window from this hidden process is not reliable); no secrets in it
        try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'setup-notices.txt') (($notices | ForEach-Object { '- ' + $_ }) -join "`r`n`r`n") } catch { }
    }
    Complete-Step
    Say 'WavWiz setup finished.'
    Write-Done 0
    exit 0
}
catch {
    $m = $_.Exception.Message -replace '^FAILED:\s*', ''
    $last = ''; try { $last = Get-LastStep } catch { }
    Say ("SETUP FAILED: " + $m)
    if ($last) { Say ("   last step: " + $last) }
    $where = ''; try { $where = Get-ErrorWhere $_ } catch { }
    if ($where) { Say ("   " + ($where -replace "`n", "`n   ")) }
    Say ("   full log: " + (Join-Path (Get-WavWizDataRoot) 'install.log'))
    try { Write-Utf8NoBom (Join-Path (Get-WavWizDataRoot) 'last-setup-error.txt') ("{0}`r`n{1}`r`n{2}`r`n{3}`r`n" -f (Get-Date -Format s), $m, $(if ($last) { "last step: $last" } else { '' }), $where) } catch { }
    Write-Done 1
    exit 1
}
