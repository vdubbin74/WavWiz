<#
.SYNOPSIS  Removes the WavWiz service and firewall rules (called by the uninstaller before files are deleted). -Purge also deletes the data folder (settings, library database, logs, certificates).
           Never fails the uninstall over a missing piece: every step is best-effort and logged. Windows PowerShell 5.1 compatible.
#>
[CmdletBinding()]
param([string]$Root = '', [string]$DataDir = '', [int]$Purge = 0, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
Start-InstallLog 'uninstall.log'
Say ("== WavWiz uninstall ({0}) root={1} purge={2} ==" -f (Get-Date -Format s), $Root, $Purge)
if (-not $DataDir) { $DataDir = Get-WavWizDataRoot }
$svc = $script:ServiceName; $problems = 0
function Step([string]$Name, [scriptblock]$Do) { Set-Step $Name; try { & $Do } catch { $script:problems++; Say ("uninstall: '{0}' did not complete: {1}" -f $Name, ($_.Exception.Message -split "`n")[0]) } }
Step 'uninstall: remove the CD-ROM read grant' { Revoke-WavWizCdromAccess }
Step 'uninstall: stop and remove the service' {
    if (Test-ServiceExists $svc) {
        if ((Get-ServiceState $svc) -ne 'STOPPED') { [void](Invoke-Sc 'stop' @('stop', $svc) -AllowFail); [void](Wait-ServiceState $svc 'STOPPED' 30) }
        [void](Invoke-Sc 'delete' @('delete', $svc) -AllowFail); Say 'Service removed.'
    } else { Say 'No WavWiz service to remove.' }
}
Step 'uninstall: close WavWiz Player and anything else running from the install folder (0.2.2 T11)' {
    $cs = Join-Path $PSScriptRoot 'close-wavwiz.ps1'
    if ($Root -and (Test-Path -LiteralPath $cs)) { & $cs -Root $Root -PlayerWaitSec 5 -LockRetrySec 5 | Out-Null }
}
Step 'uninstall: remove firewall rules' { Remove-ServerFirewall; Say 'Firewall rules removed.' }
Step 'uninstall: remove the player autostart for this user' {
    if (-not (Test-TestHost)) { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WavWizPlayer' -ErrorAction SilentlyContinue }
}
if ($Purge) {
    Step 'uninstall: delete the data folder (you chose to)' {
        $rootData = Get-WavWizDataRoot
        if ($DataDir -ne $rootData -and $DataDir -notlike "$rootData*") { throw "refusing to delete '$DataDir': it is not the WavWiz data folder" }
        # F173: uninstall.log itself is kept for diagnosis; everything else goes
        if (Test-Path -LiteralPath $DataDir) {
            foreach ($i in @(Get-ChildItem -LiteralPath $DataDir -Force)) { if ($i.Name -ine 'uninstall.log') { Remove-Item -LiteralPath $i.FullName -Recurse -Force } }
            Say "Deleted the contents of $DataDir (only uninstall.log is kept)."
        }
    }
} else { Say "Your data was kept: $DataDir" }
Step 'uninstall: make sure no WavWiz process is left (F173)' {
    if (-not (Test-TestHost)) {
        foreach ($n in 'wavwiz-player', 'wavwiz-server') { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
        if ($Root) { $d = $Root.TrimEnd('\') + '\'; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) -and $_.Name -notlike 'unins*' } | Stop-Process -Force -ErrorAction SilentlyContinue }
    }
}
Complete-Step
if ($problems -gt 0) { Say "Uninstall finished with $problems step(s) that could not complete (see above); the files are still removed." }
exit 0
