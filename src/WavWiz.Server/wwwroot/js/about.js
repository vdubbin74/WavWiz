import { h, dialog } from './util.js';
import { wordmark } from './brand.js';

export const WHATS_NEW_VERSION = '0.3.3';
// 0.2.0 item 25: shown once after the update (keyed on this version per browser) so nobody thinks something broke.
export const WHATS_NEW = [
  // 0.3.3 (only what shipped)
  ['Jukebox starts again', 'Playback > Start Jukebox… works again: the Start and Stop buttons were blank and did nothing in 0.3.2.'],
  ['New Settings look', 'Settings is a clean list per section in your theme colors, and never wider than the center panel.'],
  ['Devices', 'The Devices panel is slimmer, so more speakers fit. Expanded shows Zones, Speakers (one line each, with the output name) and Scenes & Schedules side by side. Speakers that are not in a zone get + Add to zone.'],
  ['Volume slider style', 'Settings > Appearance > Display size: Gradient (from your theme colors, the default) or Flat.'],
  ['Playlist drag and drop', 'Drag songs to reorder them (Ctrl / Shift to pick several, Ctrl+Z undoes), or drag songs, albums and folders from the Library to the spot you want.'],
  ['Now Playing and the Playlist', 'Expanding the Playlist slides Now Playing up with it. The Now Playing picker shows each style full width and to scale.'],
  ['Mini player', 'A mute button, a window transparency control (solid again when you point at it) and text that fits.'],
  ['Fixes', 'The Spectrum glow slider no longer sticks while you drag it.'],
  // 0.3.2 (only what shipped)
  ['Album art fixed', 'Covers show correctly again instead of scrambled or missing tiles. Old cached covers are cleared once after the update.'],
  ['Zones as cards', 'Zones now look like device cards, with their members, one volume bar and a mute button. Moving a zone keeps each speaker\'s offset. A muted zone shows an amber icon.'],
  ['Expanded Devices', 'Three columns of device cards, then Zones and Scenes & Schedules in the fourth column, all cards the same width.'],
  ['Playlist', 'The playlist sits under Now Playing at the center width. ˄ expands it upward, ˅ folds it back.'],
  ['Settings', 'Settings and other windows match the center panel width. Library and Network use two columns of cards with (i) help.'],
  ['Now Playing styles', 'The picker shows each style at its real size, two per row.'],
  ['Mini player', 'A small movable window with only the playback controls: cover, title, seek, previous / play / next, mute and volume. Pin it to keep it on top. Devices > Mini player, or the tray menu on a Player PC.'],
  ['Fixes', 'No more echo when the phone or PC is used as a speaker and toggled quickly. The window no longer goes black after snapping. The Library rail mirrors the Devices rail.'],
  // 0.3.1 fix pass (only what shipped)
  ['Guided calibration', 'Before each speaker: Step X of N, where to stand, then Ready (with an optional 5 s countdown). Skip keeps a speaker as it is; Retry measures just that speaker again. On the PC mic and the phone.'],
  ['Bluetooth speakers', 'Bluetooth outputs are tagged in Devices. When one reconnects, a hint offers Recalibrate. A wired speaker makes the best reference.'],
  ['Cleaner overlay controls', 'The center panel has one small icon group: Lock EQ, EQ/Visualizer, Looks and Full screen. Looks holds glow, intensity, speed, button transparency and overlay opacity. Lock EQ is always clickable.'],
  ['Settings that fit', 'A fixed-size Settings window on PC with no stray scroll bars, Reset this section beside the sub-tabs, live preview grids for themes, the visualizer, EQ and Now Playing styles, and Small, Default and Large display sizes.'],
  ['Devices panel fixes', 'Expand and Collapse use standard icons and labels, the folded rail lines up, master volume matches the device bars, Mute all has its own line, and a compact Scenes & Schedules section shows what runs next.'],
  ['Fixes', 'The EQ fits iPhone screens without scroll bars, artist pictures are no longer striped (bad pictures show initials instead), and the delay slider no longer sticks; the mouse wheel fine-tunes it by 1 ms (Shift: 10 ms).'],
  // 0.3.0
  ['Jukebox mode (beta)', 'Playback > Start Jukebox… turns a PC into a locked party screen. Guests scan the QR code and add songs from their phone, no app or sign-in. Only the host PIN gets out.'],
  ['Alarms (beta), sleep timer, crossfade', 'Scenes & Schedules is one window. Wake up to a playlist with a fade-in, snooze or skip the next alarm, fall asleep with a timer, and crossfade songs (Settings > Playback, off by default).'],
  ['EQ in the middle', 'Now Playing shows the live EQ by default. The toggle next to Looks switches to the visualizer, remembered on this device.'],
  ['Backup and restore', 'Settings > General > Backup saves your settings, playlists, scenes, alarms, EQ presets and device names in one file, with a preview before restoring.'],
  ['Easier Settings', 'Search in the header, Saved ✓ next to each change, Reset this section, and a Calibration tab under Devices.'],
  ['Tidier panels', 'Library and Devices fold to a slim rail or expand, with one arrow and one Expand button each. Keys: [ and ], Shift to expand, Esc to return.'],
  ['Steadier sliders', 'Sliders no longer jump back while you drag, and the mouse wheel fine-tunes every slider (Shift for bigger steps).'],
  ['iPhone mic page', 'The calibration mic page asks for the microphone straight from the Allow microphone tap and explains how to allow it if it was blocked. Still in testing on iPhone: the PC mic is recommended.'],
  // 0.2.5 (kept below the 0.3.0 items)
  ['Calibrate with your PC’s mic', 'Calibrate speakers now starts with the microphone on a WavWiz Player PC: a USB or headset mic, or the built-in one. Pick it, check the level, press Start. Bluetooth mics work too, with a warning: they add their own delay.'],
  ['iPhone calibration fixed', 'Scanning the calibration QR code opens a mic-only page that never plays music, so the iPhone asks for the microphone and measures. It stopped with an "AudioSession" error before.'],
  ['Phone: speaker or mic', 'A phone asks once whether to play music or be a calibration mic. Change it in Devices > Phone role. While a phone is the mic, Devices shows it at the top with Stop using as mic.'],
  ['Cleaner device cards', 'Tags next to the name, one status line, Mute on the right, and one Settings button with Output, Delay with Calibrate, Test sound, Sound / EQ and More.'],
  ['Wider Settings', 'Appearance sections are tabs under the main tabs, so previews use the full width. Settings grows to about 1200 px on large screens.'],
  ['Phone set-up page fixed', 'The phone set-up page works again when WavWiz sends other devices to the secure (HTTPS) address: the logo shows, the steps for your phone appear and Check my phone works.'],
  ['QR code goes straight to calibration', 'Scanning the Calibrate speakers QR code now takes your phone straight on to calibration, with a Continue to secure calibration button right on the page.'],
  ['Install steps when needed', 'If your phone does not trust WavWiz yet, the set-up page shows the download button and the install steps for your phone right away.'],
  ['Song title on phones', 'On a phone, Now Playing shows the song title and artist again, in every control panel style.'],
  ['Certificate says WavWiz', 'The security certificate and the phone profile are now named WavWiz everywhere. If your server still had an older certificate, it gets a new one: install and trust it on each phone once (open the set-up page from the QR code in Settings > Phone & HTTPS).'],
];

