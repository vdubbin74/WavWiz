# Changelog

All notable changes to WavWiz are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses a **public beta** versioning scheme (0.x). Dates may be
approximate for early builds.

WavWiz is currently in **beta**. Breaking changes and rough edges are expected.

## [0.5.2] - 2026-10-29 (beta)

### Added
- Devices: AirPlay speakers strip (experimental) - search and Add/Remove Sonos, WiiM and other AirPlay speakers when AirPlay 2 speakers is on in Settings -> Network.

### Changed
- Settings -> Network AirPlay hint names Sonos/WiiM and UDP 319/320; firewall commands get Copy buttons.
- Evening fixes F145-F158.

### Checksums
- `WavWiz-Setup-0.5.2.exe` - 103,895,834 bytes
- SHA-256: `51DD1A89FA7B2DBAF16B64512C154FDF03EF07145AB493167F74DF6252E02E45`

## [0.5.1] - 2026-10-29 (beta)

### Fixed
- EQ: setting Glow to 0 now takes effect live.
- Calm mode: exiting now offers two clear buttons.
- Now Playing: the Play button is a tidier 64 px.
- Level meters stay quiet for silent zones and no longer show activity when the player and queue are on different zones.
- Settings > Appearance > Looks: dragging no longer freezes the UI.
- Queue: the # column grows with the digit count, so big queues (1000+ tracks) never clip track numbers, including with Library fully open.
- Queue: expand / collapse chevrons are hidden when Library is fully open.
- Shortcuts: the pin sleeve closes when the mouse leaves it.
- Library, Devices and Queue header pins use the same highlighted pin marker as the menus.

## [0.5.0] - 2026-10-28 (beta)

### Highlights
- **AirPlay speakers as WavWiz outputs.** An AirPlay speaker joins a zone like any WavWiz player and follows play, pause, seek, skip, group moves and the house timeline, with its own volume and delay.
  - AirPlay 1 (RAOP) speakers, unencrypted and RSA (AirPort Express), with resend of lost packets.
  - AirPlay 2 speakers (**experimental, off by default**): transient pairing, WavWiz acts as the speakers' PTP clock (several speakers share one clock), buffered AAC audio via the bundled ffmpeg for near-instant pause and seek, realtime ALAC fallback.
  - Settings > Network > "AirPlay speakers (experimental)": AirPlay 2 and buffered-audio switches, connected speakers, and Windows firewall rules (UDP 319/320 for PTP).
  - Help > Diagnostics (admin): AirPlay speakers found on the network with version, codecs and route, plus Connect / Disconnect for audio tests.
- **New Now Playing.** A flatter desktop panel: art left, title over a labeled Artist · Album line, thin progress, transport beside, "on Zone ▾" picker back next to the titles; mute, mixer, Sound / EQ and Sleep share that line. Slightly bigger art and transport. (F130, F132, F134)
- **Mix-and-match looks.** Settings > Appearance > Now Playing: pick Track bar (line · wave · led · eq), Buttons (round · soft · square · ring), Color intensity (Subtle · Spicy · Max) and Album art (square, spinning disc, record sleeve, Cassette, Tape, Jacket). Replaces Classic / Center / Stack / Horizon, and applies live to mini players and compact strips too. (F94–F98, F104)
- **Shortcuts strip.** The header pin row is now one Shortcuts button that slides a horizontal pin strip (pins + Home) in from the right on every Now Playing size, including collapsed and condensed; on expanded it opens on the title bar. Scrolls when full; drag / right-click reordering kept. (F133–F135e)
- **Standalone mini player redesign.** NOW PLAYING title bar with the Shortcuts pin and a Transparency toggle; volume slider left of the transport; play / prev / next docked to the right edge with Shuffle and Repeat (off → all → one). Transparency switches the same slider to window opacity (returns to volume after 6 s). Slim mode stays compact. (F138, F139, F140)
- **Phone as a remote.** A third phone role, Use as remote: silent, opens straight to Now Playing with a remote banner. Switch any time from the menu or Settings > Devices > Phone role. (F91, F92, F100)
- **Premium polish pass.** Phone Now Playing (bigger hero art with cover bloom, full-width Up next), Scenes & Schedules sheet, Library (rounded art and rows, pill tabs, better phone layout), and premium EQ looks (LED bars, console-style Studio faders, Spectrum) with live response curve and theme colors. (F102, F103, F105, F107, F108)

### Added
- Player: borderless fullscreen - F11 or Devices > Fullscreen; Esc exits. Always starts windowed. (F120)
- Queue: "Copy queue to zone" is a title-bar icon with a zone list and "Start playing it there"; Up next shows in the Queue title bar on every Queue form. (F137)
- Themes: Crimson Lounge and Ocean Abyss added; Daylight reworked for contrast. Blue Steel and Lime Circuit removed (saved picks load Midnight Neon). (F114)
- Now Playing / Up next: tracks with no cover show the artist photo, then a generated album cover, instead of a bare note icon. (F123)
- Phone: Sound / EQ opens a full-screen EQ sheet. (F128)

### Changed
- Settings reorganized: General · Appearance · Playback · Library · Devices · Network · Jukebox · Diagnostics · About; Access folded into Network; admin password under General; File > Settings lists the sections. (F117)
- "All sound settings" opens the speaker's settings page instead of a panel under the EQ; Trim, Auto pre-gain and Limiter now live there. (F109)
- Collapsed Library and Devices rails share one flat soft-tab look ("LIBRARY · N", "DEVICES · N ZONES"). (F106)
- Installer: finish page offers "Open WavWiz Player" first (browser optional), "WavWiz Player (BETA)" desktop shortcut, refreshed info page, Private-network tip on the address page, and a WebView2 download offer when it is missing. FIRST-RUN.txt updated. (F121, F122)
- Phone: Settings no longer scrolls sideways; Visualizer setting hidden on phone; Now Playing art sized so controls and Up next stay on screen. (F100, F125)
- Pins use a solid accent chip when on, quiet outline when off. (F124)
- Diagnostics updates in place instead of rebuilding every 15 s. (F111)
- What's New / About say 0.5.0. (F118)

