<#
.SYNOPSIS  One command Windows build: restore + build, quick smoke tests, publish, installer -> C:\Users\<you>\WavWiz-Setup-<ver>.exe, then size / SHA-256 / version.
           powershell -ExecutionPolicy Bypass -File build\build-win.ps1 [-OutDir C:\Users\trevo] [-SkipTests]
           Needs build\setup-build.ps1 to have run once. Builds only; it never runs or installs the setup program.
#>
[CmdletBinding()] param([string]$OutDir = $env:USERPROFILE, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$root = Get-RepoRoot; $ver = Get-WavWizVersion
$env:WAVWIZ_TOOLS_CACHE = Join-Path $root 'payload'          # prebuilt LGPL ffmpeg + receivers (no bash/mingw needed on Windows)
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
Write-Step "WavWiz $ver - restore + build (Release)"
Invoke-Checked 'restore' { & dotnet restore (Join-Path $root 'WavWiz.sln') }
Invoke-Checked 'build' { & dotnet build (Join-Path $root 'WavWiz.sln') -c Release --no-restore }
if (-not $SkipTests) {
  Write-Step 'smoke tests (Core + Dsp unit tests)'
  foreach ($t in 'WavWiz.Core.Tests', 'WavWiz.Dsp.Tests') { $p = Join-Path $root "tests/$t"; if (Test-Path $p) { Invoke-Checked "$t" { & dotnet test $p -c Release --no-restore } } }
}
Write-Step 'publish + installer'
& (Join-Path $PSScriptRoot 'build.ps1') -ToolsCache $env:WAVWIZ_TOOLS_CACHE -Installer; if ($LASTEXITCODE -ne 0) { Stop-Build "build.ps1 failed ($LASTEXITCODE)" }
Write-Step 'smoke: published binaries carry the version'
foreach ($b in 'dist\server\wavwiz-server.exe', 'dist\player\wavwiz-player.exe') {
  $fv = (Get-Item (Join-Path $root $b)).VersionInfo; $pv = "$($fv.ProductVersion)"
  if (-not $pv.StartsWith($ver)) { Stop-Build "$b is stamped '$pv', expected $ver" }; Write-Ok "$b  $pv"
}
$exe = Join-Path $root "dist\release\WavWiz-Setup-$ver.exe"; if (-not (Test-Path $exe)) { Stop-Build "installer not found: $exe" }
$dst = Join-Path $OutDir "WavWiz-Setup-$ver.exe"; Copy-Item $exe $dst -Force
$size = (Get-Item $dst).Length; $sha = Get-Sha256 $dst; $iv = (Get-Item $dst).VersionInfo.ProductVersion
Write-Host ("`nWavWiz-Setup-{0}.exe -> {1}`n  version: {2}`n  size   : {3:N0} bytes`n  sha256 : {4}`n(Not run. Install it yourself when ready.)" -f $ver, $dst, $iv, $size, $sha) -ForegroundColor Green
