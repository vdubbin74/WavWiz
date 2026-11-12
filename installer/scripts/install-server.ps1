<#
.SYNOPSIS  Sets up the WavWiz server on this PC: data folder + permissions, server.json (merged, never clobbered), the Windows service, firewall rules, start + readiness check.
           Run by setup.ps1 in its own powershell.exe through run-step.ps1 (time-limited). Idempotent: a re-run keeps existing settings, updates the service definition in place and
           replaces (never duplicates) the firewall rules. Windows PowerShell 5.1 compatible. Generates NO password or key: the administrator password is chosen on the first-run web page.
#>
[CmdletBinding()]
param(
    [string]$Root = '', [string]$DataDir = '', [string]$LanIp = '', [switch]$AllInterfaces,
    [int]$HttpPort = 47800, [int]$HttpsPort = 47443, [int]$AudioPort = 47801, [int]$ClockPort = 47802,
    [switch]$NoStart, [switch]$NonInteractive, [switch]$AirPlayOut
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
if ($NonInteractive) { Set-NonInteractive $true }
Start-InstallLog
if (-not $Root) { throw 'install-server.ps1 needs -Root <install folder>.' }
if (-not $DataDir) { $DataDir = Get-WavWizDataRoot }
$svc = $script:ServiceName
$serverDir = Join-Path $Root 'Server'; $exe = Join-Path $serverDir 'wavwiz-server.exe'; $ffmpeg = Join-Path (Join-Path $serverDir 'ffmpeg') 'ffmpeg.exe'
Write-InstallLog ("install-server: NonInteractive switch={0} effective={1} root={2} data={3} lanIp={4}" -f [bool]$NonInteractive, (Test-NonInteractive), $Root, $DataDir, $LanIp)

Set-Step 'server: checking the installed files'
foreach ($f in $exe, $ffmpeg, (Join-Path $serverDir 'wwwroot\index.html')) { if (-not (Test-Path -LiteralPath $f)) { throw "Required file not found: $f" } }

Set-Step 'server: data folder and permissions'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Grant-ServiceDataAccess $DataDir

Set-Step 'server: server.json (merge with any existing file)'
$cfgPath = Join-Path $DataDir 'server.json'
$existingJson = ''; if (Test-Path -LiteralPath $cfgPath) { $existingJson = Read-TextFile $cfgPath }
$plan = Get-ServerConfigPlan -ExistingJson $existingJson -LanIp $LanIp -FfmpegPath $ffmpeg -HttpPort $HttpPort -HttpsPort $HttpsPort -AudioPort $AudioPort -ClockPort $ClockPort -AllInterfaces:$AllInterfaces
$bindNow = [string]$plan.Config['bindAddress']
if ($plan.BindAction -eq 'preserved') {
    Write-InstallLog ("bindAddress preserved: {0}" -f $bindNow)
    if ($AllInterfaces) { Write-InstallLog 'network choice: Home network + Tailscale/VPN (all networks) - kept' }
} elseif ($plan.BindAction -eq 'changed') {
    Write-InstallLog ("bindAddress deliberately changed: {0} -> {1}" -f $plan.PreviousBindAddress, $bindNow)
    if ($AllInterfaces) { Write-InstallLog 'network choice: Home network + Tailscale/VPN (all networks) - chosen in Setup' }
} elseif ($plan.BindAction) {
    Write-InstallLog ("bindAddress {0}: {1}" -f $plan.BindAction, $bindNow)
}
if ($plan.Existing) {
    if ($plan.BindAction -eq 'preserved' -and -not $plan.Changed) {
        Say 'Keeping the existing server.json (your settings are not overwritten).'
    } elseif ($plan.BindAction -eq 'changed') {
        if ($AllInterfaces) { Say ("Updating server.json: listening on the home network + Tailscale/VPN (all networks) instead of only {0} (your choice in Setup); unrelated settings are kept." -f $plan.PreviousBindAddress) }
        else { Say ("Updating bindAddress in server.json from {0} to {1} (explicit address from Setup); unrelated settings are kept." -f $plan.PreviousBindAddress, $bindNow) }
    } elseif ($plan.Changed) {
        Say 'Merging into the existing server.json (unrelated settings kept; only missing or installer-directed keys change).'
    } else {
        Say 'Keeping the existing server.json (your settings are not overwritten).'
    }
}
if ($plan.Changed -or -not $plan.Existing) {
    if ($plan.Existing) { try { Copy-Item -LiteralPath $cfgPath -Destination ($cfgPath + '.bak') -Force } catch { } }
    Write-Utf8NoBom $cfgPath (($plan.Config | ConvertTo-Json -Depth 6) + "`r`n")
    Say "server.json written (bindAddress $bindNow)."
} else { Write-InstallLog 'server.json already up to date; not rewritten.' }
foreach ($n in $plan.Notes) { Say "NOTE: $n"; [pscustomobject]@{ Kind = 'notice'; Value = $n } }
$bind = [string]$plan.Config['bindAddress']; $hp = [int]$plan.Config['httpPort']; if ($hp -le 0) { $hp = $HttpPort }

Set-Step 'server: Windows service'
$binPath = Get-ServiceBinPath $exe @('--data-dir', $DataDir)
$exists = Test-ServiceExists $svc
$svcAcct = Get-InstallServiceAccount $svc $exists
Write-InstallLog ("service account {0}: {1}" -f $svcAcct.Action, $svcAcct.Account)
if ($exists) {
    $st = Get-ServiceState $svc
    if ($st -ne 'STOPPED') { [void](Invoke-Sc 'stop (update)' @('stop', $svc) -AllowFail); if (-not (Wait-ServiceState $svc 'STOPPED' 30)) { throw "The $svc service did not stop within 30 s. Close WavWiz, then run the installer again." } }
    [void](Invoke-Sc 'update definition' @('config', $svc, 'binPath=', $binPath, 'start=', 'delayed-auto', 'obj=', $svcAcct.Account, 'DisplayName=', 'WavWiz Server (BETA)'))
    if ($svcAcct.Action -eq 'preserved') { Say ("Service definition updated in place (account kept: {0})." -f $svcAcct.Account) }
    else { Say 'Service definition updated in place.' }
} else {
    [void](Invoke-Sc 'create' @('create', $svc, 'binPath=', $binPath, 'start=', 'delayed-auto', 'obj=', $svcAcct.Account, 'DisplayName=', 'WavWiz Server (BETA)'))
    Say 'Service created.'
}
[void](Invoke-Sc 'description' @('description', $svc, 'WavWiz multi-zone synchronized music server (BETA). Listens on the local network only.'))
[void](Invoke-Sc 'recovery' @('failure', $svc, 'reset=', '86400', 'actions=', 'restart/5000/restart/30000/restart/60000'))
Set-Step 'server: service SID type (CD-ROM access)'
[void](Set-WavWizServiceSidType $svc)
Set-Step 'server: CD-ROM read access for the WavWiz service'
Grant-WavWizCdromAccess

Set-Step 'server: firewall rules (private networks, local subnet only)'
Set-ServerFirewall $exe @([int]$plan.Config['httpPort'], [int]$plan.Config['httpsPort'], [int]$plan.Config['audioPort']) (Get-ServerUdpPorts $plan.Config)
Set-ServerVpnFirewall $exe @([int]$plan.Config['httpPort'], [int]$plan.Config['httpsPort']) (Test-AllNetworksConfig $plan.Config)
Set-Step 'server: firewall rules for the AirPlay and Spotify Connect receivers (private networks, local subnet only)'
Set-ReceiverFirewall $exe $plan.Config
Set-Step ('server: firewall rules for sending to AirPlay speakers (opt-in: ' + $(if ($AirPlayOut) { 'on' } else { 'off - removed if present' }) + ')')
Set-AirPlayOutFirewall $exe ([bool]$AirPlayOut)

if ($NoStart) { Say 'Not starting the service (-NoStart).' }
else {
    Set-Step 'server: starting the service and waiting for it to answer (40 s limit)'
    [void](Invoke-Sc 'start' @('start', $svc) -AllowFail)
    if (-not (Wait-ServiceState $svc 'RUNNING' 30)) { throw "The $svc service did not reach RUNNING. See $(Join-Path $DataDir 'logs\wavwiz-server.log') and $(Join-Path $DataDir 'startup-error.txt') (if present), and the Windows Event Viewer > Application log." }
    $probeHost = Get-ProbeHost $bind   # F268b: never probe the wildcard listen address
    $probe = Test-HttpReady ("http://${probeHost}:$hp/api/v1/auth/state") 40
    if (-not $probe.Ok) { throw "The service is running but the web page at http://${probeHost}:$hp/ does not answer ($($probe.Detail)). See $(Join-Path $DataDir 'logs\wavwiz-server.log')." }
    Say "Server is up ($($probe.Detail))."
}
Complete-Step
[pscustomobject]@{ Kind = 'info'; Name = 'bindAddress'; Value = $bind }
[pscustomobject]@{ Kind = 'info'; Name = 'httpPort'; Value = $hp }
