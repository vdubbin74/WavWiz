<#
.SYNOPSIS  One-time toolchain setup for building WavWiz on Windows (PCBOXV3D). Checks each tool and installs ONLY what is missing, with winget.
           Run from an elevated or normal PowerShell:  powershell -ExecutionPolicy Bypass -File build\setup-build.ps1
.NOTES     What it may install (winget ID -> version):
             Microsoft.DotNet.SDK.10      -> 10.0.401   (exact SDK pinned by global.json; latest 10.0.4xx patch accepted)
             JRSoftware.InnoSetup         -> 6.x        (ISCC.exe compiles installer\WavWiz.iss)
             Microsoft.PowerShell         -> 7.x        (pwsh; the build scripts also run on Windows PowerShell 5.1)
             Git.Git                      -> latest     (BUILD-INFO commit id, future git-bundle updates)
           NOT installed, and why: ffmpeg (LGPL-only own build) and the AirPlay / Spotify receivers are cross-compiled on Linux with mingw;
           their prebuilt outputs ship in the source archive under payload\ (checked below). The WebView2 runtime is not a build dependency
           (the Player uses the Evergreen runtime already on Windows 10/11). No Node / Playwright: the UI suites run on the build box, not here.
#>
[CmdletBinding()] param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Say($m, $c = 'Cyan') { Write-Host $m -ForegroundColor $c }
$wantSdk = ((Get-Content (Join-Path $root 'global.json') -Raw | ConvertFrom-Json).sdk.version)
$problems = @()
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Say 'winget (App Installer) is missing: install "App Installer" from the Microsoft Store, then run this again.' 'Red'; exit 1 }
function Install-Pkg($id, $ver) {
  if ($CheckOnly) { $script:problems += "$id $ver"; Say "  would install $id $ver" 'Yellow'; return }
  $a = @('install', '--id', $id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent')
  if ($ver) { $a += @('--version', $ver) }
  Say "  winget $($a -join ' ')" 'Yellow'; & winget @a; if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget install $id failed ($LASTEXITCODE)" }
}
Say "==> .NET SDK $wantSdk"
$sdks = @(); try { $sdks = & dotnet --list-sdks 2>$null } catch { }
$major = $wantSdk.Substring(0, $wantSdk.LastIndexOf('.') ) + '.'   # 10.0.
$band = $wantSdk.Substring(0, $wantSdk.Length - 2)                   # 10.0.4 (feature band)
if ($sdks | Where-Object { $_ -like "$band*" -and ([version]($_ -split ' ')[0] -ge [version]$wantSdk) }) { Say "  OK  $(($sdks | Where-Object { $_ -like "$band*" }) -join ', ')" 'Green' } else { Install-Pkg 'Microsoft.DotNet.SDK.10' $wantSdk }
Say '==> Inno Setup 6'
$iscc = @(${env:ProgramFiles(x86)}, $env:ProgramFiles, (Join-Path $env:LOCALAPPDATA 'Programs')) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Inno Setup 6\ISCC.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) { Say "  OK  $iscc" 'Green' } else { Install-Pkg 'JRSoftware.InnoSetup' $null }
Say '==> PowerShell 7 (pwsh)'
if (Get-Command pwsh -ErrorAction SilentlyContinue) { Say "  OK  $((& pwsh -NoProfile -c '$PSVersionTable.PSVersion.ToString()'))" 'Green' } else { Install-Pkg 'Microsoft.PowerShell' $null }
Say '==> Git'
if (Get-Command git -ErrorAction SilentlyContinue) { Say "  OK  $(& git --version)" 'Green' } else { Install-Pkg 'Git.Git' $null }
Say '==> prebuilt payloads (from the source archive)'
foreach ($f in 'payload\ffmpeg-lgpl\out\bin\ffmpeg.exe', 'payload\ffmpeg-lgpl\out\CONFIGURE-LINE.txt', 'payload\ffmpeg-lgpl\out\ffmpeg-8.1.3.tar.xz', 'payload\receivers\out\bin\librespot.exe', 'payload\receivers\out\bin\wavwiz-airplay.exe', 'payload\receivers\out\VERSIONS.txt') {
  if (Test-Path (Join-Path $root $f)) { Say "  OK  $f" 'Green' } else { $problems += $f; Say "  MISSING $f (re-extract the source archive; it carries payload\)" 'Red' }
}
if ($problems.Count) { Say "`nNot ready: $($problems -join '; ')" 'Red'; if (-not $CheckOnly) { exit 1 } } else { Say "`nToolchain ready. Open a NEW PowerShell window (PATH changes), then run:  powershell -ExecutionPolicy Bypass -File build\build-win.ps1" 'Green' }
