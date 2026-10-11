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

## [0.2.3] - 2026-10-11 (beta)

Fine-tunes on top of 0.2.2 (which was not published on its own); 0.2.3 includes everything from 0.2.2.

### Changed

- **Minimized Now Playing is one line (U1):** album thumbnail, title · artist over the progress bar (elapsed / total), then heart, shuffle, previous, Play / Pause, next, repeat, volume + %, mute and EQ, all on the Now Playing bar and scaled to fit (less important pieces drop out first on narrow columns). Nothing moves to the Playlist title bar any more, and Play / Pause is no longer forced to the center.
- **Minimized Playlist shows "Up next" (U2):** the next song in the queue (cover, title · artist), centered on the Now Playing column; the track count, Save as playlist and Clear stay at the right.
- **The one-line bar follows the selected control panel style and theme (U3):** Classic (progress ring around the thumbnail, glowing round Play), Center (soft buttons, waveform seek, spinning record thumbnail), Stack (small LCD window, LED-block seek, squared buttons), Horizon (glowing thumbnail, seek line flowing from it, ring buttons), in the theme's Main / Second colors; the panel effect sliders apply.
- **Settings > Appearance > Display size** has no preview pane (U4); the whole app already changes live.
- **Pinned previews (U5, U8):** the Theme, Visualizer, EQ and Now Playing live previews stay at the top of the page while the settings below scroll, at every Display size (the pinned preview shrinks on short windows).
- **Expand buttons (U6)** point the way the panel travels: Devices expands to the left and returns to the right; Library is the mirror image.
- **Devices header (U7):** the DEVICES title sits at the right edge, a true mirror of LIBRARY.
- **Device cards open into their settings (U12):** the ••• button on each device card is now a themed chevron **Settings** button (it matches the Library / Devices expand arrows). It opens the device's settings (sound check, exact delay, Sound / EQ, connection, Rename / Set as reference / Forget) downward under the card, in place, in both the Standard and Expanded Devices views; the chevron flips, and the button or Esc closes them. Admin-only items stay visible but read-only for other users. Each card remembers being open for the browser session.
- **Appearance > EQ shows the real EQ (U10):** the preview mirrors this device's speaker (bands, preset, pre-gain, loudness), live, in the chosen style. It opens with Lock EQ checked every time; unchecked, changes play at once and are kept in the speaker's own preset ("<speaker> EQ").

### Added

- **Lock EQ (U9):** a checkbox with a padlock in the Sound (EQ) window header and on the Appearance > EQ preview. Locked, the EQ sliders ignore the mouse wheel (the page scrolls instead), dragging, clicks and keys, and look slightly dimmed with a small lock. Remembered per device; off by default (the wheel still fine-adjusts in 0.5 dB steps).

### Fixed

- **Revoking a device removes it from the Devices list (U11):** revoking a paired phone or browser (Settings > Devices > Paired devices & tokens) left the speakers it had opened in that browser on every Devices list, still connected and playing, because only WavWiz Player tokens were handled. Now everything the token owns leaves the list at once on every open page (Standard, Expanded, zones and the Devices page), its connections close, and it has to pair again. Forget device on a browser speaker no longer lets it rejoin straight away, and a list that was busy (a slider, menu or zone editor open) no longer keeps a removed device.

## [0.2.2] - 2026-10-10 (beta)

### Added

- **One-line Now Playing:** collapsing the control panel leaves a single strip with every control (heart, shuffle, previous, Play / Pause on the exact center line, next, repeat, volume + %, mute, EQ). The song (cover, title, artist, progress with times) moves into the Playlist title bar, lined up with the Now Playing column; the visualizer grows into the freed space. Works with all four panel styles.
- **Settings > Appearance sub-sections** with a left sub-nav: Theme, Visualizer, EQ, Now Playing, Display size. Theme and Visualizer are the 0.2.0 page layouts again (theme cards, look cards, Graphics, Reactivity, look settings); EQ gets a fuller page. Every sub-section has a live preview (app preview that recolors on hover, live mini visualizer, try-out EQ, panel preview, Display size slice).
- **Use your phone as the microphone** on Calibrate speakers: QR code + short link that goes through the one-time certificate check to the secure (HTTPS) calibration page, four numbered steps, and a live "Phone connected / waiting" line. A link made by an administrator also signs the phone in (one-time pairing code) and lets it calibrate every speaker. Links expire after 20 minutes.
- **Artist pictures from album covers:** artists without a photo show their album covers (2x2 mosaic with four or more, else one cover) before the generated portrait. TheAudioDB is a second source of artist photos; covers and photos appear live as they arrive.
- **Online art status** in Settings > Library: found / not found / pending counts for artists and albums, a switch, and Retry missing photos.
- Installer: `/NOCLOSE` switch; exit code `7` when a running WavWiz could not be closed.

