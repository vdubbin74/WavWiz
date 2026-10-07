<#
.SYNOPSIS  Builds the self-contained win-x64 publish folders in dist/ (server, player), builds/uses the LGPL-only ffmpeg, assembles licenses and BUILD-INFO. -Installer also runs make-installer.ps1.
           Runs on Linux (how it is built here: `EnableWindowsTargeting`) and on Windows. The result is UNSIGNED and has not been run on Windows.
.PARAMETER ToolsCache  Where the ffmpeg build and downloads are cached (default: <repo>/.cache; env WAVWIZ_TOOLS_CACHE). The ffmpeg tarball is verified against build/ffmpeg-lgpl.sha256.
#>
[CmdletBinding()]
param([string]$ToolsCache = '', [switch]$Installer, [switch]$SkipPublish)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$root = Get-RepoRoot; $dist = Join-Path $root 'dist'; $ver = Get-WavWizVersion
if (-not $ToolsCache) { $ToolsCache = if ($env:WAVWIZ_TOOLS_CACHE) { $env:WAVWIZ_TOOLS_CACHE } else { Join-Path $root '.cache' } }
New-Item -ItemType Directory -Force -Path $ToolsCache | Out-Null

if (-not $SkipPublish) {
    if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $common = @('-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=false', '-p:PublishTrimmed=false', '-p:PublishAot=false', '-p:Deterministic=true', '-p:ContinuousIntegrationBuild=true', '-p:SatelliteResourceLanguages=en', '-p:DebugType=none')
    Write-Step "publish wavwiz-server (self-contained win-x64, $ver)"
    Invoke-Checked 'server publish' { & dotnet publish (Join-Path $root 'src/WavWiz.Server') @common -o (Join-Path $dist 'server') }
    Write-Step "publish wavwiz-player (self-contained win-x64, $ver)"
    Invoke-Checked 'player publish' { & dotnet publish (Join-Path $root 'src/WavWiz.Player') @common -o (Join-Path $dist 'player') }
}
foreach ($f in 'server/wavwiz-server.exe', 'server/wwwroot/index.html', 'server/wwwroot/js/main.js', 'server/wwwroot/app.css', 'player/wavwiz-player.exe', 'player/WebView2Loader.dll') {
    if (-not (Test-Path (Join-Path $dist $f))) { Stop-Build "publish output is missing $f" }
}
Write-Ok 'publish output complete (server + wwwroot, player + WebView2 loader)'

Write-Step 'ffmpeg (WavWiz LGPL-only decode build, shared DLLs)'
# 0.0.3: FFmpeg 8.1.3 is built from the unmodified release tarball by build/build-ffmpeg-lgpl.sh (mingw-w64 cross build, no GPL, no nonfree, no external codec libraries).
$ffOut = Join-Path $ToolsCache 'ffmpeg-lgpl/out'
if (-not (Test-Path (Join-Path $ffOut 'bin/ffmpeg.exe'))) {
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if (-not $bash) { Stop-Build "No LGPL ffmpeg build found in $ffOut and bash/mingw are not available to make one. Run build/build-ffmpeg-lgpl.sh on Linux (or WSL) first. (The GPL 'full' ffmpeg must never be used.)" }
    $env:WAVWIZ_TOOLS_CACHE = $ToolsCache
    Invoke-Checked 'ffmpeg LGPL build' { & bash (Join-Path $PSScriptRoot 'build-ffmpeg-lgpl.sh') }
}
$cfgLine = (Get-Content (Join-Path $ffOut 'CONFIGURE-LINE.txt') -Raw).Trim()
if ($cfgLine -match '--enable-gpl|--enable-nonfree|--enable-version3|--enable-libx26|--enable-libfdk') { Stop-Build "ffmpeg configure line is not LGPL-only: $cfgLine" }
$ffDir = Join-Path $dist 'server/ffmpeg'; $licDir = Join-Path $dist 'licenses'; $srcDir = Join-Path $licDir 'source'
New-Item -ItemType Directory -Force -Path $ffDir, $licDir, $srcDir | Out-Null
foreach ($f in 'ffmpeg.exe', 'avcodec-62.dll', 'avformat-62.dll', 'avutil-60.dll', 'avfilter-11.dll', 'swresample-6.dll', 'swscale-9.dll') {
    $p = Join-Path $ffOut "bin/$f"; if (-not (Test-Path $p)) { Stop-Build "ffmpeg build is missing $f" }
    Copy-Item $p (Join-Path $ffDir $f) -Force
}
# 0.0.5: standalone wavwiz-cdda (LGPL libcdio helper) + chromaprint fpcalc; FFmpeg stays LGPL (no --enable-libcdio — that demuxer is GPL-gated)
Get-ChildItem (Join-Path $ffOut 'bin') -Filter '*.dll' | ForEach-Object {
    if ($_.Name -notmatch '^av|^sw') { Copy-Item $_.FullName (Join-Path $ffDir $_.Name) -Force }
}
foreach ($f in @('fpcalc.exe', 'fpcalc', 'wavwiz-cdda.exe')) {
    $p = Join-Path $ffOut "bin/$f"; if (Test-Path $p) { Copy-Item $p (Join-Path $ffDir $f) -Force }
}
if (-not (Test-Path (Join-Path $ffDir 'wavwiz-cdda.exe'))) { Stop-Build "wavwiz-cdda.exe missing from ffmpeg build (CDDA helper)" }
if ($cfgLine -match '--enable-gpl|--enable-libcdio|--enable-nonfree') { Stop-Build "ffmpeg configure line must stay LGPL without libcdio: $cfgLine" }
Write-Ok "LGPL-only ffmpeg + wavwiz-cdda (libcdio) + optional fpcalc"
$ffsha = Get-Sha256 (Join-Path $ffDir 'ffmpeg.exe')
$ffVer = '8.1.3'; $tar = "ffmpeg-$ffVer.tar.xz"; $ztar = 'zlib-1.3.1.tar.gz'
Copy-Item (Join-Path $ffOut $tar) $srcDir -Force; Copy-Item (Join-Path $ffOut $ztar) $srcDir -Force; Copy-Item (Join-Path $PSScriptRoot 'build-ffmpeg-lgpl.sh') $srcDir -Force
Copy-Item (Join-Path $PSScriptRoot 'ffmpeg-lgpl.sha256') $srcDir -Force

