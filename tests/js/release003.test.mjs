import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const imp = n => import(pathToFileURL(`${process.env.JS_DIR}/${n}.js`).href);
const vm = await imp('vizmath'), cols = await imp('cols'), viz = await imp('viz');

const sine = (hz, amp = 0.8, sr = 48000) => { const w = new Uint8Array(vm.N); for (let i = 0; i < vm.N; i++) w[i] = Math.round(128 + 127 * amp * Math.sin(2 * Math.PI * hz * i / sr)); return w; };

// ---------------- vizmath
test('FFT: a pure tone peaks at its bin; silence is silent', () => {
  const binHz = 48000 / vm.N;
  for (const hz of [440, 1000, 5000]) {
    const m = vm.magnitudes(sine(hz)); let pk = 0; for (let k = 1; k < m.length; k++) if (m[k] > m[pk]) pk = k;
    assert.ok(Math.abs(pk * binHz - hz) <= binHz, `${hz} Hz peaked at ${pk * binHz}`);
  }
  assert.ok(Math.max(...vm.magnitudes(new Uint8Array(vm.N).fill(128))) < 1e-9);
});
test('FFT: matches a direct DFT on a small signal', () => {
  const n = 16, re = new Float64Array(n), im = new Float64Array(n), x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
  x.forEach((v, i) => { re[i] = v; }); vm.fft(re, im);
  for (let k = 0; k < n; k++) { let sr = 0, si = 0; for (let t = 0; t < n; t++) { sr += x[t] * Math.cos(2 * Math.PI * k * t / n); si -= x[t] * Math.sin(2 * Math.PI * k * t / n); } assert.ok(Math.abs(sr - re[k]) < 1e-9 && Math.abs(si - im[k]) < 1e-9, 'bin ' + k); }
});
test('bands: strictly increasing edges, every bar owns a bin, values 0..1, a bass tone lights the low bars and not the high ones', () => {
  for (const bars of [24, 48, 64, 96]) { const e = vm.bandEdges(bars); assert.equal(e.length, bars + 1); for (let i = 1; i < e.length; i++) assert.ok(e[i] > e[i - 1]); assert.ok(e[bars] <= vm.N / 2); }
  const b = vm.bands(vm.magnitudes(sine(100)), 48); assert.ok(b.every(v => v >= 0 && v <= 1));
  assert.ok(b.slice(0, 12).some(v => v > 0.5)); assert.ok(b.slice(36).every(v => v < 0.3));
  assert.ok(vm.bands(vm.magnitudes(new Uint8Array(vm.N).fill(128)), 48).every(v => v === 0));
});
test('smooth: fast attack, slow decay, converges', () => {
  const p = new Float64Array(2); vm.smooth(p, [1, 0]); assert.ok(p[0] > 0.5 && p[0] < 1); const hi = p[0]; vm.smooth(p, [0, 0]); assert.ok(p[0] < hi && p[0] > hi * 0.5);
  for (let i = 0; i < 60; i++) vm.smooth(p, [0.7, 0.7]); assert.ok(Math.abs(p[0] - 0.7) < 0.01);
});
test('beat: fires on a bass jump over the running average, then cools down, pulse decays', () => {
  const b = new vm.Beat(); let hits = 0; for (let i = 0; i < 40; i++) hits += b.push(0.05).hit; assert.equal(hits, 0);
  const r = b.push(0.6); assert.equal(r.hit, true); assert.ok(r.pulse > 0.9);
  assert.equal(b.push(0.9).hit, false);           // cool-down
  for (let i = 0; i < 20; i++) b.push(0.05); assert.ok(b.pulse < 0.05);
});
test('ring: bars start bottom-left, orange (L) on the left half and teal (R) on the right half; the gap is at the bottom', () => {
  const n = 64, sides = Array.from({ length: n }, (_, i) => vm.barAngle(i, n));
  assert.equal(sides.slice(0, n / 2).every(s => s.side === 'L'), true); assert.equal(sides.slice(n / 2).every(s => s.side === 'R'), true);
  const gap = 56 * Math.PI / 180, first = sides[0].a, last = sides[n - 1].a; assert.ok(first > Math.PI / 2 && last < Math.PI / 2 + 2 * Math.PI);
  assert.ok(Math.abs((last - first) - (2 * Math.PI - gap) * (n - 1) / n) < 1e-9);
  const y = a => Math.sin(a); assert.ok(y(sides[n / 2 - 1].a) < 0 && y(sides[n / 2].a) < 0, 'the two middle bars are at the top');
});
test('ring layout: bars never leave the canvas for any banner shape, any pulse', () => {
  for (const [w, h] of [[1000, 130], [1000, 300], [300, 300], [60, 40], [3000, 520], [20, 20]]) for (const pulse of [0, 0.5, 1]) {
    const L = vm.ringLayout(w, h, pulse); assert.ok(L.r0 > 0 && L.maxBar > 0, `${w}x${h}`); assert.ok(L.cx - L.r0 - L.maxBar >= -0.5 || Math.min(w, h) < 24); assert.ok(L.cy - L.r0 - L.maxBar >= -0.5 || Math.min(w, h) < 24);
    assert.ok(L.cy + L.r0 + L.maxBar <= h + 0.5 || Math.min(w, h) < 24, `${w}x${h} pulse ${pulse}`);
  }
});
test('particles: pooled, capped, they die', () => {
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const p = new vm.Particles(10, rnd);
  p.burst(50, 50, 20, 100, ['#f00']); assert.ok(p.p.length <= 10 && p.p.length > 0);
  for (let i = 0; i < 400; i++) p.step(16.7); assert.equal(p.p.length, 0);
});
test('rms: silence 0, full-scale sine ~0.7', () => { assert.equal(vm.rms(new Uint8Array(vm.N).fill(128)), 0); assert.ok(Math.abs(vm.rms(sine(440, 1)) - 0.707) < 0.03); });

