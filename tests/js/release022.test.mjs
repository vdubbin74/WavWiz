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
