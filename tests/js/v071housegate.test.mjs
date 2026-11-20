// 0.7.1 t2078u: "WavWiz – Everywhere" shows on phones only while a speaker in a zone is online. Settings > Network says so instead of
// "always on", and a hidden house name reads "Hidden until a speaker in a zone is online." (not "Not running - see Diagnostics").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const set = readFileSync(join(js, 'settings.js'), 'utf8');

test('t2078u: Settings > Network explains when WavWiz – Everywhere shows', () => {
  assert.doesNotMatch(set, /“WavWiz – Everywhere” is always on/);
  assert.match(set, /“WavWiz – Everywhere” shows while a speaker in a zone is online\./);
  assert.match(set, /rc\.houseReady === false \? 'Hidden until a speaker in a zone is online\.' : 'Not running - see Diagnostics\.'/);
});
