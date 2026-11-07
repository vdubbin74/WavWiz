// F262 CAPTURE TOOLING tests (not an F262 fix): off path, privacy allowlist, bounds, freeze-before-export ordering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const mod = () => import(pathToFileURL(join(js, 'f262diag.js')).href + '?t=' + Math.random());
const SECRET = 'SENTINEL-SECRET-7731';

// ---- minimal fake DOM (geometry only; every text/value/id carries the sentinel)
class El {
  constructor(tag, sel = [], parent = null, y = 0) { this.tagName = tag; this.sel = sel; this.parentElement = parent; this.kids = []; this.y = y; this.id = SECRET; this.textContent = SECRET; this.value = SECRET; this.className = SECRET; this.scrollTop = 0; this.scrollLeft = 0; this.isConnected = true; this.dataset = {}; this.style = {}; this.attrs = {}; if (parent) parent.kids.push(this); }
  getBoundingClientRect() { return { x: 10, y: this.y, top: this.y, left: 10, right: 210, bottom: this.y + 40, width: 200, height: 40 }; }
  contains(e) { for (; e; e = e.parentElement) if (e === this) return true; return false; }
  all() { return [this, ...this.kids.flatMap(k => k.all())]; }
  querySelector(s) { return this.all().slice(1).find(e => e.sel.includes(s)) || null; }
  closest(s) { for (let e = this; e; e = e.parentElement) if (e.sel.includes(s)) return e; return null; }
  setAttribute(k, v) { this.attrs[k] = v; } append(...k) { for (const c of k) { c.parentElement = this; this.kids.push(c); } } remove() { this.removed = true; }
  focus() { this.focused = true; } select() { this.selected = true; } setSelectionRange() {}
}
function world(search, { clip = true } = {}) {
  const ev = [], counts = { listeners: 0, observers: 0, raf: 0, timers: 0 };
  const html = new El('HTML'), body = new El('BODY', [], html), app = new El('DIV', ['#app'], body);
  const sheet = new El('DIV', ['.pd42-sheet'], body, 100), head = new El('DIV', ['.pd42-head'], sheet, 100), sc = new El('DIV', [':scope > .pd42'], sheet, 140);
  new El('DIV', ['.pd42-sheet .spkset', '.spkset'], sc, 140);
  const t = {
    delayRange: new El('INPUT', ['input.spk-range[aria-label="Delay / sync offset"]'], sc, 220), delayInput: new El('INPUT', ['input.spk-num'], sc, 260),
    balanceRange: new El('INPUT', ['input.spk-range[aria-label="Balance"]'], sc, 320), outerDone: new El('BUTTON', ['[data-act="pd-done"]'], head, 100), innerDone: new El('BUTTON', ['[data-act="spk-done"]'], sc, 380) };
  const listeners = [];
  const add = target => ({ addEventListener(type, fn, o) { counts.listeners++; listeners.push({ target, type, fn, o }); o?.signal?.addEventListener?.('abort', () => { const i = listeners.findIndex(l => l.fn === fn); if (i >= 0) listeners.splice(i, 1); }); } });
  const doc = Object.assign(add('doc'), { body, documentElement: html, visibilityState: 'visible', activeElement: body,
    querySelector: s => s === '.pd42-sheet .spkset' ? sheet.querySelector('.pd42-sheet .spkset') : html.querySelector(s),
    getElementById: id => id === 'app' ? app : null, elementFromPoint: (x, y) => [...Object.values(t)].find(e => y >= e.y && y < e.y + 40) || sheet,
    createElement: tag => { ev.push('createElement:' + tag); const e = new El(tag.toUpperCase()); const ap = e.append.bind(e); return e; } });
  const origAppend = body.append.bind(body); body.append = (...k) => { ev.push('body.append'); origAppend(...k); };
  class AC { constructor() { const ls = []; this.signal = { aborted: false, addEventListener: (_, f) => ls.push(f) }; this.abort = () => { this.signal.aborted = true; ls.forEach(f => f()); }; } }
  const win = Object.assign(add('win'), { location: { search }, performance: { now: () => Date.now() }, AbortController: AC, devicePixelRatio: 3, innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0,
    getComputedStyle: () => ({ position: 'relative', transform: 'none', zoom: '1', overflowX: 'visible', overflowY: 'auto', fontSize: '16px', pointerEvents: 'auto', touchAction: 'manipulation', getPropertyValue: () => '1' }),
    MutationObserver: class { constructor(f) { counts.observers++; this.f = f; } observe() {} disconnect() { this.off = true; } },
    requestAnimationFrame: f => { counts.raf++; return setTimeout(f, 0); }, cancelAnimationFrame: clearTimeout, setTimeout: (f, ms) => { counts.timers++; return setTimeout(f, ms); }, clearTimeout,
    navigator: { clipboard: clip ? { writeText: s => { ev.push('clipboard.writeText'); win.copied = s; return Promise.resolve(); } } : undefined } });
  win.visualViewport = Object.assign(add('vv'), { width: 390, height: 500, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
  const fire = (type, target = body, extra = {}) => listeners.filter(l => l.type === type).forEach(l => l.fn({ type, target, ...extra }));
  return { doc, win, t, ev, counts, listeners, fire, sheet };
}

test('F262 off path: main.js has one exact ?diag=1 branch with a dynamic import; nothing else imports the module', () => {
  const main = readFileSync(join(js, 'main.js'), 'utf8');
  assert.match(main, /if \(new URLSearchParams\(location\.search\)\.get\('diag'\) === '1'\)\n\s+void import\('\.\/f262diag\.js'\)\.then\(m => m\.installCapture\(\)\)\.catch\(\(\) => \{\}\);/);
  for (const f of readdirSync(js).filter(f => f.endsWith('.js') && f !== 'f262diag.js')) {
    const s = readFileSync(join(js, f), 'utf8'); const n = (s.match(/f262diag/g) || []).length;
    assert.equal(n, f === 'main.js' ? 1 : 0, f); assert.doesNotMatch(s, /import[^(]*['"]\.\/f262diag\.js['"]/, f + ' static import');
  }
});
test('F262 off path: without the exact flag installCapture does nothing (no listeners, observer, rAF, timers, storage, network)', async () => {
  const m = await mod();
  const src = readFileSync(join(js, 'f262diag.js'), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie|setInterval|preventDefault|stopPropagation|setPointerCapture|releasePointerCapture|scrollTo\(|scrollIntoView/);
  for (const q of ['', '?diag=0', '?diag=true', '?x=1', '?diag=1x']) {
    const w = world(q); assert.equal(m.installCapture(w.doc, w.win), null, q);
    assert.deepEqual(w.counts, { listeners: 0, observers: 0, raf: 0, timers: 0 }, q);
  }
});
test('F262 passive: every listener is capture + passive; teardown removes them', async () => {
  const m = await mod(); const w = world('?diag=1'); const h = m.installCapture(w.doc, w.win);
  assert.ok(w.listeners.length > 10); for (const l of w.listeners) assert.deepEqual([l.o.capture, l.o.passive], [true, true]);
  h.destroy(); assert.equal(w.listeners.length, 0);
});
test('F262 privacy: export is allowlisted geometry; sentinel ids/text/values/URL never appear', async () => {
  const m = await mod(); const w = world('?diag=1&token=' + SECRET); const h = m.installCapture(w.doc, w.win);
  w.fire('pointerdown', w.t.delayRange); w.fire('focusin', w.t.delayInput); w.fire('input', w.t.delayInput);
  const txt = h.text(); assert.doesNotMatch(txt, new RegExp(SECRET)); assert.doesNotMatch(txt, /diag=1|token|location/);
  const j = JSON.parse(txt); assert.equal(j.purpose, 'F262 capture tooling, not a fix');
  const r = j.records.at(-1); assert.deepEqual(Object.keys(r.items), ['delayRange', 'delayInput', 'balanceRange', 'outerDone', 'innerDone']);
  assert.equal(r.items.delayInput.probes[0].hit, 'delayInput'); assert.equal(r.items.delayInput.probes[1].hit, 'delayRange');   // center and center-40
  assert.equal(r.active, 'other'); assert.equal(r.viewport.scale, 1); h.destroy();
});
test('F262 bounds: ring <=64 records and <=256 KiB export; oversize record dropped and counted', async () => {
  const m = await mod(); const r = m.createRing();
  for (let i = 0; i < 10000; i++) r.push({ i, pad: 'x'.repeat(i % 7000) });
  const j = JSON.parse(r.text()); assert.ok(j.records.length <= 64); assert.ok(new TextEncoder().encode(r.text()).length <= 256 * 1024);
  assert.ok(j.dropped >= 10000 - 64); assert.equal(j.records.at(-1).i, 9999);
  const r2 = m.createRing(); r2.push({ big: 'y'.repeat(9000) }); assert.equal(JSON.parse(r2.text()).records.length, 0); assert.equal(JSON.parse(r2.text()).dropped, 1);
});
test('F262 freeze: final snapshot before clipboard and export UI; frozen bytes reused; no sampling after', async () => {
  const m = await mod(); const w = world('?diag=1'); const h = m.installCapture(w.doc, w.win);
  w.fire('pointerdown', w.t.delayRange);
  const tch = (n, id0 = 1) => ({ touches: Array.from({ length: n }, (_, i) => ({ identifier: id0 + i, clientX: 50 + i * 30, clientY: 300 })) });
  w.fire('touchstart', w.doc, tch(2)); w.fire('touchend', w.doc, { touches: [] });
  const first = h.text(); const j = JSON.parse(first);
  assert.equal(j.records.at(-1).reason, 'freeze');
  assert.deepEqual(w.ev.slice(0, 3), ['clipboard.writeText', 'createElement:section', 'createElement:p']);
  assert.equal(w.win.copied, first); assert.ok(w.ev.indexOf('body.append') > w.ev.indexOf('clipboard.writeText'));
  w.fire('pointerdown', w.t.balanceRange); w.fire('focusin', w.t.delayInput); assert.equal(h.text(), first);   // passive sampling stopped
  w.fire('touchstart', w.doc, tch(2, 9)); w.fire('touchend', w.doc, { touches: [] });                          // second gesture: retry, same bytes
  assert.equal(h.text(), first); assert.equal(w.ev.filter(e => e === 'clipboard.writeText').length, 2); assert.equal(w.ev.filter(e => e === 'createElement:section').length, 1);
  h.destroy();
});
test('F262 gesture: one finger, three fingers, movement or cancel never freeze', async () => {
  const m = await mod(); const w = world('?diag=1'); const h = m.installCapture(w.doc, w.win);
  const T = (ids, dx = 0) => ({ touches: ids.map(i => ({ identifier: i, clientX: 50 + i * 30 + dx, clientY: 300 })) });
  w.fire('touchstart', w.doc, T([1])); w.fire('touchend', w.doc, { touches: [] });
  w.fire('touchstart', w.doc, T([1, 2, 3])); w.fire('touchend', w.doc, { touches: [] });
  w.fire('touchstart', w.doc, T([1, 2])); w.fire('touchmove', w.doc, T([1, 2], 40)); w.fire('touchend', w.doc, { touches: [] });
  w.fire('touchstart', w.doc, T([1, 2])); w.fire('touchcancel', w.doc); w.fire('touchend', w.doc, { touches: [] });
  assert.ok(!w.ev.includes('clipboard.writeText')); assert.doesNotMatch(h.text(), /"reason":"freeze"/); h.destroy();
});
test('F262 clipboard absent: still freezes and shows the same frozen text selected', async () => {
  const m = await mod(); const w = world('?diag=1', { clip: false }); const h = m.installCapture(w.doc, w.win);
  h.freeze(); const box = w.doc.body.kids.at(-1); const area = box.kids[1];
  assert.equal(area.value, h.text()); assert.ok(area.readOnly && area.selected); h.destroy(); assert.ok(box.removed);
});
