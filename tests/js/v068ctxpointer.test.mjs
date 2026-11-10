// Library / shared context menus open at the pointer (top-left at clientX/clientY),
// flipping when they would overflow, and clearing the in-page title bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
const js = n => readFileSync(new URL('js/' + n, W), 'utf8');

function ctxPlaceBoxFromSrc() {
  const src = js('ctxmenu.js');
  const m = src.match(/export function ctxPlaceBox\([\s\S]*?\n\}/);
  assert.ok(m, 'ctxPlaceBox export');
  return new Function(m[0].replace('export ', '') + '\nreturn ctxPlaceBox;')();
}

test('ctxPlaceBox opens with top-left at the pointer', () => {
  const ctxPlaceBox = ctxPlaceBoxFromSrc();
  const view = { vw: 1000, vh: 800, pad: 4, topMin: 4 };
  assert.deepEqual(ctxPlaceBox(200, 150, 190, 220, view), { left: 200, top: 150, maxHeight: 792 });
});

test('ctxPlaceBox flips left or up when it would overflow, then clamps', () => {
  const ctxPlaceBox = ctxPlaceBoxFromSrc();
  const view = { vw: 1000, vh: 800, pad: 4, topMin: 4 };
  const flipL = ctxPlaceBox(900, 100, 190, 120, view);
  assert.equal(flipL.left, 710, 'right edge at the pointer (900-190)');
  assert.equal(flipL.top, 100);
  const flipU = ctxPlaceBox(100, 740, 190, 200, view);
  assert.equal(flipU.left, 100);
  assert.equal(flipU.top, 540, 'bottom edge at the pointer (740-200)');
  const tight = ctxPlaceBox(20, 20, 200, 900, view);
  assert.equal(tight.top, 4);
  assert.equal(tight.maxHeight, 792);
  const sub = ctxPlaceBox(900, 100, 190, 120, view, { left: 700, right: 900, top: 100 });
  assert.equal(sub.left, 512, 'submenu flips to the left of the parent item (700-190+2)');
});

test('ctxPlaceBox stays below the title-bar topMin', () => {
  const ctxPlaceBox = ctxPlaceBoxFromSrc();
  const view = { vw: 1000, vh: 800, pad: 4, topMin: 42 };
  const p = ctxPlaceBox(80, 10, 190, 120, view);
  assert.equal(p.top, 42);
  assert.equal(p.maxHeight, 754);
});

test('attachCtx right-click uses clientX/clientY; Menu key anchors to the focused element', () => {
  const c = js('ctxmenu.js');
  assert.match(c, /show\(ev\.clientX, ev\.clientY\)/);
  assert.match(c, /ev\.key === 'ContextMenu'/);
  assert.match(c, /document\.activeElement && card\.contains\(document\.activeElement\)/);
  assert.match(c, /show\(r\.left, r\.top\)/);
  assert.doesNotMatch(c, /show\(r\.left \+ 24, r\.top \+ 24\)/);
});

test('Library attachItem opens openCtx at the pointer; sheet/song sheet stay phone-only', () => {
  const u = js('ui.js');
  const block = u.match(/export function attachItem[\s\S]*?longPress\(el, openMenu\);/);
  assert.ok(block, 'attachItem block');
  const s = block[0];
  assert.match(u, /import { openCtx } from '\.\/ctxmenu\.js'/);
  assert.match(s, /openCtx\(x, y, ctxItems\(\)/);
  assert.match(s, /ev\.type === 'contextmenu'/);
  assert.match(s, /openAt\(ev\.clientX, ev\.clientY/);
  assert.match(s, /max-width:900px/);
  assert.match(s, /if \(isPhone\(\)\) return openPhoneSheet\(\)/);
  assert.match(s, /openSongSheet/);
  assert.match(s, /return sheet\(title/);
  assert.match(s, /ContextMenu/);
  // desktop path must not call sheet() directly from openAt
  const openAt = s.match(/const openAt = [\s\S]*?const openMenu/);
  assert.ok(openAt);
  assert.match(openAt[0], /openCtx\(/);
  assert.doesNotMatch(openAt[0], /sheet\(/);
});

test('longPress reports the touch point so a desktop long-press can open at the finger', () => {
  const u = js('ui.js');
  assert.match(u, /fn\(\{ clientX: sx, clientY: sy, type: 'touchstart'/);
});

test('ctxViewBox reads the topbar for the custom title bar', () => {
  const c = js('ctxmenu.js');
  assert.match(c, /export function ctxViewBox/);
  assert.match(c, /querySelector\?\.?\('\.topbar'\)/);
});
