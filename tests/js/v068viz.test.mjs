// 0.6.8-#17: musical visualizers - a beat clock (predicted beats between kicks), bass punch emphasis, every look (incl. Neon tunnel) reacts;
// the defaults stay at 50 % (max 100 %) and Speaker cone / Particle burst / Ring stay registered in the pickers and settings grids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url);
const rd = f => readFileSync(new URL(f, W), 'utf8');
const vc = await import(new URL('vizcore.js', W));

test('beat clock: a steady 120 BPM groove locks, a missed kick still lands as a predicted beat', () => {
  const c = new vc.BeatClock(), dt = 10; let t = 0, preds = [];
  const run = (ms, kickAt) => { for (let e = 0; e < ms; e += dt) { t += dt; const k = kickAt(t); const p = c.push(dt, k); if (p) preds.push(t); } };
  run(4000, x => x % 500 === 0);                      // 8 kicks
  assert.ok(Math.abs(c.bpm - 120) < 1, 'bpm ' + c.bpm); assert.equal(c.conf, 1); assert.deepEqual(preds, []);   // kicks never double as predictions
  run(1000, x => x % 500 === 0 && x !== 4500);        // the kick at 4.5 s is missed
  assert.equal(preds.length, 1); assert.ok(Math.abs(preds[0] - 4500) <= 20, 'predicted at ' + preds[0]);
});

test('beat clock: halves / doubles fold into 80-200 BPM; an irregular pattern never predicts; silence resets', () => {
  assert.equal(vc.BeatClock.fold(250), 500); assert.equal(vc.BeatClock.fold(1000), 500); assert.equal(vc.BeatClock.fold(5000), 625);
  const c = new vc.BeatClock(); let t = 0, preds = 0; const gaps = [310, 720, 450, 380, 690, 330, 560, 410, 740, 300];
  let next = 0, gi = 0; for (let e = 0; e < 6000; e += 10) { t += 10; const k = t >= next; if (k) next = t + gaps[gi++ % gaps.length]; if (c.push(10, k)) preds++; }
  assert.ok(c.conf < 0.6); assert.equal(preds, 0);
  for (let e = 0; e < 7000; e += 10) c.push(10, false);
  assert.equal(c.bpm, 0);
});

const kickWave = (amp) => { const w = new Uint8Array(1024); for (let i = 0; i < 1024; i++) w[i] = 128 + Math.round(amp * 120 * Math.sin(i / 1024 * Math.PI * 2 * 3)); return w; };
test('bass punch: jumps when the bass hits over its average, then decays; the features expose groove / bpm / punch', () => {
  const f = new vc.Features(); f.mood = 50;
  for (let i = 0; i < 120; i++) f.push(kickWave(0.05), 16.7);
  const before = f.punch;
  f.push(kickWave(0.9), 16.7); f.push(kickWave(0.9), 16.7);
  assert.ok(f.punch > before + 0.2, `punch ${before} -> ${f.punch}`);
  const hit = f.punch; for (let i = 0; i < 30; i++) f.push(kickWave(0.05), 16.7);
  assert.ok(f.punch < hit * 0.2);
  for (const k of ['groove', 'bpm', 'phase', 'beatConf', 'punch']) assert.ok(k in f, k);
});

test('defaults stay at 50 % (max 100 %); the looks stay registered; every look reacts to the groove or the punch', () => {
  for (const k of ['intensity', 'speed', 'density', 'shake']) assert.equal(vc.DEFAULT_SETTINGS[k], 50);
  assert.equal(vc.DEFAULT_REACT.energy, 50);
  const keys = vc.VIZ_LIST.map(([k]) => k); for (const k of ['cone', 'particles', 'wavwiz', 'tunnel']) assert.ok(keys.includes(k), k);
  assert.match(rd('vizpage.js'), /VIZ_LIST\.map/);
  const g = rd('vizgl.js');
  for (const cls of ['WarpScene', 'RiverScene', 'ConeScene', 'RingScene', 'TunnelScene', 'SpectrumScene', 'GeqScene']) {
    const body = g.slice(g.indexOf('class ' + cls), g.indexOf('\nexport class', g.indexOf('class ' + cls) + 10) >>> 0 || undefined);
    assert.match(body, /f\.groove|f\.punch/, cls);
  }
  assert.match(rd('vizvu.js'), /f\.groove/);
});
