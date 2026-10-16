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

test('L28 pair QR shows the server address as text; Add to Home Screen uses the existing manifest, with iOS + Android steps and an install prompt', () => {
  const st = src('settings.js'), tls = src('tls-setup.js');
  assert.match(st, /to=pair&code=/); assert.match(st, /Server address: http:\/\/\$\{i\.host\}:\$\{i\.httpPort\}/); assert.match(st, /pairqr-addr/);
  assert.match(tls, /beforeinstallprompt/); assert.match(tls, /a2hsInstall/); assert.match(tls, /display-mode: standalone/); assert.match(tls, /appinstalled/);
  const man = JSON.parse(readFileSync(new URL('../../src/WavWiz.Server/wwwroot/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(man.display, 'standalone'); assert.equal(man.start_url, '/');
  assert.ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512') && man.icons.some(i => i.purpose === 'maskable'));
  const idx = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/index.html', import.meta.url), 'utf8'); assert.match(idx, /rel="manifest"/); assert.match(idx, /apple-mobile-web-app-capable/);
});

test('L7 purpose-based presets are grouped; All sound settings is in place, one padlock locks it, Speaker settings embeds the same EQ', async () => {
  const m = await imp('eqsettings');
  const names = m.PRESET_GROUPS.flatMap(g => g[1]); assert.equal(names.length, 16);
  for (const n of ['Late Night', 'Party Loud', 'Background', 'Vocals / Podcasts', 'Movie Night', 'Bluetooth Speaker', 'Bookshelf', 'Tower', 'Subwoofer Zone', 'Headphones', 'Outdoor', 'Hip-Hop', 'Rock / Metal', 'Acoustic / Jazz', 'Electronic', 'Classical']) assert.ok(names.includes(n), n);
  const presets = [{ id: 1, name: 'Flat', source: 'builtin' }, { id: 2, name: 'Late Night', source: 'builtin' }, { id: 3, name: 'Hip-Hop', source: 'builtin' }, { id: 9, name: 'Kitchen sound', source: 'user' }, { id: 7, name: 'Old thing', source: 'builtin' }];
  const g = m.groupPresets(presets); assert.deepEqual(g.map(x => x.label), ['', 'Situation', 'Music', 'Other built-in', 'My sounds']); assert.equal(g[4].items[0].name, 'Kitchen sound');
  const c = src('centerview.js'); assert.match(c, /All sound settings/); assert.match(c, /eqpadlock/); assert.match(c, /saveEqLock\(!loadEqLock\(\)\)/); assert.match(c, /all\.setLocked\(locked \|\| !ok\)/);
  const e = src('eqsettings.js'); for (const w of ['Bass', 'Treble', 'Trim', 'Balance', 'Loudness', 'Limiter', 'Bypass', 'Auto pre-gain']) assert.match(e, new RegExp(`'${w}'`));
  assert.match(e, /Save as/); assert.match(src('devices.js'), /centerEq\(S, eqHost, \{ deviceId: cur\?\.deviceId \}\)/); assert.doesNotMatch(src('devices.js'), /openEq\(S, ctl\.refreshAll/);
});

test('L29 drag-to-reorder in every Queue view; a showing sort asks to apply it; the lock disables dragging', async () => {
  const q = await imp('qreorder');
  assert.deepEqual(q.moveFor(2, 0, 5), { from: 2, to: 0 }); assert.deepEqual(q.moveFor(1, 4, 5), { from: 1, to: 3 }); assert.deepEqual(q.moveFor(1, 5, 5), { from: 1, to: 4 });
  assert.equal(q.moveFor(2, 2, 5), null); assert.equal(q.moveFor(2, 3, 5), null); assert.equal(q.moveFor(9, 0, 5), null);
  assert.equal(q.canDragRows({ can: true, locked: false }), true); assert.equal(q.canDragRows({ can: true, locked: true }), false); assert.equal(q.canDragRows({ can: false, locked: false }), false);
  assert.equal(q.APPLY_SORT_Q, 'Apply this sort as the queue order?');
  const lt = src('listtable.js'), main = src('main.js');
  assert.match(lt, /dg = canDragRows\(\{ can, locked: L\.locked \}\)/); assert.doesNotMatch(lt, /dg = can && !sort/);
  assert.match(lt, /applySortAsOrder/); assert.match(lt, /APPLY_SORT_Q/);
  assert.match(main, /attachReorder\(list/); assert.match(main, /qgrip/); assert.match(main, /loadLayout\(true\)/);
  const qd = await imp('qdrag'); const sorted = [2, 0, 1], mv = qd.movesFor([0, 1, 2], sorted);   // applying a sort = these server moves
  const w = [0, 1, 2]; for (const m of mv) { const [x] = w.splice(m.from, 1); w.splice(m.to, 0, x); } assert.deepEqual(w, sorted);
});
