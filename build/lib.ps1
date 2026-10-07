# Helpers for the WavWiz BUILD scripts (not shipped). Dot-source: . "$PSScriptRoot/lib.ps1"
Set-StrictMode -Version Latest
function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn2([string]$m) { Write-Host "    !!  $m" -ForegroundColor Yellow }
function Stop-Build([string]$m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
function Get-RepoRoot { return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
function Get-WavWizVersion {
    $m = Select-String -Path (Join-Path (Get-RepoRoot) 'Directory.Build.props') -Pattern '<WavWizVersion>([^<]+)</WavWizVersion>'
    if (-not $m) { Stop-Build 'WavWizVersion not found in Directory.Build.props' }
    return $m.Matches[0].Groups[1].Value
}
function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Invoke-Checked([string]$What, [scriptblock]$Cmd) { & $Cmd; if ($LASTEXITCODE -ne 0) { Stop-Build "$What failed (exit $LASTEXITCODE)" } }
