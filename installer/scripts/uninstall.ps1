<#
.SYNOPSIS  Removes the WavWiz service and firewall rules (called by the uninstaller before files are deleted). -Purge also deletes the data folder (settings, library database, logs, certificates).
           Never fails the uninstall over a missing piece: every step is best-effort and logged. Windows PowerShell 5.1 compatible.
#>
[CmdletBinding()]
param([string]$Root = '', [string]$DataDir = '', [int]$Purge = 0, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
Start-InstallLog
if (-not $DataDir) { $DataDir = Get-WavWizDataRoot }
$svc = $script:ServiceName; $problems = 0
function Step([string]$Name, [scriptblock]$Do) { Set-Step $Name; try { & $Do } catch { $script:problems++; Say ("uninstall: '{0}' did not complete: {1}" -f $Name, ($_.Exception.Message -split "`n")[0]) } }
Step 'uninstall: stop and remove the service' {
    if (Test-ServiceExists $svc) {
        if ((Get-ServiceState $svc) -ne 'STOPPED') { [void](Invoke-Sc 'stop' @('stop', $svc) -AllowFail); [void](Wait-ServiceState $svc 'STOPPED' 30) }
        [void](Invoke-Sc 'delete' @('delete', $svc) -AllowFail); Say 'Service removed.'
    } else { Say 'No WavWiz service to remove.' }
}
Step 'uninstall: remove firewall rules' { Remove-ServerFirewall; Say 'Firewall rules removed.' }
Step 'uninstall: remove the player autostart for this user' {
    if (-not (Test-TestHost)) { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WavWizPlayer' -ErrorAction SilentlyContinue }
}
if ($Purge) {
    Step 'uninstall: delete the data folder (you chose to)' {
        $rootData = Get-WavWizDataRoot
        if ($DataDir -ne $rootData -and $DataDir -notlike "$rootData*") { throw "refusing to delete '$DataDir': it is not the WavWiz data folder" }
        if (Test-Path -LiteralPath $DataDir) { Remove-Item -LiteralPath $DataDir -Recurse -Force; Say "Deleted $DataDir." }
    }
} else { Say "Your data was kept: $DataDir" }
Complete-Step
if ($problems -gt 0) { Say "Uninstall finished with $problems step(s) that could not complete (see above); the files are still removed." }
exit 0
