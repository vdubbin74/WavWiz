// F239: Library sources are top xtabs above search (expanded underline chrome); not tools-row .seg.
// Soft t2544u: stable DOM order compact↔expanded — search never moves into headRow.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const src = readFileSync(dir.replace(/\/?$/, '/') + 'library.js', 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
assert.match(src, /libsrcslot/, 'source slot');
assert.match(src, /tabs xtabs libsrc-tabs/, 'xtabs chrome for sources');
assert.match(src, /root\.append\(srcSlot, searchField/, 'DOM: sources then search');
assert.ok(!/seg libsrc/.test(src), 'no tools-row source segment');
assert.match(src, /srcSlot\.replaceChildren\(srcTabs\(\)\)/, 'draw paints source tabs');
assert.match(src, /placeSearch\(\)/, 'placeSearch keeps search under sources');
assert.ok(!/placeSearch\(expanded/.test(src), 'search not moved into category head row');
assert.ok(!/headRow\)/.test(src.match(/placeSearch[\s\S]*?};/)[0]), 'placeSearch never targets headRow');
const drawTools = src.slice(src.indexOf('function drawTools'), src.indexOf('function drawTools') + 900);
assert.ok(!/Playlists/.test(drawTools), 'drawTools has no source labels');
assert.match(drawTools, /libsrv/, 'server chip stays in tools');
assert.match(css, /\.libsrc-tabs\.xtabs button\.on/, 'underline selected source CSS');
assert.match(css, /border-bottom-color:var\(--hl/, 'xtabs accent underline');
assert.match(css, /t2544u/, 'expand stay-put CSS note');
assert.match(css, /\.lib \.libsearch\{margin:4px 0 8px\}/, 'shared search margin compact↔expanded');
console.log('f239libsourcetabs ok');
