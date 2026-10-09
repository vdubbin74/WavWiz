// WavWiz 0.2.1 (F1-F20): the user's 0.2.0 test feedback.
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
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('0.2.1 F5: the Library filter box is never re-created or re-parented while typing; filtering is debounced', () => {
  const l = src('library.js');
  assert.doesNotMatch(l, /head\.replaceChildren\(h\('div', \{ class: 'row libhead' \}/, 'the header row (holding the filter box) is no longer rebuilt per draw');
  assert.match(l, /tabsSlot\.replaceChildren\(tabs\(\)\)/);
  assert.match(l, /const placeSearch = parent => \{\s*if \(searchField\.parentElement === parent\) return;/);
  assert.match(l, /search\.focus\(\{ preventScroll: true \}\); try \{ search\.setSelectionRange\(a, b\)/);
  assert.match(l, /search\._t = setTimeout\([^]*?, 250\)/);
  assert.match(css, /\.libtabslot\{display:contents\}/);
});

test('0.2.1 F16: a silent install returns 9 (not 0) when the final setup step fails or hangs; documented', () => {
  const iss = readFileSync(new URL('../../installer/WavWiz.iss', import.meta.url), 'utf8');
  assert.match(iss, /function GetCustomSetupExitCode: Integer;\s*begin\s*if SetupFailed then Result := 9 else Result := 0;/);
  assert.match(iss, /or \(Code <> 0\) then\s*begin\s*SetupFailed := True;/);    // both "hung / never reported" and a non-zero script exit set it
  const doc = readFileSync(new URL('../../docs/INSTALLER.md', import.meta.url), 'utf8');
  assert.match(doc, /`9` the files were copied but the final setup step/); assert.doesNotMatch(doc, /the installer still returns `0`/);
});

test('0.2.1 F1: Devices header = collapse arrow + separate Expand button (no size toggle, no cycling); Esc returns', async () => {
  const d = await imp('devices');
  assert.equal(d.nextSize, undefined); assert.equal(d.SIZE_LABEL, undefined);
  assert.equal(d.arrowSize('standard'), 'collapsed'); assert.equal(d.arrowSize('expanded'), 'collapsed'); assert.equal(d.arrowSize('collapsed'), 'standard');
  assert.equal(d.expandSize('standard'), 'expanded'); assert.equal(d.expandSize('collapsed'), 'expanded'); assert.equal(d.expandSize('expanded'), 'standard');
  const s = src('devices.js'), m = src('main.js');
  assert.doesNotMatch(s, /segsize/); assert.doesNotMatch(css, /segsize/);
  assert.match(s, /class: 'plus devcol'/); assert.match(s, /class: 'plus devexp'/); assert.match(s, /ctl\.toggleDevExpanded/);
  assert.match(m, /function toggleDevExpanded\(force\)/); assert.match(m, /setDevSize\(arrowSize\(devp\.size\)\)/);
  assert.match(m, /else if \(desk\.classList\.contains\('devexpanded'\)\) toggleDevExpanded\(false\)/);
  assert.match(css, /\.desk\.devexpanded \.devpanel \.pane-h \.eschint\{display:inline-block\}/);
});

test('0.2.1 F2: no "Expanded library" menu item; Browse library always opens the Expanded Library', () => {
  const menu = src('menu.js');
  assert.doesNotMatch(menu, /'Expanded library'/);
  assert.match(menu, /const browseLib = \(\) => \(desktop && wideNow\(\) && ctl\.toggleLibExpanded \? ctl\.toggleLibExpanded\(true\) : go\('library'\)\)/);
});

test('0.2.1 F3: no VISUALIZER title and no look-name label on the visualizer panel; the small buttons stay', () => {
  const n = src('now.js');
  assert.doesNotMatch(n, /'VISUALIZER'/); assert.doesNotMatch(n, /np-vlabel/); assert.doesNotMatch(n, /vlabel\.textContent/);
  assert.match(n, /const vizPanel = h\('section', \{ class: 'np-vizpanel', 'aria-label': 'Visualizer' \}, stage\);/);
  assert.match(n, /'Looks'/); assert.match(n, /'Full screen visualizer'/); assert.match(n, /'Open the visualizer in its own window'/);
});

test('0.2.1 F4: Expanded Library opens in tiles on every tab (Large), list toggle remembered per tab, the narrow panel keeps its own choice', async () => {
  const L = await imp('libsort');
  const st = memStore(); const p = L.loadLibPrefs(st);
  assert.equal(p.defView, 'grid'); assert.equal(p.tileSize, 'large'); assert.equal(p.remember, true); assert.equal(p.defSort, 'artist'); assert.equal(p.compactView, 'list');
  for (const k of ['albums', 'artists', 'genres', 'years', 'recent', 'folders', 'favorites']) assert.equal(L.tabView(p, k), 'grid', k);
  assert.equal(L.tabView(p, 'songs'), 'list');
  p.views.genres = 'list'; L.saveLibPrefs(p, st); const q = L.loadLibPrefs(st);
  assert.equal(L.tabView(q, 'genres'), 'list'); assert.equal(L.tabView(q, 'albums'), 'grid');                // remembered per tab
  q.remember = false; assert.equal(L.tabView(q, 'genres'), 'grid'); assert.equal(L.tabView(q, 'genres', { genres: 'list' }), 'list');   // not remembered: session only
  const old = memStore(); old.setItem('wavwiz.libprefs.v1', JSON.stringify({ view: 'grid', sort: {}, flip: {} }));
  const o = L.loadLibPrefs(old); assert.equal(o.compactView, 'grid'); assert.equal(L.tabView(o, 'artists'), 'grid');  // 0.2.0 save carries over to the narrow panel
  L.saveLibPrefs(o, old); assert.equal(JSON.parse(old.getItem('wavwiz.libprefs.v1')).view, undefined);
  const r = L.resetLibView({ ...q, tileSize: 'small', defView: 'list', views: { albums: 'list' } }); assert.equal(r.tileSize, 'large'); assert.equal(r.defView, 'grid'); assert.deepEqual(r.views, {});
  const l = src('library.js');
  for (const t of ['artistTile', 'genreTile', 'yearTile', 'folderTile']) assert.match(l, new RegExp(`list\\('\\w+', [^)]*\\)?, ${t}\\)|, ${t}\\)`), t);
  assert.match(l, /tabView\(P, kind, session\) === 'grid'/); assert.match(l, /root\.dataset\.tiles = P\.tileSize/);
  assert.match(css, /\.lib\.expanded \.tilegrid\{grid-template-columns:repeat\(auto-fill,minmax\(var\(--tmin\),1fr\)\)/);
  const lib = L; assert.deepEqual(lib.blockColors('Jazz'), lib.blockColors('Jazz')); assert.notDeepEqual(lib.blockColors('Jazz'), lib.blockColors('Folk'));
});
