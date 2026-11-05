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
  assert.match(room, /class: 'dtag'/, 'REMOTE chip');
  assert.match(room, /'this phone is silent'/);
});
test('F240/F91: remote banner is dtag-style (panel/line), z below drawer, no Highlight fill', () => {
  const rule = css.match(/\.remote-banner\{[^}]*\}/)[0];
  assert.match(rule, /var\(--panel/);
  assert.match(rule, /var\(--line\)/);
  assert.match(rule, /z-index:25/);
  assert.match(rule, /flex:none/);
  assert.doesNotMatch(rule, /position:fixed/);
  assert.doesNotMatch(rule, /background:var\(--hl/);
  assert.doesNotMatch(rule, /gold|#ffd|#f5c|#e6b/i);
  const mic = css.match(/\.mic-banner\{[^}]*\}/)[0];
  assert.match(mic, /z-index:25/, 'mic banner also under drawer');
  assert.doesNotMatch(mic, /position:fixed/);
});
test('F241: remote banner docks in #app above .mini/.tabbar (in-flow, not body fixed)', () => {
  assert.match(room, /function dockRoleBanner/);
  assert.match(room, /getElementById\('app'\)/);
  assert.match(room, /:scope > \.mini|:scope > \.tabbar/);
  assert.match(room, /dockRoleBanner\(bar\)/);
  assert.ok(!/document\.body\.append\(bar\)/.test(room.slice(room.indexOf('export function showRemoteBanner'), room.indexOf('function goNow'))), 'showRemoteBanner does not body.append');
  assert.doesNotMatch(css, /F162: on Library\/Devices/);
  assert.doesNotMatch(css, /body:has\(\.remote-banner\) \.desk/);
  assert.doesNotMatch(css, /70px \+ var\(--minih/);
});
