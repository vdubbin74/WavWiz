// WavWiz 0.3.0 §3: EQ is the default center view; toggle remembered; visualizer stops when hidden; Sound title; picker flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

test('0.3.0 §3.1: a 0.2.5 profile with the visualizer selected opens on EQ once; afterwards the device choice is kept', async () => {
  const c = await imp('centerview');
  const old = mem({ 'wavwiz.viz.v1': JSON.stringify({ on: true, engine: 'bars' }), [c.CENTER_KEY]: 'viz' });
  assert.equal(c.loadCenter(old), 'eq', 'migrated to EQ on the first 0.3.0 launch');
  c.saveCenter('viz', old); assert.equal(c.loadCenter(old), 'viz', 'the toggle is remembered per device');
  assert.equal(c.loadCenter(old), 'viz', 'the migration runs once');
  assert.equal(c.loadCenter(mem()), 'eq', 'fresh install: EQ');
  assert.equal(c.toggleLabel('eq'), 'Visualizer'); assert.equal(c.toggleLabel('viz'), 'EQ');
});
test('0.3.0 §3.3: the visualizer is created only while selected and destroyed when hidden / under the Jukebox screen', () => {
  const n = src('now.js');
  assert.match(n, /if \(!p\.on \|\| center !== 'viz' \|\| kioskOpen\(\) \|\| document\.hidden \|\| covered\) \{ if \(viz\) \{ viz\.destroy\(\); viz = null; \}/);   // 0.3.3 G5: also while the expanded Playlist covers it
  assert.match(n, /document\.addEventListener\('visibilitychange', \(\) => \{ ensureViz\(\)/);
  assert.match(n, /else if \(eqv\) \{ eqv\.destroy\(\); eqv = null; \}/, 'the EQ view (and its spectrum tap) goes away too');
  assert.match(n, /np-centertoggle/);
});
test('0.3.0 §3.4/3.5: "Sound · Kitchen" title, no picker in the Sound window, admin picker behind ui.eqOutputPicker (one place)', async () => {
  const e = await imp('eq'); assert.equal(e.soundTitle('Kitchen'), 'Sound · Kitchen');
  const q = src('eq.js'); assert.doesNotMatch(q, /outSel/); assert.doesNotMatch(q, /'aria-label': 'Speaker'/);
  const f = await imp('flags'); assert.equal(f.flag('ui.eqOutputPicker'), true, 'default ON'); assert.equal(f.flag('ui.eqOutputPicker', { 'ui.eqOutputPicker': false }), false);
  const cv = src('centerview.js'); assert.match(cv, /flag\('ui\.eqOutputPicker'\) && isAdmin\(S\)/);
  let hits = 0; for (const fn of ['main.js', 'now.js', 'eq.js', 'settings.js', 'menu.js', 'centerview.js']) hits += (src(fn).match(/eqOutputPicker/g) || []).length; assert.equal(hits, 1, 'used in exactly one place');
  const c = await imp('centerview'); const zones = [{ id: 1, name: 'Kitchen', outputs: [{ deviceId: 'k', name: 'Out', connected: true }] }, { id: 2, name: 'Den', outputs: [{ deviceId: 'd', name: 'Out', connected: true, active: true }] }];
  assert.deepEqual(c.pickerOutputs(zones, { id: 1 }).map(o => o.deviceId), ['k', 'd'], 'this Player’s own output first (the default)');
  assert.match(cv, /canTune\(S, zoneOf\(o\)\)/, 'same rights as the Sound dialog'); assert.match(cv, /loadEqLock\(\)/, 'respects Lock EQ');
});
