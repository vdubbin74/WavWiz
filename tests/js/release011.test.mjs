// WavWiz 0.1.1: Mood + calmer visualizers, Playlist slide-down panel, AirPlay / Spotify Connect UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
const vc = await imp('vizcore');
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const tone = (a, hz = 60) => { const w = new Uint8Array(1024); for (let i = 0; i < 1024; i++) w[i] = Math.round(128 + 127 * a * Math.sin(2 * Math.PI * hz * i / 48000)); return w; };

test('0.1.1 Mood (0.1.3: Energy 0-100 %): saved Mood carries over, Calm -> 50 %, Energetic -> 100 %; old Sensitivity default -> 50 %', () => {
  assert.equal(vc.DEFAULT_MOOD, 50); assert.equal(new vc.Features().mood, 50);
  const st = memStore(); st.setItem(vc.REACT_KEY_V1, JSON.stringify({ sensitivity: 0.8, autoGain: false, mood: 'energetic', v: 2 }));     // what 0.1.2 saved
  assert.deepEqual(vc.loadReact(st), { energy: 100, sensitivity: 50, autoGain: 0 });
  const st2 = memStore(); st2.setItem(vc.REACT_KEY_V1, JSON.stringify({ sensitivity: 0.8, autoGain: true, mood: 'calm', v: 2 })); assert.deepEqual(vc.loadReact(st2), { energy: 50, sensitivity: 50, autoGain: 50 });
  vc.saveReact({ energy: 'bogus', sensitivity: 50, autoGain: 50 }, st); assert.equal(vc.loadReact(st).energy, 50);
});

test('0.1.3 per-look settings: 0.1.2 values migrate once (untouched -> 50 %, changed -> same value), scaled by Energy at run time', () => {
  const st = memStore(); st.setItem(vc.SETTINGS_KEY_V1, JSON.stringify({ particles: { intensity: 1, speed: 1, density: 1.5, shake: false, fx: { warp: 2.5 } }, lightning: { fx: { bolts: 2 } } }));
  const saved = vc.loadSettings('particles', st);
  assert.equal(saved.intensity, 50); assert.equal(saved.speed, 50); assert.equal(saved.shake, 0);
  assert.ok(Math.abs(vc.pmap(saved.density, vc.SHARED.find(d => d[0] === 'density')[2]) - 1.5) < 0.02, 'customized density keeps its value');
  assert.ok(Math.abs(vc.pmap(saved.fx.warp, vc.FX.particles.find(d => d[0] === 'warp')[2]) - 2.5) < 0.05, 'customized warp keeps its value');
  assert.equal(JSON.parse(st.getItem(vc.SETTINGS_KEY)).lightning, undefined, 'Lightning settings are dropped');
  vc.saveSettings('particles', { ...saved, intensity: 80 }, st); assert.equal(vc.loadSettings('particles', st).intensity, 80);       // migration runs only once
  const calm = vc.effectiveSettings('particles', 0, st), wild = vc.effectiveSettings('particles', 100, st);
  assert.ok(calm.intensity < wild.intensity && calm.speed < wild.speed);
});

test('0.1.1 calmer response: Calm flashes softer, shakes less, eases in and decays slower than Energetic (0.0.8)', () => {
  const run = mood => {
    const f = new vc.Features(); f.mood = mood; for (let i = 0; i < 40; i++) f.push(tone(0.02), 33);
    let peakFlash = 0, peakShake = 0, kicked = false, first = null;
    for (let i = 0; i < 8; i++) { f.push(tone(0.95), 33); kicked ||= f.kick; if (kicked && first === null) first = f.flash; peakFlash = Math.max(peakFlash, f.flash); peakShake = Math.max(peakShake, f.shake); }
    for (let i = 0; i < 6; i++) f.push(null, 33);
    return { kicked, peakFlash, peakShake, first, after: f.flash / Math.max(1e-6, peakFlash) };
  };
  const calm = run('calm'), wild = run('energetic');
  assert.ok(wild.kicked && calm.kicked, 'both still see the beat');
  assert.ok(calm.peakFlash < wild.peakFlash * 0.7, `flash ${calm.peakFlash} vs ${wild.peakFlash}`);
  assert.ok(calm.peakShake < wild.peakShake * 0.5, `shake ${calm.peakShake} vs ${wild.peakShake}`);
  assert.ok(calm.first < calm.peakFlash || calm.first < wild.first * 0.5, 'calm eases in');
  assert.ok(calm.after > wild.after, 'calm decays slower');
});

