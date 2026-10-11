# Installer (WavWiz BETA)

**Full self-contained installer only** (`WavWiz-Setup-<version>.exe`); the target PCs have no .NET. There is no slim variant.
Unsigned. **Built and compiled on Linux (Inno Setup under Wine); never run on Windows yet.**

## Wizard
Welcome (BETA) > info page (what it does / never does) > folder > components (Server, Player) > **home-network address** (server only; auto-detected, editable, 0.0.0.0 refused) or **server address** (player-only) > tasks (player autostart, desktop link) > ready memo > install > final page (open the first-run web page, start the player).
Silent: `/VERYSILENT /SUPPRESSMSGBOXES /COMPONENTS="server,player" /LANIP=192.168.1.20` (`/SERVERHOST=<addr>` seeds the player-only address). Without `/LANIP` the setup script keeps the address in an existing `server.json`, else detects one, else uses 127.0.0.1 with a notice. Other switches: `/SKIPSETUP=1`, `/NOSTART=1`; uninstall `/PURGE=1`.

## Silent install switches (0.2.0, checked against `installer/WavWiz.iss` and `installer/scripts/setup.ps1`; prep for a future winget listing - nothing is published)
WavWiz uses Inno Setup, so the standard Inno switches work, plus a few of our own. Run from an elevated prompt (the installer needs admin: it installs a service and firewall rules).

| Switch | Meaning |
|---|---|
| `/VERYSILENT` (or `/SILENT`) | No wizard (`/SILENT` shows only the progress window). |
| `/SUPPRESSMSGBOXES` | Answers every message box with its default. With it, the uninstaller keeps your data (the "also delete your data?" question defaults to No). |
| `/NORESTART` | Never restart Windows (WavWiz never asks for a restart anyway). |
| `/COMPONENTS="server,player"` | What to install: `server`, `player` or both. Default: both. |
| `/TASKS="autostart,desktopicon"` | Optional tasks: `autostart` (start the Player at sign-in, player only), `desktopicon` (desktop link to the web page, server only). Without `/TASKS` the defaults apply (autostart on, desktop link off). |
| `/LANIP=192.168.1.20` | Server only: the one home-network IPv4 address the server listens on. `0.0.0.0` and anything that is not a single IPv4 address is refused (setup fails with that message in `install.log`). Without it an existing `server.json` keeps its address; otherwise one is detected, else 127.0.0.1 with a notice. |
| `/SERVERHOST=192.168.1.20` | Player-only installs: seeds the server address the Player connects to. |
| `/NOSTART=1` | Install and configure, but do not start the service or the Player. |
| `/SKIPSETUP=1` | Copy files only; skip the service / firewall / settings step (for testing). |
| `/NOCLOSE=1` | Do not close a running WavWiz first (for testing; locked files then fail the copy). |
| `/DIR="D:\Apps\WavWiz"` | Install folder (default `C:\Program Files\WavWiz`; an upgrade reuses the previous folder). |
| `/LOG="C:\Temp\wavwiz-setup.log"` | Inno's own log, in addition to `C:\ProgramData\WavWiz\install.log`. |

Examples:
```
WavWiz-Setup-0.2.3.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /COMPONENTS="server,player" /LANIP=192.168.1.20
WavWiz-Setup-0.2.3.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /COMPONENTS="player" /SERVERHOST=192.168.1.20 /TASKS="autostart"
"C:\Program Files\WavWiz\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES            (keeps your data)
"C:\Program Files\WavWiz\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /PURGE=1   (also deletes C:\ProgramData\WavWiz; music files are never touched)
```

**Exit codes**: `0` installed, `1` setup failed to start, `2` canceled before installing, `3` fatal error before the install phase, `4` fatal error while installing, `5` canceled while installing, `6` setup was killed, `7` the preparing step failed, `8` the preparing step failed and Windows must restart first (`1`-`8` are standard Inno Setup), and **`7` also when a running WavWiz could not be closed before copying (0.2.2; nothing was changed, the reason is in `install.log` and `close-error.txt`)**, **`9` the files were copied but the final setup step (service, firewall, settings) failed or stopped answering** (0.2.1; earlier versions returned `0` here). On `9`, `C:\ProgramData\WavWiz\install.log` has the failing step and `setup.done` holds the script's own exit code. Running the installer again after fixing the cause is safe.

**Upgrades:** the same AppId is used for every version, so running a newer installer upgrades in place; `C:\ProgramData\WavWiz` (library database, settings, admin password, paired devices) is kept, the service is re-configured, not re-created. Running the same version again repairs the install (idempotent).

