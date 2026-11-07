// F262-fix(-A): phone portrait-only overlay; physical orientation from screen signals (H1); recovery scoped to open sheets (M1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const mod = () => import(pathToFileURL(join(js, 'orientlock.js')).href + '?t=' + Math.random());

class El {
  constructor(tag, parent = null) { this.tagName = tag; this.kids = []; this.parent = parent; this.style = { display: '', props: {}, setProperty(k, v) { this.props[k] = v; } }; this.attrs = {}; this.listeners = {}; this.scrollTop = 0; this.reflows = 0; this.hidden = false;
    const cl = new Set(); this.classList = { add: c => cl.add(c), remove: c => cl.delete(c), contains: c => cl.has(c) }; if (parent) parent.kids.push(this); }
  get offsetHeight() { this.reflows++; return 10; }
  contains(e) { for (; e; e = e.parent) if (e === this) return true; return false; }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  append(...k) { this.kids.push(...k); } blur() { this.blurred = true; }
}
// screen: { w, h, type } physical; vp: layout viewport landscape media match
function world({ coarse = true, sw = 390, sh = 844, type = 'portrait-primary', vpLandscape = false, sheet = false, lockable = true } = {}) {
  const html = new El('HTML'), body = new El('BODY', html), desk = new El('DIV', body), input = new El('INPUT', desk);
  desk.scrollTop = 900; html.scrollTop = 120;
  const sh42 = sheet ? new El('DIV', body) : null; if (sh42) sh42.classList.add('pd42-sheet');
  const sheetInput = sh42 ? new El('INPUT', sh42) : null;
  const st = { vpLandscape, coarse }, mqls = [], ev = [], wl = {}, timers = []; let tid = 0;
  const orientation = { type, addEventListener: (t, f) => (wl['so:' + t] ||= []).push(f) };
  if (lockable) orientation.lock = o => { ev.push('lock:' + o); return Promise.reject(new Error('NotSupported')); };
  const doc = { documentElement: html, body, activeElement: body, createElement: t => new El(t.toUpperCase()), getElementById: id => id === 'desk' ? desk : null,
    querySelectorAll: () => sh42 ? [sh42] : [] };
  const win = { innerHeight: 844, visualViewport: { height: 844, offsetTop: 0, addEventListener: (t, f) => (wl['vv:' + t] ||= []).push(f) },
    screen: { width: sw, height: sh, orientation },
    matchMedia: q => q === '(pointer: coarse)' ? { get matches() { return st.coarse; } } : { get matches() { return st.vpLandscape && st.coarse; }, addEventListener: (t, f) => mqls.push(f) },
    addEventListener: (t, f) => (wl[t] ||= []).push(f), scrollTo: (x, y) => ev.push(`scrollTo:${x},${y}`), requestAnimationFrame: f => { f(); return 1; },
    setTimeout: (f, ms) => { timers.push({ f, ms, id: ++tid }); return tid; }, clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    CustomEvent: class { constructor(t) { this.type = t; } }, dispatchEvent: e => ev.push('dispatch:' + e.type) };
  const rotate = l => { orientation.type = l ? 'landscape-primary' : 'portrait-primary'; win.screen.width = l ? 844 : 390; win.screen.height = l ? 390 : 844; st.vpLandscape = l; (wl['so:change'] || []).forEach(f => f()); };
  const flush = () => { const ms = []; while (timers.length) { timers.sort((a, b) => a.ms - b.ms); const t = timers.shift(); ms.push(t.ms); t.f(); } return ms; };
  return { win, doc, html, body, desk, input, sh42, sheetInput, ev, rotate, st, wl, orientation, flush, timers };
}

