// RADIO-1 (Nov 9 2026): Radio Library layout - My stations first (Library tiles/list), quiet collapsed Add station / Add podcast,
// full-width finder with Genre + Country pickers (server /radio/finder/tags + /countries), empty state, themed remove ✕.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const js = rel => readFileSync(join(www, 'js', rel), 'utf8');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');

test('RADIO-1 My stations section comes before the finder and keeps Library tiles/list', () => {
  const t = js('radiotab.js');
  assert.ok(t.indexOf("'radcol radsaved'") < t.indexOf("'radcol radfind'"), 'saved stations first');
  assert.match(t, /tilegrid tg-radio' : 'list'/);
  assert.match(t, /savedStationTile/);
  assert.match(js('radiostation.js'), /savedStationTile|stationArt/);
});

test('RADIO-1 Add station / Add podcast are quiet toggles, forms collapsed by default', () => {
  const t = js('radiotab.js'), f = js('radiofinder.js');
  assert.match(t, /let openKey = null;/);
  assert.match(t, /class: 'btn sm quiet', 'data-radadd': k, 'aria-expanded'/);
  assert.match(t, /toggle\('station', 'Add station'\), toggle\('podcast', 'Add podcast'\)/);
  assert.match(t, /openKey \? forms\[openKey\]\(\) : ''/);
  assert.doesNotMatch(f, /'Add feed'/, 'finder no longer renders an always-open podcast form');
  assert.match(f, /reloadPods: loadPods/);
});

test('RADIO-1 finder: full-width row with Genre + Country pickers fed by the server lists, empty state first', () => {
  const f = js('radiofinder.js');
  assert.match(f, /wsel\(\{ 'aria-label': 'Genre'/);
  assert.match(f, /wsel\(\{ 'aria-label': 'Country'/);
  assert.match(f, /api\('\/radio\/finder\/tags\?limit=80'\)/);
  assert.match(f, /api\('\/radio\/finder\/countries'\)/);
  assert.match(f, /h\('div', \{ class: 'radsearch' \}, q, tag, country,/);
  assert.match(f, /if \(!searched\) results\.replaceChildren\(emptyState\(\)\)/);
  assert.match(f, /tag=\$\{encodeURIComponent\(tag\.value\)\}&country=\$\{encodeURIComponent\(country\.value\)\}/);
});

test('RADIO-1 / RADIO-2: no danger ✕ on stations; podcast remove stays ww-close; padding + phone sizes in CSS', () => {
  const t = js('radiotab.js'), f = js('radiofinder.js'), s = css();
  assert.doesNotMatch(t, /class: '[^']*danger|'btn sm danger'|'btn danger'/); assert.doesNotMatch(f, /class: '[^']*danger/);
  assert.doesNotMatch(t, /ww-close/);
  assert.match(f, /class: 'btn ww-close', 'aria-label': 'Remove podcast /);
  assert.match(s, /\/\* ===== RADIO-1/);
  assert.match(s, /\.radiotab2 \.radadd\{margin-top:20px\}/);
  assert.match(s, /\.radiotab2 \.radsearch\{display:flex;flex-wrap:wrap/);
  assert.match(s, /\.radiotab2 \.btn\.quiet\{background:transparent/);
  assert.match(s, /radiotab2 \.radsearch \.wwdd\.radpick/);
  assert.match(s, /radiotab2 \.radsearch input\[type=search\]/);
});
