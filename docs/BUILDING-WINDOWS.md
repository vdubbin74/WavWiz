# Building WavWiz on Windows

1. Extract the source archive to `C:\Users\trevo\WavWiz-src\` (it contains `payload\` with the prebuilt LGPL ffmpeg and receivers).
2. Once: `powershell -ExecutionPolicy Bypass -File build\setup-build.ps1` (installs only what is missing via winget:
   Microsoft.DotNet.SDK.10 10.0.401, JRSoftware.InnoSetup 6, Microsoft.PowerShell 7, Git.Git). `-CheckOnly` lists without installing.
3. Open a new PowerShell window, `cd C:\Users\trevo\WavWiz-src`, then
   `powershell -ExecutionPolicy Bypass -File build\build-win.ps1`
   -> `C:\Users\trevo\WavWiz-Setup-<ver>.exe` plus its size, SHA-256 and version. The script never runs the installer.

## Later releases: send a git bundle, not the whole tree
The archive is a git checkout (`.git` included). For the next version the build box sends only the new commits:

    # build box (private repo), from the commit the PC already has (see BUILD-INFO.txt / `git -C WavWiz-src log -1`)
    git bundle create wavwiz-0.4.5..0.4.6.bundle v045-pc..HEAD      # usually a few hundred KB
    sha256sum wavwiz-0.4.5..0.4.6.bundle

    # PC
    cd C:\Users\trevo\WavWiz-src
    git bundle verify ..\wavwiz-0.4.5..0.4.6.bundle
    git pull ..\wavwiz-0.4.5..0.4.6.bundle HEAD
    powershell -ExecutionPolicy Bypass -File build\build-win.ps1

`payload\` only changes when ffmpeg or the receivers are rebuilt; then send just that folder's zip.
