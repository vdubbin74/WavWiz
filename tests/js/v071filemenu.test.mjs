// 0.7.1 t2069u: the File menu (Player title bar / desktop menu bar) kept a themed focus box after a mouse-opened menu closed: File stayed
// focused and the next key (Esc, or Alt for a shortcut) made it :focus-visible. Focus cues now show only for keyboard use (.menubar.kbd).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, ev } from './minidom.mjs';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(dir + '/../app.css', 'utf8'), src = readFileSync(dir + '/menu.js', 'utf8');
const doc = installDom();
globalThis.MutationObserver ??= class { observe() {} };
const { menuFocusCues } = await import(new URL('file://' + dir + '/menu.js').href);

function rig() {
  const bar = doc.createElement('nav'); bar.className = 'menubar';
  const file = doc.createElement('button'); file.className = 'mtop'; file.textContent = 'File';
  const lib = doc.createElement('button'); lib.className = 'mtop'; lib.textContent = 'Library';
  bar.append(file, lib); doc.body.append(bar);
  let open = false; const closed = [];
  const cues = menuFocusCues(bar, { closeAll: () => { open = false; closed.push(1); }, isOpen: () => open }, doc, null);
  const key = (type, k, extra = {}) => doc.dispatchEvent(ev(type, { key: k, ...extra }));
  return { bar, file, lib, cues, key, setOpen: v => { open = v; }, closed, done: () => bar.remove() };
}

test('mouse-opened File menu closed with Esc: no focus left on File, no keyboard cue', () => {
  const r = rig();
  doc.dispatchEvent(ev('pointerdown')); r.file.focus(); r.setOpen(true);
  assert.equal(doc.activeElement, r.file);
  r.cues.escape();
  assert.notEqual(doc.activeElement, r.file, 'the leftover focus is handed back, so Esc / Alt cannot turn it into a stuck focus box');
  assert.equal(r.bar.classList.contains('kbd'), false);
  r.done();
});
test('mouse-picked item / mouse-closed menu: dropFocus blurs; a keyboard user keeps focus', () => {
  const r = rig();
  doc.dispatchEvent(ev('pointerdown')); r.file.focus(); r.cues.dropFocus(); assert.notEqual(doc.activeElement, r.file);
  r.file.focus(); r.key('keydown', 'Enter'); assert.equal(r.bar.classList.contains('kbd'), true); r.cues.dropFocus();
  assert.equal(doc.activeElement, r.file, 'keyboard: focus stays');
  r.done();
});
test('Alt alone (or F10) focuses File with the keyboard cue; again leaves the bar; Alt+key shortcuts do not', () => {
  const r = rig();
  doc.dispatchEvent(ev('pointerdown')); doc.body.focus?.();
  r.key('keydown', 'Alt'); r.key('keydown', 'm'); r.key('keyup', 'Alt');
  assert.notEqual(doc.activeElement, r.file, 'Alt+M is a shortcut, not menu access');
  r.key('keydown', 'Alt'); r.key('keyup', 'Alt');
  assert.equal(doc.activeElement, r.file); assert.equal(r.bar.classList.contains('kbd'), true, 'visible keyboard cue');
  r.key('keydown', 'Alt'); r.key('keyup', 'Alt');
  assert.notEqual(doc.activeElement, r.file); assert.equal(r.bar.classList.contains('kbd'), false);
  r.key('keydown', 'F10'); assert.equal(doc.activeElement, r.file); assert.equal(r.bar.classList.contains('kbd'), true);
  r.cues.escape(); assert.notEqual(doc.activeElement, r.file, 'Esc with no menu open leaves the bar');
  r.done();
});
test('keyboard Esc on an open menu keeps File focused with its cue (Windows-style)', () => {
  const r = rig();
  r.file.focus(); r.key('keydown', 'Enter'); r.setOpen(true);
  r.cues.escape(); assert.equal(doc.activeElement, r.file); assert.equal(r.bar.classList.contains('kbd'), true);
  r.done();
});
test('CSS: no cue unless .kbd (beats the global !important :focus-visible); a clear cue with .kbd', () => {
  const at = css.indexOf('0.7.1 t2069u'); assert.ok(at > css.indexOf(':focus-visible{outline:2px solid var(--accent) !important'), 'after the global rule');
  const r = css.slice(at);
  assert.match(r, /\.menubar:not\(\.kbd\) :is\(\.mtop,\.mpanel button\):focus-visible\{outline:none!important/);
  assert.match(r, /\.menubar\.kbd \.mtop:focus\{outline:2px solid [^}]*!important/);
  assert.match(r, /\.menubar\.kbd \.mpanel button:focus\{outline:2px solid [^}]*!important/);
});
test('the menu bar uses it: items / flyouts / File toggle drop the focus, Esc goes through cues.escape', () => {
  assert.match(src, /const cues = menuFocusCues\(bar, \{ closeAll, isOpen: /);
  assert.match(src, /onclick: ev => \{ ev\.stopPropagation\(\); closeAll\(\); dropFocus\(\); onclick\?\.\(\); \}/);
  assert.match(src, /if \(fn\) \{ closeAll\(\); dropFocus\(\); fn\(\); \}/);
  assert.match(src, /toggle\(group, btn\); if \(!group\.classList\.contains\('open'\)\) dropFocus\(\);/);
  assert.match(src, /if \(ev\.key === 'Escape'\) cues\.escape\(\);/);
});
