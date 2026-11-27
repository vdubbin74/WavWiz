// 0.7.2 t2166u: in the desktop Player the "secure address" sheet has no links that leave the app (Close + a short line only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ann = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/announce.js', import.meta.url), 'utf8');

test('t2166u: inDesktopPlayer reads the Player user agent', () => {
  const m = ann.match(/export const inDesktopPlayer = (.*);\n/); assert.ok(m);
  const f = new Function('globalThis', `return ${m[1]};`)({});
  assert.equal(f('Mozilla/5.0 Edg/130 WavWizPlayer/0.7.2'), true);
  assert.equal(f('Mozilla/5.0 (iPhone) Safari'), false);
});

test('t2166u: the Player branch returns before the secure-address / Set up secure connection links are made', () => {
  const body = ann.slice(ann.indexOf('export function insecureSheet('), ann.indexOf('/** Hold-to-talk.'));
  const i = body.indexOf('if (inDesktopPlayer()) {'), j = body.indexOf("'Switch to secure address'"), k = body.indexOf("'Set up secure connection'");   // F274 W6 wording
  assert.ok(i > 0 && j > i && k > i, 'the Player check comes first');
  const branch = body.slice(i, body.indexOf('\n  }\n', i));
  assert.match(branch, /'Close'/); assert.match(branch, /return;/); assert.doesNotMatch(branch, /href/);
});
