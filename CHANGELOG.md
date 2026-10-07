# Changelog

All notable changes to WavWiz are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses a **public beta** versioning scheme (0.x). Dates may be
approximate for early builds.

WavWiz is currently in **beta**. Breaking changes and rough edges are expected.

## [Unreleased]

### Planned

Items below are on the roadmap (not promised for a specific date):

- Authenticode code signing for the public installer (planned for 1.0.0)

## [0.1.3] - 2026-10-07 (first public beta)

### Added

- **Receiver health and one-click recovery:** Diagnostics shows buffered milliseconds, underruns, and orphaned receiver sessions, with **Restart AirPlay** and **Clear orphans** buttons.
- **Network / bind helper** (Settings → Network → Home network): shows whether Windows treats the network as Private or Public, re-detects the PC's address, switches WavWiz to it, and explains in plain English what to fix.
- **NAS library logons:** save a user name and password for password-protected network shares (for example `\\NAS\Music`). The password is encrypted by Windows (DPAPI) for the WavWiz service and never shown again.
- **Volume leveling (ReplayGain / R128):** evens out loudness between songs using the tags in your files; **Automatic** by default; never clips; untagged songs play unchanged.
- **Gapless album playback** (including encoder-delay trimming for MP3/AAC files that carry it).
- **Graphic EQ visualizer** (classic graphic-equalizer bars, GPU-rendered, theme colors). It replaces Lightning, so there are still eight looks.
- **Visualizer Quality setting:** Auto / Low / High / Ultra. Auto keeps phones light and gives desktop GPUs full resolution, more particles, and longer trails.
- **GPU particles** (instanced) for Particle burst and Neon tunnel, scaled to the Quality setting.
- **Post-processing:** soft bloom, light streaks, subtle color fringing on big hits, and depth blur on Terrain and Ring. Each effect has its own 0–100% control and can be turned off.

### Changed

- Every visualizer setting, including each look's own effects, now runs **0–100% with a 50% default**. The default look has a bit more energy than 0.1.2. Saved settings from 0.1.2 are migrated to the new scale.
- Visualizers use **WebGL 2** (with half-float render targets for smoother gradients and real bloom) and fall back to WebGL 1 automatically on older devices.
- **VU meters reworked** and moved to the GPU: one bouncier needle per meter with a subtle glass reflection, and a level bar with bigger hits and deeper lows.
- Terrain rendering reworked.

### Removed

- Lightning visualizer (replaced by Graphic EQ).

## [0.1.2] - 2026-10-06

### Added

- AirPlay level control: up/down arrows, 0 dB default (base), +6 dB max (after phone volume)
- Spotify Connect level control: same arrow pattern, 0 dB default, +6 dB max
- Pepecoin theme (brand greens / earth tones from the public Pepecoin brand kit; not affiliated with Pepecoin or artists)
- Pepecoin community visualizer (calm default; adjustable effects; no third-party character art without permission)
- Streaming source chip on Now Playing (AirPlay or Spotify Connect, with sender device name when available)

### Changed

- AirPlay live-feed buffer target increased (~1400 ms → ~1800 ms)
- Terrain visualizer redo (more terrain; solid theme-matching colors)
- Now Playing polish: transport and master volume in their own solid panel that matches Library / Devices / Playlist; the visualizer panel grows when the controls are collapsed; followed-speaker status colors; themed collapse arrow
- Playlist collapses downward; Violet Pulse theme added

### Fixed

- Scrub remaining Unison leftovers for users (for example `unison.db` → `wavwiz.db` on upgrade; clean user-facing strings; keep migration/compat)
- Admin password reset on the server PC only (no manual SQLite; library kept)

## [0.1.1] - 2026-10

### Added

- **AirPlay** receiver: always-on AirPlay 1 (RAOP) speaker **WavWiz – Whole House** (shairplay-based separate process, WavWiz mDNS; no Bonjour install). Audio feeds the sync pipeline to all zones; metadata and artwork on Now Playing; sender pause / skip / volume honored. One whole-house speaker (not per-zone).
- **Optional Spotify Connect** (Settings → Network, admin; **off by default**; requires **Spotify Premium**). Unofficial librespot-based separate process into the same sync pipeline; title / artist / artwork; WavWiz mDNS fallback if needed.
- Diagnostics rows for AirPlay and Spotify Connect.

### Changed

- Desktop bottom Playlist collapses/slides like the side panels (saved per device); Library → Playlist toggles it; phone keeps the full Playlist page.
- Visualizers: calmer easing / decay / peaks / colors; default Sensitivity 0.8; global Mood (Calm / Balanced / Energetic, default Calm).

### Notes

- AirPlay is a trademark of Apple Inc. Spotify is a trademark of Spotify AB. WavWiz is not affiliated with either. Spotify Connect support is unofficial.

## [0.0.8] - 2026-09

### Added

- Per-device delay slider **0–1000 ms** (5 ms steps) with ms box and −/+ 1 ms; live while dragging.
- Eight visualizers: Particle burst (default), Waveform river, Speaker cone, Ring, Neon tunnel, Terrain, Lightning, VU meters — each with per-look effect controls.
- Stronger visualizer reactivity (auto-gain, Sensitivity, onset drive; server feed carries stereo levels; radio/network streams drive Viz like files).

### Changed

- Devices panel collapse; desktop toggles for Devices & zones and Browse library; US English throughout.
- Now Playing layout refresh; Display size zooms the whole UI live (saved per device).
- Theme consistency for buttons and native controls.

### Fixed

- Tray “Open player…” on the server PC uses the same address as the desktop shortcut (never loopback); blank gray WebView recovery (“Try again” / open in browser).
- Visualizer card taps no longer flash white or crash (shared WebGL context, loss/restore, 2D fallback).

## Earlier betas

Summaries only; see repository history for detail.

- **0.0.7** — Phone WebSocket reliability; four WebGL visualizers; MilkDrop/butterchurn removed.
- **0.0.6** — Menu/theme wiring; Particle burst default; phone auto-join improvements.
- **0.0.5** — UI chrome; CDDA via helper; AcoustID optional; scrub of personal LAN hints from UI.
- **0.0.4** — Follow-speaker, scenes, schedules, Radio Browser, Tailscale panel, CD ripper, tag auto-fill.
- **0.0.3** — Renamed from **Unison** to **WavWiz**; in-place upgrade migration.
- **0.0.2 / 0.0.1** — Early Unison betas (pairing, library, visualizer experiments, installer).

---

[Unreleased]: https://github.com/vdubbin74/WavWiz/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/vdubbin74/WavWiz/releases/tag/v0.1.3
[0.1.2]: https://github.com/vdubbin74/WavWiz/releases
[0.1.1]: https://github.com/vdubbin74/WavWiz/releases
[0.0.8]: https://github.com/vdubbin74/WavWiz/releases
