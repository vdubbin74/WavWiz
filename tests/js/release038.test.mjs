// 0.3.8 pure-logic checks (L34, L37, L38, L43, L44). Run through run.sh like the others.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import path from 'node:path';
const dir = process.env.JS_DIR; const src = f => readFileSync(path.join(dir, f), 'utf8'); const css = readFileSync(path.join(dir, '..', 'app.css'), 'utf8');
const imp = n => import(path.join(dir, n + '.js'));
test('L44 hotkeys table + matcher', async () => {
  const m = await imp('hotkeys'); const k = (code, o = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...o });
  assert.equal(m.matchShortcut(k('Space')), 'playpause'); assert.equal(m.matchShortcut(k('KeyM')), 'mute');
  assert.equal(m.matchShortcut(k('KeyM', { altKey: true })), 'mini'); assert.equal(m.matchShortcut(k('KeyH', { altKey: true })), 'home');
  assert.equal(m.matchShortcut(k('KeyE', { altKey: true })), 'eq'); assert.equal(m.matchShortcut(k('KeyQ', { altKey: true })), 'queue');
  assert.equal(m.matchShortcut(k('ArrowRight', { ctrlKey: true })), 'next'); assert.equal(m.matchShortcut(k('ArrowLeft', { ctrlKey: true })), 'prev'); assert.equal(m.matchShortcut(k('Comma', { ctrlKey: true })), 'settings');
  assert.equal(m.matchShortcut(k('KeyM', { altKey: true, ctrlKey: true })), null, 'AltGr is not a shortcut'); assert.equal(m.matchShortcut(k('KeyM', { altKey: true, repeat: true })), null);
  assert.equal(m.matchShortcut(k('KeyH', { ctrlKey: true, shiftKey: true })), null, 'Ctrl+Shift+H stays New schedule');
  const doc = { querySelector: s => null }; assert.equal(m.blocked({ target: { tagName: 'INPUT' }, code: 'KeyM' }, doc), true);
  assert.equal(m.blocked({ target: { tagName: 'DIV', closest: () => null }, code: 'Space' }, doc), false);
  assert.equal(m.blocked({ target: { tagName: 'BUTTON', closest: () => ({}) }, code: 'Space' }, doc), true, 'Space on a focused button is the button');
  assert.equal(m.blocked({ target: { tagName: 'DIV', closest: () => null }, code: 'KeyM' }, { querySelector: () => ({}) }), true, 'dialogs / kiosk silence them');
  assert.equal(new Set(m.SHORTCUTS.map(s => s.keys)).size, m.SHORTCUTS.length);
  assert.match(src('menu.js'), /keysFor\('mini'\)/); assert.match(src('menu.js'), /'Keyboard shortcuts'/);
});
test('L37 pins: 5, one-click title pins, more overflow', async () => {
  const m = await imp('shortcuts'); assert.equal(m.MAX_PINS, 5); assert.match(src('shortcuts.js'), /scmore/); assert.match(src('main.js'), /class: 'plus tpin'/);
});
test('L34 pending target survives a hidden main page', async () => {
  const m = await imp('shortcuts'); const st = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
  m.writePending({ run: 'settings' }, st); assert.deepEqual(m.takePending(Date.now(), st), { home: false, run: 'settings' }); assert.equal(m.takePending(Date.now(), st), null);
  m.writePending({ home: true }, st); assert.equal(m.takePending(Date.now() + 20000, st), null, 'stale notes are ignored');
});
test('L38/L43 css rules', () => {
  assert.doesNotMatch(css, /lock-red/); assert.match(css, /--fld-h:40px/); assert.match(css, /::placeholder\{color:var\(--fld-ph\)/);
  assert.match(css, /\.minicol::after\{content:'';position:absolute;right:100%/); assert.match(css, /--sleevew:30px/);
});
