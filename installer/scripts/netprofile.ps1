<#
.SYNOPSIS  F273: writes C:\ProgramData\WavWiz\network-status.txt - the network type (Public / Private / Domain) of the CONNECTED networks only, through the
           NetworkListManager COM object (no WMI/CIM, 10 s limit inside). Used by the wizard's Network page, by setup.ps1 once the bind is final, and by the
           Finish page's Check again. Never prompts, never changes a network or firewall setting, never fails the wizard (no answer = no file).
.PARAMETER Bind      The address WavWiz listens on (empty / 0.0.0.0 = the best LAN adapter decides).
.PARAMETER OutFile   Where to write (default C:\ProgramData\WavWiz\network-status.txt).
.PARAMETER DoneFile  Written last (the wizard polls it, so it never waits the full 10 s when the answer is quick).
#>
param([string]$Bind = '', [string]$OutFile = '', [string]$DoneFile = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
try { Start-InstallLog } catch { }
try { [void](Write-NetworkStatus -Bind $Bind -Path $OutFile -TimeoutSec 10) } catch { }
if ($DoneFile) { try { [IO.File]::WriteAllText($DoneFile, '0', (New-Object Text.UTF8Encoding($false))) } catch { } }
exit 0
