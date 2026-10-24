// WavWiz 0.4.5 F8 - pointer-event drag (pdrag.js): pure mode / threshold logic and source wiring. UI covered by tests/ui/f8pointer.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');
const imp = async n => import(`${js}/${n}.js`);
const PLAYER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0 WavWizPlayer/0.4.4';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

test('F8 dndMode: Player window = pointer, browsers = hybrid, ?dnd / stored override', async () => {
  const { dndMode } = await imp('pdrag');
  assert.equal(dndMode({ ua: PLAYER, search: '', stored: null }), 'pointer');
  assert.equal(dndMode({ ua: CHROME, search: '', stored: null }), 'hybrid');
  assert.equal(dndMode({ ua: CHROME, search: '?dnd=pointer', stored: null }), 'pointer');
  assert.equal(dndMode({ ua: PLAYER, search: '?dnd=native', stored: null }), 'native');
  assert.equal(dndMode({ ua: CHROME, search: '', stored: 'pointer' }), 'pointer');
  assert.equal(dndMode({ ua: CHROME, search: '?dnd=bogus', stored: null }), 'hybrid');
});
test('F8 usesPointer: hybrid leaves the mouse on native DnD, touch and pen use pointer events', async () => {
  const { usesPointer } = await imp('pdrag');
  assert.ok(usesPointer('pointer', 'mouse')); assert.ok(usesPointer('pointer', 'touch')); assert.ok(usesPointer('pointer', 'pen'));
  assert.ok(!usesPointer('hybrid', 'mouse')); assert.ok(usesPointer('hybrid', 'touch')); assert.ok(usesPointer('hybrid', 'pen'));
  assert.ok(!usesPointer('native', 'touch'));
});
test('F8 dragStarts: mouse after ~5 px (a click still opens a category); touch/pen need a short hold, a quick swipe scrolls', async () => {
  const { dragStarts } = await imp('pdrag');
  assert.equal(dragStarts({ dx: 3, dy: 2, heldMs: 0, pointerType: 'mouse' }), 'wait');
  assert.equal(dragStarts({ dx: 5, dy: 0, heldMs: 0, pointerType: 'mouse' }), 'drag');
  assert.equal(dragStarts({ dx: 0, dy: 20, heldMs: 50, pointerType: 'touch' }), 'scroll');
  assert.equal(dragStarts({ dx: 0, dy: 3, heldMs: 50, pointerType: 'touch' }), 'wait');
  assert.equal(dragStarts({ dx: 8, dy: 0, heldMs: 250, pointerType: 'touch' }), 'drag');
  assert.equal(dragStarts({ dx: 8, dy: 0, heldMs: 250, pointerType: 'pen' }), 'drag');
});
test('F8 wiring: Library items are pointer drag sources with a grab cursor; queue body + header and playlist targets accept pointer drops', () => {
  const u = src('ui'), l = src('listtable'), c = css();
  assert.match(u, /pointerDragSource\(el, \(\) => \(\{ lib: true, ref, title \}\)/); assert.match(u, /classList\.add\('ldrag'\)/);
  assert.match(u, /if \(mode === 'pointer'\) return el;/);   // the Player window does not also make rows natively draggable
  assert.match(u, /export function dropTarget[^\n]*\n\s*pointerDropTarget\(el/);
  assert.equal((l.match(/pointerDropTarget\((wrap|head),/g) || []).length, 2);
  assert.match(c, /\.ldrag\{cursor:grab\}/); assert.match(c, /\.ldrag\.dragging,\.ldrag:active\{cursor:grabbing\}/); assert.match(c, /body\.pdragging \*\{[^}]*cursor:grabbing/);
  assert.match(c, /\.dragghost\.pdghost\{pointer-events:none/);
});
test('F8 category rows (artist, album, genre/year, decade, folder) are drag sources with node refs', () => {
  const lib = src('library');
  for (const k of ["refNode\\('artist:'", 'refNode\\(albumNode', "refNode\\(key \\+ ':'", "refNode\\('decade:'", "refNode\\('folder:'"]) assert.match(lib, new RegExp('attachItem\\(S, el, ' + k.replace(/^refNode/, '(ref|refNode)').replace('(ref|refNode)\\(', '(?:ref|refNode\\()') + '|' + k));
});
test('version: badge, footer and title come from the server build version; build, installer and What\'s new all say the same version', () => {
  const props = readFileSync(new URL('../../Directory.Build.props', import.meta.url), 'utf8'), iss = readFileSync(new URL('../../installer/WavWiz.iss', import.meta.url), 'utf8');
  const v = props.match(/<WavWizVersion>([\d.]+)</)[1];
  assert.match(props, /<InformationalVersion>\$\(WavWizVersion\)-beta</); assert.match(props, /<AssemblyVersion>\$\(WavWizVersion\)\.0</);
  assert.equal(iss.match(/#define AppVersion "([\d.]+)"/)[1], v);
  assert.match(src('about'), new RegExp(`WHATS_NEW_VERSION = '${v.replace(/\./g, '\\.')}'`));
  const m = src('main');   // badge + footer + title: S.auth.appVersion (= WavWizInfo.Version, from InformationalVersion), never a literal
  assert.match(m, /const VERSION_LABEL = \(\) => `BETA \$\{S\.auth\?\.appVersion \?\? ''\}`/); assert.match(m, /`WavWiz BETA \$\{S\.auth\?\.appVersion \?\? ''\}`/);
  assert.doesNotMatch(m, /BETA \d+\.\d+\.\d+/);
});

test('T2 Display size: Extra small 67 % added; Small / Default / Large stay; no 50 %', async () => {
  const U = await imp('uiscale');
  assert.deepEqual(U.SCALES.map(s => [s[0], s[2]]), [['tiny', 0.67], ['small', 0.75], ['compact', 1], ['large', 1.25]]);
  assert.ok(!U.SCALES.some(s => s[2] < 0.67)); assert.equal(U.scaleFactor('tiny'), 0.67); assert.equal(U.migrateScale('tiny'), 'tiny'); assert.equal(U.migrateScale('compact'), 'compact');
});

test('F27 zone name in the now-playing text is the zone picker; the mini player shortcuts row has no chip', () => {
  const z = src('zones40'), mini = src('mini'), now = src('now');
  assert.match(z, /export function zoneLink/); assert.match(z, /wavwiz:editzone/);
  assert.doesNotMatch(mini, /zoneChip\('zs-mini'\)/); assert.match(mini, /zoneLink\('zl-mini'\)/);
  for (const k of ['zl-ov', 'zl-strip', 'zl-meta', 'zl-phone', 'zl-bar']) assert.match(now, new RegExp(`zoneLink\\('${k}'\\)`));
  assert.match(css(), /\.zlink \.zl-name\{color:var\(--accent\)/);
});

test('F28 the Queue panel is keyed on the Editing zone', () => {
  const l = src('listtable');
  assert.match(l, /function setView\(key\)/); assert.match(l, /onchange: \(\) => setView\(pickSel\.value\)/);
  assert.match(l, /if \(seq !== vSeq \|\| key !== view\) return;/);   // a reply for an older zone is dropped
  assert.match(l, /Z\.queueSuffixFor\(c\)/); assert.match(l, /from = editingKey\(\)/);
  assert.match(l, /wavwiz:editzone', \(\) => setView\(null\)/);
});

test('F29 calibration guide: four steps, By ear in three lines, Bluetooth + phone notes, every error says what to do', async () => {
  const G = await imp('calguide');
  assert.equal(G.CAL_STEPS.length, 4); assert.equal(G.stepLabel(1), 'Step 1 of 4');
  assert.match(G.CAL_STEPS[0].text, /REF/); assert.match(G.CAL_STEPS[1].text, /phone/); assert.match(G.CAL_STEPS[2].text, /ear height/); assert.match(G.CAL_STEPS[3].text, /Apply or Retry/);
  assert.equal(G.EAR_LINES.length, 3); assert.match(G.EAR_LINES[1], /slider/); assert.match(G.EAR_LINES[2], /Save/);
  const all = JSON.stringify(G.GUIDE_SECTIONS); assert.match(all, /Bluetooth adds lag/); assert.match(all, /recalibrate|Calibrate again after/i); assert.match(all, /manual delay slider/); assert.match(all, /screen awake/);
  assert.equal(G.calFix('No chirp heard', { name: 'iPhone', web: true }), 'No chirp heard on iPhone: keep the WavWiz page open and unmuted, raise the volume, retry.');
  assert.match(G.calFix('Speaker silent', { name: 'Den' }), /Den is on and its volume is up, then retry/);
  assert.match(G.calFix('Permission denied'), /allow microphone access/);
  assert.match(G.calFix('Low confidence'), /closer.*retry.*By ear/);
  assert.match(G.calFix('Kitchen is offline'), /Turn .* on/);
  assert.match(G.calFix('Something odd'), /Retry\. If it keeps failing, use By ear\./);
  assert.match(G.calFix(''), /^Retry/);
  for (const t of all.match(/"[^"]+"/g)) assert.doesNotMatch(t, /colour|behaviour|centre|favourite/i);   // US English
  const c = src('calibrate');
  assert.match(c, /calStrip\(1\)/); assert.match(c, /strip\.set\(p\.phase === 'waiting' \? 3 : 4\)/); assert.match(c, /msg = calFix\(msg\)/); assert.doesNotMatch(c, /toast\(e\.message, true\)/);
  assert.match(c, /'Retry'\)/); assert.match(c, /'Apply'\)/); assert.match(src('devices'), /calHelpLink\('calhelp-dev'\)/);
});

test('F26 Devices drags on the pointer engine; the ghost is pinned at the grab point at any zoom', async () => {
  const P = await imp('pdrag');
  assert.equal(P.zoomOf(1920, 960), 2); assert.equal(P.zoomOf(0, 0), 1);
  assert.deepEqual(P.pinnedGhostPos({ x: 500, y: 300, offX: 20, offY: 10, zoom: 1 }), { left: 480, top: 290 });
  assert.deepEqual(P.pinnedGhostPos({ x: 500, y: 300, offX: 20, offY: 10, zoom: 1.25 }), { left: 384, top: 232 });
  const t = src('tree42'); assert.match(t, /startPointerDrag\(ev, grip/); assert.match(t, /pin: src \|\| grip/); assert.match(t, /classList\.add\('dropno'\)/);
  assert.doesNotMatch(t, /drag42-ghost/);
});

test('T1/T1b tight layout: < 1600 CSS px, or dpr >= 1.75 and < 2000 CSS px; Layout Auto/Roomy/Full', async () => {
  const P = await imp('panels');
  assert.equal(P.TIGHT_PX, 1600);
  assert.equal(P.isTight(1280, 1, 1, 'auto'), true);      // the Player window's 1280 x 820 design size
  assert.equal(P.isTight(1536, 1, 1, 'auto'), true);      // 4K TV at 250 %, maximized
  assert.equal(P.isTight(1920, 1, 1, 'auto'), false);     // 1080p monitor at 100 %
  assert.equal(P.isTight(1920, 1, 2, 'auto'), true);   // T1b: 4K TV at Windows 200 % (dpr 2) - the user's TV
  assert.equal(P.isTight(1920, 1, 1.5, 'auto'), false); assert.equal(P.isTight(2560, 1, 1.75, 'auto'), false); assert.equal(P.isTight(1999, 1, 1.75, 'auto'), true);
  assert.equal(P.isTight(2560, 1, 1, 'roomy'), true); assert.equal(P.isTight(1280, 1, 2, 'full'), false); assert.equal(P.isTight(800, 1, 1, 'roomy'), false);
  assert.equal(P.normLayout('x'), 'full'); assert.deepEqual(P.LAYOUTS.map(l => l[0]), ['full', 'roomy', 'auto']);
  assert.equal(P.isTight(2560, 1, 1, 'auto'), false);
  assert.equal(P.isTight(1920, 1.25, 1, 'auto'), true);   // Display size Large on 1920 = 1536
  assert.equal(P.isTight(1280, 0.67, 1, 'auto'), false);  // Extra small on 1280 = 1910
  assert.equal(P.isTight(900, 1, 1, 'auto'), false); assert.equal(P.isTight(800, 1, 1, 'auto'), false);   // phone layout
  // T1c: Full is the default - no saved setting = the 0.4.4 layout at every size, including the 4K TV at 200 %
  assert.equal(P.DEFAULT_LAYOUT, 'full'); assert.equal(P.normLayout(null), 'full'); assert.equal(P.loadLayout({ getItem: () => null }), 'full');
  for (const [w, z, d] of [[1280, 1, 1], [1536, 1, 1], [1920, 1, 2], [1920, 1.25, 1], [2560, 1, 1]]) assert.equal(P.isTight(w, z, d), false);
  assert.equal(P.devTabText(4), 'DEVICES · 4 ZONES'); assert.equal(P.devTabText(1), 'DEVICES · 1 ZONE');
  assert.match(src('main'), /isTight\(window\.innerWidth, pageZoom\(\), window\.devicePixelRatio \|\| 1, mode\)/); assert.match(src('main'), /dppx/); assert.match(src('appearance'), /'Layout'/);
});
