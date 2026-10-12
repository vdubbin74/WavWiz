// WavWiz 0.3.1 fix pass (B1-B19, S1) - logic + markup checks. UI behavior is covered by tests/ui/ui031.mjs (Chromium / WebKit).
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
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const rule = sel => { const i = css.lastIndexOf(sel + '{'); assert.ok(i >= 0, 'css rule ' + sel); return css.slice(i, css.indexOf('}', i)); };

test('B18: EQ mode = Lock, swap, Looks, full screen; viz mode adds power + pop-out; no style button', async () => {
  const L = await imp('looks');
  assert.deepEqual(L.overlayButtons('eq'), ['lock', 'swap', 'looks', 'full']);
  assert.deepEqual(L.overlayButtons('viz'), ['lock', 'swap', 'looks', 'full', 'power', 'popout']);
  assert.deepEqual(L.overlayButtons('viz', { popout: false }), ['lock', 'swap', 'looks', 'full', 'power']);
  assert.deepEqual(L.looksRows('eq').map(r => r[1]), ['Glow', 'Overlay opacity', 'Button transparency']);
  assert.deepEqual(L.looksRows('viz').map(r => r[1]), ['Intensity', 'Overlay opacity', 'Speed', 'Button transparency']);
});
test('B18: Button transparency / Overlay opacity default 50 %, clamp 0..100, saved per device; ±1 / Shift ±10', async () => {
  const L = await imp('looks'); const s = mem();
  assert.deepEqual(L.loadLooks(s), { btn: 50, overlay: 50 });
  assert.deepEqual(L.saveLooks({ btn: 140, overlay: -3 }, s), { btn: 100, overlay: 0 }); assert.deepEqual(L.loadLooks(s), { btn: 100, overlay: 0 });
  assert.equal(L.btnOpacity(50), 0.5); assert.equal(L.btnOpacity(0), 1);
  assert.equal(L.stepPct(50, 1, false), 51); assert.equal(L.stepPct(50, -1, true), 40); assert.equal(L.stepPct(95, 1, true), 100);
});
test('B18: icon buttons 28x28, 16px icons, one stroke, theme variables only, 3px corners, active = accent outline (no fill)', () => {
  const b = rule('.stage .vbtns .ib');
  assert.match(b, /width:28px;height:28px/); assert.match(b, /border-radius:3px/); assert.match(b, /background:var\(--panel2\)/);
  assert.match(rule('.stage .vbtns .ib svg'), /width:16px;height:16px.*stroke-width:1.75/);
  const on = rule('.stage .vbtns .ib.on'); assert.match(on, /inset 0 0 0 1px var\(--accent\)/); assert.doesNotMatch(on, /background/);
  const grp = css.slice(css.indexOf('/* 0.3.1 B18'), css.indexOf('/* B17'));
  assert.doesNotMatch(grp, /#[0-9a-fA-F]{3,6}\b|rgba\(0,0,0|#fff|ffd54a/, 'no hard-coded black / white / yellow');
  const pop = rule('.looks-pop'); assert.match(pop, /width:300px/); assert.match(pop, /background:var\(--panel\)/); assert.match(pop, /border-top:2px solid var\(--accent\)/);
  assert.match(rule('.looks-pop.sheet'), /position:fixed;left:0;right:0;bottom:0/);
  const n = src('now.js'); assert.match(n, /'aria-label': label, title: label/); assert.match(n, /'Reset'/); assert.match(n, /'More…'/); assert.match(n, /ev\.key === 'Escape'/); assert.match(n, /ev\.key === 'Tab'/);
});
test('B17: glow / visualizer / backdrop layers are click-through; the button group sits above them; Lock EQ is in the group', () => {
  assert.match(css, /\.np-stage \.stagecover,\.np-stage \.vname,\.eqa-glow,\.eqa-grid,\.np-stage \.vizhost canvas\{pointer-events:none\}/);
  assert.match(rule('.stage .vbtns'), /z-index:6/); assert.match(css, /\.np-stage \.np-eqhost\{z-index:2\}/);
  assert.doesNotMatch(src('centerview.js'), /lock\.el/); assert.match(src('now.js'), /saveEqLock\(!loadEqLock\(\)\)/);
});
test('B18: Looks values are shared with Settings (EQ glow, the look\'s Intensity / Speed)', async () => {
  const s = mem(); globalThis.localStorage = s;
  const L = await imp('looks'); const E = await imp('eqstyle'); const V = await imp('vizcore');
  L.setLook('glow', 70); assert.equal(E.loadEqPrefs(s).glow, 70);
  L.setLook('intensity', 20, 'particles'); assert.equal(V.loadSettings('particles', s).intensity, 20);
  L.resetLooks('viz', 'particles'); assert.equal(V.loadSettings('particles', s).intensity, 50); assert.equal(L.loadLooks(s).btn, 50);
  assert.match(src('vizpage.js'), /'Button transparency'/);
  delete globalThis.localStorage;
});
test('B4/B6: every exit path repaints the Expand button (always rewrites the icon); labels Expand / Collapse (Esc)', async () => {
  const D = await imp('devices'); const I = await imp('icons');
  assert.ok(I.ICON_NAMES.includes('expandOut') && I.ICON_NAMES.includes('collapseIn'));
  const btn = { dataset: { icon: 'expandOut' }, innerHTML: '', attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; } };
  D.paintExpandBtn(btn, 'Library', true); assert.equal(btn.dataset.icon, 'collapseIn'); assert.equal(btn.attrs['aria-label'], 'Collapse (Esc)'); assert.equal(btn.attrs['aria-pressed'], 'true');
  btn.innerHTML = '⤡ Esc';   // the 0.3.0 bug: text replaced the icon while the remembered name stayed the same
  D.paintExpandBtn(btn, 'Library', false); assert.match(btn.innerHTML, /<svg/); assert.equal(btn.attrs['aria-label'], 'Expand'); assert.equal(btn.title, 'Expand');
  assert.doesNotMatch(src('main.js') + src('devices.js'), /⤡ Esc'/);
  // the panel model: every exit path leaves exp = null so applyPanels repaints "Expand"
  const P = await imp('panels'); const n = P.normPanels({});
  for (const k of ['lib', 'dev']) {
    const e = P.expand(n, k);
    assert.equal(P.esc(e).exp, null, 'Esc'); assert.equal(P.expand(e, k).exp, null, 'button'); assert.equal(P.chevron(e, k).exp, null, 'chevron');
    assert.equal(P.keyAction(e, { code: k === 'lib' ? 'BracketLeft' : 'BracketRight', target: {} }).exp, null, '[ ] key');
  }
});
test('B5: both rails put the chevron at the top and center icon + vertical title the same way', () => {
  assert.match(css, /\.israil \.pane-h\{order:0;margin:0/); assert.match(css, /\.israil \.prail\{order:1;justify-content:center\}/);
  assert.doesNotMatch(css, /\.israil \.pane-h\{order:2;margin-top:auto/);
});
test('B7/B8: master bar uses the device-row structure (slider, %, Mute slot) and Mute all is on its own line', () => {
  const d = src('devices.js');
  assert.match(d, /h\('div', \{ class: 'dvol dvol-master' \}, sl, pct, h\('span', \{ class: 'mutebtn dvol-slot', 'aria-hidden': 'true' \}\)\)/);
  assert.match(d, /h\('div', \{ class: 'dmaster-mute' \}, muteAllButton\(S, ctl\)\)/);
  assert.match(d, /h\('div', \{ class: 'dvol' \}, vol, pct, mute\)/, 'device rows: slider, %, round mute');
  assert.match(css, /\.dvol-slot\{visibility:hidden/);
});
test('B9: compact Scenes & Schedules: next event + countdown + Skip, Run chips, Open, + for admins only', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const D = await imp('devices');
  const rows = [{ id: 1, enabled: true, nextRunAt: '2026-10-13T07:00:00Z' }, { id: 2, enabled: true, nextRunAt: '2026-10-12T23:00:00Z' }, { id: 3, enabled: false, nextRunAt: '2026-10-12T20:00:00Z' }];
  assert.equal(D.nextEvent(rows).id, 2); assert.equal(D.nextEvent([]), null);
  const now = Date.parse('2026-10-12T21:00:00Z');
  assert.equal(D.ssCountdown('2026-10-12T23:05:00Z', now), 'in 2 h 5 m'); assert.equal(D.ssCountdown('2026-10-12T21:07:00Z', now), 'in 7 m'); assert.equal(D.ssCountdown('2026-10-12T20:00:00Z', now), 'now');
  const d = src('devices.js');
  assert.match(d, /admin \? h\('button', \{ type: 'button', class: 'plus zbtn dss-add'/, '+ only rendered for admins');
  assert.match(d, /\/schedules\/\$\{nx\.id\}\/skip/); assert.match(d, /\/scenes\/\$\{sc\.id\}\/apply/); assert.match(d, /'Open'/);
  assert.doesNotMatch(src('now.js'), /nextRunAt|countdown\(/, 'rule 6: Now Playing shows no next-event countdown');
});
test('B10/B11/B12: Settings shell - reset in a fixed slot of the sub-tab bar, pinned tab menu, fixed size, content scrolls inside', () => {
  const st = src('settings.js');
  assert.match(st, /for \(const sec of sections\) placeReset\(sec\);/); assert.match(st, /h\('div', \{ class: 'settings-scroll' \}, \.\.\.sections\)/);
  assert.match(st, /row\.append\(sub, h\('span', \{ class: 'subbar-slot' \}, btn\)\)/);
  assert.match(css, /\.subbar>\.subtabs\{flex:1 1 auto;min-width:0;margin:0!important\}/); assert.match(css, /\.subbar-slot\{flex:none/);
  assert.match(css, /dialog\.settings-dlg\{width:min\(1200px,calc\(calc\(100vw \/ var\(--z,1\)\) - 32px\)\);height:min\(860px/);
  assert.match(css, /\.settings-scroll\{flex:1;min-height:0;overflow-y:auto/);
  assert.match(css, /\.settings-body>\.settings-nav\{flex:none;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden/, 'no vertical scroll bar on the tabs');
  assert.doesNotMatch(css, /\.appnav\.subtabs\{[^}]*margin:-6px/, 'no negative margin pulling the sub-tabs under the reset bar');
});
test('B13-B16: one Appearance grid - per-row counts, 16:10 cards up to 170 px, 12 px gaps, check + theme border; live previews pause off screen', async () => {
  const G = await imp('pgrid');
  assert.deepEqual(G.GRID_COLS, { theme: 5, viz: 4, eq: 3, np: 2, display: 3 });
  assert.equal(G.CARD_MAX_H, 170); assert.equal(G.GRID_GAP, 12); assert.equal(G.CARD_RATIO, 1.6);
  const c = rule('.pgcard'); assert.match(c, /aspect-ratio:16\/10;max-height:170px/); assert.match(c, /border-radius:3px/);
  assert.match(rule('.pgcard.on'), /border-color:var\(--accent\)/); assert.match(css, /\.pgcard\.on \.pg-check\{display:grid\}/);
  assert.match(css, /\.pgrid\{display:grid;[^}]*gap:12px/);
  const ap = src('appearance.js'), vp = src('vizpage.js');
  assert.match(ap, /stopLive = whileVisible\(cards/); assert.match(ap, /stopNp = whileVisible\(cards/); assert.match(vp, /stopVis = whileVisible\(list/);
  assert.match(ap, /interactive: false \}\), \{ id \}\)\);/, 'EQ previews are display-only');
  // a hidden card stops its live preview, a visible one starts it
  let shown = 0, hidden = 0; const stop = G.whileVisible([{}, {}], () => shown++, () => hidden++); assert.equal(shown, 2); stop(); assert.equal(hidden, 2);
});
test('B16: Small 75 %, Default 100 % (default), Large 125 % (max); earlier saved choices are kept', async () => {
  const U = await imp('uiscale');
  assert.deepEqual(U.SCALES.map(s => [s[0], s[2]]), [['small', 0.75], ['compact', 1], ['large', 1.25]]);
  assert.equal(U.migrateScale('compact'), 'compact'); assert.equal(U.migrateScale('large'), 'large'); assert.equal(U.migrateScale('small'), 'small');
  assert.equal(U.migrateScale('medium'), 'medium'); assert.equal(U.scaleFactor('medium'), 1.12, 'kept until another size is picked');
  assert.equal(U.migrateScale('xlarge'), 'large', 'capped at the new maximum'); assert.equal(U.migrateScale('junk'), 'compact');
  assert.ok(Math.max(...U.SCALES.map(s => s[2])) <= 1.25);
});
test('B2: center-panel EQ scales to the stage - no fixed plot height, no scroll container, desktop dialog unchanged', () => {
  assert.match(css, /\.np-eqhost\{overflow:hidden;/); assert.match(css, /\.np-eqview \.eqa-plot\{flex:1 1 auto;height:auto!important;min-height:0\}/);
  assert.match(css, /\.eqa-plot\{position:relative;height:300px;/, 'the Sound (EQ) dialog keeps its size');
});

// ---- B3 guided calibration
test('B3 guided groups: reference, each speaker, reference again; only speakers skippable', async () => {
  const { guideGroups, guideText, buildPlan, skipNote } = await imp('calmic-core');
  const g = guideGroups(buildPlan({ reference: { id: 1, name: 'Den' }, speakers: [{ id: 1, name: 'Den' }, { id: 2, name: 'Kitchen' }, { id: 3, name: 'Patio' }] }));
  assert.deepEqual(g.map(x => [x.name, x.kind, x.steps.length, x.canSkip]), [['Den', 'ref', 3, false], ['Kitchen', 'dev', 3, true], ['Patio', 'dev', 3, true], ['Den', 'ref-end', 1, false]]);
  assert.equal(guideText('Kitchen'), 'Walk to Kitchen, hold the mic about 3 ft in front of it, then tap Ready');
  assert.match(skipNote('Patio'), /Skipped Patio: its delay is unchanged/);
});
test('B3 pages wire Ready / Skip / Retry and the countdown', () => {
  const cal = src('calibrate.js'), ph = src('calmic.js');
  for (const s of [cal, ph]) { assert.match(s, /'Ready'/); assert.match(s, /'Skip'/); assert.match(s, /'Retry'/); assert.match(s, /\/retry/); assert.match(s, /countdown/); }
  assert.match(ph, /waitReady\(g, gi\) === 'skip'/);
});

// ---- B1 Bluetooth
test('B1: Bluetooth tag only on BT outputs; reconnect / output change hits once; first sight and wired never hit', async () => {
  const D = await imp('devices');
  const z = (id, kind, connected = true, dev = 'd' + id) => ({ id, name: 'Z' + id, connected, outputs: [{ deviceId: dev, kind, active: true, connected }] });
  assert.ok(D.cardTags(z(1, 'bluetooth')).some(t => t.text === 'BLUETOOTH'));
  assert.ok(!D.cardTags(z(2, 'analog')).some(t => t.text === 'BLUETOOTH'));
  let r = D.btReconnects(null, [z(1, 'bluetooth'), z(2, 'analog')]); assert.deepEqual(r.hits, []);
  r = D.btReconnects(r.next, [z(1, 'bluetooth', false), z(2, 'analog', false)]); assert.deepEqual(r.hits, []);
  r = D.btReconnects(r.next, [z(1, 'bluetooth'), z(2, 'analog')]); assert.deepEqual(r.hits, [1]);
  r = D.btReconnects(r.next, [z(1, 'bluetooth'), z(2, 'analog')]); assert.deepEqual(r.hits, []);           // once
  r = D.btReconnects(r.next, [z(1, 'bluetooth', true, 'other'), z(2, 'analog')]); assert.deepEqual(r.hits, [1]);   // output changed
  assert.match(src('devices.js'), /Bluetooth reconnected - recalibrate\?/);
  assert.match(src('devices.js'), /openCalibration\(S, ctl\.refreshAll, z\.id\)/);
  assert.match(src('calibrate.js'), /A wired speaker makes a steadier reference/);
});