// (0.0.7: the MilkDrop gain test was removed with MilkDrop itself)

// ---------------- playlist columns
test('resizeCol keeps the total, respects the minimum on both sides', () => {
  const w = [100, 200, 300, 150]; const r = cols.resizeCol(w, 1, 50); assert.deepEqual(r, [100, 250, 250, 150]);
  assert.equal(r.reduce((a, b) => a + b), 750);
  assert.deepEqual(cols.resizeCol(w, 1, 10_000), [100, 200 + 256, 44, 150]); assert.deepEqual(cols.resizeCol(w, 1, -10_000), [100, 44, 456, 150]);
  assert.deepEqual(cols.resizeCol(w, 3, 40), w);       // the last column has no divider to its right
});
test('fitWidths adds up to exactly the table width for narrow and wide tables', () => {
  for (const total of [320, 500, 777, 1000, 1920, 3000]) { const w = cols.fitWidths(total); assert.equal(w.reduce((a, b) => a + b, 0), total, `total ${total}`); assert.ok(w.every(x => x >= 44)); }
  const f = cols.toFracs([100, 300]); assert.deepEqual(f, [0.25, 0.75]);
});
test('column choices are remembered and a corrupt store falls back to the defaults', () => {
  const st = {}; const store = { getItem: k => st[k] ?? null, setItem: (k, v) => { st[k] = v; } };
  assert.deepEqual(cols.loadFracs(store), cols.DEFAULT_FRACS); cols.saveFracs([0.1, 0.3, 0.2, 0.2, 0.1, 0.1], store); assert.deepEqual(cols.loadFracs(store), [0.1, 0.3, 0.2, 0.2, 0.1, 0.1]);
  st[cols.COL_KEY] = '{oops'; assert.deepEqual(cols.loadFracs(store), cols.DEFAULT_FRACS); st[cols.COL_KEY] = JSON.stringify([1, 2]); assert.deepEqual(cols.loadFracs(store), cols.DEFAULT_FRACS);
});

// ---------------- brand
test('the wordmark SVG: orange Wav, teal Wiz, tagline, sparkle', async () => {
  const fs = await import('node:fs'); const svg = fs.readFileSync(new URL(`file://${process.env.JS_DIR}/brand.js`), 'utf8');
  // 0.0.6: plain text wordmark; colors + aria tagline remain required
  for (const must of ['#FF3C00', '#19C3B1', 'Whole-home music, in sync.', 'wm-wav']) assert.ok(svg.includes(must), must);
});
