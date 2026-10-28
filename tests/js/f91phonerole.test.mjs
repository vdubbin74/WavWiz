// WavWiz 0.5.0 F91: phone role is speaker | remote | mic; remote phones never auto-join as a speaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phoneRole, setPhoneRole, ROLE_KEY } from '../../src/WavWiz.Server/wwwroot/js/calmic-core.js';
const room = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/room.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('F91: phoneRole/setPhoneRole accept speaker, remote, mic; reject others', () => {
  for (const v of ['speaker', 'remote', 'mic']) { const s = mem(); setPhoneRole(s, v); assert.equal(phoneRole(s), v); }
  const s = mem(); setPhoneRole(s, 'remote'); setPhoneRole(s, 'bogus'); assert.equal(phoneRole(s), null);
  const o = mem(); o.setItem(ROLE_KEY, 'speaker'); assert.equal(phoneRole(o), 'speaker'); o.setItem(ROLE_KEY, 'mic'); assert.equal(phoneRole(o), 'mic');   // old values still work
  const bad = mem(); bad.setItem(ROLE_KEY, 'tv'); assert.equal(phoneRole(bad), null);
});
test('F91: dialog has three choices, spec wording and footer; Escape cannot dismiss', () => {
  for (const t of ['How do you want to use this phone?', "'Play music here'", "'Use as remote'", "'Use as a calibration mic'", 'This phone plays in sync with your other speakers.', 'Control the music. This phone stays silent.', 'Listens only, to line up your speakers.', 'You can change this later in the menu → Phone role.']) assert.ok(room.includes(t), t);
  assert.match(room, /oncancel: ev => ev\.preventDefault\(\)/);
});
test('F91: auto-join branches: ?role=remote accepted, remote shows banner and returns before joining, mic unchanged', () => {
  const fn = room.slice(room.indexOf('export function installAutoJoin'), room.indexOf('export function askPhoneRole'));
  assert.match(fn, /q === 'speaker' \|\| q === 'remote' \|\| q === 'mic'/);
  assert.match(fn, /role === 'mic'\) \{ showMicBanner\(\); return; \}/);
  assert.match(fn, /role === 'remote'\) \{ showRemoteBanner\(\); return; \}/);
  assert.ok(fn.indexOf("role === 'remote'") < fn.indexOf('setTimeout(go'), 'remote returns before auto-join');
});
test('F91: menu switch stops the speaker for remote and mic', () => {
  const fn = room.slice(room.indexOf('export function changePhoneRole'));
  assert.match(fn, /r === 'mic'\) \{ await stopPhoneDevice\(\); location\.href = '\/calmic\.html'/);
  assert.match(fn, /r === 'remote'\) \{ await stopPhoneDevice\(\); showRemoteBanner\(\)/);
  assert.match(room, /'Remote — this phone is silent'/);
});
test('F91: remote banner uses the theme Highlight, no hard-coded gold, 3px corners', () => {
  const rule = css.match(/\.remote-banner\{[^}]*\}/)[0];
  assert.match(rule, /var\(--hl,var\(--accent\)\)/); assert.match(rule, /border-radius:3px/); assert.doesNotMatch(rule, /gold|#ffd|#f5c|#e6b/i);
});