### Fixed
- Queue: drag-to-reorder works again in the WavWiz Player; Time column header stays pinned while scrolling. (F113, F115)
- Now Playing LED / wave / EQ track bars advance again while playing. (F98c)
- Condensed player: round buttons and cassette hubs no longer squash; more room for title/artist. (F98b, F99)
- Library: tabs and Expand / Collapse keep the theme style. (F116, F131)
- Offline first load keeps Scenes, rails and EQ styling. (F106b)

### Known limits
- AirPlay 2 output is experimental. Sonos, WiiM and similar AirPlay 2 speakers are still being tested. HomePod and Apple TV are not supported yet (they need a pairing flow), nor are FairPlay-only or NTP-timed AirPlay 2 speakers.

## [0.4.9] - 2026-10-23 (beta)
- Library: the tab row fits again after you collapse and reopen the Library. (F64)
- Roomy layout: Devices slides out over the side again from the narrow bar; click outside it or press Escape to fold it. (F65)
- Mixer: every slider in a card uses the same track, so they line up. (F66)
- Phone: a simpler 7-item menu and a slimmer Now Playing (no EQ or visualizer). (F67)
- Phone: Now Playing works as a full-screen remote. (F68)
- Devices: active zones come first in one saved order you set; offline and empty zones use compact rows; a Move menu, and click-to-map with a Back button; drag by the handle only. (F69)
- Devices: the master volume slider lines up with the other bars, and its buttons get their own space to the right of the track; speaker mute sits inside the card. (F70)
- Calibration: the test sound plays at full volume even past the volume caps, and your volume is always restored afterward. (F71)
- Queue: expanding or collapsing the Queue no longer shifts Devices. (F72)
- Queue: "Up next" shows the track shuffle will really play next. (F73)
- No scrollbar flash or Devices shift during any slide, expand or collapse. (F74)
- Mini player: no longer cut off when it opens narrow or on high-DPI displays. (F75)
- Jukebox: shows as a zone in Devices; Settings > Jukebox sets its default speakers and whether it shows in Devices; "Start Jukebox" lets you pick speakers; leaving the kiosk with the PIN offers "Switch to app" or "Exit", and "Return to Jukebox" takes you back. (F76)
- Streaming quality: Settings > Playback > Streaming quality picks Studio (24-bit / 48 kHz) or Studio Max (24-bit / 96 kHz). Players that can't play 96 kHz automatically get 48 kHz in sync with the rest; calibration, radio, AirPlay and Spotify stay at 48 kHz. (F77)
- AirPlay: the all-zones speaker is now called **WavWiz – Everywhere** (was "WavWiz – Whole House"); phones see the new name on the same speaker.
- AirPlay / Spotify Connect: sending to **WavWiz – Everywhere** plays in every zone again even when zones have their own music (they get it back when the phone stops); a zone's own name plays in that zone. The installer firewall rules now cover the per-zone receiver ports, and the log says when a phone connects but no audio arrives (firewall).
- Devices: while a phone casts to **WavWiz – Everywhere**, a "Casting: AirPlay Everywhere" bar on top of Devices shows the sender, title and artist with a Stop button, and the zones playing it get an AIRPLAY tag. (F78)
- Settings: the Settings window loads again after an AirPlay Everywhere session ends. (F78 fix)
- AirPlay: casts to two zones play side by side; a zone's own AirPlay or Spotify cast keeps playing when someone casts to **WavWiz – Everywhere** (the zone joins in when its cast ends), and ending Everywhere puts the other zones back without touching a zone still casting.
- Volume Mixer: zone cards stack in one column so every slider is long, and a speaker's status tags (REF, OFFLINE, BT, MUTED) sit on their own line under its full name instead of running into the slider. (F79)
- Devices: the grab hand shows only on the ⋮ drag handles of zones and speakers; the rest of a zone card shows the normal pointer. (F80)
- Phone pages (Devices, Library, Queue, Mixer, Scenes) scroll again on iPhone: the F68 Now Playing clip and forced layout now apply only on the Now page; the animation page clip has a hard timeout (F81)
- Devices keeps its scroll position: now-playing, progress, levels and cast (AirPlay / Spotify) updates are patched into the zone tree in place instead of rebuilding it; any redraw of a Devices panel (Classic, Roomy, Full, expanded, phone) restores every scroller, also when content fills in a moment later, and keeps focus; window.__wwScrollLog records each restore (F82)
- Queue beside the expanded Library: expanding the Library opens a collapsed queue in the right column (collapsing the Library restores it); that column has one show / hide button, and its header drops the Up next chip so the zone picker, pin, Copy and count fit at every scale (F83)
- Now Playing bar: album covers load instead of the black record placeholder; a cover that is not ready yet (online lookup, cache rebuild) is fetched again, also when the server announces new art, and follows every track change (F84)
- Now Playing bar (right column): the leftover Transparency chip is gone, the mixer button sits with the transport, and the freed row shows the Now Playing layout picked in Settings (Classic, Center, Stack, Horizon) in compact form, in the theme colors; click it to seek (F85)
- Player window: two rows instead of three - transport, mute, volume, %, Transparency and Home share one row, less padding; the window opens at and shrinks to the new height (about 89 CSS px) at any scale (F86)

## [0.4.8] - 2026-10-22 (beta)
- Queue: the full-screen Queue has its own player bar along the bottom. (F48)
- Master Volume mixer: every zone and speaker in one window, with each speaker's Delay and Max volume right there. (F49)
- Queue: "Up next" sits where it fits and never overlaps the pin button. (F50)
- Speakers: the Delay box is smaller and tidier. (F51)
- Devices: a + button to add a zone, and cleaner dividers in the list. (F52)
- Expanded Devices (Full and Roomy) runs full height with no now-playing player (Now Playing is on the home page); Scenes runs full height too and is as wide as the Devices panel. (F53)
- Player bars: the volume slider is gone from the play bars (the standalone mini player keeps its slider); a mixer button opens Master Volume instead. (F54)
- Mini player: fits at 200% display scaling, with small corner icons. (F55)
- Phone: "All sound settings" opens full screen with a Close button; the button stays small but is easy to tap (44 px). (F56)
- CD ripper: only offered on the PC running WavWiz, not on phones or other browsers. (F57)
- Roomy layout uses the same Devices bar as Classic. (F58)
- Devices: the collapsed Devices count reads vertically, in the same color as the Library count. (F59)
- Queue: a "Queue: [zone]" dropdown picks which zone's queue you see, in every size and on the phone, with "(playing)" next to the zone that's playing; the zone name no longer shows twice. (F60)
- Zone and speaker cards show what's playing right away instead of every ~10 seconds. (F61)
- Long song titles and artists scroll smoothly everywhere they are shown, including the phone and the mini player (off when "reduce motion" is on). (F62)
- Mixer: 2 columns, no overlaps, longer sliders. Nothing in the Master Volume window overlaps at any size, including 200% scaling at the 67% Display size, and narrow cards stack each speaker's slider under its name. (F63)