test('F262-fix: desktop (fine pointer) and tablet (short side > 500) never block', async () => {
  const m = await mod();
  for (const o of [{ coarse: false, sw: 1280, sh: 720, type: 'landscape-primary' }, { sw: 1180, sh: 820, type: 'landscape-primary' }]) {
    const w = world({ ...o, vpLandscape: true }); const g = m.installOrientationGuard(w);
    assert.equal(g.blocked, false); assert.equal(g.overlay, null); assert.equal(w.html.classList.contains('ww-rotate-block'), false);
  }
});
test('F262-fix: physical phone landscape shows a blocking overlay; portrait hides it; overlay reused', async () => {
  const w = world(); const g = (await mod()).installOrientationGuard(w);
  assert.equal(g.blocked, false);
  w.rotate(true);
  assert.equal(g.blocked, true); assert.ok(w.html.classList.contains('ww-rotate-block'));
  assert.equal(g.overlay.id, 'ww-rotate'); assert.equal(g.overlay.hidden, false); assert.match(g.overlay.textContent, /Rotate your phone to portrait/);
  let prevented = 0; for (const t of ['pointerdown', 'touchstart', 'click']) g.overlay.listeners[t].forEach(f => f({ preventDefault: () => prevented++, stopPropagation() {} }));
  assert.equal(prevented, 3);
  w.rotate(false); assert.equal(g.blocked, false); assert.equal(g.overlay.hidden, true);
  w.rotate(true); assert.equal(w.body.kids.filter(k => k.id === 'ww-rotate').length, 1);
});
test('F262-fix-A H1: keyboard-shrunk portrait viewport (412x360) is NOT blocked and the input keeps focus', async () => {
  const m = await mod();
  const w = world({ sw: 412, sh: 915 }); w.doc.activeElement = w.input; const g = m.installOrientationGuard(w);
  w.st.vpLandscape = true;   // viewport media now says landscape (keyboard)
  w.wl['vv:resize'].forEach(f => f()); w.wl.resize.forEach(f => f());
  assert.equal(g.blocked, false); assert.ok(!w.input.blurred); assert.equal(g.overlay, null);
  // window.orientation fallback (no screen.orientation.type)
  const w2 = world({ sw: 412, sh: 915, vpLandscape: true }); w2.orientation.type = undefined; w2.win.orientation = 0;
  assert.equal(m.shouldBlock(w2.win, w2.doc), false); w2.win.orientation = 90; assert.equal(m.shouldBlock(w2.win, w2.doc), true);
  // no screen signal at all: viewport fallback, but never while an editable is focused
  const w3 = world({ vpLandscape: true }); w3.orientation.type = undefined; w3.win.screen.width = 0; w3.win.screen.height = 0;
  w3.doc.activeElement = w3.input; assert.equal(m.shouldBlock(w3.win, w3.doc), false);
  w3.doc.activeElement = w3.body; assert.equal(m.shouldBlock(w3.win, w3.doc), true);
});
test('F262-fix-A H1: entering landscape never blurs the focused input', async () => {
  const w = world(); w.doc.activeElement = w.input; const g = (await mod()).installOrientationGuard(w);
  w.rotate(true); assert.equal(g.blocked, true); assert.ok(!w.input.blurred);
});
test('F262-fix-A M1: return to portrait with no sheet open keeps #desk scroll 900 and does not scroll the window', async () => {
  const w = world(); const g = (await mod()).installOrientationGuard(w);
  w.rotate(true); w.rotate(false); w.wl.orientationchange.forEach(f => f()); w.wl['vv:resize'].forEach(f => f()); assert.equal(w.flush().length, 0, 'no recovery timers without a sheet');
  assert.equal(g.blocked, false); assert.equal(w.desk.scrollTop, 900); assert.equal(w.html.scrollTop, 120);
  assert.ok(!w.ev.includes('scrollTo:0,0')); assert.ok(!w.ev.includes('dispatch:wavwiz:orientrecover'));
});
test('F262-fix-A M1: with Speaker Settings open, recovery realigns only the sheet (blur sheet input, window 0,0, reflow); #desk kept', async () => {
  const w = world({ sheet: true }); const g = (await mod()).installOrientationGuard({ ...w, relock: () => false });
  w.rotate(true); w.flush(); w.doc.activeElement = w.sheetInput; w.rotate(false); w.flush();
  assert.ok(w.sheetInput.blurred); assert.ok(w.ev.includes('scrollTo:0,0')); assert.ok(w.sh42.reflows >= 1); assert.equal(w.sh42.style.display, '');
  assert.equal(w.desk.scrollTop, 900); assert.ok(w.ev.includes('dispatch:wavwiz:orientrecover'));
  // an input outside the sheet is not blurred
  w.rotate(true); w.flush(); w.doc.activeElement = w.input; w.rotate(false); w.flush(); assert.ok(!w.input.blurred);
});
test('F262-fix: orientation lock attempted, rejection/throw/missing API tolerated', async () => {
  const m = await mod();
  const w = world(); m.installOrientationGuard(w); assert.ok(w.ev.includes('lock:portrait'));
  assert.doesNotThrow(() => m.installOrientationGuard(world({ lockable: false })));
  const w3 = world(); w3.orientation.lock = () => { throw new Error('x'); }; const g = m.installOrientationGuard(w3); w3.rotate(true); assert.equal(g.blocked, true);
});
test('F262-fix: wiring - main.js installs guard, manifest portrait, class-gated CSS, diag capture untouched', () => {
  const main = readFileSync(join(js, 'main.js'), 'utf8');
  assert.match(main, /import \{ installOrientationGuard \} from '\.\/orientlock\.js';[^\n]*\ninstallOrientationGuard\(\);/);
  assert.match(main, /get\('diag'\) === '1'\)\n\s+void import\('\.\/f262diag\.js'\)/);
  const man = JSON.parse(readFileSync(new URL('../../src/WavWiz.Server/wwwroot/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(man.orientation, 'portrait');
  const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
  assert.match(css, /html\.ww-rotate-block body > \*:not\(#ww-rotate\) \{ visibility: hidden !important; pointer-events: none !important; \}/);
});

// ---- F262-fix-B: real body lock + delayed recovery burst after every rotation
const lockMod = () => import(pathToFileURL(join(js, 'sheetlock.js')).href + '?t=' + Math.random());
test('F262-fix-B: sheetlock pins the body at -scrollY (position:fixed), relock zeroes window scroll, unlock restores scrollY', async () => {
  const L = await lockMod(), w = world(); w.win.scrollY = 240; w.body.style.position = 'relative';
  L.lockBody(w.win, w.doc);
  assert.equal(w.body.style.position, 'fixed'); assert.equal(w.body.style.top, '-240px'); assert.equal(w.body.style.width, '100%');
  assert.ok(w.html.classList.contains('ww-bodylock')); assert.equal(L.lockedY(), 240);
  L.lockBody(w.win, w.doc); assert.equal(w.body.style.top, '-240px', 'idempotent');
  w.body.style.top = '0px'; assert.equal(L.relockBody(w.win, w.doc), true); assert.equal(w.body.style.top, '-240px'); assert.ok(w.ev.includes('scrollTo:0,0'));
  L.unlockBody(w.win, w.doc);
  assert.equal(w.body.style.position, 'relative'); assert.equal(w.html.classList.contains('ww-bodylock'), false); assert.equal(w.ev.at(-1), 'scrollTo:0,240');
  assert.equal(L.relockBody(w.win, w.doc), false); assert.equal(L.bodyLocked(), false);
});
test('F262-fix-B: rotation with Speaker Settings open runs recovery at 0/100/350/700 ms (relock + reflow each step, blur once, sheet scroll kept)', async () => {
  const m = await mod(); assert.deepEqual(m.RECOVER_DELAYS, [0, 100, 350, 700]);
  const w = world({ sheet: true }); let relocks = 0; const inner = { scrollTop: 77 };
  w.sh42.querySelector = s => (s === ':scope > .pd42' ? inner : null);
  const g = m.installOrientationGuard({ ...w, relock: () => { relocks++; inner.scrollTop = 0; return true; } });
  w.rotate(true); w.flush(); assert.equal(relocks, 0, 'no recovery while blocked');
  let blurs = 0; w.sheetInput.blur = () => blurs++; w.doc.activeElement = w.sheetInput;
  w.rotate(false); w.wl.orientationchange.forEach(f => f());
  const ms = w.flush();
  assert.deepEqual(ms, [0, 100, 350, 700], 'debounced to one burst'); assert.ok(relocks >= 5, 'rAF step(s) + 4 timed steps (fake rAF is synchronous)'); assert.equal(blurs, 1);
  assert.ok(w.sh42.reflows >= 8); assert.ok(w.ev.filter(e => e === 'scrollTo:0,0').length >= 5, 'window forced to 0 every step'); assert.equal(w.sh42.style.display, ''); assert.equal(inner.scrollTop, 77); assert.equal(w.desk.scrollTop, 900);
});
test('F262-fix-B: late visualViewport resize after rotation re-runs the burst; a keyboard resize (no rotation) never does', async () => {
  let t = 0; const m = await mod(); const w = world({ sheet: true }); let relocks = 0;
  m.installOrientationGuard({ ...w, now: () => t, relock: () => (relocks++, true) });
  w.rotate(true); w.rotate(false); w.flush(); const after = relocks;
  t += 300; w.wl['vv:resize'].forEach(f => f()); w.flush(); assert.ok(relocks >= after + 5, 'late resize inside window');
  t += 5000; const k = relocks; w.doc.activeElement = w.sheetInput; w.wl['vv:resize'].forEach(f => f()); w.flush();
  assert.equal(relocks, k, 'keyboard resize: no recovery'); assert.ok(!w.sheetInput.blurred);
});
test('F262-fix-B: wiring - devices.js locks/unlocks the body with the sheet; CSS has no transform/vh on the sheet', () => {
  const dev = readFileSync(join(js, 'devices.js'), 'utf8');
  assert.match(dev, /import \{ lockBody, unlockBody \} from '\.\/sheetlock\.js';/);
  assert.match(dev, /if \(lockedApp\) lockedApp\.inert = true;\n\s+lockBody\(\);/);
  assert.match(dev, /classList\.remove\('pd42-open'\);\n\s+unlockBody\(\);/);
  const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
  assert.match(css, /\.pd42-sheet\{top:0;bottom:0;height:auto;transform:none\}/);
  assert.doesNotMatch(css, /\.pd42-sheet[^{]*\{[^}]*(100vh|100dvh|translate)/);
});
