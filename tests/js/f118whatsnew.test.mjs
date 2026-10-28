import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const s = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/about.js', import.meta.url), 'utf8');
assert.match(s, /export const WHATS_NEW_VERSION = '0\.5\.0';/);
const body = s.slice(s.indexOf('export const WHATS_NEW = ['));
const first = body.match(/\/\/ (\d+\.\d+\.\d+)/);
assert.equal(first[1], '0.5.0');
assert.ok(body.indexOf("'Mix-and-match Now Playing'") < body.indexOf('// 0.4.9'));
console.log('ok f118');
