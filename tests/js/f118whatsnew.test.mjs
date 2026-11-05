import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const s = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/about.js', import.meta.url), 'utf8');
assert.match(s, /export const WHATS_NEW_VERSION = '\d+\.\d+\.\d+';/);   // F177: bumped per release; 0.5.0 entries stay below
const body = s.slice(s.indexOf('export const WHATS_NEW = ['));
assert.ok(body.indexOf('// 0.5.0') > 0, '0.5.0 entries kept');
assert.ok(body.indexOf("'Mix-and-match Now Playing'") < body.indexOf('// 0.4.9'));
console.log('ok f118');
