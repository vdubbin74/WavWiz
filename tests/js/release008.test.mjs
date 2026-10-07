// WavWiz 0.0.8: unit tests for the pure logic and static checks behind items 2-16.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};   // util.js patches Element.prototype at import; node has no DOM
const vc = await imp('vizcore'), vu = await imp('vizvu'), lat = await imp('latency'), ui = await imp('uiscale');
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
/** waveform bytes for a bass tone (60 Hz at 48 kHz) of amplitude a (0..1) */
const tone = (a, hz = 60) => { const w = new Uint8Array(1024); for (let i = 0; i < 1024; i++) w[i] = Math.round(128 + 127 * a * Math.sin(2 * Math.PI * hz * i / 48000)); return w; };

// ---- item 16: looks list (Pepecoin viz removed in 0.1.2 overlay rebuild)
test('0.0.8 item 16: eight looks, Particle burst default, new looks registered', () => {
  // 0.1.3: Graphic EQ replaced Lightning
  assert.deepEqual(vc.VIZ_LIST.map(([k]) => k), ['particles', 'river', 'cone', 'wavwiz', 'tunnel', 'terrain', 'vu', 'geq']);
  assert.deepEqual(vc.VIZ_LIST.map(([, t]) => t), ['Particle burst', 'Waveform river', 'Speaker cone', 'Ring', 'Neon tunnel', 'Terrain', 'VU meters', 'Graphic EQ']);
  assert.equal(vc.DEFAULT_ENGINE, 'particles');
  for (const k of ['tunnel', 'terrain', 'vu', 'geq']) assert.ok(vc.VIZ_BLURB[k], k);
  const g = src('vizgl.js'); for (const c of ['TunnelScene', 'TerrainScene', 'GeqScene']) assert.match(g, new RegExp('class ' + c)); assert.doesNotMatch(g, /class LightningScene/);
  assert.match(src('viz.js'), /VuScene/);
});

// ---- item 15: per-look effect controls
test('0.0.8 item 15: every look has its own effect controls, clamped and saved per look', () => {
  for (const [k] of vc.VIZ_LIST) assert.ok((vc.FX[k] || []).length >= 2, `${k} has unique controls`);
  const keys = vc.VIZ_LIST.map(([k]) => vc.FX[k].map(d => d[0]).join(',')); assert.equal(new Set(keys).size, keys.length, 'no two looks share the same control set');
  assert.deepEqual(vc.cleanFx('vu', { needle: 900, bounce: -1, style: 'bogus' }), { needle: 100, bounce: 0, peakHold: 50, bar: 50, style: 'classic' });    // 0.1.3: 0-100 %
  const st = memStore();
  vc.saveSettings('tunnel', { fx: { twist: 75 } }, st); vc.saveSettings('vu', { fx: { style: 'neon' } }, st);
  assert.equal(vc.loadSettings('tunnel', st).fx.twist, 75); assert.equal(vc.loadSettings('vu', st).fx.style, 'neon');
  assert.equal(vc.loadSettings('terrain', st).fx.height, 50);
  assert.equal(vc.resetSettings('vu', st).fx.style, 'classic');
  assert.match(src('vizpage.js'), /data-fx/);
});

// ---- item 10: reactivity
test('0.0.8 item 10: Sensitivity + auto-gain settings are clamped and default sensibly', () => {
  const st = memStore();
  assert.deepEqual(vc.loadReact(st), { energy: 50, sensitivity: 50, autoGain: 50 });          // 0.1.3 defaults (0-100 %)
  assert.deepEqual(vc.saveReact({ energy: 50, sensitivity: 900, autoGain: 0 }, st), { energy: 50, sensitivity: 100, autoGain: 0 });
  assert.deepEqual(vc.loadReact(st), { energy: 50, sensitivity: 100, autoGain: 0 });
  assert.equal(vc.reactRaw(vc.loadReact(st)).sensitivity, 3); assert.equal(vc.reactRaw({ energy: 50, sensitivity: 50, autoGain: 0 }).autoGain, 0);
  assert.match(src('vizpage.js'), /Sensitivity/); assert.match(src('vizpage.js'), /Auto-gain/);
});

