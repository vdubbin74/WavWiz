# Installer (WavWiz BETA 0.0.x)

**Full self-contained installer only** (`WavWiz-Setup-<version>.exe`); the target PCs have no .NET. There is no slim variant.
Unsigned. **Built and compiled on Linux (Inno Setup under Wine); never run on Windows yet.**

## Wizard
Welcome (BETA) > info page (what it does / never does) > folder > components (Server, Player) > **home-network address** (server only; auto-detected, editable, 0.0.0.0 refused) or **server address** (player-only) > tasks (player autostart, desktop link) > ready memo > install > final page (open the first-run web page, start the player).
Silent: `/VERYSILENT /SUPPRESSMSGBOXES /COMPONENTS="server,player" /LANIP=192.168.1.20` (`/SERVERHOST=<addr>` seeds the player-only address). Without `/LANIP` the setup script keeps the address in an existing `server.json`, else detects one, else uses 127.0.0.1 with a notice. Other switches: `/SKIPSETUP=1`, `/NOSTART=1`; uninstall `/PURGE=1`.

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
