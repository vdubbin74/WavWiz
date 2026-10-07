# WavWiz - architecture decisions

Design notes kept from the early betas. References such as "spec 7.3" or "Q8 default" point to the original internal design spec, which is not part of this repository.
Version lives in ONE place: `Directory.Build.props` (`WavWizVersion`). All builds are beta (0.x) until 1.0.0.

## Shape (spec option A, Snapcast-style)
```
server PC: wavwiz-server (Windows service, LocalService)      every listening PC: wavwiz-player (per-user tray app)
  library -> queue -> decode -> 48k stereo float              TCP audio (47801) + UDP clock (47802) + HTTP(S) control
  StreamEngine: 20 ms frames, play-at = server monotonic      ClockModel -> PlaybackEngine (jitter buffer, PI drift
  REST/WS + static web UI (47800 / 47443 TLS)                 control, Hermite resampler) -> DSP chain -> WASAPI
```
server PC also runs a player and talks to the server exactly like every other player (no loopback shortcut, no WASAPI capture).

## Projects
| Project | Target | What |
|---|---|---|
| `WavWiz.Core` | net10.0 | version info, protocol codec, `ClockModel`, `StreamEngine` (server timeline), `PlaybackEngine` + `JitterBuffer` (player sync). Platform independent so the simulator runs the REAL code. |
| `WavWiz.Dsp` | net10.0 | per-speaker DSP (biquads, 10-band EQ, shelves, trim, limiter, loudness) - allocation-free |
| `WavWiz.Measure` | net10.0 | chirp/click cross-correlation (phone captures, `wavwiz-measure`) |
| `WavWiz.Server` | net10.0 web | host, library, queue, radio, zones, calibration, auth, TLS CA, web UI (static, no build step) |
| `WavWiz.Player` | net10.0-windows | tray app, WASAPI sink (NAudio), output switcher, WebView2 shell, `file sink` test mode |
| `tests/WavWiz.Sim` | tests | deterministic simulator (spec 18.2) + scenarios |

## Decisions taken (spec defaults unless noted)
1. **Option A**, one house stream, PCM 24-bit over TCP, 48 kHz stereo (Q8 default), 20 ms frames, lead 600 ms, buffer 3 s Ethernet / 4 s Wi-Fi (Q12 default).
2. **Control messages are JSON, audio/epoch/stop-at are binary** (spec 6.1 header `UNSN`, version 1). Easier to version and test.
3. **Sync math**: NTP-style pings, lowest-RTT quarter of the last 60 s, least-squares skew; PI controller (critically damped, tau 8 s) on a +-500 ppm resample ratio, Hermite interpolation; fade-jump-fade hard resync.
   **Deviation:** hard-resync threshold is **25 ms**, not 50 ms (spec 7.3): +-500 ppm can only remove ~10 ms in 20 s, so errors of 25-50 ms would stay audible for minutes.
