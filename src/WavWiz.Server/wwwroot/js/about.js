import { h, dialog } from './util.js';
import { wordmark } from './brand.js';

export const WHATS_NEW_VERSION = '0.2.2';
// 0.2.0 item 25: shown once after the update (keyed on this version per browser) so nobody thinks something broke.
export const WHATS_NEW = [
  ['Now Playing folds down to one line', 'Collapse the control panel and every control stays on one strip, with Play / Pause right in the middle. The song, its cover and the progress bar move up into the Playlist bar, and the visualizer gets the extra room.'],
  ['Appearance in sections', 'Settings > Appearance has its own menu on the left: Theme, Visualizer, EQ, Now Playing and Display size. Theme and Visualizer are the big pages you liked from 0.2.0 again, and every section shows a live preview.'],
  ['Use your phone as the microphone', 'Devices > Calibrate speakers shows a QR code. Scan it, install the WavWiz certificate once if asked, allow the microphone and follow the prompts. The PC page shows when your phone is connected.'],
  ['Devices works like the Library', 'The Devices header is a mirror image of the Library header, the arrow and Expand button behave the same in both, and Devices & zones always opens the expanded view.'],
  ['More artist pictures', 'Artists without a photo show their album covers, four at a time. Photos also come from TheAudioDB now, missing pictures are tried again later, and Settings > Library shows how many were found, with a Retry button.'],
  ['Smoother updates on Windows', 'The installer closes a running WavWiz by itself and starts it again afterwards. The Player opens its window when you start it from the Start menu, and a second start brings the open window to the front.'],
  ['Fixes', 'The Auto pre-gain badge no longer covers the Loudness switch, the status bar shows "Reconnecting…" only when the connection drops (the top-right light shows Connected), and the Pepecoin logo is a bit smaller.'],
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
