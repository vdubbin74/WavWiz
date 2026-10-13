// WavWiz 0.3.0 §1 Jukebox + §2 Remote mode: pure helpers and source checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
globalThis.Element ??= class {};
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('0.3.0 §1: grouped heads, counts and the guest line', async () => {
  const c = await imp('jukebox-core');
  assert.equal(c.groupHead('Artists', 2), 'Artists (2)');
  assert.equal(c.artistLine({ songs: 1 }), '1 song'); assert.equal(c.artistLine({ songs: 3 }), '3 songs');
  assert.equal(c.albumLine({ artist: 'A', tracks: 12 }), 'A · 12 tracks');
  assert.equal(c.mineLine({ perGuest: 3, next: [{ guest: 'g1' }, { guest: 'g2' }] }, 'g1'), 'Your songs in queue: 1 of 3');
  assert.equal(c.selCode(0), 'A1'); assert.equal(c.selCode(9), 'B1');
  const s = mem(); const id = c.guestId(s, () => [123456789, 987654321]); assert.equal(c.guestId(s, () => [9, 9]), id, 'the guest id stays on the phone'); assert.ok(id.length >= 8);
});
test('0.3.0 §1: the kiosk swallows Esc, Alt+Tab, F11, Alt+F4 and the context-menu key; Ctrl+Shift+J asks for the PIN', async () => {
  const c = await imp('jukebox-core');
  for (const e of [{ key: 'Escape' }, { key: 'Tab', altKey: true }, { key: 'F4', altKey: true }, { key: 'F11' }, { key: 'ContextMenu' }, { key: 'w', ctrlKey: true }]) assert.equal(c.blockedKey(e), true, JSON.stringify(e));
  assert.equal(c.blockedKey({ key: 'a' }), false);
  assert.equal(c.isExitChord({ key: 'J', ctrlKey: true, shiftKey: true }), true); assert.equal(c.blockedKey({ key: 'J', ctrlKey: true, shiftKey: true }), false);
  const k = src('jukebox-kiosk.js');
  assert.match(k, /addEventListener\('keydown', block, true\)/); assert.match(k, /addEventListener\('contextmenu', noMenu, true\)/);
  assert.match(k, /api\('\/jukebox\/unlock', \{ method: 'POST', body: \{ pin \} \}\); closeKiosk\(\)/, 'leaving needs the PIN checked by the server');
  assert.match(k, /setTimeout\(askExit, 1200\)/, 'long-press the corner logo');
  assert.match(k, /new Viz\(bg/, 'visualizer behind'); assert.match(k, /viz\?\.destroy/);
});
test('0.3.0 §1: guest page needs no sign-in and uses only the session code; styles use theme variables', () => {
  const g = src('jukebox-guest.js'), core = src('jukebox-core.js');
  assert.match(core, /'X-WavWiz-Guest': code/); assert.doesNotMatch(g, /from '\.\/util\.js'/, 'no app api() (no token)');
  const css = readFileSync(join(js, '../jukebox.css'), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no fixed colors');
  assert.match(css, /\.retro \.jb-cover\{[^}]*animation:jb-spin/); assert.match(css, /\.jb-tubes i\{[^}]*var\(--beat/);
});
test('0.3.2 F3: Remote mode is retired - isRemote() is always false, the old setting is cleared once, Mini player replaces the menu item', async () => {
  const r = await imp('remotemode');
  const s = mem(); assert.equal(r.isRemote(s, ''), false); assert.equal(r.isRemote(s, '?remote=1'), false);
  assert.match(src('main.js'), /await retireRemote\(\)/); assert.doesNotMatch(src('main.js'), /'Use as remote only'/); assert.doesNotMatch(src('room.js'), /'Use as remote only'/);
  assert.match(src('menu.js'), /'Mini player'/);
});