# 0.1.1: AirPlay + Spotify Connect receivers (separate bundled programs): wavwiz-airplay.exe (shairplay, LGPL-2.1+), librespot.exe (MIT), wavwiz-hook.exe (ours)
Write-Step 'receivers (AirPlay: shairplay; Spotify Connect: librespot)'
$rcOut = Join-Path $ToolsCache 'receivers/out'
if (-not (Test-Path (Join-Path $rcOut 'bin/librespot.exe')) -or -not (Test-Path (Join-Path $rcOut 'bin/wavwiz-airplay.exe'))) {
    $env:WAVWIZ_TOOLS_CACHE = $ToolsCache
    Invoke-Checked 'receivers build' { & bash (Join-Path $PSScriptRoot 'build-receivers.sh') }
}
$rcDir = Join-Path $dist 'server/receivers'; New-Item -ItemType Directory -Force -Path $rcDir | Out-Null
foreach ($f in 'wavwiz-airplay.exe', 'airport.key', 'librespot.exe', 'wavwiz-hook.exe') {
    $p = Join-Path $rcOut "bin/$f"; if (-not (Test-Path $p)) { Stop-Build "receiver build is missing $f" }
    Copy-Item $p (Join-Path $rcDir $f) -Force
}
Get-ChildItem (Join-Path $rcOut 'source') -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $srcDir $_.Name) -Force }
Copy-Item (Join-Path $PSScriptRoot 'build-receivers.sh') $srcDir -Force
Get-ChildItem (Join-Path $PSScriptRoot 'receivers') -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $srcDir $_.Name) -Force }
Write-Ok 'receivers: wavwiz-airplay.exe, librespot.exe, wavwiz-hook.exe (+ sources in licenses\source)'

Write-Step 'licenses and notices'
$webLic = Join-Path $root 'src/WavWiz.Server/wwwroot/licenses'
Get-ChildItem $webLic -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $licDir $_.Name) -Force }
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $licDir 'LICENSE.txt') -Force
$files = ((Get-Content (Join-Path $ffOut 'FILES.sha256')) | ForEach-Object { '  ' + $_ }) -join "`n"
$bt = (Get-Content (Join-Path $root 'installer/FFMPEG-BUILD.template.txt') -Raw)
$bt = $bt.Replace('{{VERSION}}', $ffVer).Replace('{{APPVERSION}}', $ver).Replace('{{DATE}}', (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).Replace('{{CONFIG}}', '  ' + $cfgLine).Replace('{{FILES}}', $files)
$bt = $bt.Replace('{{TARNAME}}', $tar).Replace('{{TARSHA}}', (Get-Sha256 (Join-Path $srcDir $tar))).Replace('{{ZNAME}}', $ztar).Replace('{{ZSHA}}', (Get-Sha256 (Join-Path $srcDir $ztar)))
[IO.File]::WriteAllText((Join-Path $licDir 'FFMPEG-BUILD.txt'), $bt, (New-Object Text.UTF8Encoding($false)))
# the web page (Settings > About) links to /licenses/*.txt, so the server's wwwroot gets the same files
$wl = Join-Path $dist 'server/wwwroot/licenses'; New-Item -ItemType Directory -Force -Path $wl | Out-Null
Get-ChildItem $licDir -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $wl $_.Name) -Force }
foreach ($need in 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'FFMPEG-BUILD.txt', 'COPYING.LGPLv2.1.txt', 'COPYING.LGPLv3.txt', 'PRIVACY.txt', 'OFL-Nunito.txt', 'LICENSE-librespot.txt', 'LICENSE-shairplay.txt') { if (-not (Test-Path (Join-Path $licDir $need))) { Stop-Build "license file missing: $need" } }
Copy-Item (Join-Path $root 'README.md') (Join-Path $dist 'README.md') -Force

Write-Step 'BUILD-INFO.txt'
$commit = ''; try { $commit = (& git -C $root rev-parse --short HEAD).Trim() } catch { }
$dirty = ''; try { if ((& git -C $root status --porcelain) ) { $dirty = ' (uncommitted changes)' } } catch { }
$sdk = (& dotnet --version).Trim()
@"
WavWiz (BETA) $ver
Built    : $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm')) UTC
Commit   : $commit$dirty
.NET SDK : $sdk (self-contained win-x64; the target PC needs no .NET)
ffmpeg   : $ffVer LGPL-only shared build (own build, see licenses\FFMPEG-BUILD.txt), ffmpeg.exe sha256 $ffsha
receivers: $((Get-Content (Join-Path $rcOut 'VERSIONS.txt') -Raw).Trim()) (separate processes; see licenses\THIRD-PARTY-NOTICES.txt)
Signing  : NONE (unsigned beta). NOT yet run on Windows.
"@ | Set-Content (Join-Path $dist 'BUILD-INFO.txt') -Encoding ascii
Write-Ok "dist ready: $dist"
if ($Installer) { & (Join-Path $PSScriptRoot 'make-installer.ps1'); if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