4. **Device latency sign**: engine targets `serverNow + latencyMs_d + dspLatency` (spec 7.5); "unknown is never zero": unknown BT = flagged 200 ms guess (D9), unknown wired = 0 flagged "not calibrated"; clock model throws before its first sample.
5. **Decode with `ffmpeg.exe` as a child process** (LGPL build, shipped in the installer) instead of FFmpeg.AutoGen P/Invoke: crash isolation, no native binding risk, gapless/encoder-delay handled by ffmpeg, same tool for files and radio. Radio: the server reads the HTTP stream itself (ICY metadata + reconnect/backoff) and pipes audio bytes to ffmpeg. *Unverified: which ffmpeg build; downloaded + SHA-256 pinned at build time, license notice shipped.*
6. **Desktop UI** = WinForms shell + WebView2 hosting the same web UI; if the WebView2 runtime is missing the player opens the UI in the default browser and says so. (Q4 default.)
7. **Web UI** = vanilla HTML/CSS/JS served from embedded resources, "WavWiz Brushed Metal" teal/amber from the approved mockups; no node on user PCs. Phone is a PWA.
8. **One installer** with components Server / Player (Q9 default), self-contained, full only (no slim build, no framework-dependent build).
9. **Server runs as `LocalService`** (least privilege); library folders must be readable by it. The first-run page checks and says which account needs read access. Local paths/UNC only, never `Y:\`.
10. **Binding**: server binds only to the chosen LAN IP (installer proposes the detected private IPv4; loopback until chosen); `0.0.0.0` needs an explicit opt-in. Non-private source addresses refused. Firewall: Private profile, local subnet, ports 47800/47443/47801/47802/UDP.
11. **Auth**: first-run admin password (PBKDF2), 6-digit player pairing code (5 min) -> device token (DPAPI on the player), roles admin/control/view, HttpOnly SameSite=Strict cookie + Bearer. Login rate-limited.
12. **HTTPS**: per-install root CA on server PC with name constraints, server cert for LAN IP + hostnames, `/tls/setup` page + QR, Android `.crt`, iPhone `.mobileconfig`. Needed for phone-mic calibration; wizard detects `isSecureContext === false` and links to setup.
13. **Installer**: Inno Setup under Wine, earlier installer lessons applied (see `docs/INSTALLER.md`): PS 5.1 rules, scan tool, no hidden-window UI, every step logged with a watchdog, failure messages with file:line, idempotent re-runs, BOM-less config, wizard error box shows install.log.
14. **Parked (spec 0.5)**: sleep timer, party mode, announce/duck, follow-me, smart library, radio favorites/recording, scrobbling, panic stop/volume cap, active crossover, iPhone app, visualizer (static placeholder), skins loading, crossfade, Opus/FLAC transport, advanced DSP.

## Test strategy (Linux first)
* `tests/WavWiz.Sim`: real StreamEngine/ClockModel/PlaybackEngine/wire codec in virtual time with per-PC clock skew/wander, virtual sound cards, lossy/jittery/outage links. Measures what came out of the virtual DACs in true time.
* Unit tests for clock math, wire codec, DSP, calibration lookup, API auth matrix, chirp detection.
* Installer flows under pwsh with shims (existing config re-run, non-interactive, hidden-window fallbacks) + PS 5.1 compatibility scan + `.iss` compile under Wine.


## 0.0.2 additions
* **Discovery** (`Core/Discovery`, `PlayerCore/Discovery`, `Server/Net/DiscoveryHost`): UDP probe `UNISON?1` on 47803, mDNS `_unison._tcp.local` on 5353, http sweep fallback. The player stores `ServerId`; on `ServerUnreachable` it re-runs discovery for that id and switches host.
* **Room health** (`Server/Zones/RoomHealth`): per-player state machine (ok/idle/buffering/dropped/reconnecting/offline) + timestamped event ring. The server sends a keepalive (`CalResult keepalive`) every 2 s on each audio connection; the player treats 6 s without ANY TCP frame as dead (UDP clock replies cannot hide a dead audio link) and reconnects with backoff. A reconnect with the same id replaces the old session and records a drop.
* **Web rooms**: `/ws/room` carries the same wire frames over a WebSocket (Hello id `web-...`, role Control+). Clock: browser pairs `AudioContext.currentTime` with `performance.now()` and runs NTP-style samples over the socket; `FrameScheduler` chains 20 ms frames and trims with playbackRate. Sync error is reported as unknown.
* **Visualizer feed** `/ws/viz`: 1024-sample mono 8-bit waveform at ~30 Hz from `VizHub` (ring of 8 s, delayed per device).
* **Library**: db v2 (`raw_artist`, `folder`, `has_art`, alias table); browse API under `/api/v1/library/*`; art under `/api/v1/art/*` (204 when none).
* **Web UI**: ES modules, no build step; layout = left view + pinned Now Playing on desktop, hamburger drawer + 3 tabs + mini player on phones.

## 0.0.3 BETA additions
* **Names**: product/UI/service/folders are WavWiz. Wire and persisted identifiers keep their `unison` spelling on purpose so 0.0.2 players keep pairing (`UNISON?1`, `app:"unison"`, `_unison._tcp`, `unison_session`, `unison.db`, `unison-root-ca.crt`, magic `UNSN`, DPAPI entropy `Unison.Player.v1`). The server accepts user agents `UnisonPlayer/` and `WavWizPlayer/`; `ServerFinder` accepts discover names starting with WavWiz or Unison.
* **Zone groups** (db v3 `zone_group`, `zone_group_member`; `Zones/ZoneManager` + `/api/v1/groups`): a device is one output; a *zone* is an optional named set of devices that can be activated together. Devices not in any zone are "Unassigned". Forget device (`POST /players/{id}/forget`) revokes the token, closes the live session with an "unauthorized" Bye (the player then shows "not paired" and offers pairing) and removes it from the list and zones.
* **Web layout**: desktop grid (library | Now Playing + banner | devices/zones/unassigned; playlist table; status bar), phone layout unchanged. Visualizer engines: `wzviz.js` (WavWiz ring, own canvas, math in `vizmath.js`) and butterchurn/MilkDrop (`viz.js`, WebGL2) with error surfacing, bad-preset skipping, fallback to the ring, and `vizStats()` for the diagnostics card. The page CSP allows `'unsafe-eval'` because MilkDrop presets compile their equations at run time (without it every `loadPreset` was refused).
* **DPI**: player manifest declares PerMonitorV2 (the only mechanism; `SetHighDpiMode` is not called), forms use `AutoScaleMode.Dpi`, `PlayerCore/UiScale` holds the setting (Auto, 100-300 %) and the WebView2 zoom / window fit math (unit-tested at 100/150/200/250/300 %).
* **ffmpeg**: own LGPL-only decode-only shared build (FFmpeg 8.1.3 + zlib 1.3.1, mingw-w64), reproducible from `build/build-ffmpeg-lgpl.sh` and the pinned tarball hash; still a child process.
