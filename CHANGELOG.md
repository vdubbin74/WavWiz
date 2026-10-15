# Changelog

All notable changes to WavWiz are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses a **public beta** versioning scheme (0.x). Dates may be
approximate for early builds.

WavWiz is currently in **beta**. Breaking changes and rough edges are expected.

## [Unreleased]

Nothing yet.

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
