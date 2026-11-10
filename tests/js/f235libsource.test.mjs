// F235 (+F239): Library sources Local | Remote | Radio | Playlists as top tabs; no rs:* category tabs; Remote MVP categories.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const src = readFileSync(dir.replace(/\/?$/, '/') + 'library.js', 'utf8');
const fn = src.match(/export function libTabs[\s\S]*?\n}/)[0].replace('export ', '');
const libTabs = new Function('TOOL_TABS', fn + '\nreturn libTabs;')([['tags', 'Tag & cover fix'], ['cleanup', 'Tidy up library']]);
const all = T => [...T.main, ...(T.row2 || []), ...T.more];
for (const ex of [true, false]) {
  const loc = libTabs(ex, 'local');
  assert.ok(!all(loc).includes('radio') && !all(loc).includes('playlists'), 'Radio/Playlists are sources, not category tabs');
  assert.ok(!all(loc).some(k => String(k).startsWith('rs:')), 'no rs:* tabs');
  assert.ok(all(loc).includes('favorites') && all(loc).includes('folders'), 'Favorites/Folders stay under Local');
  const rem = libTabs(ex, 'remote');
  assert.deepEqual([...rem.main, ...(rem.row2 || [])].sort(), ['albums', 'artists', 'recent'].sort());
  assert.ok(!all(rem).includes('folders') && !all(rem).includes('favorites'));
  assert.deepEqual(rem.tools, []);
}
const x = libTabs(true, 'local');
assert.ok(x.tools.includes('tags'));
assert.match(src, /libsrcslot|libsrc-tabs/, 'source tabs above search (F239)');
assert.ok(!/seg libsrc/.test(src), 'sources not in tools-row .seg');
assert.match(src, /\['local', 'Local'\].*\['remote', 'Remote'\].*\['radio', 'Radio'\].*\['playlists', 'Playlists'\]/s);
assert.match(src, /LIB_SOURCE_KEY/, 'remembers libSource');
assert.match(src, /isRsTab\(seedTab\)/, 'migrates saved rs:* tabs');
assert.match(src, /seedTab === 'radio'/, 'migrates radio tab → source');
assert.match(src, /seedTab === 'playlists'/, 'migrates playlists tab → source');
assert.ok(!/rk\.slice|RS_ROW2|\.\.\.rk/.test(src.match(/export function libTabs[\s\S]*?\n}/)[0]), 'libTabs no longer spreads rs ids');
const rad = readFileSync(dir.replace(/\/?$/, '/') + 'radiotab.js', 'utf8');
assert.match(rad, /tilegrid tg-radio|class: grid \? 'tilegrid/, 'Radio stations tiles/list');
assert.match(rad, /savedStationTile|radiostation/, 'Radio station tiles');
const docs = readFileSync(new URL('../../docs/REMOTE-LIBRARIES.md', import.meta.url), 'utf8');
assert.match(docs, /Local \| Remote \| Radio \| Playlists/);
assert.match(docs, /server chip/);
console.log('f235libsource ok');