## [0.4.7] - 2026-10-21 (beta)
- Library: the side tab row (Artists / Albums / Genres / Folders) shows on a cold first start instead of an empty box. It is measured after layout and re-measured when the panel is shown, pinned, the layout or display size changes and fonts finish loading; with no width yet it shows every tab instead of moving them all into "⋯".
- Library: the selected tab's text uses the theme's on-accent color again (readable at 4.5:1 or better in every theme).
- With the Queue full screen, the Devices column (Full) and the Devices strip (Roomy) run full height down to the status bar again; the player bar stays left of it.

## [0.4.6] - 2026-10-20 (beta)
- Zones drag to reorder in the Devices tree; the tree trunk ends at the last elbow and the source zone redraws after a drag-out.
- Roomy layout holds through expanding the Library or Queue and through resizes; only Appearance > Layout changes it.
- The full-screen Queue keeps the full-width player bar; only the expanded Library shows the condensed player, which follows the chosen Now Playing layout and shows real art or a themed placeholder. The small corner "Now playing" box is gone.
- Expanded Devices: the Library rail runs full height and the player bar spans exactly the Devices area.
- Library: tabs fit on one row with a themed overflow menu; every Library control (Sort, More, inputs, buttons, menus) follows the theme, with no native dropdowns.
- iPhone: zone and speaker settings open as a full-width sheet with Back / Done that returns to the tree where you left it; no horizontal overflow at 390 px; the EQ header no longer overlaps the view buttons; 44 px touch targets; the menu has a Done button.
- Phone as a speaker: the clock and audio timing are re-measured on every start, resume and return from the background, so the delay you set stays right launch after launch.
- Delay / sync offset: fine-tune -/+ buttons (1 ms, hold to repeat) and a typed value box.
- The Queue can no longer be reordered by collapsing or expanding its panel.
- Scene editor: "Update from current setup" has its own row; Delete and Duplicate sit left, Cancel and Save right.
- One version number everywhere (refreshed from the server on reconnect).
- Build: removed the unneeded System.Security.Cryptography.ProtectedData package reference (NU1510).

## [0.4.5] - 2026-10-20 (beta)
- Library -> queue drag works in the WavWiz Player (WebView2) window and with touch and pen: a pointer-event drag path (no native HTML5 drag and drop needed); category rows (artist, album, genre, year, decade, folder) add all their songs; grab / grabbing cursor on draggable rows; works in the side panel, collapsed queue strip and expanded Library, into any zone's queue.

## [0.4.4] - 2026-10-19 (beta)
- Album art: one album's cover no longer bleeds over other albums/artists/folders (art keyed per track/real album; folder pictures only for single-album folders); missing artist tags fall back to album artist or the file name; admin "Rebuild album art" in Settings.
- Per-speaker mute/unmute toggle in Devices tree rows (panel and expanded), on the speaker page beside Volume and on phone; the MUTED tag unmutes.
- Devices: drag feedback in the tree, zone title selects Controlling, status tags open their setting, CONTROLLING chip on the collapsed Now Playing bar, speaker page keeps scroll/focus during status ticks, EQ preset dropdown on the speaker page, one tag size.
- Queue: Library drops onto the collapsed Queue strip, "Editing: <zone>" picker, Copy queue to zone; full-width volume sliders.
- Scenes & Schedules: schedule row grid, no horizontal overflow, wrapping scene subtitles; legacy presets migrate to My presets.
- Calibration: PC + mic pickers before Start; browser/phone speakers play calibration chirps; Delay applies live. Web speaker mid-song join fix.
- Collapsed Library rail count is vertical and themed.

## [0.4.3] - 2026-10-19 (beta)
- Fix: the visualizer and the EQ view's live meters were flat during zone playback on every device since 0.4.1 (only the house playback group fed them). Every group now feeds its own visualizer feed; `/ws/viz?zoneId=` follows the zone (and its links), the page follows the zone picker, and nothing is shown after stop. Idle groups do no analysis.
- Phone, browser and TV speakers now apply EQ (saved preset, live preview, revert, bypass, bass/treble, loudness, balance, trim; same math as the PC Player). The peak limiter stays PC-only.
- Devices panel matches the approved render: sentence-case zone boxes with an inline speaker count, grips and connector lines, inline tags, OFF/ON with Link/Split under it, no ⋯ button, one MASTER row (no CONTROLLING chip), and a zone paused at 0:00 shows as idle.
- EQ: band labels never overlap at any width, exactly one preset chip is lit, the Home EQ adjusts the Controlling zone's speaker by default with short picker labels.
- Speaker page: output picker and the calibration line (quick/thorough); Scenes & Schedules header on one line with the server PC clock; no dotted inner outline.

## [0.4.2] - 2026-10-19 (beta)
- Zones hold their own speakers (nested tree; each speaker in exactly one zone; Unassigned group; drag, "Move to zone" and right-click menus). Migrates existing sub-zone data safely.
- Every zone is a "Queue: <Zone> · PLAYING/IDLE" box with one now-playing line and volume; linked zones share one accent box "Queue: <Leader> · IN SYNC" (followers: "Queue from <Leader>"). The Controlling highlight wraps the whole zone box.
- Expanded Devices: Scenes & Schedules | detail pane (breadcrumb, defaults to the Controlling zone) | tree. Full inline speaker page (Max volume with CAPPED tag, EQ never locked, presets, Save as preset, rename, Move to zone, output, delay, Calibrate).
- EQ presets cut to 8 (retired ones kept for users on them). EQ view: lock in the top-right icon group, "All sound settings" on one line.
- Queue panel titles name the zone(s). Scenes save zone layout and links; schedules and alarms target zones only.
- Phone: same tree, Unassigned group, Move to zone, long-press menus, Thorough calibration toggle.
- Mini player: zone chip, small close, transparency, keyboard shortcuts, identical sizing at 100% and 200%. Shuffle is a play mode and no longer rewrites the queue.
- Fixes: pause/stop with an unknown zone no longer touches the house group; context-menu icons; grip gutter.

