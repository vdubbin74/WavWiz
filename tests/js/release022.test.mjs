// WavWiz 0.2.2 (T1-T11): the user's 0.2.1 test notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
void imp;

test('0.2.2 T4: artist tiles fall back to the artist\'s album covers (mosaic of 4 or one cover) before the generated portrait; live swap on "art"', () => {
  const a = src('art.js');
  assert.match(a, /export function artistCover\(name, ids = \[\], cls = 'lg rnd', size = 384\)/);
  assert.match(a, /ok\.length >= 4 \? ok\.slice\(0, 4\) : \[ok\[0\]\]/);
  assert.match(a, /if \(!ok\.length\) \{ m\.remove\(\); return; \}\s*\/\/ no album art either: the generated portrait stays/);
  assert.match(a, /export function artPushed\(d\)/);
  assert.match(src('main.js'), /m\.type === 'art'\) \{ artPushed\(m\.data\)/);
  const l = src('library.js');
  assert.match(l, /const artistArt = a => artistCover\(a\.name, a\.artTrackIds, 'lg rnd', 384\)/);
  assert.match(l, /artistCover\(a\.name, a\.artTrackIds, 'sm rnd', 96\)/);
  assert.match(css, /\.acover \.amosaic\{position:absolute;inset:0;display:grid/);
});

test('0.2.2 T4e: Settings > Library has the Online art card (counts, switch, Retry missing photos, sources)', () => {
  const s = src('settings.js');
  assert.match(s, /panes\.library\.push\(onlineArtCard\(settings, admin\)\)/);
  assert.match(s, /api\('\/library\/online-art'\)/);
  assert.match(s, /api\('\/library\/online-art\/retry', \{ method: 'POST' \}\)/);
  assert.match(s, /'Retry missing photos'/);
  assert.match(s, /TheAudioDB \(theaudiodb\.com\)/);
  assert.match(s, /'library\.onlineArt': ev\.target\.checked/);
});

test('0.2.2 T3: collapsed Now Playing = one-line strip with every control, Play/Pause on the exact center line', () => {
  const n = src('now.js');
  assert.match(n, /h\('div', \{ class: 'np-strip-l' \}, sHeart, sShuffle, sPrev\)/);
  assert.match(n, /h\('div', \{ class: 'np-strip-c' \}, sPlay\)/);
  assert.match(n, /h\('div', \{ class: 'np-strip-r' \}, sNext, sRepeat, h\('span', \{ class: 'np-strip-vol' \}, icon\('volume'\), sVol, sPct\), sMute, sEq\)/);
  assert.match(n, /'NOW PLAYING'\), ctlNow, ctlStrip,/);
  assert.match(n, /for \(const r of \[vol, barVol, sVol\]\)/);
  assert.match(n, /for \(const b of \[muteBtn, barMute, sMute\]\)/);
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-strip\{display:grid;grid-template-columns:1fr auto 1fr/);
  assert.match(css, /\.np-strip-l\{justify-self:end\} \.np-strip-r\{justify-self:start\} \.np-strip-c\{justify-self:center\}/);
  assert.match(css, /\.np-strip \.tbtn\{width:28px;height:28px;[^}]*border-radius:50%/);
});

test('0.2.2 T3: song block (thumb, title · artist, progress + times) moves into the Playlist title bar, lined up with the NP column', () => {
  const n = src('now.js'), m = src('main.js'), l = src('listtable.js');
  assert.match(n, /const songBlock = h\('div', \{ class: 'plsong'/);
  assert.match(n, /psElv, psProg, psDur/);
  assert.match(n, /return \{ el, mini, npbar, songBlock, ctlPanel, draw,/);
  assert.match(l, /const setSongBlock = el => \{ head\.insertBefore\(el, meta\); \}/);
  assert.match(m, /const l = Math\.max\(col\.left, listt\.leftEdge\(\) \+ 14\), r = Math\.min\(col\.right, listt\.rightEdge\(\) - 14\)/);
  assert.match(m, /desk\.classList\.toggle\('npcollapsed', on\)/);
  assert.match(css, /\.desk\.npcollapsed \.listpanel > \.pane-h\{min-height:42px\}/);
  assert.match(css, /\.desk\.npcollapsed\.listcollapsed\{--listh:44px\}/);
});