### Changed

- The Devices header mirrors the Library header (Expand and the arrow on the outer edge, Esc hint, accent-colored title). One rule for both panels: the arrow while expanded returns to the normal layout first, then collapses.
- Menu > Devices > Devices & zones always opens the expanded Devices view on the desktop (the phone keeps its page).
- The status bar no longer repeats "Connected" (the top-right indicator stays); it shows "Reconnecting…" only when the connection drops.
- Online art: lookups are never dropped (unbounded queue), "not found" is retried after 7 days instead of never, and network errors back off from 1 hour to 1 day. The 0.2.1 "not found" marks are cleared once so everything is tried again.
- The Pepecoin logo in the Themes menu is about 20% smaller (same unedited brand-kit file).

### Fixed

- Installing over a running WavWiz no longer fails: the installer stops the service, asks the Player to exit (then forces it after a timeout), retries locked files, shows "Closing WavWiz…", and starts the service and Player again afterwards. Silent installs do the same and return non-zero only when WavWiz truly cannot be closed.
- Starting the WavWiz Player from the Start menu or a shortcut opens its window (only the sign-in auto-start stays in the tray); a second start brings the running window to the front.
- The EQ Auto pre-gain badge no longer overlaps the Loudness switch in the LED look.

## [0.2.1] - 2026-10-09 (beta)

### Added

- **Library makeover:** big tiles on every tab of the Expanded library, the year under each album, hover lift with a round Play and a heart, and a new album page (header tinted with the cover's color, Play, Shuffle, heart, track list).
- **Online covers and artist photos:** when a song has no embedded picture and no folder.jpg/cover.jpg, the server looks the album up on MusicBrainz and the Cover Art Archive; artist photos come from MusicBrainz and Wikidata/Wikimedia Commons. Lookups run in the background, one at a time, and are cached in the WavWiz data folder. Turn them off with `"onlineArt": false` in server.json or the `library.onlineArt` setting.
- **Generated covers and portraits:** albums without any picture get a unique cover in the theme colors (initials, wave pattern, note glyph); artists without a photo get a round generated portrait.
- **Zones sidebar** in Expanded Devices (pick a zone to filter the cards, edit it in place), **Mute all** on the master volume strip.
- **Device card settings** (••• button): Calibrate, Test sound, exact delay, Sound / EQ, delay history, connection, Rename, Set as reference, Forget.
- **Sound (EQ) dialog redesign** with three looks (LED bars, Studio faders, Spectrum curve) over the same 10-band EQ; **EQ style** on Settings > Appearance.
- **Settings > Appearance** as one page (Theme, Visualizer, Now Playing style with a live preview, EQ style, Display size); **Settings > Library > Library view** card.
- **Highlight**, a third theme color for small accents; Custom colors has five pickers.

### Changed

- Menus: File, Library, Playback, Devices, Help (View removed). Browse library always opens the expanded Library. Radio finder is a tab in Internet radio; the Status card moved to Help > Diagnostics.
- Devices panel: collapse arrow + Expand button instead of the three-size toggle.
- Now Playing panel: no ••• menu, Stop or status chips; an EQ button; the Classic heart matches the other controls. The visualizer panel has no title or look name.
- Theme order: Midnight Neon, Pepecoin, Ember, Arctic, Violet Pulse, Monochrome, Daylight, Nebula, Blue Steel, Lime Circuit, then Custom colors.
- The Pepecoin note uses the official onDark logo with wordmark from the brand kit, unedited.

### Removed

- The device Details pop-up (everything moved to the card's settings or the zones sidebar).

### Fixed

- The Library filter box lost focus after every keystroke.
- Menus now switch on hover while one is open, like Windows.
- The silent installer returned exit code 0 even when a setup step failed.

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