## Store / directory icon (0.2.0 item 19)
Transparent square icons for listings (Uptodown, winget manifests, etc.): `assets/logo/wavwiz-1024-transparent.png`, `wavwiz-512-transparent.png`, `wavwiz-256-transparent.png` (real alpha outside the rounded tile). `assets/logo/wavwiz.ico` (16-256 px) is made from the same transparent art and is used for the installer, the Player and the shortcuts. The opaque `wavwiz-<size>.png` files stay for the web app and the wizard images.

## What setup does (installer\scripts, Windows PowerShell 5.1, each step in its own time-limited child process)
`setup.ps1` (orchestrator) > `install-server.ps1` (data folder + LocalService permission, `server.json` merge, service `WavWizServer` delayed-auto/LocalService/recovery actions, netsh firewall rules, start + HTTP readiness check) and `install-player.ps1` (server address defaults, WebView2 check = warning only). `uninstall.ps1` removes service + rules (+ data with purge).
Everything is logged to `C:\ProgramData\WavWiz\install.log` with `STEP>` lines; a failure message includes the command, exit code, and **file:line**; the wizard error box shows the log path. Nothing secret is generated or logged; the person chooses the admin password on the first-run page.

## Installer hardening applied (see LESSONS-INSTALLER.md)
No hidden window waits for input; no WinForms from the hidden process (`show-notice.ps1` is a separate visible process with time limits and a restricted-ACL file fallback, tested with a window that never appears / crashes / is closed / hangs); non-interactive detected four ways, no `$NonInteractive` variable clash; existing `server.json` is merged not clobbered; re-runs are idempotent; BOM-less config; all shipped scripts are pure ASCII and scanned for 5.1 compatibility (`tools/scan-ps51.ps1`).

## Build
`pwsh build/build.ps1` (publish self-contained win-x64 + pinned ffmpeg), `pwsh build/make-installer.ps1` (ISCC; Wine on Linux: set `RR_ISCC`).
Tests: `pwsh tests/pwsh/install-flow.tests.ps1`, `pwsh tools/scan-ps51.ps1`, `python3 tests/ui-smoke/smoke.py --dll <wavwiz-server.dll>`.

## Not verified on Windows
PowerShell 5.1 itself, real sc.exe/netsh/icacls behavior, UAC, the Inno wizard pages, SmartScreen, the service as LocalService (file permissions, UNC), firewall behavior, WebView2, WASAPI, DPAPI, tray, autostart.

## 0.0.2 notes
* Installer is `WavWiz-Setup-0.0.2.exe` (full, self-contained only). Running it over 0.0.1 is an upgrade: `server.json`, the database (library, playlists, settings), the administrator password, paired players and the player defaults are kept; the service is re-configured, not re-created; the firewall rules are replaced (the UDP rule now also opens 47803 discovery and 5353 mDNS).
* The first start after the upgrade re-reads the tags once (db v2) so Artist/Album/Genre/Year grouping and cover art work for the existing library; the music files are never modified.
* Wizard images, shortcuts, tray icon and favicon use the final logo (`assets/logo/`).
* Not verified on Windows from this Linux build box: the Inno wizard pages, `netsh` rules, service start, mDNS/broadcast behavior, tray. See the release report.

## 0.0.3 notes (rename + upgrade from Unison)
* Installer is `WavWiz-Setup-0.0.3.exe` (full, self-contained only), new Inno AppId. ffmpeg is our own decode-only LGPL build (about 20 MB); `build/build.ps1` builds it from the pinned source via `build/build-ffmpeg-lgpl.sh` if `$WAVWIZ_TOOLS_CACHE/ffmpeg-lgpl/out` is missing, and fills `licenses\FFMPEG-BUILD.txt`.
* **Upgrade migration** (`Invoke-LegacyMigration` in `installer/scripts/lib.ps1`, run by `setup.ps1` right after preflight; idempotent, safe to re-run): stop/delete service `UnisonServer` and kill old processes > delete the old firewall rules > remove the old all-users Run value > merge `ProgramData\Unison` into `ProgramData\WavWiz` (database, library, password, pairings, art cache kept; name collisions become `*.from-unison`; if both hold `unison.db` the new one wins and the old folder is left untouched with a notice; a failed move throws and deletes nothing) > remove the old program folder (marker-checked, never the new root), Start-menu group, desktop link and old uninstall entry.
* The per-user player folder `%LOCALAPPDATA%\Unison` is copied to `WavWiz` by the player on its first start (the WebView2 cache is skipped); the old HKCU `UnisonPlayer` autostart value is replaced.
* Tests: `tests/pwsh/install-flow.tests.ps1` (rename migration, re-run, collisions, failure, no-legacy case).
* Not verified on Windows: the migration on a real 0.0.2 install (real `sc`/`netsh`/registry views/Inno uninstall key), the DPI manifest and 200 %+ layouts, WebView2 zoom, tray Display size, About form, Schannel https in ffmpeg, the visualizer on a real GPU.


