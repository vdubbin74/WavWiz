import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const ws = await imp('wsconn');

test('0.0.7 ws: backoff grows, is capped at ~10 s and has jitter', () => {
  assert.equal(ws.backoffMs(0, () => 0.5), 500);
  assert.equal(ws.backoffMs(1, () => 0.5), 1000);
  assert.equal(ws.backoffMs(10, () => 0.5), 10000);
  assert.ok(ws.backoffMs(20, () => 1) <= 12500);
  assert.ok(ws.backoffMs(3, () => 0) < ws.backoffMs(3, () => 1));
});

test('0.0.7 ws: plain http uses ws:// with the ticket in the query; https uses wss://', () => {
  assert.equal(ws.wsUrl('/ws', 'AB', { protocol: 'http:', host: '192.168.1.20:47800' }), 'ws://192.168.1.20:47800/ws?ticket=AB');
  assert.equal(ws.wsUrl('/ws/viz?delayMs=0', 'AB', { protocol: 'https:', host: 'h:1' }), 'wss://h:1/ws/viz?delayMs=0&ticket=AB');
  assert.equal(ws.wsUrl('/ws', null, { protocol: 'http:', host: 'h' }), 'ws://h/ws');
});

test('0.0.7 every live socket goes through wsconn (no raw cookie-only WebSockets left)', () => {
  for (const f of ['main.js', 'room.js', 'viz.js', 'calibrate.js']) assert.doesNotMatch(src(f), /new WebSocket\(/, f);
  assert.match(src('wsconn.js'), /auth\/ws-ticket/);
  assert.match(src('wsconn.js'), /visibilitychange/);
  assert.match(src('wsconn.js'), /pageshow/);
});

test('0.0.7 phone audio: one shared AudioContext, unlock on touchend/click, auto-join default on phones', async () => {
  const s = src('room.js');
  assert.equal((s.match(/new AC\(/g) || []).length, 2);        // only inside sharedCtx (with and without options)
  assert.match(s, /'touchend', 'click'/);
  assert.doesNotMatch(s, /ctx\?\.close\(\)/);
  assert.doesNotMatch(s, /start\.click\(\)/);                     // the device page no longer starts a second PhoneRoom at load
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const room = await imp('phonejoin');
  assert.equal(room.wantsAutoJoin(null, true), true);
  assert.equal(room.wantsAutoJoin('0', true), false);
  assert.equal(room.wantsAutoJoin(null, false), false);
  assert.equal(room.wantsAutoJoin('1', false), true);
  assert.equal(room.isPhoneUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
});

const vc = await imp('vizcore');
const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const tone = (amp, f = 60) => Uint8Array.from({ length: 1024 }, (_, i) => Math.max(0, Math.min(255, Math.round(128 + 127 * amp * Math.sin(2 * Math.PI * f * i / 48000)))));

test('0.0.7 viz list: Particle burst (default), Waveform river, Speaker cone, Ring; milkdrop maps to Particle burst', () => {
  // 0.0.8: the four 0.0.7 looks stay first, four new looks follow
  assert.deepEqual(vc.VIZ_LIST.map(([k]) => k).slice(0, 4), ['particles', 'river', 'cone', 'wavwiz']);
  assert.deepEqual(vc.VIZ_LIST.map(([, t]) => t).slice(0, 4), ['Particle burst', 'Waveform river', 'Speaker cone', 'Ring']);
  assert.equal(vc.normEngine('milkdrop'), 'particles'); assert.equal(vc.normEngine('cone'), 'cone'); assert.equal(vc.normEngine(undefined), 'particles');
});

test('0.0.7 viz settings: per-look, clamped, saved separately; theme vs custom palette', () => {
  const st = memStore();
  vc.saveSettings('river', { colorMode: 'custom', primary: '#00ff00', intensity: 900, speed: -1, density: 60, shake: false }, st);     // 0.1.3: 0-100 %
  const r = vc.loadSettings('river', st), p = vc.loadSettings('particles', st);
  assert.equal(r.colorMode, 'custom'); assert.equal(r.primary, '#00FF00'); assert.equal(r.intensity, 100); assert.equal(r.speed, 0); assert.equal(r.density, 60); assert.equal(r.shake, 0);
  assert.deepEqual(p, vc.cleanSettings({}, 'particles'));   // 0.0.8: settings carry the look's own effect controls
  assert.deepEqual(vc.palette(r, { accent: '#FF3C00', accent2: '#19C3B1' }).p, [0, 1, 0]);
  const t = vc.palette(p, { accent: '#FF0000', accent2: '#0000FF' }); assert.deepEqual(t.p, [1, 0, 0]); assert.deepEqual(t.s, [0, 0, 1]);
  vc.resetSettings('river', st); assert.equal(vc.loadSettings('river', st).colorMode, 'theme');
});

test('0.0.7 energy features: calm idle, kick fires flash + surge + shake on heavy bass, all decay', () => {
  const f = new vc.Features(); f.mood = 'energetic';          // 0.1.1: the 0.0.8 response lives on as Mood = Energetic (default is Calm)
  for (let i = 0; i < 60; i++) f.push(null, 16.7);
  assert.equal(f.idle, true); assert.ok(f.flash < 0.01 && f.surge < 0.01 && f.shake < 0.01);
  for (let i = 0; i < 40; i++) f.push(tone(0.02), 33);           // quiet bed so the beat average settles
  let kicked = false; for (let i = 0; i < 6 && !kicked; i++) { f.push(tone(0.95), 33); kicked = kicked || f.kick; }
  assert.ok(kicked, 'a loud bass hit is a kick'); assert.equal(f.idle, false);
  assert.ok(f.flash > 0.4 && f.surge > 0.5, `flash ${f.flash} surge ${f.surge}`); assert.ok(f.shake > 0.3, 'heavy bass shakes the camera');
  for (let i = 0; i < 90; i++) f.push(null, 16.7);
  assert.ok(f.flash < 0.05 && f.surge < 0.05 && f.shake < 0.05); assert.equal(f.idle, true);
});

test('0.0.7 particle counts: thousands on desktop and phones, never a few dim dots', () => {
  assert.ok(vc.particleCount(4200, 1, false) >= 4000);
  assert.ok(vc.particleCount(2600, 1, true) >= 2000);
  assert.ok(vc.particleCount(900, 0.25, false) >= 300);
});

test('0.0.7 WebGL looks: WebGL 1 (iOS), additive glow, trails, shockwaves, no eval; CSP drops unsafe-eval; butterchurn gone', () => {
  const g = src('vizgl.js');
  assert.match(g, /getContext\('webgl'/); assert.match(g, /'webgl2'/);      // 0.1.3: WebGL 2 first, WebGL 1 fallback (older iPhones)
  assert.match(g, /blendFunc\(gl\.ONE, gl\.ONE\)/); assert.match(g, /preserveDrawingBuffer: false/);   // 0.0.8: one shared context renders into per-view framebuffers
  for (const c of ['WarpScene', 'RiverScene', 'ConeScene', 'RingScene']) assert.match(g, new RegExp('class ' + c));
  for (const f of ['vizgl.js', 'viz.js', 'vizcore.js', 'vizpage.js']) assert.doesNotMatch(src(f), /new Function|eval\(/);
  const cs = readFileSync(new URL('../../src/WavWiz.Server/Host/WavWizServer.cs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(cs, /'unsafe-eval'/);
  assert.doesNotMatch(src('viz.js'), /butterchurn|loadVendor/);
});

test('0.0.7 pages: View > Theme… / Visualizer… open pages (desktop + phone); Settings no longer lists themes or looks', () => {
  const m = src('menu.js'), st = src('settings.js'), main = src('main.js');
  assert.match(m, /item\('Theme…', \(\) => A\.go\('themes'\)\)/); assert.match(m, /leaf\('Theme…', \(\) => A\.go\('themes'\)\)/);
  assert.match(m, /item\('Visualizer…', \(\) => A\.go\('visualizer'\)\)/); assert.match(m, /leaf\('Visualizer…', \(\) => A\.go\('visualizer'\)\)/);
  assert.doesNotMatch(st, /themeCard\(|vizCard\(|PRESETS/);
  assert.match(main, /views\.themes = themesView\(\); views\.visualizer = visualizerView\(\)/);
});

test('0.0.7 transport: SVG icon set, no emoji transport glyphs; themed zone Add', () => {
  const n = src('now.js');
  for (const e of ['⏮', '⏭', '🔁', '■', '⇄', '❚❚', '🔈']) assert.ok(!n.includes(`'${e}'`), 'emoji ' + e);
  for (const k of ['play', 'pause', 'prev', 'next', 'shuffle', 'repeat', 'repeatOne', 'stop', 'volume', 'eq']) assert.match(src('icons.js'), new RegExp('\\b' + k + ':'));
  assert.match(src('devices.js'), /accent-o zadd/);
  assert.match(readFileSync(join(js, '../app.css'), 'utf8'), /\.zadd\{[^}]*var\(--accent\)/);
});

test('0.0.7 version strings', () => {
  assert.match(src('about.js'), /WHATS_NEW_VERSION = '0\.(0\.[7-9]|1\.\d)'/);   // 0.0.8 bumps it
  assert.doesNotMatch(src('about.js'), /butterchurn/);
});
