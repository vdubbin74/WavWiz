// WavWiz 0.7.3: Auto pre-gain no longer turns the whole track down by the full boost (browser path, roomeq.js), kept in step with
// WavWiz.Dsp DspProgram.cs; the browser has a soft clip guard instead of the PC Player's peak limiter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const repo = new URL('../../', import.meta.url);
const cs = p => readFileSync(new URL(p, repo), 'utf8');
const BASS_BOOST = { graphicDb: [5, 4, 2, 1, 0, -1, 0, 1, 2, 1], bass: { gainDb: 3, hz: 90 } };

test('0.7.3 Bass Boost keeps 1 kHz within -5 dB (and the built-in still has those values)', async () => {
  const { eqPlan, planResponseDb } = await imp('roomeq');
  assert.match(cs('src/WavWiz.Server/Dsp/DspService.cs'), /"Bass Boost", new DspPreset \{ GraphicDb = new double\[\] \{ 5, 4, 2, 1, 0, -1, 0, 1, 2, 1 \}, Bass = new ShelfSettings\(3, 90\) \}/);
  const p = eqPlan({ preset: BASS_BOOST });
  assert.ok(planResponseDb(p, 1000) >= -5, '1 kHz ' + planResponseDb(p, 1000));
  assert.ok(p.preGainDb <= -3 && p.preGainDb >= -4.5, 'pre-gain ' + p.preGainDb);
});

test('0.7.3 Bass and Treble +12 cost about 6 dB (half the 40 Hz-12 kHz peak), not 12; cuts cost nothing', async () => {
  const { eqPlan, autoCutDb } = await imp('roomeq');
  const p = eqPlan({ preset: { bass: { gainDb: 12, hz: 100 }, treble: { gainDb: 12, hz: 10000 } } });
  assert.ok(p.preGainDb >= -6 && p.preGainDb <= -5.5, 'pre-gain ' + p.preGainDb);
  assert.equal(eqPlan({ preset: { bass: { gainDb: -12, hz: 100 } } }).preGainDb, 0);
  assert.equal(eqPlan({ preset: { bass: { gainDb: -12, hz: 100 } } }).guard, false, 'a cut needs no clip guard');
  assert.deepEqual([autoCutDb(40), autoCutDb(-3), autoCutDb(NaN), autoCutDb(4)], [6, 0, 0, 2]);
});

test('0.7.3 Loudness at 40% raises 50 Hz by 3 dB or more and does not move the pre-gain', async () => {
  const { eqPlan, planResponseDb } = await imp('roomeq');
  const on = eqPlan({ preset: { loudness: { enabled: true, refVolume: 80 } } }, 40);
  assert.ok(planResponseDb(on, 50) >= 3, '50 Hz ' + planResponseDb(on, 50));
  assert.equal(on.preGainDb, 0);
  const bb = eqPlan({ preset: BASS_BOOST }, 40), bbl = eqPlan({ preset: { ...BASS_BOOST, loudness: { enabled: true, refVolume: 80 } } }, 40);
  assert.equal(bbl.preGainDb, bb.preGainDb);
});

test('0.7.3 soft clip guard: exact below -1.9 dBFS, smooth, never above the -0.3 dBFS ceiling', async () => {
  const { softClip, softClipCurve, CLIP_KNEE, CLIP_CEIL, CLIP_RANGE } = await imp('roomeq');
  for (const x of [0, 0.1, -0.5, 0.8, -CLIP_KNEE]) assert.equal(softClip(x), x);
  let prev = -Infinity;
  for (let x = -12; x <= 12; x += 0.001) { const y = softClip(x); assert.ok(Math.abs(y) <= CLIP_CEIL, `x ${x} -> ${y}`); assert.ok(y >= prev - 1e-12, 'monotonic'); prev = y; }
  assert.equal(softClip(NaN), 0); assert.ok(softClip(Infinity) <= CLIP_CEIL);
  const c = softClipCurve(); assert.equal(c.length % 2, 1); assert.equal(c[(c.length - 1) / 2], 0);
  assert.ok(Math.max(...c.map(Math.abs)) <= CLIP_CEIL + 1e-7); assert.ok(CLIP_RANGE >= 4, 'covers a +12 dB overshoot');
  // slope 1 at the knee (no kink)
  const d = 1e-6, s = (softClip(CLIP_KNEE + d) - softClip(CLIP_KNEE)) / d; assert.ok(Math.abs(s - 1) < 1e-3, 'slope ' + s);
});

test('0.7.3 EqChain puts the guard last (pre-scale + WaveShaper, no oversampling = no added delay)', async () => {
  const s = readFileSync(`${js}/roomeq.js`, 'utf8');
  assert.match(s, /if \(plan\.guard\) \{/); assert.match(s, /ws\.oversample = 'none'/); assert.match(s, /pre\.gain\.value = 1 \/ CLIP_RANGE/);
  assert.ok(s.indexOf('if (plan.guard)') > s.indexOf('createChannelMerger'), 'after balance');
});

test('0.7.3 the Player (DspProgram.cs) and the browser (roomeq.js) use the same pre-gain rule', async () => {
  const r = await imp('roomeq'), d = cs('src/WavWiz.Dsp/DspProgram.cs');
  assert.match(d, /AutoScanLoHz = 40, AutoScanHiHz = 12000, AutoMaxCutDb = 6/);
  assert.deepEqual([r.AUTO_LO_HZ, r.AUTO_HI_HZ, r.AUTO_MAX_CUT_DB], [40, 12000, 6]);
  assert.match(d, /Math\.Min\(AutoMaxCutDb, 0\.5 \* Math\.Max\(0, peakDb\)\)/);
  assert.match(d, /for \(int i = 0; i < 12; i\+\+\) if \(Active\[i\]\)/, 'loudness shelves (12, 13) are left out');
  assert.match(d, /auto = -AutoCutDb\(UserPeakDb\(\)\)/);
});
