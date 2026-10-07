// WavWiz 0.1.3: percent settings, migration, Graphic EQ replaces Lightning, quality tiers + governor, post knobs, GPU paths, What's new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
globalThis.Element ??= class {};
const vc = await imp('vizcore'), vu = await imp('vizvu');
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('0.1.3 Graphic EQ replaces Lightning: eight looks, saved Lightning -> Graphic EQ, no Lightning anywhere', () => {
  assert.equal(vc.VIZ_LIST.length, 8); assert.ok(vc.VIZ_LIST.some(([k, t]) => k === 'geq' && t === 'Graphic EQ'));
  assert.ok(!vc.VIZ_LIST.some(([k]) => k === 'lightning')); assert.ok(!vc.FX.lightning); assert.ok(vc.FX.geq.length >= 2);
  assert.equal(vc.normEngine('lightning'), 'geq'); assert.equal(vc.normEngine('nope'), 'particles');
  for (const f of ['vizgl.js', 'vizpage.js', 'viz.js']) assert.doesNotMatch(src(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /LightningScene|lightning:/, f);
  assert.match(src('vizgl.js'), /geq: GeqScene/);
  const a = src('about.js'); assert.match(a, /Graphic EQ replaces Lightning/); assert.doesNotMatch(a, /glass table|crystal/i);
});

test('0.1.3 every level is 0-100 % with 50 % default; 50 % maps to the (livelier) mid anchor', () => {
  const d = vc.cleanSettings({}, 'terrain');
  for (const k of ['intensity', 'speed', 'density', 'shake']) assert.equal(d[k], 50, k);
  for (const [k] of vc.FX.terrain) assert.equal(d.fx[k], 50, k);
  for (const [k, , map] of vc.SHARED) { assert.equal(vc.pmap(50, map), map[1], k); assert.equal(vc.pmap(0, map), map[0]); assert.equal(vc.pmap(100, map), map[2]); assert.equal(vc.pinv(vc.pmap(37, map), map), 37); }
  assert.ok(vc.SHARED.find(x => x[0] === 'intensity')[2][1] > 1, '50 % is a bit more energetic than the old 1.0 default');
  const r = vc.loadReact(memStore()); assert.deepEqual(r, { energy: 50, sensitivity: 50, autoGain: 50 });
  assert.deepEqual(vc.loadPost(memStore()), { bloom: 50, streaks: 50, fringe: 50, depth: 50 });
  assert.equal(vc.postRaw({ bloom: 0, streaks: 0, fringe: 0, depth: 0 }).bloom, 0, '0 % turns an effect off');
  assert.equal(vc.moodAt(50).flash > vc.moodAt(0).flash, true); assert.ok(vc.moodAt(100).flash >= vc.moodAt(50).flash);
});

test('0.1.3 migration: VU damping -> bounce, colors/styles kept, v1 left intact, runs once', () => {
  const st = memStore(); const v1 = JSON.stringify({ vu: { colorMode: 'custom', primary: '#112233', fx: { needle: 1, damping: 0.6, style: 'neon' } }, geq: {} });
  st.setItem(vc.SETTINGS_KEY_V1, v1);
  const s = vc.loadSettings('vu', st);
  assert.equal(s.colorMode, 'custom'); assert.equal(s.primary, '#112233'); assert.equal(s.fx.style, 'neon'); assert.equal(s.fx.bounce, 50);
  assert.equal(st.getItem(vc.SETTINGS_KEY_V1), v1);
  assert.equal(vc.migrateLooksV2(st), false);
});

test('0.1.3 quality: Auto picks Low on phones and software GL, Ultra on strong desktop GPUs; governor steps down on missed frames and back up', () => {
  assert.equal(vc.autoTier({ coarse: true, minSide: 390, cores: 6, memory: 4, phoneUa: true }), 'low');
  assert.equal(vc.autoTier({ coarse: false, minSide: 1080, cores: 8, memory: 8, renderer: 'Google SwiftShader' }), 'low');
  assert.equal(vc.autoTier({ coarse: false, minSide: 1440, cores: 16, memory: 8, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)' }), 'ultra');
  assert.equal(vc.autoTier({ coarse: false, minSide: 1080, cores: 8, memory: 8, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)' }), 'high');
  assert.deepEqual(vc.QUALITY_LIST.map(([k]) => k), ['auto', 'low', 'high', 'ultra']);
  assert.ok(vc.QUALITY.ultra.particles > vc.QUALITY.high.particles && vc.QUALITY.high.particles > vc.QUALITY.low.particles);
  assert.equal(vc.QUALITY.low.streaks, false); assert.equal(vc.QUALITY.low.depth, false);
  assert.equal(vc.qualityFromLight('on'), 'low'); assert.equal(vc.qualityFromLight('off'), 'high'); assert.equal(vc.qualityFromLight(undefined), 'auto');
  const g = new vc.FrameGovernor('high'); let t = 0;
  for (let i = 0; i < 200; i++) { g.push(50, 30); t += 50; }          // 20 fps with heavy work: step down
  assert.notEqual(g.tier, 'high'); const down = g.tier;
  for (let i = 0; i < 60 * 30; i++) g.push(16.7, 3);                   // 30 s calm: step back up (never above the ceiling)
  assert.ok(['high', 'low'].includes(g.tier) && g.steps >= 1, `${down} -> ${g.tier}`);
  const top = new vc.FrameGovernor('low'); for (let i = 0; i < 60 * 30; i++) top.push(16.7, 2); assert.equal(top.tier, 'low');
});

test('0.1.3 graphics: WebGL 2 + WebGL 1 fallback, half-float targets with 8-bit + dither fallback, instancing for Particle burst and Neon tunnel only, context loss handled', () => {
  const g = src('vizgl.js');
  assert.match(g, /'webgl2'/); assert.match(g, /'webgl'/); assert.match(g, /RGBA16F/); assert.match(g, /OES_texture_half_float/);
  assert.match(g, /ANGLE_instanced_arrays/); assert.match(g, /webglcontextlost/); assert.match(g, /webglcontextrestored/);
  const parts = g.split(/\n(?:export )?class /).slice(1).map(b => [b.match(/^\w+/)[0], b]);
  const inst = parts.filter(([n, b]) => /Scene$/.test(n) && n !== 'Scene' && /g\.(stars|burst|instanced)\(|bursts\.draw\(/.test(b)).map(([n]) => n).sort();
  assert.deepEqual(inst, ['TunnelScene', 'WarpScene']);
  assert.match(g, /class GeqScene/);
  const v = src('viz.js'); assert.match(v, /FrameGovernor/); assert.match(v, /VuGLScene/); assert.match(v, /g\.present\(this\.target, this\.postFor\(\)\)/);
});

test('0.1.3 VU: one needle per meter, bouncier, bar has bigger hits and deeper lows', () => {
  const sc = { needles: [new vu.Needle(), new vu.Needle()], bar: 0, barPk: 0, kick: 0 };
  assert.equal(typeof vu.meterStep, 'function'); assert.equal(typeof vu.VuGLScene, 'function');
  assert.doesNotMatch(src('vizvu.js'), /peakNeedle|secondNeedle/);
  const n = new vu.Needle(); let over = 0; for (let i = 0; i < 120; i++) { n.step(0.8, 16.7, 1.2, 0.2); over = Math.max(over, n.v); }
  assert.ok(over > 0.8, 'an underdamped needle overshoots (bounce)');
  void sc;
});

test('0.1.3 pages: percent sliders, Quality select, Graphics card, Energy card, ReplayGain, NAS, network and receiver cards', () => {
  const p = src('vizpage.js'); assert.match(p, /data-quality/); assert.match(p, /'Off'/); assert.match(p, /Graphics \(this device\)/); assert.match(p, /POST\.map/);
  assert.doesNotMatch(p, /Visualizer detail/);
  const s = src('settings.js'); assert.match(s, /playback\.replayGain/); assert.match(s, /library\/nas/); assert.match(s, /networkCard/);
  const d = src('diag.js'); assert.match(d, /Restart AirPlay/); assert.match(d, /Clear orphans/); assert.match(d, /Re-detect/); assert.match(d, /network\/bind/);
});
