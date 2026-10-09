import { h, dialog } from './util.js';
import { wordmark } from './brand.js';

export const WHATS_NEW_VERSION = '0.2.1';
// 0.2.0 item 25: shown once after the update (keyed on this version per browser) so nobody thinks something broke.
export const WHATS_NEW = [
  ['Terrain is now Spectrum', 'The Terrain visualizer was retired. If you had it picked, you now get Spectrum: smooth rounded bars in your theme colors with a glossy reflection. Every effect has its own 0–100 % slider (50 % default).'],
  ['Four Now Playing styles', 'Classic, Center, Stack and Horizon. Pick one in Settings > Appearance; Classic is the default. A Panel effects slider tunes the glow and motion.'],
  ['Every browser is a speaker', 'Any browser that opens WavWiz - desktop, phone, tablet or smart TV - joins as a speaker by itself and gets a readable name, like “LG TV browser”. The separate “This phone as a device” page is gone. TVs get a light, remote-friendly screen.'],
  ['This device first', 'The volume and Mute on the Now Playing panel now control only the device you are using. Master volume moved to the top of Devices, and every speaker has its own Mute.'],
  ['Devices in three sizes', 'The Devices panel is Collapsed, Standard or Expanded. Expanded shows every device with volume, mute, output and delay inline - no more pop-up. The delay is saved per output.'],
  ['Getting started + admin mode', 'A short Getting started guide opens on first run and from Help > Getting started. File > Sign in as admin unlocks admin settings without signing out; Leave admin mode switches back.'],
  ['Library and themes', 'Sorting on every tab, favorites (hearts), a cover grid and a big Expanded library. Ten themes, including Blue Steel, an all-green Pepecoin, Nebula and Lime Circuit, and custom themes with four colors.'],
  ['Calmer calibration', 'Calibration pauses the music and plays it again afterwards, re-syncs the clock before every recording, and waits for you to walk to the next speaker with a Wi-Fi meter.'],
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
      h('li', null, 'Internet radio stations are contacted only when you play one. The Radio finder and tag auto-fill contact Radio Browser / MusicBrainz / Cover Art Archive / AcoustID only when you use those tools (AcoustID needs your own API key). Phones and browsers talk to the server directly.'))),
    h('div', { class: 'card' }, h('h3', null, 'Credits'), h('p', { class: 'small dim' }, 'WavWiz is built with the open-source work of others. Thank you.'),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Component', 'License', 'Used for'].map(x => h('th', null, x)))),
        h('tbody', null, CREDITS.map(([n, l, u, url]) => h('tr', null, h('td', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, n)), h('td', null, l), h('td', { class: 'small' }, u)))))),
    h('div', { class: 'card' }, h('h3', null, 'Licenses and source'), h('p', { class: 'small' }, 'WavWiz itself is released under the license below. FFmpeg and TagLib# are used as separate libraries under the LGPL: you may replace them with your own build (the FFmpeg libraries are separate DLLs next to the server). The exact FFmpeg source and build configuration are listed in the FFmpeg build file.'),
      h('ul', { class: 'small' }, FILES.map(([u, t]) => h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, t))))),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => openWhatsNew() }, `What's new in ${WHATS_NEW_VERSION}`)));
}
export function openAbout(S) { return dialog('About WavWiz', aboutBody(S), [{ text: 'Close' }], { cls: 'page' }); }

export function openWhatsNew(onClose) {
  return dialog(`What's new in WavWiz ${WHATS_NEW_VERSION} BETA`, h('div', { class: 'whatsnew' }, h('div', { class: 'row' }, wordmark('wordmark')), h('ul', null, WHATS_NEW.map(([t, x]) => h('li', null, h('b', null, t), h('div', { class: 'small dim' }, x))))),
    [{ text: 'Got it', cls: 'primary' }], { cls: 'whatsnew-dlg', onClose });
}
/** Shown once per device (keyed on the version in localStorage), never on the sign-in screens. */
export function maybeWhatsNew(S) {
  const key = 'wavwiz.whatsnew'; let seen = null; try { seen = localStorage.getItem(key); } catch { /* private mode */ return; }
  if (seen === WHATS_NEW_VERSION) return;
  openWhatsNew(); try { localStorage.setItem(key, WHATS_NEW_VERSION); } catch { /* ignore */ }
  void S;
}