## [0.4.1] - 2026-10-18 (beta)
- The smaller zone takes precedence while it plays; its speakers are greyed on larger zones and the larger zone shows "N of M playing here". Split off explains when it would do nothing.
- Unknown zone ids fall back to the house group; every zone keeps its own playback group; stale groups are pruned; toasts are deduplicated and capped at 3.
- Zone and speaker cards: grip gutter, link icon, shared now-playing box for linked zones, right-click menus, drag to reorder, drop on the middle to link.
- Queue panel: zone picker and "Send this queue to another zone".
- Zone selector also on the master panel and in the mini and compact players.
- Mini player: volume, transparency button, smaller close, keyboard shortcuts.
- Calibration: Quick (one test per speaker) by default, Thorough optional; one-tap "Calibrate this speaker".
- iPhone: Add to Home Screen guide; per-device manifest so the Home Screen app opens as the same device.

## [0.4.0] - 2026-10-17 (beta)
- Zones can play their own music: zone chip, link / split off / link all, a now-playing line per zone. Zones start linked as before; each playback group is created lazily and shares decode and encode across linked zones (an idle zone runs no decoder, pump or timer).
- The Jukebox is its own zone with its own speaker picker.
- Alarms and the sleep timer can target a zone, the Jukebox or every zone.
- AirPlay and Spotify Connect: one name per zone ("WavWiz – <zone>"), switched on per zone in the zone editor (Phone casting). Receivers are AirPlay 1 / RAOP and librespot; AirPlay 2 is not included.
- Calibration pauses only the zones it measures.
- Reliable drag reordering.

## [0.3.9] - 2026-10-17 (beta)
This release rolls up 0.3.7, 0.3.8 and 0.3.9. The first two were test builds and were never published, so everything since 0.3.6 is listed here, grouped by theme.

### Devices
- Expanded Devices has three bordered columns (Scenes & Schedules, Zones, Speakers) with header bars, equal widths and equal gaps. Speaker cards sit in a two-wide grid and show the output device, status badge, zone chip and delay; the volume bar spans the full card width with the percentage at its right end, and Mute sits in the card's bottom-right corner. Zone cards are larger.
- A "Now playing in each zone" strip shows the current song on zones that are playing and "Nothing playing" on the others. WavWiz still has one queue for the whole house, so every zone shows the same song for now. Separate music per zone is planned for 0.4.0.
- Click anywhere on a speaker card to open its settings, or anywhere on a zone card to expand it. The expand arrow is gone; cards show a pointer and a hover highlight. The On/Off switch, Mute, volume, delay, pencil and drag handle keep their own actions.
- Master row in both Devices views: All off, All on and a master volume, with room between the slider and the buttons.
- Drag device and zone cards to reorder them (the order is remembered on each device). The standard Devices column uses large cards when there are few devices and compact cards when there are many.
- The collapsed Devices bar is a slim full-height bar with the mini player button built in, also while the Library is open. It stays visible outside the Queue column.

### Calibration
- A louder test sound with a Test volume slider.
- A mic check before each measurement, at every spot: it rates the level (good, weak or too quiet) and gives specific advice (move the mic closer, raise the test volume, check the Windows input). A live level meter stays visible during measurement.
- Your music stays paused for the whole calibration and only resumes when you choose.
- A silent speaker is retried automatically and named in the result instead of being skipped. Confidence always shows as 0-100% (readings above 100% in earlier builds were a display bug).
- Calibration with a wired PC microphone has now succeeded on more than one setup, including a remote PC. Phone-mic calibration on iPhone is still in testing.

### Queue
- The panel is now called Queue everywhere (Playlists stay in the Library).
- Drag to reorder in every view, including phones. While a sort is showing, dragging offers to apply that sort as the queue order.
- Locking the queue also locks sorting. The sorted column is highlighted, with a "Sorted by" chip you can clear (disabled while the queue is locked).
- Right-click (long-press on a phone) a queue item for Play now, Play next, Remove, Move to top or bottom, Add to playlist, Show in Library and Copy title. Remove and move are disabled while the queue is locked.
- Clear asks for confirmation and offers a short Undo. After an unexpected exit, the queue and current song are restored and playback starts paused.

### Sound and EQ
- One EQ for every entry point. An "All sound settings" button expands presets, Bass, Treble, Trim, Balance, Loudness, Limiter and Bypass in place. The same panel is in Speaker Settings.
- Purpose-based presets (by situation, speaker type and music style), shown in a plain select box that matches the output picker.
- One EQ lock keeps the whole panel from changing; the duplicate padlock is gone. Every padlock in the app now follows your theme color.

### Navigation, shortcuts and pins
- Keyboard shortcuts: Space (play/pause), Ctrl+Right / Left (next/previous), M (mute), Alt+M (show/hide the mini player), Alt+H (Home), Alt+E (Sound / EQ), Alt+Q (Queue) and Ctrl+, (Settings). Hints appear in the menus and Help > Keyboard shortcuts lists them. They stay quiet while you type or a window is open.
- Media keys on Windows (Play/Pause, Next, Previous, Mute, Volume up/down) work with WavWiz Player even while minimized, with a small on-screen volume indicator.
- Home returns to the default screen. Pin up to five shortcuts next to Home on the Now Playing bar and in both mini players; a pin icon on the Library, Queue and Devices title bars pins or unpins in one click. In the standalone mini player, one click opens the target in the main window.
- Every menu item and shortcut now brings its view to the front in its home spot (for example Sound / EQ and Queue work while the Library or Devices is expanded).
- Fixes: pins never overlap the transport controls on a small or scaled window (tested at 200% Windows scaling with 75% display size), and resizing the window no longer leaves the center blank.

