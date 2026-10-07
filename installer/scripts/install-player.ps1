<#
.SYNOPSIS  Prepares WavWiz Player on this PC: writes the shared defaults (server address) the player reads on its first start, and checks for the WebView2 runtime (warning only).
           Run by setup.ps1 through run-step.ps1. Idempotent; an existing defaults file is kept unless a server address is given explicitly. Windows PowerShell 5.1 compatible.
           Autostart is an installer registry entry (removed on uninstall) plus the player's own per-user switch.
#>
[CmdletBinding()]
param([string]$Root = '', [string]$DataDir = '', [string]$ServerHost = '', [int]$HttpPort = 47800, [int]$AudioPort = 47801, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
if ($NonInteractive) { Set-NonInteractive $true }
Start-InstallLog
if (-not $Root) { throw 'install-player.ps1 needs -Root <install folder>.' }
if (-not $DataDir) { $DataDir = Get-WavWizDataRoot }
Write-InstallLog ("install-player: NonInteractive switch={0} effective={1} root={2} serverHost={3}" -f [bool]$NonInteractive, (Test-NonInteractive), $Root, $ServerHost)

Set-Step 'player: checking the installed files'
if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $Root 'Player') 'wavwiz-player.exe'))) { throw "Required file not found: $(Join-Path (Join-Path $Root 'Player') 'wavwiz-player.exe')" }

Set-Step 'player: server address defaults'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$defPath = Join-Path $DataDir 'player-defaults.json'
if ($ServerHost) {
    if ($ServerHost -notmatch '^[A-Za-z0-9]([A-Za-z0-9.\-]{0,251}[A-Za-z0-9])?$') { throw "The server address '$ServerHost' is not a valid host name or IPv4 address." }
    $o = [ordered]@{ serverHost = $ServerHost; httpPort = $HttpPort; audioPort = $AudioPort }
    $same = $false
    if (Test-Path -LiteralPath $defPath) { try { $cur = (Read-TextFile $defPath) | ConvertFrom-Json; $same = ($cur.serverHost -eq $ServerHost -and [int]$cur.httpPort -eq $HttpPort -and [int]$cur.audioPort -eq $AudioPort) } catch { } }
    if ($same) { Write-InstallLog 'player-defaults.json already has this server address; not rewritten.' }
    else { Write-Utf8NoBom $defPath (($o | ConvertTo-Json) + "`r`n"); Say "Player will connect to $ServerHost (set in player-defaults.json)." }
} elseif (Test-Path -LiteralPath $defPath) { Say 'Keeping the existing player-defaults.json.' }
else { Say 'No server address given: the player will ask for it on first start.' }

Set-Step 'player: checking the WebView2 runtime'
$wv = 'present'
if ((Test-TestHost) -and $env:WAVWIZ_TEST_WEBVIEW2) { $wv = $env:WAVWIZ_TEST_WEBVIEW2 }
else {
    $wv = 'missing'
    foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
        try { $pv = (Get-ItemProperty -LiteralPath $k -ErrorAction Stop).pv; if ($pv -and $pv -ne '0.0.0.0') { $wv = 'present'; break } } catch { }
    }
}
if ($wv -ne 'present') {
    $n = 'The Microsoft Edge WebView2 runtime was not found. WavWiz Player will open its control page in your web browser instead (everything still works). Windows 11 and up-to-date Windows 10 normally include WebView2.'
    Say "NOTE: $n"; [pscustomobject]@{ Kind = 'notice'; Value = $n }
}
Complete-Step