const CREDITS = [
  ['FFmpeg (libavcodec, libavformat, libavfilter, libswresample, libswscale)', 'LGPL 2.1+ / 3', 'Decoding of music files and radio streams, cover thumbnails, and encoding ripped CD audio to FLAC/AAC. This product uses libraries from the FFmpeg project under the LGPL; no GPL or non-free parts (libcdio demuxer not enabled). LAME/MP3 encode is not shipped.', 'https://ffmpeg.org'],
  ['libcdio / libcdio-paranoia (wavwiz-cdda helper)', 'LGPL 2.1+', 'Reading audio CDs (CDDA). Shipped as a separate helper (not inside FFmpeg — FFmpeg\'s libcdio demuxer is GPL-gated and is not enabled)', 'https://www.gnu.org/software/libcdio/'],
  ['Chromaprint (fpcalc)', 'LGPL 2.1+', 'Audio fingerprints for AcoustID tag lookup (optional; needs an AcoustID API key)', 'https://acoustid.org/chromaprint'],
  ['TagLib# (TagLibSharp)', 'LGPL 2.1', 'Reading song tags and embedded covers', 'https://github.com/mono/taglib-sharp'],
  ['NAudio', 'MIT', 'Audio output on Windows (WASAPI)', 'https://github.com/naudio/NAudio'],
  ['Microsoft Edge WebView2', 'Microsoft BSD-style license', 'Shows this page inside WavWiz Player', 'https://developer.microsoft.com/microsoft-edge/webview2/'],
  ['QRCoder', 'MIT', 'QR codes for phone set-up', 'https://github.com/codebude/QRCoder'],
  ['SQLite (Microsoft.Data.Sqlite)', 'Public domain / MIT', 'The library and settings database', 'https://www.sqlite.org'],
  ['.NET and ASP.NET Core', 'MIT', 'The runtime of the server and the player', 'https://dotnet.microsoft.com'],
  ['Nunito', 'SIL Open Font License 1.1', 'Letter shapes used in earlier wordmark experiments; 0.0.6 header is plain system text', 'https://fonts.google.com/specimen/Nunito'],
  ['shairplay (wavwiz-airplay)', 'LGPL 2.1+ (ALAC decoder MIT, crypto BSD)', 'The AirPlay speaker. Runs as a separate program; source in the licenses folder', 'https://github.com/juhovh/shairplay'],
  ['librespot', 'MIT', 'Spotify Connect add-on (off by default). Runs as a separate program; unofficial, not made by Spotify', 'https://github.com/librespot-org/librespot'],
  ['Inno Setup', 'Inno Setup License', 'Builds the installer (not part of the installed app)', 'https://jrsoftware.org/isinfo.php'],
];
const FILES = [['/licenses/LICENSE.txt', 'WavWiz license'], ['/licenses/THIRD-PARTY-NOTICES.txt', 'Third-party notices'], ['/licenses/FFMPEG-BUILD.txt', 'FFmpeg build configuration and source'], ['/licenses/COPYING.LGPLv2.1.txt', 'LGPL 2.1'], ['/licenses/LICENSE-shairplay.txt', 'shairplay license'], ['/licenses/LICENSE-librespot.txt', 'librespot license'], ['/licenses/COPYING.LGPLv3.txt', 'LGPL 3'], ['/licenses/PRIVACY.txt', 'Privacy note']];

