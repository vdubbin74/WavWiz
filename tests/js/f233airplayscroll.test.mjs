// F233: Add AirPlay open — Speakers .tcol42 scroll held across paint; SCR not poisoned by clamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
test('F233 airplaydevices paint holds .tcol42 scrollTop while open', () => {
  const s = readFileSync(`${js}/airplaydevices.js`, 'utf8');
  assert.match(s, /closest\('\.tcol42'\)/);
  assert.match(s, /sc\.scrollTop = top/);
  assert.match(s, /requestAnimationFrame/);
  assert.match(s, /F233: Speakers \.tcol42 is the scroller/);
});
test('F233 devices scroll listener skips SCR update for .apds.open clamps', () => {
  const s = readFileSync(`${js}/devices.js`, 'utf8');
  assert.match(s, /\.apds\.open/);
  assert.match(s, /F233: AirPlay paint clamps must not poison Speakers SCR/);
});
