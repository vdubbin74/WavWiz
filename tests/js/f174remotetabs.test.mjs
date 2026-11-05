// F174 → F235: rs:* top tabs removed; migration helpers + Remote source still recognize rs: keys.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const src = readFileSync(dir.replace(/\/?$/, '/') + 'library.js', 'utf8');
assert.match(src, /export const isRsTab = k => typeof k === 'string' && k\.startsWith\('rs:'\)/);
assert.match(src, /isRsTab\(seedTab\)/, 'saved rs:* migrates to Remote source');
assert.match(src, /isRsTab\(k\)/, 'showTab still accepts rs:* for migration');
const fn = src.match(/export function libTabs[\s\S]*?\n}/)[0].replace('export ', '');
const libTabs = new Function('TOOL_TABS', fn + '\nreturn libTabs;')([['tags', 'Tag & cover fix'], ['cleanup', 'Tidy up library']]);
const all = T => [...T.main, ...(T.row2 || []), ...T.more];
for (const ex of [true, false]) {
  assert.ok(!all(libTabs(ex, 'local')).some(k => String(k).startsWith('rs:')));
  assert.ok(!all(libTabs(ex, 'remote')).some(k => String(k).startsWith('rs:')));
}
assert.match(src, /addEventListener\('wavwiz:library', \(\) => \{ loadRS\(\)/, 'servers refresh on library event');
assert.match(src, /rsoff/, 'offline remote chip dimmed');
console.log('f174remotetabs ok');
