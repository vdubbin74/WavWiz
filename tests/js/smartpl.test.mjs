// Smart playlist form helpers (pure).
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {} };
globalThis.Element = globalThis.Element || function () {};
const m = await import(new URL('../../src/WavWiz.Server/wwwroot/js/smartpl.js', import.meta.url));
const r = m.rulesFrom({ genre: ' Jazz ', genreMatch: 'x', yearMin: '1990', yearMax: '', addedDays: 'abc', artist: '' });
assert.deepEqual(r, { genre: 'Jazz', genreMatch: 'contains', yearMin: 1990, yearMax: null, addedDays: null, notPlayedDays: null, artist: null });
assert.equal(m.ruleCount(r), 2);
assert.equal(m.ruleSummary({ genre: 'Rock', genreMatch: 'equals', yearMin: 1990, yearMax: 1999 }), 'Genre is Rock • 1990-1999');
console.log('smartpl ok');
