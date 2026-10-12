// WavWiz 0.3.1 fix pass (B1-B19, S1) - logic + markup checks. UI behavior is covered by tests/ui/ui031.mjs (Chromium / WebKit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const rule = sel => { const i = css.lastIndexOf(sel + '{'); assert.ok(i >= 0, 'css rule ' + sel); return css.slice(i, css.indexOf('}', i)); };

test('B18: EQ mode = Lock, swap, Looks, full screen; viz mode adds power + pop-out; no style button', async () => {
  const L = await imp('looks');
  assert.deepEqual(L.overlayButtons('eq'), ['lock', 'swap', 'looks', 'full']);
  assert.deepEqual(L.overlayButtons('viz'), ['lock', 'swap', 'looks', 'full', 'power', 'popout']);
  assert.deepEqual(L.overlayButtons('viz', { popout: false }), ['lock', 'swap', 'looks', 'full', 'power']);
  assert.deepEqual(L.looksRows('eq').map(r => r[1]), ['Glow', 'Overlay opacity', 'Button transparency']);
  assert.deepEqual(L.looksRows('viz').map(r => r[1]), ['Intensity', 'Overlay opacity', 'Speed', 'Button transparency']);
});
test('B18: Button transparency / Overlay opacity default 50 %, clamp 0..100, saved per device; ±1 / Shift ±10', async () => {
  const L = await imp('looks'); const s = mem();
  assert.deepEqual(L.loadLooks(s), { btn: 50, overlay: 50 });
  assert.deepEqual(L.saveLooks({ btn: 140, overlay: -3 }, s), { btn: 100, overlay: 0 }); assert.deepEqual(L.loadLooks(s), { btn: 100, overlay: 0 });
  assert.equal(L.btnOpacity(50), 0.5); assert.equal(L.btnOpacity(0), 1);
  assert.equal(L.stepPct(50, 1, false), 51); assert.equal(L.stepPct(50, -1, true), 40); assert.equal(L.stepPct(95, 1, true), 100);
});
test('B18: icon buttons 28x28, 16px icons, one stroke, theme variables only, 3px corners, active = accent outline (no fill)', () => {
  const b = rule('.stage .vbtns .ib');
  assert.match(b, /width:28px;height:28px/); assert.match(b, /border-radius:3px/); assert.match(b, /background:var\(--panel2\)/);
  assert.match(rule('.stage .vbtns .ib svg'), /width:16px;height:16px.*stroke-width:1.75/);
  const on = rule('.stage .vbtns .ib.on'); assert.match(on, /inset 0 0 0 1px var\(--accent\)/); assert.doesNotMatch(on, /background/);
  const grp = css.slice(css.indexOf('/* 0.3.1 B18'), css.indexOf('/* B17'));
  assert.doesNotMatch(grp, /#[0-9a-fA-F]{3,6}\b|rgba\(0,0,0|#fff|ffd54a/, 'no hard-coded black / white / yellow');
  const pop = rule('.looks-pop'); assert.match(pop, /width:300px/); assert.match(pop, /background:var\(--panel\)/); assert.match(pop, /border-top:2px solid var\(--accent\)/);
  assert.match(rule('.looks-pop.sheet'), /position:fixed;left:0;right:0;bottom:0/);
  const n = src('now.js'); assert.match(n, /'aria-label': label, title: label/); assert.match(n, /'Reset'/); assert.match(n, /'More…'/); assert.match(n, /ev\.key === 'Escape'/); assert.match(n, /ev\.key === 'Tab'/);
});
test('B17: glow / visualizer / backdrop layers are click-through; the button group sits above them; Lock EQ is in the group', () => {
  assert.match(css, /\.np-stage \.stagecover,\.np-stage \.vname,\.eqa-glow,\.eqa-grid,\.np-stage \.vizhost canvas\{pointer-events:none\}/);
  assert.match(rule('.stage .vbtns'), /z-index:6/); assert.match(css, /\.np-stage \.np-eqhost\{z-index:2\}/);
  assert.doesNotMatch(src('centerview.js'), /lock\.el/); assert.match(src('now.js'), /saveEqLock\(!loadEqLock\(\)\)/);
});
test('B18: Looks values are shared with Settings (EQ glow, the look\'s Intensity / Speed)', async () => {
  const s = mem(); globalThis.localStorage = s;
  const L = await imp('looks'); const E = await imp('eqstyle'); const V = await imp('vizcore');
  L.setLook('glow', 70); assert.equal(E.loadEqPrefs(s).glow, 70);
  L.setLook('intensity', 20, 'particles'); assert.equal(V.loadSettings('particles', s).intensity, 20);
  L.resetLooks('viz', 'particles'); assert.equal(V.loadSettings('particles', s).intensity, 50); assert.equal(L.loadLooks(s).btn, 50);
  assert.match(src('vizpage.js'), /'Button transparency'/);
  delete globalThis.localStorage;
});
test('B4/B6: every exit path repaints the Expand button (always rewrites the icon); labels Expand / Collapse (Esc)', async () => {
  const D = await imp('devices'); const I = await imp('icons');
  assert.ok(I.ICON_NAMES.includes('expandOut') && I.ICON_NAMES.includes('collapseIn'));
  const btn = { dataset: { icon: 'expandOut' }, innerHTML: '', attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; } };
  D.paintExpandBtn(btn, 'Library', true); assert.equal(btn.dataset.icon, 'collapseIn'); assert.equal(btn.attrs['aria-label'], 'Collapse (Esc)'); assert.equal(btn.attrs['aria-pressed'], 'true');
  btn.innerHTML = '⤡ Esc';   // the 0.3.0 bug: text replaced the icon while the remembered name stayed the same
  D.paintExpandBtn(btn, 'Library', false); assert.match(btn.innerHTML, /<svg/); assert.equal(btn.attrs['aria-label'], 'Expand'); assert.equal(btn.title, 'Expand');
  assert.doesNotMatch(src('main.js') + src('devices.js'), /⤡ Esc'/);
  // the panel model: every exit path leaves exp = null so applyPanels repaints "Expand"
  const P = await imp('panels'); const n = P.normPanels({});
  for (const k of ['lib', 'dev']) {
    const e = P.expand(n, k);
    assert.equal(P.esc(e).exp, null, 'Esc'); assert.equal(P.expand(e, k).exp, null, 'button'); assert.equal(P.chevron(e, k).exp, null, 'chevron');
    assert.equal(P.keyAction(e, { code: k === 'lib' ? 'BracketLeft' : 'BracketRight', target: {} }).exp, null, '[ ] key');
  }
});
test('B5: both rails put the chevron at the top and center icon + vertical title the same way', () => {
  assert.match(css, /\.israil \.pane-h\{order:0;margin:0/); assert.match(css, /\.israil \.prail\{order:1;justify-content:center\}/);
  assert.doesNotMatch(css, /\.israil \.pane-h\{order:2;margin-top:auto/);
});