test('0.0.8 item 10: auto-gain makes a quiet track move about as much as a loud one', () => {
  const run = a => { const f = new vc.Features(); for (let i = 0; i < 200; i++) f.push(tone(a), 33); return f.bass; };
  const quiet = run(0.04), loud = run(0.8);
  assert.ok(quiet > 0.35, `quiet track still drives the picture (bass ${quiet.toFixed(2)})`);
  assert.ok(quiet / loud > 0.6, `quiet ${quiet.toFixed(2)} vs loud ${loud.toFixed(2)}`);
  const off = new vc.Features(); off.autoGain = false; for (let i = 0; i < 200; i++) off.push(tone(0.04), 33);
  assert.ok(off.bass < quiet, 'without auto-gain the quiet track moves less');
});

test('0.0.8 item 10: sensitivity scales the motion; kicks are counted on a beat', () => {
  const lo = new vc.Features(), hi = new vc.Features(); lo.autoGain = hi.autoGain = false; lo.sensitivity = 0.5; hi.sensitivity = 2;
  for (let i = 0; i < 60; i++) { lo.push(tone(0.1), 33); hi.push(tone(0.1), 33); }
  assert.ok(hi.bass > lo.bass + 0.1, `hi ${hi.bass.toFixed(2)} lo ${lo.bass.toFixed(2)}`);
  const f = new vc.Features();
  for (let b = 0; b < 8; b++) { for (let i = 0; i < 3; i++) f.push(tone(0.9), 33); for (let i = 0; i < 12; i++) f.push(tone(0.01, 2000), 33); }
  assert.ok(f.kicks >= 6, `kicks counted: ${f.kicks}`);
});

test('0.0.8 item 10: peak caps jump at once, hold, then fall slowly', () => {
  const f = new vc.Features(); f.autoGain = false;
  for (let i = 0; i < 10; i++) f.push(tone(0.9), 33);
  const top = Math.max(...f.peaks); assert.ok(top > 0.5);
  f.push(null, 33); f.push(null, 33);
  assert.ok(Math.max(...f.peaks) > top * 0.97, 'still held right after the hit');
  for (let i = 0; i < 10; i++) f.push(null, 33);
  const mid = Math.max(...f.peaks); assert.ok(mid < top && mid > top * 0.5, `falls slowly (${top.toFixed(2)} -> ${mid.toFixed(2)})`);
  assert.ok(mid > Math.max(...f.bands), 'caps stay above the falling bars');
});

test('0.0.8 item 10: stereo levels from the server feed lr (VU meters)', () => {
  const f = new vc.Features(); const db = d => Math.round((d + 72) * 255 / 72);
  f.push(tone(0.5), 33, new Uint8Array([db(-10), db(-30), db(-4), db(-20)]));
  assert.equal(f.lr.stereo, true); assert.ok(Math.abs(f.lr.rmsL + 10) < 0.5 && Math.abs(f.lr.rmsR + 30) < 0.5);
  assert.match(src('viz.js'), /u\.length >= 1029 \? u\.subarray\(1025, 1029\)/);
});

// ---- item 16: VU ballistics
test('0.0.8 VU: needle rises in about 300 ms, overshoots, then settles; damping controls the overshoot', () => {
  const run = (damp, speed = 1) => { const n = new vu.Needle(); let max = 0, t300 = 0; for (let t = 0; t < 1500; t += 16) { const x = n.step(0.6, 16, speed, damp); max = Math.max(max, x); if (!t300 && x >= 0.6 * 0.99) t300 = t; } return { max, end: n.x, t300 }; };
  const a = run(0.6); assert.ok(a.max > 0.62, `overshoot ${a.max.toFixed(3)}`); assert.ok(Math.abs(a.end - 0.6) < 0.01, 'settles on the target');
  assert.ok(a.t300 > 120 && a.t300 < 450, `rise time ${a.t300} ms`);
  const b = run(1.4); assert.ok(b.max <= 0.6005, 'heavily damped needle does not overshoot');
  const fast = run(0.6, 2); assert.ok(fast.t300 < a.t300, 'needle speed control works');
  const n = new vu.Needle(); for (let i = 0; i < 40; i++) n.step(2, 16, 1, 0.3); assert.ok(n.x <= 1.12, 'the right peg stops the needle');
});

