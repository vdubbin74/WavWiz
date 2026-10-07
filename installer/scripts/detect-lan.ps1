<#
.SYNOPSIS  Used by the wizard's network page: finds the PC's home-network IPv4 address (no WMI/CIM, 10 s limit inside) and writes it to -OutFile. Never prompts; never fails the wizard.
#>
param([string]$OutFile = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Set-NonInteractive $true
$ip = ''
try { $ip = Get-LanIPv4 10 } catch { $ip = '' }
if ($OutFile) { [IO.File]::WriteAllText($OutFile, [string]$ip, (New-Object Text.UTF8Encoding($false))) }
exit 0
