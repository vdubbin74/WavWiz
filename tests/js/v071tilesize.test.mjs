// 0.7.1 t2061u: Settings > Library > Tile size did nothing. library.js sets .lib[data-tiles], but every layout fixed its tile columns
// (expanded panel 132px !important, side panel 3 columns, phone / narrow page 2 columns), so no size ever changed anything.
// t2062u: Large (the default) must equal the 0.7.1 look on every layout, so nothing changes after an update; Medium steps down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(dir, '../app.css'), 'utf8'), lib = readFileSync(join(dir, 'library.js'), 'utf8'), set = readFileSync(join(dir, 'settings.js'), 'utf8');
const after = (needle, from) => { const i = css.indexOf(needle, from); assert.ok(i >= 0, needle); return i; };

test('the setting reaches the Library live: saved, event, data-tiles on every draw', () => {
  assert.match(set, /seg\(TILE_SIZES, p\.tileSize, 'tileSize', 'Tile size'\)/);
  assert.match(set, /saveLibPrefs\(\{ \.\.\.loadLibPrefs\(\), \.\.\.patch \}\); window\.dispatchEvent\(new CustomEvent\('wavwiz:libprefs'\)\)/);
  assert.match(lib, /window\.addEventListener\('wavwiz:libprefs', \(\) => \{ const e = P\.expanded; P = loadLibPrefs\(\);[^\n]*draw\(\); \}\)/);
  assert.match(lib, /root\.dataset\.tiles = P\.tileSize;/);
});
test('expanded Library (PC wide): each size has its own column width, after (and stronger than) the fixed 132px rule', () => {
  const fixed = after('.desk.libexpanded .libpanel .tilegrid{grid-template-columns:repeat(auto-fill,132px)!important');
  const px = {};
  for (const sz of ['large', 'medium']) {
    const m = css.slice(fixed).match(new RegExp(`\\.desk\\.libexpanded \\.libpanel \\.lib\\[data-tiles=${sz}\\] \\.tilegrid\\{grid-template-columns:repeat\\(auto-fill,(\\d+)px\\)!important\\}`));
    assert.ok(m, sz); px[sz] = +m[1];
  }
  assert.ok(px.large > px.medium, JSON.stringify(px)); assert.equal(px.large, 132, 'Large (the default) = the 0.7.1 look'); assert.equal(px.medium, 112);
});
test('Large (the default) = the 0.7.1 look; side panel 3 / 4 columns, phone / narrow page 2 / 3', () => {
  const side = after('.desk.libexpanded .libpanel .tilegrid{grid-template-columns:repeat(auto-fill,132px)!important');
  for (const [sz, n] of [['large', 3], ['medium', 4]])
    assert.ok(css.indexOf(`:is(.lib.compact[data-tiles=${sz}], .libpanel .lib[data-tiles=${sz}]:not(.expanded)) :is(.tilegrid, .tilegrid.tg-radio, .radiotab2 .tilegrid){grid-template-columns:repeat(${n},minmax(0,1fr))`, side) > side, 'side ' + sz);
  for (const [sz, n] of [['large', 2], ['medium', 3]]) {
    assert.ok(css.indexOf(`  .view .lib[data-tiles=${sz}] .tilegrid{grid-template-columns:repeat(${n},minmax(0,1fr))`, after('.view .phone-library .tilegrid{grid-template-columns:repeat(2,minmax(0,1fr))')) > 0, 'page ' + sz);
  }
});
test('t2066u: two sizes only - Small is gone from the setting and the CSS; a stored small loads as Medium', async () => {
  const L = await import(new URL('file://' + join(dir, 'libsort.js')).href);
  assert.deepEqual(L.TILE_SIZES.map(([v]) => v), ['medium', 'large']);
  const mem = v => ({ getItem: () => JSON.stringify(v) });
  assert.equal(L.loadLibPrefs(mem({ tileSize: 'small' })).tileSize, 'medium', 'migrated');
  assert.equal(L.loadLibPrefs(mem({ tileSize: 'medium' })).tileSize, 'medium');
  assert.equal(L.loadLibPrefs(mem({})).tileSize, 'large', 'default');
  assert.equal(L.loadLibPrefs(mem({ tileSize: 'huge' })).tileSize, 'large');
  assert.doesNotMatch(css, /data-tiles=small/);
});