test('0.1.1 calmer colors: Calm softens the palette and cools the glow accent; Energetic is unchanged', () => {
  const th = { accent: '#FF3C00', accent2: '#19C3B1' };
  const e = vc.palette({ mood: 'energetic' }, th), c = vc.palette({ mood: 'calm' }, th), base = vc.palette({}, th);
  assert.deepEqual(e, base);
  const sat = x => Math.max(...x) - Math.min(...x); assert.ok(sat(c.p) < sat(e.p)); assert.ok(c.a.reduce((a, b) => a + b) < e.a.reduce((a, b) => a + b));
});

test('0.1.1 Visualizer page has the Mood control and keeps Sensitivity, Auto-gain and every per-look effect control', () => {
  const p = src('vizpage.js'); assert.match(p, /'Energy'/); assert.match(p, /Sensitivity/); assert.match(p, /Auto-gain/); assert.match(p, /FX/);    // 0.1.3: Mood became the Energy slider
  assert.match(src('viz.js'), /effectiveSettings\(this\.engine\)/); assert.match(src('viz.js'), /features\.mood = r\.energy/);
  for (const k of Object.keys(vc.FX)) assert.ok(vc.FX[k].length >= 2, k);
});

test('0.1.1 Playlist panel: arrow + desktop Library > Playlist toggle, saved per device, slides with the grid rows; phone keeps the page', () => {
  const m = src('main.js'), menu = src('menu.js'), lt = src('listtable.js');
  assert.match(m, /function toggleList/); assert.match(m, /wavwiz\.listcollapsed/); assert.match(m, /toggleList: f => toggleList\(f\)/);
  assert.match(menu, /\['Playlist', listPanel, \(\) => !desktop\]/); assert.match(menu, /go\('queue'\)/);
  assert.match(lt, /Collapse or expand the playlist/); assert.match(lt, /setCollapsed/);
  assert.match(css, /\.desk\.listcollapsed\{--listh:36px\}/); assert.match(css, /grid-template-rows \.32s/);
});

test('0.1.1 AirPlay / Spotify UI: live sources show LIVE, no seeking, source label; Spotify toggle carries exactly the Premium line; no "untested" wording', async () => {
  const art = await imp('art');
  assert.equal(art.isLive({ kind: 'airplay' }), true); assert.equal(art.isLive({ kind: 'spotify' }), true); assert.equal(art.isLive({ kind: 'track' }), false);
  assert.equal(art.sourceLabel({ kind: 'airplay' }), 'AirPlay'); assert.equal(art.itemArtUrl({ kind: 'spotify', artist: 'a', album: 'b' }), null);
  assert.equal(art.itemArtUrl({ kind: 'airplay', artUrl: '/api/v1/live/art/airplay?v=2' }), '/api/v1/live/art/airplay?v=2');
  const s = src('settings.js'); assert.match(s, /'spotify\.enabled'/); assert.match(s, /'Requires Spotify Premium\.'/); assert.match(s, /WavWiz – Whole House/);
  for (const f of ['settings.js', 'about.js', 'now.js', 'rip.js']) assert.doesNotMatch(src(f), /untested/i, f);
  assert.match(src('about.js'), /WHATS_NEW_VERSION = '0\.1\.[2-9]'/);
});
