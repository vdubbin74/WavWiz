// WavWiz 0.3.3 - logic + markup checks (G1-G14). Browser behavior: tests/ui/ui033.mjs and tests/ui/jukebox033.mjs (Chromium).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');

test('G1: popup width = the live center column (zoom-corrected, fallback, viewport cap)', async () => {
  const { centerPopupWidth } = await imp('panels');
  assert.equal(centerPopupWidth(1000, 1000, 1920, 1), 1000);
  assert.equal(centerPopupWidth(1250, 1000, 1920, 1.25), 1000, 'a zoomed rect is brought back to CSS px');
  assert.equal(centerPopupWidth(0, 0, 1920, 1), 1140, 'center hidden: both-panels-open width');
  assert.ok(centerPopupWidth(5000, 5000, 1280, 1) <= 1248);
  assert.match(src('main.js'), /popupWidth\(window\.screen\?\.availWidth/);   /* 0.3.5 J1 */ assert.match(src('main.js'), /wavwiz:uiscale', centerW/);
  assert.match(css, /max-width:var\(--centerw/);
});
test('G2/G2b: previews at true width, scaled down, one per row, clipped', async () => {
  const ts = eval(src('nppreview.js').match(/export const thumbScale = (\([^\n]*\));/)[1].replace(/;$/, '')); assert.equal(ts(1100, 550), 0.5); assert.equal(ts(400, 800), 1, 'never scaled up');
  assert.match(src('nppreview.js'), /w = trueNpWidth\(\), s = thumbScale\(w, sw\)/); assert.match(src('nppreview.js'), /transform = s < 1 \? `scale\(\$\{s\}\)`/);
  assert.match(css, /\.pgrid-np\{grid-template-columns:minmax\(0,1fr\) !important\}/); assert.match(css, /\.pgrid-np \.npthumb\{overflow:hidden/);
  assert.match(css, /\.pgrid-theme\{grid-template-columns:repeat\(5/); assert.match(css, /vizgrid\{grid-template-columns:repeat\(4/); assert.match(css, /pgrid-eq\{grid-template-columns:repeat\(3/);
});
test('G3: Settings v2 colors - highlight tabs / Admin / focus, secondary headings + left line, primary on-state', () => {
  assert.match(css, /\.settings-dlg \.settings-nav button\.on\{color:var\(--hl/); assert.match(css, /\.settings-dlg \.admintag\{color:var\(--hl/);
  assert.match(css, /focus-visible\{outline:2px solid var\(--hl/); assert.match(css, /border-left:2px solid color-mix\(in srgb,var\(--accent2\)/);
  assert.match(css, /\.card>h3\{color:var\(--accent2-text,var\(--accent2\)\)!important/); assert.match(css, /\.switch input:checked\+span\{background:var\(--accent\)/);
  assert.match(css, /\.settings-dlg \.switch span::after\{background:var\(--dim\)\}/);
});
test('G4: mini player opacity 30-100 (default opaque), text fit, master mute icon-only', async () => {
  const m = await imp('minifit'); assert.equal(m.clampOpacity(10), 30); assert.equal(m.clampOpacity(150), 100); assert.equal(m.clampOpacity('x'), 100); assert.equal(m.OPACITY_DEFAULT, 100);
  const f = m.fitText(58, 10), f2 = m.fitText(38, 60); assert.ok(f.title >= f2.title && f2.title >= m.TITLE_MIN && f2.artist >= m.ARTIST_MIN);
  const s = src('mini.js'); assert.match(s, /send\('opacity'/); assert.match(s, /mouseenter', \(\) => \{ hover = true/); assert.match(s, /class: 'mutebtn mp-mute'/); assert.match(s, /\/zones\/mute-all/);
  assert.match(readFileSync(join(js, '../mini.css'), 'utf8'), /text-overflow:ellipsis/);
});
test('G5: expanded Playlist slides Now Playing up (FLIP, same timing) and stops the EQ / visualizer', () => {
  const m = src('main.js'); assert.match(m, /LIST_ANIM = GLIDE/); assert.match(m, /wavwiz:listcover/);
  assert.match(css, /\.desk\.listexpanded\{grid-template-rows:auto minmax\(0,1fr\)\}/); assert.match(css, /\.desk\.listexpanded \.nowcol\{grid-area:1\/2\/2\/3/);
  assert.match(src('now.js'), /center === 'eq' && !kioskOpen\(\) && !covered/);
});
test('G6-G10: Speakers wording, output line, groups, highlight, zone on, slim rows, E1 columns', async () => {
  const d = await imp('devices');
  assert.equal(d.SPEAKERS_LABEL, 'Speakers');
  assert.equal(d.outputTypeLine({ outputs: [{ active: true, kind: 'hdmi', name: 'DENON-AVR' }] }), 'HDMI · DENON-AVR');
  assert.equal(d.outputTypeLine({ outputs: [], outputUnavailable: true }), '⚠ Output unavailable');
  const zs = [{ id: 1, enabled: true }, { id: 2, enabled: false }, { id: 3, enabled: false }], gs = [{ id: 9, deviceIds: [1, 2] }];
  assert.deepEqual(d.speakerGroups(zs, gs).unassigned.map(z => z.id), [3]); assert.deepEqual(d.speakerGroups(zs, []).unassigned, []);
  assert.deepEqual([...d.zoneHighlight(gs, 9)], [1, 2]); assert.equal(d.zoneHighlight(gs, 'all'), null);
  assert.equal(d.zoneOn(zs, gs[0]), true); assert.equal(d.zoneOn(zs, { deviceIds: [2, 3] }), false);
  const s = src('devices.js'); assert.match(s, /'\+ Add to zone'/); assert.match(s, /' · not in any zone'/); assert.match(s, /reconcile\(emain, \[sscol, zcol, spcol, scol\]\)/   /* 0.3.5 J5 B */);
  assert.match(s, /ro\(h\('button', \{ type: 'button', class: 'btn sm saddzone'[^]*isAdmin\(S\)\)/, 'Add to zone is read-only for non-admins');
  assert.match(css, /\.devpanel \.dvol\{display:grid!important;grid-template-columns:minmax\(0,1fr\) 38px 28px/);
  assert.match(css, /\.dexp-main\.e1\{display:grid!important;grid-template-columns:340px minmax\(0,1fr\) 330px/);
});
test('G11: volume slider style - Gradient (default, theme colors) or Flat (primary), everywhere', async () => {
  const st = new Map(), store = { getItem: k => st.get(k) ?? null, setItem: (k, v) => st.set(k, v) };
  const s = await imp('sliderstyle'); assert.equal(s.loadSlider(store), 'gradient'); s.applySlider('flat', store); assert.equal(s.loadSlider(store), 'flat'); s.applySlider('nope', store); assert.equal(s.loadSlider(store), 'gradient');
  assert.equal(s.sliderTrack('gradient'), 'linear-gradient(90deg,var(--accent),var(--accent2))'); assert.equal(s.sliderTrack('flat'), 'var(--accent)'); // 0.3.4 H3: back to two colors
  assert.match(css, /:root\[data-slider=flat\]\{--voltrack:linear-gradient\(var\(--accent\),var\(--accent\)\)\}/);   // 0.3.4: a bare color in a non-final background layer is invalid (Flat drew no track) assert.match(css, /:is\(\.dvol,\.mp-vol,\.np-volrow,\.dmaster\)/);
  assert.match(src('appearance.js'), /'Volume slider style'/); assert.match(src('mini.js'), /import '\.\/sliderstyle\.js'/);
});
test('G12: reorder (multi-select block), server moves, undo, insertion index, auto-scroll, selection', async () => {
  const q = await imp('qdrag');
  assert.deepEqual(q.reorder(5, [1, 3], 5), [0, 2, 4, 1, 3]); assert.deepEqual(q.reorder(5, [4], 0), [4, 0, 1, 2, 3]); assert.deepEqual(q.reorder(4, [2], 2), [0, 1, 2, 3]);
  const apply = (n, mv) => { const a = [...Array(n).keys()]; for (const { from, to } of mv) { const [x] = a.splice(from, 1); a.splice(to, 0, x); } return a; };
  for (const [n, sel, t] of [[6, [0, 2, 5], 3], [5, [4, 1], 0], [7, [3], 7], [3, [0, 1, 2], 1]]) {
    const order = q.reorder(n, sel, t); assert.deepEqual(apply(n, q.movesFor([...Array(n).keys()], order)), order);
    const back = q.undoMoves(order); const w = order.slice(); for (const { from, to } of back) { const [x] = w.splice(from, 1); w.splice(to, 0, x); } assert.deepEqual(w, [...Array(n).keys()], 'Ctrl+Z restores');
  }
  const rows = [{ top: 0, bottom: 20 }, { top: 20, bottom: 40 }]; assert.equal(q.dropIndex(rows, 5), 0); assert.equal(q.dropIndex(rows, 25), 1); assert.equal(q.dropIndex(rows, 99), 2);
  assert.ok(q.edgeScroll(2, 0, 300) < 0); assert.ok(q.edgeScroll(298, 0, 300) > 0); assert.equal(q.edgeScroll(150, 0, 300), 0);
  assert.deepEqual(q.nextSelection([1], 3, { ctrl: true }), [1, 3]); assert.deepEqual(q.nextSelection([1, 3], 3, { ctrl: true }), [1]); assert.deepEqual(q.nextSelection([], 4, { shift: true }, 1), [1, 2, 3, 4]);
  const l = src('listtable.js'); assert.match(l, /api\('\/queue\/add', \{ method: 'POST', body: \{ \.\.\.JSON\.parse\(ref\), at: sort \? \(t < order\.length \? order\[t\] : S\.queue\.length\) : t \} \}\)/); assert.match(l, /if \(dragging\) return;/); assert.match(l, /ev\.key\.toLowerCase\(\) === 'z'/);
  assert.match(src('ui.js'), /Play next/);
});
test('G13: Jukebox dialogs use object buttons (keep on Start / Stop), non-admin toast, no array-form dialog() anywhere', () => {
  const k = src('jukebox-kiosk.js');
  assert.match(k, /\{ text: 'Start Jukebox', cls: 'primary', keep: true, onclick:/); assert.match(k, /'Stop Jukebox'\)\)|\{ text: 'Stop Jukebox', cls: 'danger', keep: true, onclick:/   /* 0.3.5 J9 #13: host panel, Stop keeps its confirm */);
  assert.match(k, /if \(!isAdmin\(S\)\) \{ toast\(/);
  for (const f of ['jukebox-kiosk.js', 'main.js', 'devices.js', 'settings.js', 'settingsui.js', 'about.js', 'scenesched.js', 'playlists.js', 'radiofinder.js', 'calibrate.js', 'eq.js'])
    assert.doesNotMatch(src(f), /dialog\([^;]*?,\s*\[\s*\[/, f + ': array-form dialog buttons');
});
test('G14: glow slider - no save / rebuild while dragging, save on change, Live only on 0 -> >0', async () => {
  const e = src('eq.js'); const oi = e.match(/'data-eqglow': '1', oninput: ev => \{[^}]*\}/)[0];
  assert.doesNotMatch(oi, /saveEqPrefs/); assert.match(e, /onchange: ev => \{ const v = \+ev\.target\.value; saveEqPrefs/);
  assert.match(e, /if \(s2 === builtStyle \|\| userDragging\(d\.el\)\) return;/);
  const m = await imp('eq'); assert.equal(m.glowWasOff(0, 5), true); assert.equal(m.glowWasOff(5, 6), false); assert.equal(m.glowWasOff(5, 0), false);
  const a = src('appearance.js').match(/'data-eqglow': '1',\s*oninput: ev => \{[^\n]*/)[0]; assert.doesNotMatch(a, /saveEqPrefs/);
});
test('0.3.3 What\'s new and version', async () => {
  const a = await imp('about'); assert.equal(/^0\.3\.[3-9]$/.test(a.WHATS_NEW_VERSION), true); assert.ok(a.WHATS_NEW.some(([t]) => t === 'Jukebox starts again'));
});
