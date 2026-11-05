// Keep playing select values + queue undo helpers (pure).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/queuetools.js', import.meta.url), 'utf8');
globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {} };
globalThis.document = globalThis.document || { createElement: () => ({}) };
globalThis.Element = globalThis.Element || function () {}; Element.prototype = Element.prototype || {};
const m = await import(new URL('../../src/WavWiz.Server/wwwroot/js/queuetools.js', import.meta.url));
assert.equal(m.keepValue(null), 'off'); assert.equal(m.keepValue({ mode: 'similar' }), 'similar'); assert.equal(m.keepValue({ mode: 'playlist', id: 4 }), 'playlist:4');
assert.deepEqual(m.keepBody('radio:7'), { mode: 'radio', id: 7 }); assert.deepEqual(m.keepBody('off'), { mode: 'off' });
{ const xs = Array.from({ length: 30 }, (_, i) => ({ id: i, name: 'Mix ' + i })); const r = m.keepFilter(xs, ''); assert.equal(r.shown.length, m.KEEP_MAX); assert.equal(r.more, 30 - m.KEEP_MAX);   // Keep playing popover: capped list
  const f = m.keepFilter(xs, 'mix 2'); assert.deepEqual(f.shown.map(x => x.id), [2, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]); assert.equal(f.more, 0); }
assert.ok(!/h\('select'/.test(src.slice(src.indexOf('export function keepControl'), src.indexOf('export const zoneOfPath'))), 'Keep playing opens a small popover, not a full native select');
assert.equal(m.zoneOfPath('/queue/clear?zoneId=g%3A5'), 'g:5'); assert.equal(m.zoneOfPath('/queue/clear'), null);
assert.equal(m.undoMsg('/queue/clear'), 'Cleared the queue'); assert.equal(m.undoMsg('/stream/play'), 'Replaced the queue');
assert.equal(m.UNDO_MS, 10000);
assert.ok(!/F1\d\d/.test(src.replace(/^\/\/.*$/mg, '')), 'no ticket numbers in user-facing strings');
console.log('queuetools ok');
