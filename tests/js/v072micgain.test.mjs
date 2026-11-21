// 0.7.2 t2182u: a quiet mic needs more than +6 dB: the gain slider reaches +24 dB for mics (the server sends maxGainDb per input).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/inputs.js', import.meta.url), 'utf8');
const gainMax = new Function(src.match(/export const gainMax = [^\n]+/)[0].replace('export ', '') + '\nreturn gainMax;')();
test('t2182u gainMax: the server value wins; without it mics +24, the rest +6', () => {
  assert.equal(gainMax({ kind: 'mic', maxGainDb: 24 }), 24); assert.equal(gainMax({ kind: 'aux', maxGainDb: 6 }), 6);
  assert.equal(gainMax({ kind: 'mic' }), 24); assert.equal(gainMax({ kind: 'loopback' }), 6); assert.equal(gainMax(null), 6);
});
