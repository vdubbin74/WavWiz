<#
.SYNOPSIS  Compiles installer/WavWiz.iss with Inno Setup (ISCC) -> dist/release/WavWiz-Setup-<version>.exe (FULL self-contained installer only; there is no slim variant). Prints size + SHA-256.
           Needs dist/ (run build/build.ps1 first). On Linux: Inno Setup under Wine; set RR_ISCC / WAVWIZ_ISCC or -IsccPath to the ISCC.exe inside the Wine prefix.
#>
[CmdletBinding()]
param([string]$IsccPath = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$root = Get-RepoRoot; $dist = Join-Path $root 'dist'; $ver = Get-WavWizVersion; $iss = Join-Path $root 'installer/WavWiz.iss'
if (-not (Test-Path (Join-Path $dist 'server/wavwiz-server.exe'))) { Stop-Build 'dist/ not found - run build/build.ps1 first.' }
$onWindows = ($PSVersionTable.PSEdition -eq 'Desktop') -or ($IsWindows -eq $true)
$iscc = $IsccPath; if (-not $iscc) { $iscc = $env:WAVWIZ_ISCC }; if (-not $iscc) { $iscc = $env:RR_ISCC }
if (-not $iscc -and $onWindows) {
    foreach ($b in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, (Join-Path $env:LOCALAPPDATA 'Programs'))) { if ($b) { $c = Join-Path $b 'Inno Setup 6\ISCC.exe'; if (Test-Path $c) { $iscc = $c; break } } }
}
if (-not $iscc -or -not (Test-Path $iscc)) { Stop-Build 'ISCC.exe not found. Install Inno Setup 6 (https://jrsoftware.org/isdl.php) or pass -IsccPath <ISCC.exe>.' }
$out = Join-Path $dist 'release'; New-Item -ItemType Directory -Force -Path $out | Out-Null
$exeName = "WavWiz-Setup-$ver.exe"; $exe = Join-Path $out $exeName; if (Test-Path $exe) { Remove-Item $exe -Force }
function ConvertTo-IsccPath([string]$p) { if ($onWindows) { return $p } else { return (& winepath -w $p) } }
Write-Step "compile $iss (FULL, self-contained)"
$a = @('/Q', "/DAppVersion=$ver", ('/DDistDir=' + (ConvertTo-IsccPath $dist)), ('/DRepoDir=' + (ConvertTo-IsccPath $root)), ('/DOutDir=' + (ConvertTo-IsccPath $out)), (ConvertTo-IsccPath $iss))
if ($onWindows) { & $iscc @a } else { $env:WINEDEBUG = '-all'; & wine $iscc @a }
if ($LASTEXITCODE -ne 0) { Stop-Build "ISCC failed (exit $LASTEXITCODE)" }
if (-not (Test-Path $exe)) { Stop-Build "ISCC reported success but $exe does not exist." }
$size = (Get-Item $exe).Length; $sha = Get-Sha256 $exe
"$sha  $exeName" | Set-Content (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
Write-Host ("`nInstaller built: {0}`n  size   : {1:N0} bytes ({2:N1} MiB)`n  sha256 : {3}" -f $exe, $size, ($size / 1MB), $sha) -ForegroundColor Green
Write-Warn2 'UNSIGNED and NOT yet run on Windows - see docs/INSTALLER.md.'