test('0.0.8 VU: scale positions are monotonic, -20 at the left end, 0 VU about two thirds, +3 at the right end', () => {
  assert.equal(vu.vuPos(-20), 0); assert.equal(vu.vuPos(3), 1); assert.ok(Math.abs(vu.vuPos(0) - 0.664) < 0.01);
  let p = -1; for (let v = -40; v <= 8; v += 0.5) { const q = vu.vuPos(v); assert.ok(q >= p, `monotonic at ${v}`); p = q; }
  assert.ok(vu.vuPos(-60) >= -0.035);
  assert.ok(vu.vuAngle(0) < 0 && vu.vuAngle(1) > 0 && Math.abs(vu.vuAngle(0.5)) < 1e-9);
  const s = src('vizvu.js'); for (const k of ['classic', 'dark', 'neon', 'peakHold', 'led', 'bar']) assert.match(s, new RegExp(k));
});

// ---- item 11: shared context, no per-view contexts, loss handling
test('0.0.8 item 11: one shared WebGL context with loss/restore handling; views never create their own', () => {
  const g = src('vizgl.js'), v = src('viz.js');
  assert.match(g, /webglcontextlost/); assert.match(g, /webglcontextrestored/); assert.match(g, /export function sharedGL/);
  assert.doesNotMatch(v, /getContext\('webgl/); assert.doesNotMatch(src('vizpage.js'), /getContext\('webgl/);
  assert.match(v, /fallback/i);
});

// ---- item 12: Adjust button removed
test('0.0.8 item 12: no Adjust button on the Visualizer page', () => {
  assert.doesNotMatch(src('vizpage.js').replace(/\/\/.*$/gm, ''), /['"]Adjust/);
});

// ---- item 9: display size zooms the whole UI
test('0.0.8 item 9: Display size factors and the CSS zoom rule; viewport units compensate the zoom', () => {
  assert.deepEqual(ui.SCALES.map(s => s[2]), [0.9, 1, 1.12, 1.25, 1.5]);
  assert.equal(ui.scaleFactor('large'), 1.25); assert.equal(ui.scaleFactor('nope'), 1);
  assert.match(css, /html\{zoom:var\(--z,1\)\}/);
  const raw = css.replace(/\d+(\.\d+)?d?v[hw] \/ var\(--z,1\)/g, '').match(/\d+(\.\d+)?d?v[hw]\b/g) || [];
  assert.deepEqual(raw, [], 'every vh/vw is divided by the zoom');
  assert.match(src('uiscale.js'), /wavwiz\.uiscale/);
});

// ---- item 2: no hard-coded white/light button styles
test('0.0.8 item 2: no hard-coded white or light backgrounds on buttons (CSS and inline JS styles)', () => {
  const light = /background(-color)?\s*:\s*(#fff\b|#ffffff\b|white\b|#f[0-9a-f]{5}\b|#e[0-9a-f]{5}\b|rgba?\(\s*2[3-5]\d\s*,\s*2[3-5]\d\s*,\s*2[3-5]\d)/i;
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim(), body = m[2];
    if (/button|\.btn|\.tbtn|\.chip|\.plus|\.zbtn|\.iconbtn|\.devchip|\.zadd|\.zedit/.test(sel) && light.test(body)) bad.push(sel);
  }
  assert.deepEqual(bad, [], 'button rules with a white/light background');
  for (const f of ['devices.js', 'zone.js', 'now.js', 'menu.js', 'settings.js', 'vizpage.js', 'themes.js', 'main.js', 'library.js', 'diag.js', 'latency.js']) {
    for (const m of src(f).matchAll(/h\('button',\s*\{[^}]*style:\s*'([^']*)'/g)) assert.doesNotMatch(m[1], light, `${f}: inline button style`);
  }
  assert.match(css, /:where\(button\)\{background-color:var\(--panel2\)/, 'unstyled buttons follow the theme');
  assert.match(src('devices.js'), /zbtn zedit/); assert.doesNotMatch(src('devices.js'), /class: 'more', 'aria-label': `Edit zone/);
  assert.match(src('devices.js'), /accent-o zadd/); assert.match(css, /\.zadd\{[^}]*var\(--accent\)/);
});

// ---- items 3-6: panels and menus
test('0.0.8 items 3-6: Devices panel collapse arrow saved per device; desktop menu toggles panels, phone keeps pages', () => {
  const m = src('main.js'), d = src('devices.js'), menu = src('menu.js');
  assert.match(m, /wavwiz\.devcollapsed/); assert.match(m, /function toggleDev/); assert.match(css, /\.desk\.devcollapsed\{--rightw:46px\}/);
  assert.match(css, /\.desk\{transition:grid-template-columns/); assert.match(d, /devcol/);
  assert.match(menu, /menuActions\(S, ctl, true\)/, 'desktop menu bar asks for panel toggles');
  assert.match(menu, /\['Browse library', browseLib\]/); assert.match(menu, /\['Devices & zones', devPanel\]/);
  assert.match(menu, /createPhoneDrawerNav[\s\S]*menuActions\(S, ctl\)\;/, 'phone drawer keeps the full-screen pages');
});

// ---- item 7: delay slider
test('0.0.8 item 7: delay slider 0-1000 ms in 5 ms steps, ms box 0-2000, clamp', () => {
  assert.equal(lat.LAT_MAX_SLIDER, 1000); assert.equal(lat.LAT_STEP, 5); assert.equal(lat.LAT_MAX, 2000);
  assert.equal(lat.clampMs(-5), 0); assert.equal(lat.clampMs(2500), 2000); assert.equal(lat.clampMs('12.6'), 13); assert.equal(lat.clampMs('x'), 0);
  const z = src('zone.js'); assert.match(z, /latencyControl/); assert.match(z, /live/);
  assert.match(css, /\.latslider::-webkit-slider-thumb\{[^}]*width:32px/, 'big thumb on touch screens');
});

// ---- item 13: US English
test('0.0.8 item 13: US English spelling in the UI', () => {
  const brit = /\b(colour|favourite|grey|centre|customis|licence|organis|behaviour|analys(e|ing)|catalogue|cancelled|labelled|normalis)/i;
  for (const f of ['about.js', 'main.js', 'menu.js', 'settings.js', 'themes.js', 'vizpage.js', 'vizcore.js', 'now.js', 'devices.js', 'zone.js', 'calibrate.js', 'calerrors.js', 'radiofinder.js', 'diag.js', 'library.js', 'room.js']) {
    const m = src(f).match(brit); assert.equal(m, null, `${f}: ${m?.[0]}`);
  }
  assert.doesNotMatch(css, brit);
});

// ---- item 14: Now Playing per the mockup
test('0.0.8/0.1.2 item 14: Now Playing visualizer panel + control panel', () => {
  const n = src('now.js');
  for (const k of ['np-vlabel', 'np-times', 'np-genre', 'np-eq', 'np-volbtn', 'np-dot', 'np-volpop', 'np-srcchip', 'np-vizpanel', 'np-ctlpanel']) assert.match(n, new RegExp(k), k);
  assert.match(n, /h\('section', \{ class: 'np-vizpanel'[^]*stage\)/, 'the stage sits inside the visualizer panel');
  assert.match(n, /openEq/); assert.match(n, /stream\/stop/); assert.match(n, /Master volume/);   // volume, stop and Sound stay reachable
});

test('0.0.8 version strings (0.1.3 now)', () => {
  assert.match(src('about.js'), /WHATS_NEW_VERSION = '0\.1\.3'/);
  const props = readFileSync(new URL('../../Directory.Build.props', import.meta.url), 'utf8'); assert.match(props, /<WavWizVersion>0\.1\.3</);
  const iss = readFileSync(new URL('../../installer/WavWiz.iss', import.meta.url), 'utf8'); assert.match(iss, /#define AppVersion "0\.1\.3"/);
});