## 0.0.4 notes
* Installer is `WavWiz-Setup-0.0.4.exe` (full, self-contained only). Upgrades 0.0.3 in place (same AppId); `ProgramData\WavWiz` (library, settings, pairings, password) is kept.
* ffmpeg LGPL build now also includes native `flac` and `aac` encoders (CD ripper). Still no GPL/nonfree/LAME. MP3 rip option is refused with an explanation.
* New DB schema v4 (scenes, schedules, speaker profiles, tag-fix jobs, rip jobs, radio-finder favorites). Automatic backup before migrate.
* Not verified on Windows: follow-speaker with real Bluetooth, CDDA ripping, Tailscale bind, MusicBrainz live lookups behind a firewall, Inno wizard pages, service start.

## 0.0.5 notes
* Installer is `WavWiz-Setup-0.0.5.exe` (full, self-contained only). Upgrades 0.0.4 in place (same AppId); `ProgramData\WavWiz` (library, settings, pairings, password) is kept.
* FFmpeg LGPL build adds libcdio (+paranoia) for CDDA and ships Chromaprint `fpcalc` for AcoustID when built.
* SHA-256 (uppercase): 345C946731BBF2AB1331DDB2949168F2403C2FC2D43831196E3D4429F466D12C
* Size: 96807303 bytes


## 0.0.8 BETA
* Installer `WavWiz-Setup-0.0.8.exe` upgrades 0.0.7 in place (same AppId; `ProgramData\WavWiz` with the library database, settings, admin password and paired players is kept; the service is stopped and restarted by setup as before).
* No new third-party components. FFmpeg stays the pinned LGPL build (no GPL, no nonfree). All visualizers are original code.
* Built 2026-10-05 (Linux, ISCC via Wine), unsigned, NOT yet run on Windows.
* Size: 96537917 bytes
* SHA-256 (uppercase): 9CA7F7A5395D2ABCE35DFABDB8BC9D92DA5156AE0F6B1ED1866422B4A3B41C77

## 0.1.1 BETA
* Installer `WavWiz-Setup-0.1.1.exe` upgrades 0.0.8 in place (same AppId; `ProgramData\WavWiz` with the library database, settings, admin password and paired players is kept).
* New bundled receivers (separate processes in `server\receivers`, sources in `licenses\source`): `wavwiz-airplay.exe` (shairplay 096b61a, LGPL-2.1+ with MIT/BSD/zlib parts, plus our MIT front end), `librespot.exe` (librespot 0.8.0, MIT, with libmdns 0.10.1 MIT), `wavwiz-hook.exe` (MIT). No GPL components. FFmpeg stays the pinned LGPL build.
* Firewall (private profile, local subnet, program-scoped): TCP 47804 + UDP for wavwiz-airplay.exe; TCP 47805 + UDP 5353 for librespot.exe; the server's existing UDP rule already covers mDNS 5353. Removed on uninstall.
* Built 2026-10-06 (Linux, ISCC via Wine), unsigned, NOT yet run on Windows.
* Size: 101925142 bytes
* SHA-256 (uppercase): 03E543ABA52D68DA476674A6553FBE948B341100734E471D0EE6A9DD046798A3

## Upgrading over a running WavWiz (0.2.2)

Before any file is replaced the installer shows **Closing WavWiz...** and runs `scripts/close-wavwiz.ps1` (hidden, with a 2-minute limit):

1. stops the **WavWiz Server** service and waits up to 30 s; if it does not stop, its process is ended;
2. asks every **WavWiz Player** to exit (0.2.2+ Players listen for `Local\WavWizPlayer.Exit`; older ones get a window close), waits 8 s, then ends the ones still running;
3. ends anything else still running from the install folder (AirPlay / Spotify receivers, ffmpeg);
4. retries for up to 20 s until no `.exe` / `.dll` in the install folder is locked.

After the install the service is started again by the setup step (or directly when only the Player part was installed), and a Player that was running in the installing user's session is started again in the tray (`--background`, as the signed-in user, not elevated), in silent installs too. Players closed in *other* Windows sessions start again at their next sign-in. A silent install returns non-zero (`7`) only when something truly could not be closed. The uninstaller runs the same close step.

## How the Player starts (0.2.2)

Only the sign-in auto-start (`--autostart` from the installer, `--background` from the Player's own "Start with Windows", or `--tray` / `--minimized`) starts hidden in the tray. A Start menu or desktop launch opens the window. The Player is single-instance per Windows session: a second manual launch brings the running window to the front. `wavwiz-player.exe --exit` asks a running Player to close.
