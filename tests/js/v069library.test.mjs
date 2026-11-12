// WavWiz 0.6.9 Library items 1-5 (pure parts + CSS contracts). Previews under /workspace/programmer/wavwiz-069-previews show the rendered result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const src = readFileSync(join(js, 'library.js'), 'utf8');
const fn = src.match(/export function libTabs[\s\S]*?\n}/)[0].replace('export ', '');
const libTabs = new Function('TOOL_TABS', fn + '\nreturn libTabs;')([['tags', 'Tag & cover fix'], ['cleanup', 'Tidy up library']]);
const v069 = css.slice(css.indexOf('/* ---- 0.6.9 Library'));

test('#1: the side panel lays every tile grid out in three columns next to the A–Z rail; Remote lists get the rail too', () => {
  assert.match(v069, /\.lib\.compact \.tilegrid[^{]*\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(v069, /tg-radio/);
  assert.match(src, /function rlist[\s\S]*?letterIndex\(art \? 'artists' : 'albums', sorted, lk\)[\s\S]*?stripPlan = idx/);
});
test('#2: names wrap instead of ending in an ellipsis (tiles, list rows, genre names, stations)', () => {
  assert.match(v069, /\.lib \.tile \.t1\.ell[^{]*\{\s*white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere/);
  for (const sel of ['.lib .list .item .t .t1.ell', '.lib .tile .gblock.j10 .gname', '.radiotab2 .tile .t1.ell']) assert.ok(v069.includes(sel), sel);
});
test('#3: Genres and Years are square tiles', () => {
  assert.match(v069, /\.lib \.tile \.gblock,[^{]*\{aspect-ratio:1\/1/);
});
test('#4: Local and Remote line up (Artists, Albums, Recently added first); one search wording; Remote Artists have their own sorts', async () => {
  for (const ex of [true, false]) {
    const l = libTabs(ex, 'local'), r = libTabs(ex, 'remote'), all = T => [...T.main, ...(T.row2 || [])];
    assert.deepEqual(all(l).slice(0, 3), ['artists', 'albums', 'recent']);
    assert.deepEqual(all(r), ['artists', 'albums', 'recent']);
    assert.ok(all(l).includes('genres') && all(l).includes('folders') && all(l).includes('years') && all(l).includes('favorites'));
  }
  const m = await import(pathToFileURL(join(js, 'libsort.js')).href);
  const { searchPlaceholder, remoteSortKind } = Object.fromEntries([...src.matchAll(/export const (searchPlaceholder|remoteSortKind) = ([^\n]+);\n/g)].map(x => [x[1], eval(x[2])]));
  assert.equal(searchPlaceholder('local'), searchPlaceholder('remote'));
  assert.equal(searchPlaceholder('radio'), 'Search my stations…');
  assert.doesNotMatch(src, /Filter remote…|Search the remote library…/);
  assert.equal(remoteSortKind('artists'), 'rartists'); assert.equal(remoteSortKind('newest'), 'rrecent'); assert.equal(remoteSortKind('albums'), 'remote'); assert.equal(remoteSortKind('artists', true), 'remote');
  assert.ok(!m.SORTS.rartists.some(([, l]) => /album name/i.test(l)), 'Remote Artists never say "Album name"');
  assert.deepEqual(m.SORTS.rartists.map(x => x[0]), ['name', 'albums', 'server']);
  const P = m.loadLibPrefs({ getItem: () => null }); assert.equal(P.sort.rartists, 'name'); assert.equal(P.sort.rrecent, 'recent');
});
test('#5: Radio follows the Library Tiles / List pick (side panel and Expanded), not only the Expanded per-tab pref', async () => {
  globalThis.localStorage ??= { getItem: () => JSON.stringify({ views: { radio: 'grid' } }), setItem() {} };
  const rs = readFileSync(join(js, 'radiostation.js'), 'utf8');
  assert.match(rs, /export const setRadioView = v =>/);
  assert.match(rs, /if \(viewPick\) return viewPick === 'grid';/);
  assert.match(src, /if \(k === 'radio' && !phone\) setRadioView\(gridOn\('radio'\) \? 'grid' : 'list'\);/);
  assert.match(readFileSync(join(js, 'radiotab.js'), 'utf8'), /setFilter: q =>/);
  assert.match(readFileSync(join(js, 'playlists.js'), 'utf8'), /setFilter: q =>/);
});
