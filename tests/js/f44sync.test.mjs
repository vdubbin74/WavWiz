// WavWiz 0.4.6 F44 - the phone's needed delay changed every launch (148 / 14 / 65 ms). Simulates 3 launches with different clock offsets, Wi-Fi
// power-save asymmetry on the first replies, AudioContext start times, iOS IO-buffer step sizes and output latencies, and checks that with ONE
// fixed user delay the audio is heard within 3 ms of its server time on every launch (the 0.4.5 maths drifted by tens of ms).
import test from 'node:test';
import assert from 'node:assert/strict';
const js = process.env.JS_DIR;
const R = await import(`${js}/roomsched.js`);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const LAUNCHES = [
  { seed: 1, offMs: 123456.7, asymMs: [140, 90, 60], stepMs: 21.33, t0Ms: 812.4, outMs: 11.6 },
  { seed: 2, offMs: -98765.4, asymMs: [12, 5, 2], stepMs: 5.33, t0Ms: 2310.9, outMs: 5.8 },
  { seed: 3, offMs: 5555.5, asymMs: [70, 40, 25], stepMs: 42.67, t0Ms: 1503.2, outMs: 23.2 },
];
// old 0.4.5 estimator update rule (first sample taken, then 0.1 ms/s slew under 5 ms)
class OldEst extends R.OffsetEstimator { add(t0, t1, t2, t3) { const rtt = (t3 - t0) - (t2 - t1); const off = ((t1 - t0) + (t2 - t3)) / 2; this.samples.push({ rtt, off }); if (this.samples.length > this.keep) this.samples.shift();
  const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 4))); const target = best.reduce((s, x) => s + x.off, 0) / best.length;
  if (this.offsetUs == null || Math.abs(target - this.offsetUs) > 5000) this.offsetUs = target; else this.offsetUs += Math.max(-100, Math.min(100, (target - this.offsetUs) * 0.5)); this.rttUs = best[0].rtt; return true; } }
function launch(L, { fixed }) {
  const r = rng(L.seed), est = fixed ? new R.OffsetEstimator() : new OldEst();
  let perf = 3000;   // ms (the context is running by now)
  for (let i = 0; i < 12; i++) { const up = 4 + r() * 2 + (L.asymMs[i] || 0), down = 4 + r() * 2; const t0 = perf, t1 = (t0 + up) + L.offMs, t2 = t1 + 0.05, t3 = t0 + up + 0.05 + down;
    est.add(t0 * 1000, t1 * 1000, t2 * 1000, t3 * 1000); perf += fixed ? 60 : 70; }
  // AudioContext: currentTime = floor((perf - t0) / step) * step, i.e. it steps once per IO buffer
  const ctxAt = pm => Math.max(0, Math.floor((pm - L.t0Ms) / L.stepMs) * L.stepMs) / 1000; perf += r() * 7;
  const reads = []; if (fixed) { const s = perf; while (perf - s < 80) { reads.push({ ctxSec: ctxAt(perf), perfMs: perf }); perf += 0.02; } } else for (let i = 0; i < 6; i++) { reads.push({ ctxSec: ctxAt(perf), perfMs: perf }); perf += 0.004; }
  const pair = fixed ? R.pairClocksEdge(reads) : R.pairClocks(reads);
  const ctx = { baseLatency: L.outMs / 1000, outputLatency: 0 };   // Safari: baseLatency only
  const userDelayMs = 0, serverUs = (perf + 500 + L.offMs) * 1000;
  const start = R.ctxTimeFor(serverUs, { pair, offsetUs: est.offsetUs, latencyMs: userDelayMs, outputLatencySec: fixed ? R.outputDelaySec(ctx) : 0 });
  const heardPerfMs = L.t0Ms + start * 1000 + L.outMs, wantPerfMs = serverUs / 1000 - L.offMs;
  return heardPerfMs - wantPerfMs;
}
test('F44: 3 launches, one fixed user delay -> heard within 3 ms of server time each launch', () => {
  const errs = LAUNCHES.map(L => launch(L, { fixed: true }));
  console.log('# new errs ms', errs.map(e => e.toFixed(2)).join(' ')); for (const e of errs) assert.ok(Math.abs(e) < 3, `error ${e.toFixed(2)} ms`);
  assert.ok(Math.max(...errs) - Math.min(...errs) < 4, `spread ${errs.map(e => e.toFixed(2))}`);
});
test('F44: the 0.4.5 maths reproduces a launch-dependent error (root cause)', () => {
  const errs = LAUNCHES.map(L => launch(L, { fixed: false }));
  console.log('# old errs ms', errs.map(e => e.toFixed(1)).join(' ')); assert.ok(Math.max(...errs) - Math.min(...errs) > 10, `old spread only ${errs.map(e => e.toFixed(2))}`);
});
test('F44: pairClocksEdge pairs on the step, falls back without one; outputDelaySec prefers outputLatency', () => {
  const p = R.pairClocksEdge([{ ctxSec: 1, perfMs: 10 }, { ctxSec: 1, perfMs: 10.5 }, { ctxSec: 1.02, perfMs: 10.52 }]); assert.equal(p.edge, true); assert.ok(Math.abs(p.perfUs - 10510) < 1);
  assert.equal(R.pairClocksEdge([{ ctxSec: 1, perfMs: 10 }, { ctxSec: 1, perfMs: 11 }]).edge, undefined);
  assert.equal(R.outputDelaySec({ outputLatency: 0.02, baseLatency: 0.005 }), 0.02); assert.equal(R.outputDelaySec({ outputLatency: 0, baseLatency: 0.005 }), 0.005); assert.equal(R.outputDelaySec({}), 0);
});
test('F44: OffsetEstimator.reset forgets; start/resume/visibility/statechange all re-measure (room.js)', async () => {
  const e = new R.OffsetEstimator(); e.add(0, 5000, 5100, 10000); e.reset(); assert.equal(e.offsetUs, null); assert.equal(e.samples.length, 0);
  const { readFileSync } = await import('node:fs'); const s = readFileSync(`${js}/room.js`, 'utf8');
  for (const w of ["resync('start')", "resync('visible')", "'ctx ' + this._lastSt + '>running'", 'wavwiz.sync.log', 'outputDelaySec(this.ctx)']) assert.ok(s.includes(w), w);
});
