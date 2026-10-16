// WavWiz 0.3.7 - pure logic + markup checks. Browser behavior: tests/ui/ui037.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR, web = join(js, '..');
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(web, 'app.css'), 'utf8');

test('L27 locking the queue locks sort orders; unlocking gives them back', async () => {
  const m = await imp('plcols');
  const un = { locked: false }, lk = { locked: true };
  let s = m.applySort(un, null, 'title'); assert.deepEqual(s, { id: 'title', dir: 'asc' });
  s = m.applySort(un, s, 'title'); assert.deepEqual(s, { id: 'title', dir: 'desc' });
  const held = s;
  assert.equal(m.applySort(lk, held, 'artist'), held, 'a locked queue ignores a sort click');
  assert.equal(m.applySort(lk, null, 'artist'), null);
  assert.equal(m.sortAllowed(lk), false); assert.equal(m.sortAllowed(un), true);
  assert.deepEqual(m.applySort(un, held, 'artist'), { id: 'artist', dir: 'asc' }, 'unlocked again: sorting works');
  assert.match(m.SORT_LOCK_HINT, /locked/i);
  const t = src('listtable.js');
  assert.match(t, /sortlocked/); assert.match(t, /aria-disabled/); assert.match(t, /plp-sort/); assert.match(t, /disabled: L\.locked, title: L\.locked \? SORT_LOCK_HINT/);
  assert.match(css, /th\.sortlocked/);
});

test('L26 confidence shown only as a real 0-100 %', async () => {
  const m = await imp('calibrate');
  assert.equal(m.confPct(0.92), 92); assert.equal(m.confPct(68), 100); assert.equal(m.confPct(160), 100); assert.equal(m.confPct(-3), 0);
  assert.equal(m.confPct(NaN), null); assert.equal(m.confText(undefined), '—'); assert.equal(m.confText(0.234), '23%');
});

test('L5/L8/L11/L23 shortcuts: max 3 pins, Home far right, pins stack leftward, order is remembered', async () => {
  const m = await imp('shortcuts');
  assert.equal(m.MAX_PINS, 3);
  assert.deepEqual(m.cleanPins(['eq', 'eq', 'nope', 'queue', 'library', 'devices']), ['eq', 'queue', 'library']);
  let r = m.togglePin([], 'eq'); r = m.togglePin(r.pins, 'queue'); r = m.togglePin(r.pins, 'scenes'); assert.deepEqual(r.pins, ['eq', 'queue', 'scenes']);
  const full = m.togglePin(r.pins, 'sleep'); assert.equal(full.full, true); assert.deepEqual(full.pins, r.pins, 'a 4th pin changes nothing');
  assert.deepEqual(m.togglePin(r.pins, 'queue').pins, ['eq', 'scenes'], 'pin again = unpin');
  // the first pinned is closest to Home: DOM order left->right is last pin ... first pin, separator, Home
  assert.deepEqual(m.rowOrder(['eq', 'queue', 'scenes']).map(x => x.id || x.kind), ['scenes', 'queue', 'eq', 'sep', 'home']);
  assert.deepEqual(m.rowOrder([]).map(x => x.kind), ['home'], 'no pins: just Home, no separator');
  assert.deepEqual(m.movePin(['eq', 'queue', 'scenes'], 0, 2), ['queue', 'scenes', 'eq']);
  const store = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
  m.savePins(['queue', 'eq', 'bogus'], store); assert.deepEqual(m.loadPins(store), ['queue', 'eq']);
  for (const id of ['eq', 'queue', 'library', 'devices', 'scenes', 'alarms', 'sleep', 'settings']) assert.ok(m.pinInfo(id), id);
});

test('L1/L4/L17 every EQ / Queue / shortcut entry point goes through the shared front-and-glide functions', () => {
  const main = src('main.js'), now = src('now.js'), menu = src('menu.js'), mini = src('mini.js');
  assert.match(main, /export function showEq/); assert.match(main, /export function runShortcut/); assert.match(main, /export function goHome/);
  assert.match(main, /openEq: \(\) => showEq\(\)/); assert.match(main, /if \(k === 'eq'\) return showEq\(\)/);
  assert.doesNotMatch(main.replace(/\/\*[\s\S]*?\*\//g, ''), /openEq\(S, refreshAll\)\s*[;}]\s*\n\s*if \(S\.view/, 'the phone go(eq) no longer opens the popup');
  assert.match(now, /onclick: \(\) => ctl\.openEq\(\)/); assert.match(now, /mkSc\('np-sc'\)/); assert.match(now, /mkSc\('npb-sc'\)/);
  assert.match(main, /if \(P6\.exp === 'dev'\) setPanels\(\{ \.\.\.P6, exp: null \}/);   // L17 queue from an expanded Devices view
  assert.match(menu, /pin: 'eq'/); assert.match(menu, /pin: 'queue'/); assert.match(mini, /shortcutsRow/); assert.match(mini, /sendToMain/);
  assert.match(css, /\.scrow/); assert.match(css, /\.schome/);
});