### Now Playing and mini players
- The Now Playing bar sits in the center column under the Queue. The collapsed bar keeps elapsed and total time at 1366 px wide, and "Up next" text is centered.
- The standalone mini player has a large themed volume bar with the percentage, like the Devices tab, plus the Mute button next to the transport.
- Choosing Mini player from the menu opens the always-on-top mini player and minimizes the main window; Home on the mini restores the main window.
- A softly glowing button over the full-screen visualizer floats the mini player on hover. The hover mini player stays open while the pointer is on the button or the player.
- Removed the accent ring around the Now Playing bar and the extra outline on the Queue; panels share one border.

### Setup and look
- Pair a Player shows a QR code and the server address as text. The phone page has Add to Home Screen steps for iPhone and Android.
- Every text field, search box and select shares one style in all ten themes.

### Not yet confirmed on real hardware
Media keys and Alt shortcuts on more PCs, phone-mic calibration on iPhone, Balance (applied by WavWiz Player only), 4K screens, and TV browsers.

## [0.3.6] - 2026-10-15 (beta)
- Playlist: a compact icon title bar (Save, Clear, column picker, lock), a full-width table, and columns you can show or hide, resize, reorder and sort by clicking a header. The lock freezes the column layout and is themed like the speaker status tags. The same title bar appears in every playlist view.
- Chevrons and rails: clean thin chevrons on every expand and collapse control; the collapsed Library and Devices bars have an accent edge and a count badge (songs, devices online); title bars are slimmer (30 px); the Now Playing controls start collapsed into the narrow bar.
- Library: a dark placeholder and a quick fade-in for album covers (no more bright flash before the image loads).
- One shared 250 ms glide for every panel and slide, and one shared accent pulse when a menu item or button points at something already on screen (reduce-motion respected).
- Library expanded: the Library takes the whole left panel, the playlist stays on the right, and the real mini player sits under it. Devices collapsed becomes a slim rail with a small cover and progress line; hover opens the mini player. Queue in the Library menu always opens the playlist expanded.
- EQ: LED bars are permanent on every EQ look and follow the real level of each band's frequency (31 Hz to 16 kHz). The analog VU meter follows the theme (Pepecoin uses brand colors only). In visualizer mode, Power and Pop-out sit on the left so the swap button never moves.
- Expanded Devices: opening a speaker's settings gives it a wide center column (Scenes & Schedules collapses to a bar, Zones slides left, Speakers keep their width).
- Speaker profiles: save and load a speaker's volume, cap, delay, balance, bass, treble, EQ and output from the speaker settings; a scene can pick a profile per device. Scenes never change a max-volume cap. Balance is applied by WavWiz Player.
- Menus: hover submenus for choice lists (for example the Sleep timer times); File > New (zone, scene, alarm, schedule) with Ctrl+Shift+Z / S / A / H; File > Run starts scenes, schedules and alarms; the Devices menu lists devices, zones and scenes and jumps straight to them.
- Backup: File > Import settings, Restore backup, Export settings and Back up now. Restore shows a summary first and offers Undo restore. The last 10 saved backups are kept on the server.
- Fixes: a scene can no longer lift a max-volume lock through a profile; Save as no longer overwrites a profile with the same name; the scene editor shows newly saved profiles; the Speakers column no longer balloons in expanded Devices.
- Not yet confirmed on real hardware: Balance (it only affects Player-side audio), Ctrl+Shift+S / A / H (some browsers reserve them), the mini player hover pop-out with a real mouse, 4K screens, WebKit on a real iPhone, and the LED EQ and analog meter on a real GPU.

## [0.3.5] - 2026-10-14 (beta)
- Expanded Devices: Scenes & Schedules, Zones and Speakers side by side, with Speakers anchored on the right where they sit in the normal view. A speaker card opens in place to change its output, max volume, delay, EQ and name.
- Scenes, schedules and alarms are created and edited right in the Scenes & Schedules column; the Devices menu items open it (the separate window remains only on phones).
- Device cards: name with a labeled OFF | ON switch, one row of status tags, and the volume bar with mute. Zones use the same card.
- Max-volume lock fixed: setting a cap now locks it, and a capped bar shows a marker at the limit and stops there.
- Sleep timer is a button in Now Playing.
- Fewer popups: Playlists and Radio are Library tabs; CD ripper, Tag & cover fix and Tidy up library are tabs in the expanded Library; many small windows became inline. Every remaining window has the same fixed width.
- The playlist stays on the right while the Library is expanded, so songs can be dropped exactly where you want; the drop label shows the dragged count.
- Library Genres and Years tiles use artwork from the active theme colors with legible counts, at a smaller fixed tile size; years are grouped by decade.
- Display size moved into Settings > Appearance > Theme.
- One consistent look: shared window chrome, headings, tabs, buttons, labeled ON/OFF switches and tags in every theme, including the playlist table. The Pepecoin theme uses brand-kit colors only (copper replaces yellow and red).
- Jukebox: starts with an empty playlist and restores yours when it stops; plays random filler from the library until a guest picks (guest picks always come first); guests see how many plays they have left; the big screen scales to fill any TV, including 4K.
- WavWiz Player tray menu: Start Jukebox… / Stop Jukebox….
- Mini player: a clearly labeled transparency control (slider, Settings and the Player right-click menu) with a live preview.
- Not yet confirmed on real hardware: tray Jukebox, mini player window transparency, 4K in TV built-in browsers, and the plays-left counter with several phones at once.

## [0.3.4] - 2026-10-13 (beta)
- Installable web app: home-screen icon and iOS/Android home-screen support, a full web app manifest (192 px and maskable icons), and a versioned service worker that never caches the API or live connections; a new version replaces the old one.
- Playlist numbers 10 and up no longer wrap.
- The Gradient volume slider style is the two-color theme gradient again (Flat unchanged), and the fill follows every volume slider.
- Jukebox: Modern style fixed, Retro CD rebuilt (guest page and big screen), the chosen style applies everywhere, and Settings > Jukebox shows style preview cards. New GET /api/v1/jukebox/guest/picks.
- Adding an album from Jukebox search results works again.
- Jukebox guest search no longer loses focus or drops letters while typing; Add button styling fixed.
- The Now Playing bar docks in its own row under the expanded Library and Devices panels; speaker switches sit in their own column and output names show.
- Scenes & Schedules heading colors match Zones and Speakers.

