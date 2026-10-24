// WavWiz 0.4.3 #10: browser / phone / TV speaker EQ (roomeq.js, same math as the PC Player's DspProgram) and the zone-aware visualizer feed.
// tests/ui/eq043.mjs renders a tone through EqChain in a real browser (OfflineAudioContext) and measures the change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(2)} vs ${b}`);
const cut1k = { graphicDb: [0, 0, 0, 0, 0, -12, 0, 0, 0, 0] };

test('#10 eqPlan: no preset or a flat one runs no filters (idle and flat speakers do no DSP)', async () => {
  const { eqPlan } = await imp('roomeq');
  assert.equal(eqPlan(null), null); assert.equal(eqPlan({ preset: null }), null); assert.equal(eqPlan({ preset: {} }), null);
  assert.equal(eqPlan({ preset: { graphicDb: new Array(10).fill(0) } }), null);
});

test('#10 eqPlan: a -12 dB cut at 1 kHz lowers 1 kHz by 12 dB and leaves 100 Hz alone (cuts need no auto-preamp)', async () => {
  const { eqPlan, planResponseDb } = await imp('roomeq');
  const p = eqPlan({ preset: cut1k, bypass: false });
  assert.equal(p.filters.length, 1); assert.deepEqual([p.filters[0].type, p.filters[0].hz, p.filters[0].q], ['peaking', 1000, 1.4]);
  near(planResponseDb(p, 1000), -12, 0.05, '1 kHz'); near(planResponseDb(p, 100), 0, 0.2, '100 Hz'); assert.equal(p.preGainDb, 0);
});

test('#10 eqPlan: a boost gets the same auto-preamp as the PC Player (peak <= 0 dB), and PascalCase keys work too', async () => {
  const { eqPlan, planResponseDb } = await imp('roomeq');
  const p = eqPlan({ preset: { GraphicDb: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
  assert.ok(p.preGainDb < -5.5 && p.preGainDb > -6.2, 'auto-preamp ~ -6 dB: ' + p.preGainDb);
  let max = -99; for (let f = 20; f <= 20000; f *= 1.06) max = Math.max(max, planResponseDb(p, f)); assert.ok(max <= 0.01, 'never above 0 dB: ' + max);
  const noAuto = eqPlan({ preset: { graphicDb: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0], autoPreamp: false } }); assert.equal(noAuto.preGainDb, 0);
});

test('#10 eqPlan: bypass (config or preset) turns EQ/shelves/loudness off but keeps the trim; balance turns the far side down', async () => {
  const { eqPlan } = await imp('roomeq');
  assert.equal(eqPlan({ preset: cut1k, bypass: true }), null);
  const t = eqPlan({ preset: { ...cut1k, trimDb: -3, bypass: true } }); assert.equal(t.filters.length, 0); assert.equal(t.preGainDb, -3);
  const b = eqPlan({ preset: { balance: 50 } }); assert.deepEqual([b.left, b.right], [0.5, 1]);
  const l = eqPlan({ preset: { balance: -100 } }); assert.deepEqual([l.left, l.right], [1, 0]);
});

test('#10 eqPlan: shelves and loudness follow the preset and the volume; ranges are clamped like the server', async () => {
  const { eqPlan, loudnessGains } = await imp('roomeq');
  const s = eqPlan({ preset: { bass: { gainDb: 30, hz: 10 }, treble: { gainDb: -4, hz: 10000 }, autoPreamp: false } });
  assert.deepEqual(s.filters.map(f => [f.type, f.hz, f.gainDb]), [['lowshelf', 40, 12], ['highshelf', 10000, -4]]);
  assert.deepEqual(loudnessGains(80, 80), [0, 0]); assert.deepEqual(loudnessGains(0, 80), [10, 3]);
  assert.equal(eqPlan({ preset: { loudness: { enabled: true, refVolume: 80 } } }, 90), null, 'loudness above the reference = flat');
  assert.equal(eqPlan({ preset: { loudness: { enabled: true, refVolume: 80 } }, autoPreamp: false }, 40).filters.length, 2);
});

test('#10 coeffs: the RBJ peaking filter matches the server (gain at the center = the band gain)', async () => {
  const { coeffs, magDb } = await imp('roomeq');
  near(magDb(coeffs('peaking', 1000, -12, 1.4), 1000), -12, 1e-6, 'peak'); near(magDb(coeffs('lowshelf', 100, 6, 0.707), 20), 6, 0.3, 'low shelf');
  near(magDb(coeffs('highshelf', 10000, -6, 0.707), 20000), -6, 0.6, 'high shelf');
});

test('#10 EqChain: wires pre-gain -> biquads -> balance -> output, and goes straight through with no plan', async () => {
  const { EqChain, eqPlan } = await imp('roomeq');
  const made = []; const node = kind => { const n = { kind, outs: [], connect(t) { this.outs.push(t); return t; }, disconnect() { this.outs = []; }, gain: { value: 1 }, frequency: { value: 0 }, Q: { value: 0 }, type: '' }; made.push(n); return n; };
  const ctx = { createGain: () => node('gain'), createBiquadFilter: () => node('biquad'), createChannelSplitter: () => node('split'), createChannelMerger: () => node('merge') };
  const out = node('out'), ch = new EqChain(ctx, out);
  assert.deepEqual(ch.input.outs, [out]);
  ch.set(eqPlan({ preset: { ...cut1k, balance: 20 } }));
  const bq = made.filter(n => n.kind === 'biquad'); assert.equal(bq.length, 1); assert.equal(bq[0].type, 'peaking'); assert.equal(bq[0].gain.value, -12); assert.equal(bq[0].Q.value, 1.4);
  assert.equal(ch.input.outs[0], bq[0]); assert.equal(made.filter(n => n.kind === 'merge')[0].outs[0], out);
  ch.set(null); assert.deepEqual(ch.input.outs, [out]); assert.equal(ch.nodes.length, 0);
});

test('#10 room.js applies DspConfig (saved, preview, revert) through EqChain; music goes through the EQ', () => {
  const r = src('room');
  assert.match(r, /case MSG\.DspConfig: \{ this\.dsp = decodeJson\(f\.payload\); this\.applyEq\(\)/);
  assert.match(r, /new EqChain\(this\.ctx, this\.gain\)/); assert.match(r, /src\.connect\(this\.eq\?\.input \|\| this\.gain\)/);
  assert.doesNotMatch(r, /no EQ in this beta/);
});

test('#10 the visualizer feed names the zone this page controls and follows the zone picker', async () => {
  const { vizUrl } = await imp('viz');
  assert.equal(vizUrl(null), '/ws/viz?delayMs=0'); assert.equal(vizUrl('g:12'), '/ws/viz?delayMs=0&zoneId=g%3A12'); assert.equal(vizUrl('jukebox'), '/ws/viz?delayMs=0&zoneId=jukebox');
  assert.match(src('viz'), /addEventListener\?\.\('wavwiz:zone'/);
});