export function aboutBody(S) {
  const v = S?.auth?.appVersion ?? '';
  return h('div', { class: 'about' },
    h('div', { class: 'aboutHead' }, h('img', { src: '/assets/logo-128.png', alt: '', width: 72, height: 72 }), h('div', null, wordmark('wordmark big'), h('div', { class: 'small dim' }, `BETA ${v}`))),
    h('p', null, 'WavWiz plays your own music in sync on every speaker in the house: PCs with Bluetooth or wired speakers, phones, TVs and any browser. No cloud account, no analytics, no telemetry.'),
    h('div', { class: 'card' }, h('h3', null, 'Privacy'), h('ul', { class: 'small' },
      h('li', null, 'No cloud account, no analytics, no telemetry. WavWiz doesn\'t open ports to the internet; by default it only listens on your home network.'),
      h('li', null, 'WavWiz does use the internet for what you choose: internet radio (and the Radio finder), tag and cover lookups, and Spotify Connect if you switch it on.'),
      h('li', null, 'Your music files are only read, never changed. The library, passwords (stored as hashes) and settings stay in the WavWiz data folder on the server PC.'),
      h('li', null, 'Internet radio stations are contacted only when you play one. The Radio finder and tag auto-fill contact Radio Browser / MusicBrainz / Cover Art Archive / AcoustID only when you use those tools (AcoustID needs your own API key). Online covers and artist photos (MusicBrainz, Cover Art Archive, Wikidata / Wikimedia Commons, TheAudioDB) are looked up in the background unless you switch them off in Settings > Library. Phones and browsers talk to the server directly.'))),
    h('div', { class: 'card' }, h('h3', null, 'Credits'), h('p', { class: 'small dim' }, 'WavWiz is built with the open-source work of others. Thank you.'),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Component', 'License', 'Used for'].map(x => h('th', null, x)))),
        h('tbody', null, CREDITS.map(([n, l, u, url]) => h('tr', null, h('td', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, n)), h('td', null, l), h('td', { class: 'small' }, u)))))),
    h('div', { class: 'card' }, h('h3', null, 'Licenses and source'), h('p', { class: 'small' }, 'WavWiz itself is released under the license below. FFmpeg and TagLib# are used as separate libraries under the LGPL: you may replace them with your own build (the FFmpeg libraries are separate DLLs next to the server). The exact FFmpeg source and build configuration are listed in the FFmpeg build file.'),
      h('ul', { class: 'small' }, FILES.map(([u, t]) => h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, t))))),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => openWhatsNew() }, `What's new in ${WHATS_NEW_VERSION}`)));
}
export function openAbout(S) { return dialog('About WavWiz', aboutBody(S), [{ text: 'Close' }], { cls: 'page' }); }

export function openWhatsNew(onClose) {
  return dialog(`What's new in WavWiz ${WHATS_NEW_VERSION} BETA`, h('div', { class: 'whatsnew' }, h('div', { class: 'row' }, wordmark('wordmark')), h('ul', null, WHATS_NEW.map(([t, x]) => h('li', null, h('b', null, h('span', { class: 'newchip' }, 'NEW'), t), h('div', { class: 'small dim' }, x))))),
    [{ text: 'Got it', cls: 'primary' }], { cls: 'whatsnew-dlg', onClose });
}
/** Shown once per device (keyed on the version in localStorage), never on the sign-in screens. */
export function maybeWhatsNew(S) {
  const key = 'wavwiz.whatsnew'; let seen = null; try { seen = localStorage.getItem(key); } catch { /* private mode */ return; }
  if (seen === WHATS_NEW_VERSION) return;
  openWhatsNew(); try { localStorage.setItem(key, WHATS_NEW_VERSION); } catch { /* ignore */ }
  void S;
}