## [0.3.3] - 2026-10-13 (beta)
- Settings and other center popups fit the live center column width (updated on resize, panel changes and Display size).
- Now Playing style picker: one style per row at full width, each preview laid out at the real panel width and scaled to fit.
- Settings redesign: unboxed list layout in theme colors; the Pepecoin theme uses brand-kit colors only.
- Mini player: icon-only master mute, window transparency (opaque by default, minimum 30 %, solid on hover, remembered), and text that fits.
- Expanding the Playlist slides Now Playing to the top of the center column; the EQ and visualizer pause while covered.
- Devices: volume bars reach the %, zone cards match device cards, "Speakers" wording, a slimmer standard panel, and a new expanded view (Zones | Speakers | Scenes & Schedules) with an Unassigned group and + Add to zone.
- Volume slider style: Gradient (theme) or Flat, in Settings > Appearance.
- Playlist drag and drop: reorder (multi-select, insertion line, auto-scroll, Ctrl+Z) and drop from the Library at a position (the server's /queue/add accepts "at").
- Jukebox Start and Stop dialogs fixed (validation keeps the dialog open; non-admins get a message).
- The Spectrum glow slider no longer sticks while dragging.

## [0.3.2] - 2026-10-12 (beta)

### Fixed

- **Album art:** covers were scrambled (magenta / green tiles) or missing after 0.3.0. The bundled ffmpeg's fast scaler produced garbage colors, and the 0.3.1 check that was meant to catch it relied on a part ffmpeg doesn't include, so it threw out every cover. Covers are now scaled bit-exact and checked by WavWiz itself; old cached covers are cleared once, and the app's cache is refreshed after an update.
- **Echo** when the phone or PC speaker was switched on and off quickly: only one speaker stream can exist per device now.
- **Black window** after snapping, maximizing or moving WavWiz Player to a screen with a different scale.
- The saved panel layout (folded Library, expanded Devices) is kept when the app starts.

### Added

- **Mini player** window (replaces Remote mode): cover, title, seek, previous / play / next, mute, volume, pin on top, slim size.
- **Zone cards** with members, one volume bar (keeps each speaker's offset) and a zone mute; a muted zone shows an amber icon.
- **Max-volume lock** per device (admin): nothing can raise a locked room above its cap; turning it down always works. Padlock by the volume bar.

### Changed

- **Expanded Devices:** three columns of device cards, then Zones and Scenes & Schedules in a fourth column; every card the same width.
- Status tags (REF, MUTED, OFFLINE, NO DELAY, Bluetooth…) sit on their own line under the volume bar.
- **Playlist** sits under Now Playing at the center width; ˄ expands it upward, ˅ folds it.
- Settings and other windows are as wide as the center panel. Library and Network use two columns of cards with (i) help.
- Now Playing styles are previewed at their real size, two per row.
- A locked EQ is no longer dimmed; the Lock button turns red (copper on Pepecoin).
- **Button transparency** now affects only the overlay buttons; the EQ and visualizer always draw at full strength.
- The collapsed Library rail mirrors the Devices rail. Round master mute.

### Removed

- **Remote mode** ("Use as remote only"). Use the Mini player, or just leave the speaker off.

## [0.3.1] - 2026-10-12 (beta)

### Added

- **Guided calibration:** before each speaker the calibration shows "Step X of N", the speaker's name and "Walk to <speaker>, hold the mic about 3 ft in front of it, then tap Ready". No test sound plays until Ready; an optional 5-second countdown can be turned on. Skip leaves a speaker's delay unchanged and says so in the summary; Retry measures only that speaker again. Works with the PC mic and the phone mic page.
- **Bluetooth outputs:** a Bluetooth tag on the device row, and a one-time "Bluetooth reconnected - recalibrate?" hint with Recalibrate when a Bluetooth output reconnects or changes. Calibration recommends a wired reference speaker.
- **Compact Scenes & Schedules** in the Devices panel: the next event with a countdown and Skip, Run buttons for scenes, and Open.

### Changed

- **Center-panel overlay controls:** one compact icon group (Lock EQ, EQ/Visualizer, Looks, Full screen; plus power and pop-out on the visualizer) with tooltips and a clear active outline. Looks is a popover (a bottom sheet on phones) with glow, intensity, speed, button transparency and overlay opacity, Reset and More…. Effects default to 50%.
- **Settings (PC):** a fixed-size window with the content scrolling inside, no scroll bar on the main tabs, and Reset this section beside the sub-tabs instead of on top of them.
- **Appearance:** themes, visualizer, EQ style and Now Playing style use the same live preview grid; Display size is Small, Default and Large (Medium and Extra large are kept or mapped to Large).
- **Devices panel:** standard Expand and Collapse icons, a label that goes back to "Expand", a lined-up folded rail, master volume that matches the device bars, and Mute all on its own line.
- **Delay slider:** a bigger handle, 1 ms steps, and the mouse wheel fine-tunes by 1 ms (Shift: 10 ms) and saves.

### Fixed

- Lock EQ could not be clicked under the glow and visualizer layers.
- The center EQ had scroll bars and was cut off on iPhone.
- Artist and album pictures could show magenta/green striped noise. Pictures are now decoded strictly and checked; a bad picture shows the artist's initials instead. The picture cache is rebuilt once after updating.
- The delay slider could stick or jump while the server sent updates.

## [0.3.0] - 2026-10-12 (beta)

### Added

- **Jukebox mode (beta):** Playback → Start Jukebox… (admin) turns a PC into a locked party screen: big cover art and Now Playing, the next songs with who asked for them, a QR code to join, and the visualizer behind. Guests scan the code and add songs from their phone with no app and no sign-in; search is grouped into Artists, Albums and Songs and only counts the music you allow. Rules in Settings → Jukebox: allowed folders and playlists, songs per guest (3 by default), vote to skip, an optional explicit filter (songs with "explicit" in the title or album), artist cooldown and auto-fill when the queue runs dry. Two styles: Modern and Retro CD. Esc, Alt+Tab and right-click do nothing on the Jukebox screen; only the host PIN gets out (hold the corner logo or press Ctrl+Shift+J). Windows itself can still be reached with Ctrl+Alt+Del or the Windows key: for a fully locked public PC, use Windows Assigned Access. The host keeps full control from the "Jukebox on" chip: pin next, remove, ban, lock the queue.
- **Remote mode:** use a phone, browser or PC as a remote only. It controls playback but plays no sound and is not a speaker card, and a banner in the Highlight color says so. Choose it on the connect screen, in Devices → Use as remote only, or with the **Remote mode** checkmark in the WavWiz Player tray menu. The choice is remembered.
- **Alarms (beta), sleep timer and crossfade:** Scenes & Schedules is one window with a server clock, a Next up strip, scene cards and a list of schedules and alarms sorted by next run. Alarms can play a playlist, song or radio station with a fade-in, on chosen days or once, with Snooze, Stop and Skip next. The sleep timer (15 to 90 minutes, end of song, end of album or custom) fades out over 30 seconds and shows a countdown on Now Playing. Crossfade (Settings → Playback, 0–12 s) is off by default and never crossfades between tracks of the same album.
- **EQ in the middle:** the center panel shows the live EQ by default (once, also after updating). The toggle next to Looks switches between EQ and Visualizer and is remembered on each device. The Sound window title names the speaker ("Sound · Kitchen").
- **Backup and restore:** Settings → General → Backup exports one .wavwizbackup file with your settings, playlists, scenes, schedules and alarms, EQ presets and device names and delays. Import shows what will change before anything is replaced. Certificates, private keys and passwords are never in the file.
- **Settings:** a search box in the header, an inline "Saved ✓" next to what you changed, a **Reset this section** button on every section, shorter help with **Learn more**, and friendly role names (View, Control, Admin). Calibration has its own sub-tab under Devices. The HTTPS redirect option moved under Advanced with a warning.
- **Mouse wheel on every slider:** one step per notch, Shift for bigger steps; Lock EQ is respected.

### Changed

- **Library and Devices panels:** each side panel folds to a slim rail with its icon and name, opens normally or expands. One arrow on the outer edge, one Expand button on the inner edge (it reads "⤡ Esc" while expanded), smooth 240 ms moves, and Now Playing keeps at least 420 px. Keys: `[` and `]` fold or open, Shift+`[` / Shift+`]` expand, Esc returns. Devices → Devices & zones opens Devices expanded.
- **Getting started** has a new step, "Calibrate your speakers".
- **Contrast:** text is at least 4.5:1 on all ten themes, with a visible focus ring on every control. Pepecoin uses only its brand colors.
- **Confirmations and errors** use the app's own dialogs (no browser pop-ups) with a plain sentence and a next step.

### Fixed

- **Sliders no longer jump back while you drag them** when other devices change things at the same time (most noticeable on the delay slider).
- **iPhone calibration mic page:** the microphone is now requested directly from the **Allow microphone** tap. If access is blocked, the page says how to allow it ("Settings > Safari > Microphone"), and it always shows the error and whether the page is secure, for bug reports. Opened over plain http, the page moves to the secure address or shows the setup step.

> **Still in testing:** phone-mic calibration on an iPhone. Calibrating with the PC's microphone (WavWiz Player) is recommended until a real iPhone passes.

## [0.2.5] - 2026-10-11 (beta)

Replaces 0.2.4, which was a test build and was not published; its fixes are listed under [0.2.4] below and are all included in 0.2.5.

### Fixed

- **iPhone calibration no longer joins as a speaker:** on a real iPhone, 0.2.4 stopped with "InvalidStateError: AudioSession category is not compatible with audio capture" and never asked for the microphone. The calibration QR code opened the normal WavWiz page, which joined the phone as a speaker first; that set the phone's audio session to playback-only and started audio, so iOS refused the microphone. The QR code now opens a separate **mic-only page** that never joins as a speaker and never plays: on the Start tap it sets the audio session to play-and-record, asks for the microphone first, and only then starts a record-only audio engine.

> **Still in testing:** phone-mic calibration on an iPhone may not show the microphone permission prompt yet. For now, calibrating with the PC's microphone (WavWiz Player) is recommended; a fix for the phone prompt is coming in a later update.

### Added

- **Calibrate with the PC's microphone (recommended):** WavWiz Player records with the PC's own mic (USB, headset, audio interface or built-in, through Windows audio), with a mic picker that remembers your choice and a live level meter. Bluetooth headset mics work but show a warning ("Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended."). The Calibrate screen offers the PC mic first, then your phone, then by ear.
- **Phone role:** a phone asks once whether to **play music here** or be a **calibration mic**; change it in Devices → Phone role….
- **Calibration mic line:** while a phone (or a PC mic run) is the calibration mic, Devices shows it at the top with **Stop using as mic**.

### Changed

- **Device cards (Expanded):** tags right of the name (REF, MUTED, NO DELAY, OFFLINE, SPEAKER; at most two), one status line (playing · output · delay), volume row with the round Mute on the right, and one Settings button. Settings: Output, Delay (slider, exact ms and Calibrate, with "Measured with … · date"), Test sound, Sound / EQ and More (Rename, Set as reference, Delay history, Forget), and the connection on one line. Offline devices are grayed and show when they were last seen. Admin-only controls stay visible, read-only.
- **Settings is wider on a PC:** Appearance's sections (Theme, Visualizer, EQ, Now Playing, Display size) are sub-tabs under the main tabs, so the content uses the full width; the dialog grows to about 1200 px on large screens; pinned previews stay and scale to fit.

## [0.2.4] - 2026-10-11 (beta, test build, not published)

### Fixed

- **Phone set-up page works with the HTTPS redirect on:** with "send other devices to the secure (HTTPS) address" switched on, the set-up page's own logo and script were sent to the secure address and blocked, so the steps stayed hidden and Check my phone did nothing. The page's own files now load normally.
- **The calibration QR code goes straight to calibration:** the set-up page opened from Calibrate speakers shows a Continue to secure calibration button, so the hand-off works even if the page's script cannot run.
- **Install steps when the phone does not trust the certificate:** the iPhone / Android steps are always visible, and a phone that is not trusted yet gets its download button and highlighted install steps.
- **Song title and artist on phones:** on a phone, Now Playing showed the cover, time and controls but not the song title or artist. They show again in every control panel style.

### Changed

- **Certificate and profile names say WavWiz:** the downloaded certificate is wavwiz-root-ca.crt and the iPhone profile wavwiz-root-ca.mobileconfig (organization WavWiz). A server whose certificate still carried the old name gets a new WavWiz certificate on first start (the old files are kept as backups); phones need to install and trust the new certificate once.

## [0.2.3] - 2026-10-11 (beta)

First public release since 0.1.3. Versions 0.2.0, 0.2.1 and 0.2.2 were test builds and were not published on their own; their changes are listed below and are all included in 0.2.3.

### Changed

- **Minimized Now Playing is one line:** album thumbnail, title · artist over the progress bar (elapsed / total), then heart, shuffle, previous, Play / Pause, next, repeat, volume + %, mute and EQ, all on the Now Playing bar and scaled to fit (less important pieces drop out first on narrow columns). Nothing moves to the Playlist title bar any more, and Play / Pause is no longer forced to the center.
- **Minimized Playlist shows "Up next":** the next song in the queue (cover, title · artist), centered on the Now Playing column; the track count, Save as playlist and Clear stay at the right.
- **The one-line bar follows the selected control panel style and theme:** Classic (progress ring around the thumbnail, glowing round Play), Center (soft buttons, waveform seek, spinning record thumbnail), Stack (small LCD window, LED-block seek, squared buttons), Horizon (glowing thumbnail, seek line flowing from it, ring buttons), in the theme's Main / Second colors; the panel effect sliders apply.
- **Settings > Appearance > Display size** has no preview pane; the whole app already changes live.
- **Pinned previews:** the Theme, Visualizer, EQ and Now Playing live previews stay at the top of the page while the settings below scroll, at every Display size (the pinned preview shrinks on short windows).
- **Expand buttons** point the way the panel travels: Devices expands to the left and returns to the right; Library is the mirror image.
- **Devices header:** the DEVICES title sits at the right edge, a true mirror of LIBRARY.
- **Device cards open into their settings:** the ••• button on each device card is now a themed chevron **Settings** button (it matches the Library / Devices expand arrows). It opens the device's settings (sound check, exact delay, Sound / EQ, connection, Rename / Set as reference / Forget) downward under the card, in place, on the cards of the Expanded Devices view (and the Devices page on phones); the chevron flips, and the button or Esc closes them. Admin-only items stay visible but read-only for other users. Each card remembers being open for the browser session. The Standard Devices list stays compact (name, status, volume, Mute and on/off) and has no Settings button: tap a device's name there to open the Expanded view with its card highlighted.
- **Appearance > EQ shows the real EQ:** the preview mirrors this device's speaker (bands, preset, pre-gain, loudness), live, in the chosen style. It opens with Lock EQ checked every time; unchecked, changes play at once and are kept in the speaker's own preset ("<speaker> EQ").

### Added

- **Lock EQ:** a checkbox with a padlock in the Sound (EQ) window header and on the Appearance > EQ preview. Locked, the EQ sliders ignore the mouse wheel (the page scrolls instead), dragging, clicks and keys, and look slightly dimmed with a small lock. Remembered per device; off by default (the wheel still fine-adjusts in 0.5 dB steps).

### Fixed

- **Revoking a device removes it from the Devices list:** revoking a paired phone or browser (Settings > Devices > Paired devices & tokens) left the speakers it had opened in that browser on every Devices list, still connected and playing, because only WavWiz Player tokens were handled. Now everything the token owns leaves the list at once on every open page (Standard, Expanded, zones and the Devices page), its connections close, and it has to pair again. Forget device on a browser speaker no longer lets it rejoin straight away, and a list that was busy (a slider, menu or zone editor open) no longer keeps a removed device.
- **Open device settings stay put:** with a device card's Settings open, the section with Delay kept refreshing every few seconds, which closed dropdowns, reset a delay you were typing and interrupted slider drags. Device cards are now updated in place: live values (status, volume, mute, delay, connection) change without rebuilding the card, and nothing you are typing in or dragging is replaced. A removed device still leaves the list at once.

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

## [0.2.0] - 2026-10-08 (beta)

### Added

- **Every browser is a speaker:** any desktop, phone or tablet browser that opens WavWiz joins as a speaker by itself, with a readable name (for example "Chrome on Windows"). The separate "This phone as a device" page is gone.
- **Safe start for slower browsers:** the visualizer starts after the page is ready, a stall watchdog switches to a lighter mode if the page freezes, and `?lite` opens the light layout directly.
- **Getting started:** one short guide on first run and from Help > Getting started (speakers, test sound, next steps).
- **Sign in as admin / Leave admin mode** (File menu): unlock admin settings in place without signing out or pairing again; an Admin chip shows while it is on. Admin-only items are read-only for everyone else, never hidden.
- **Master volume** at the top of Devices, and a Mute button on every speaker.
- **Outputs:** each PC speaker shows its audio output, can switch it, and keeps its delay (0–1000 ms) per output.
- **Set as reference:** pick a house reference speaker once; calibration uses it by default.
- **Four Now Playing styles:** Classic (default), Center, Stack and Horizon, each with Panel effects sliders (50% default).
- **Ten theme presets**, including Blue Steel, an all-green Pepecoin, Nebula and Lime Circuit; custom themes with more color pickers.
- **Library:** sorting with a flip button and a letter strip on every tab, favorites (hearts) with a Favorites tab, a cover grid, and the big Expanded library view.
- **Spectrum visualizer** (smooth rounded bars in the theme colors with a glossy reflection), every effect 0–100% with a 50% default.
- **What's new** pop-up, shown once after an update.
- Transparent square app icons; silent-install switches, exit codes and upgrade behavior documented in [docs/INSTALLER.md](docs/INSTALLER.md).

### Changed

- The volume and Mute on the Now Playing panel control only the device you are using; the header chips only show status.
- Regular users can set the delay and output of their own device; house-wide settings stay with the administrator.
- **Calibration** pauses the music and resumes it afterwards, re-syncs the clock before every recording, and waits for you to walk to the next speaker, with a Wi-Fi meter.
- The About box and privacy note now say plainly which features reach the internet (internet radio, tag and cover lookups, Spotify Connect).
- MusicBrainz lookups identify themselves with the current WavWiz version.

### Removed

- The Terrain visualizer (a saved Terrain choice switches to Spectrum).

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
