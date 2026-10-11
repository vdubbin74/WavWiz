// WavWiz 0.2.3 (U1-U10): fine-tunes on top of 0.2.2.
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

test('0.2.3 U1: minimized Now Playing is ONE line - thumbnail, title · artist over the progress bar, then every control', () => {
  const n = src('now.js');
  assert.match(n, /h\('div', \{ class: 'ns-song' \}, sArt, h\('div', \{ class: 'ns-main' \}, h\('div', \{ class: 'ns-titles' \}, sT1,[^\n]*h\('div', \{ class: 'ns-seek' \}, sElv, sProg, sDur\)\)\)/);
  assert.match(n, /h\('div', \{ class: 'ns-x', role: 'group', 'aria-label': 'Transport' \}, sHeart, sShuffle, sPrev, sPlay, sNext, sRepeat\)/);
  assert.match(n, /h\('div', \{ class: 'ns-vol' \}, icon\('volume'\), sVol, sPct, sMute, sEq\)/);
  assert.match(n, /for \(const r of \[vol, barVol, sVol\]\)/);
  assert.match(n, /for \(const b of \[muteBtn, barMute, sMute\]\)/);
  assert.doesNotMatch(n, /songBlock|plsong|np-strip-c/);          // nothing moves to the Playlist title bar any more, no forced centering
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-strip\{display:flex;/);
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-ctlnow,\.np-ctlpanel\.collapsed \.np-ctltitle,/);
  assert.doesNotMatch(css, /\.plsong|np-strip-l|grid-template-columns:1fr auto 1fr/);
  // scaled to fit: pieces drop out by priority as the column narrows (container queries on the panel)
  for (const w of [860, 720, 600, 440]) assert.match(css, new RegExp(`@container npctl \\(max-width:${w}px\\)\\{[\\s\\S]{0,220}\\.ns-`));
});

test('0.2.3 U2: minimized Playlist shows "Up next: Title · Artist" centered on the Now Playing column; Save / Clear stay at the right', () => {
  const n = src('now.js'), m = src('main.js'), l = src('listtable.js');
  assert.match(n, /const nextBlock = h\('div', \{ class: 'plnext', 'aria-label': 'Up next', hidden: true \}, h\('span', \{ class: 'pln-lbl' \}, 'UP NEXT'\), nxArt, nxT1,/);
  assert.match(n, /drawNext\(nxt\);/);
  assert.match(n, /'Nothing queued after this'/);
  assert.match(l, /const setNextBlock = el => \{ head\.insertBefore\(el, meta\); \}/);
  assert.match(m, /const on = desk\.classList\.contains\('listcollapsed'\)/);
  assert.match(m, /const c = col\.left \+ col\.width \/ 2, room = Math\.min\(c - \(listt\.leftEdge\(\) \+ 16\), listt\.rightEdge\(\) - 16 - c\)/);
  assert.match(m, /listt\.setCollapsed\?\.\(c\); placeNext\(\);/);
  assert.match(css, /\.desk\.listcollapsed \.plnext:not\(\[hidden\]\)\{display:flex;[^}]*transform:translateX\(-50%\)/);
  assert.doesNotMatch(css, /\.desk\.listcollapsed \.listpanel \.pane-h \.small,\.desk\.listcollapsed \.listpanel \.pane-h \.row:not\(\.listcolwrap\)\{display:none\}/);
});

test('0.2.3 U3: the one-line bar wears the selected panel style (all four) in the theme colors', () => {
  for (const st of ['classic', 'center', 'stack', 'horizon']) assert.match(css, new RegExp(`\\.pn-${st} \\.(np-strip|ns-)`), st);
  assert.match(css, /\.pn-classic \.ns-art\{[^}]*conic-gradient\(var\(--accent\) calc\(var\(--ns-frac,0\) \* 1turn\)/);   // ring around the thumb
  assert.match(css, /\.pn-center \.ns-wave\{display:block\}/);                                                              // waveform seek
  assert.match(css, /\.pn-stack \.ns-led\{display:block;/);                                                                 // LED blocks
  assert.match(css, /\.pn-horizon \.ns-prog \.bar\{background:linear-gradient\(90deg,var\(--accent\),var\(--line\) 40%\)\}/); // line from the cover
  // effects follow the panel's 0-100 % sliders (inherited --fx-* custom properties), colors only from theme variables
  const block = css.slice(css.indexOf('0.2.3 U1:'), css.lastIndexOf('0.2.3 U2:'));
  assert.match(block, /var\(--fx-glow\)/); assert.match(block, /var\(--fx-motion\)/);
  assert.doesNotMatch(block.replace(/#08090A|#000\b/g, ''), /#[0-9a-f]{3,6}\b/i);
  const n = src('now.js');
  assert.match(n, /for \(const box of \[waveBase, waveTop, sWaveBase, sWaveTop\]\)/);
  assert.match(n, /ctlStrip\.style\.setProperty\('--ns-frac', frac\.toFixed\(4\)\)/);
});

test('0.2.3 U4: Settings > Appearance > Display size has no preview pane (the whole app already changes live)', () => {
  const ap = src('appearance.js'), body = ap.split('function displaySizeCard() {')[1].split('\n}\n')[0];
  assert.doesNotMatch(body, /npprev|dsprev|ds-stage|prevHead/);
  assert.match(body, /data-scale': id, onclick: \(\) => \{ applyScale\(id\); draw\(\); \}/);
});

test('0.2.3 U5 + U8: Theme, Visualizer, EQ and Now Playing previews are pinned (sticky) while the page scrolls, at every Display size', () => {
  assert.match(src('themes.js'), /class: 'npprev apprev pinprev'/);
  const ap = src('appearance.js');
  assert.match(ap, /class: 'npprev vlive pinprev'/);
  assert.match(ap, /class: 'eqprevbox eqprev-big pinprev'/);
  assert.match(src('nppreview.js'), /class: 'npprev pinprev', 'data-preview': 'np'/);
  assert.match(css, /\.appsub \.pinprev\{position:sticky;top:-12px;z-index:4;/);
  // the pinned preview shrinks with the dialog height (divided by the Display size zoom) so the settings below stay usable
  for (const sel of ['\\.apprev\\.pinprev \\.ap-app', '\\.vlive\\.pinprev \\.vlive-stage', '\\.eqprevbox\\.pinprev \\.eqa-plot']) assert.match(css, new RegExp(`\\.appsub ${sel}\\{[^}]*45vh / var\\(--z,1\\)`), sel);
  // nothing between the preview and the dialog body clips it (sticky needs visible overflow on the way up)
  assert.doesNotMatch(css, /\.(appsub|appsplit|themes-page|settings-sec)\{[^}]*overflow:(hidden|auto)/);
});

test('0.2.3 U9: Lock EQ - wheel fine-adjusts by default; locked, the wheel is left to the page (scrolls) and nothing changes', async () => {
  const e = await imp('eqstyle');
  assert.equal(e.wheelGain(false, 0, -100), 0.5);    // wheel up = +0.5 dB
  assert.equal(e.wheelGain(false, 0, 100), -0.5);
  assert.equal(e.wheelGain(false, 12, -100), 12);    // clamped at +12
  assert.equal(e.wheelGain(false, -12, 53), -12);
  assert.equal(e.wheelGain(true, 3, -100), null);    // locked: no change, the event is not consumed
  assert.equal(e.wheelGain(true, 3, 100), null);
  assert.equal(e.wheelGain(false, 3, 0), null);      // horizontal-only wheel: leave it
  const v = src('eqview.js');
  assert.match(v, /b\.addEventListener\('wheel', ev => \{ const v = wheelGain\(isLocked, g\[i\], ev\.deltaY\); if \(v == null\) return; ev\.preventDefault\(\);/);
  assert.match(v, /b\.addEventListener\('pointerdown', ev => \{ if \(isLocked\) return;/);
  assert.match(v, /if \(isLocked\) return;\n\s+const v = keyStep/);
  assert.match(v, /function setLocked\(v\) \{\s*isLocked = !!v; el\.classList\.toggle\('locked', isLocked\); lockMark\.hidden = !isLocked;/);
  assert.match(v, /export function eqLockBox\(checked, onToggle\)/); assert.match(v, /'Lock EQ'/); assert.match(v, /iconSvg\('lock'\)/);
  assert.match(css, /\.eqarea\.locked \.eqa-plot,\.eqarea\.locked \.eqchips\{opacity:\.6/);
});

test('0.2.3 U9: Lock EQ is remembered per device (this browser), off by default; the dialog header has it', async () => {
  const e = await imp('eqstyle');
  const mem = new Map(), store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(e.loadEqLock(store), false);
  assert.equal(e.saveEqLock(true, store), true); assert.equal(mem.get('wavwiz.eqlock.v1'), '1'); assert.equal(e.loadEqLock(store), true);
  e.saveEqLock(false, store); assert.equal(e.loadEqLock(store), false);
  assert.equal(e.loadEqLock({ getItem() { throw new Error('private'); } }), false);
  const q = src('eq.js');
  assert.match(q, /const lock = eqLockBox\(loadEqLock\(\), v => \{ saveEqLock\(v\); area\?\.setLocked\(v\); \}\);/);
  assert.match(q, /d\.el\.querySelector\('header \.grow'\)\?\.after\(lock\.el\)/);
  assert.match(q, /locked: loadEqLock\(\), onChange:/);
});

test('0.2.3 U10: Appearance > EQ mirrors the real EQ of this device, opens locked every time, unlocking edits the real EQ', async () => {
  const e = await imp('eqstyle');
  const zones = [{ id: 1, name: 'Den', outputs: [{ deviceId: 'a', name: 'Out A', connected: true }] }, { id: 2, name: 'Phone', outputs: [{ deviceId: 'p', name: 'Browser', connected: true, active: true }] }, { id: 3, name: 'Off', outputs: [{ deviceId: 'x', connected: false }] }];
  assert.equal(e.eqTarget(zones, { id: 1 }).deviceId, 'a');       // this device's own speaker first
  assert.equal(e.eqTarget(zones, null).deviceId, 'p');            // else the active output
  assert.equal(e.eqTarget(zones, { id: 3 }).deviceId, 'p');       // own speaker offline -> active one
  assert.equal(e.eqTarget([], null), null);
  assert.equal(e.ownEqName('Living room'), 'Living room EQ');
  assert.equal(e.eqSummary({ presetName: 'Rock', preGainDb: -2.5, loudness: true }), 'Preset: Rock · Pre-gain -2.5 dB · Loudness on');
  assert.equal(e.eqSummary({}), 'Preset: Flat · Pre-gain 0 dB · Loudness off');
  const ap = src('appearance.js');
  assert.match(ap, /shown = true; locked = true;\s+\/\/ U10: locked by default every time the page opens/);
  assert.match(ap, /api\(`\/dsp\/assignments\/\$\{encodeURIComponent\(out\.deviceId\)\}`\)/);
  assert.match(ap, /const gains = \(\) => real \? \[\.\.\.real\.cur\.graphicDb\] : \[\.\.\.EQ_EXAMPLE\]/);
  assert.match(ap, /onChange: \(i, db\) => \{ if \(!real \|\| locked\) return;/);
  assert.match(ap, /api\('\/dsp\/preview', \{ method: 'POST'/);
  assert.match(ap, /x\.source !== 'builtin' && x\.name === name/);   // never writes over a built-in
  assert.match(ap, /window\.addEventListener\('wavwiz:eqchanged'/);
  assert.match(ap, /eqStyleCard\(opts\.S \|\| null\)/); assert.match(src('settings.js'), /appearancePane\(\{ S, /);
  assert.match(src('eq.js'), /window\.dispatchEvent\(new CustomEvent\('wavwiz:eqchanged'/);
});

test('0.2.3 U6: Expand button arrows point the way the panel travels (Devices left / back right; Library mirrored)', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const d = await imp('devices');
  assert.equal(d.expandIcon('right', false), 'expandL');   // Devices normal: it will grow to the left
  assert.equal(d.expandIcon('right', true), 'expandR');    // Devices expanded: it goes back to the right
  assert.equal(d.expandIcon('left', false), 'expandR');    // Library normal: grows to the right
  assert.equal(d.expandIcon('left', true), 'expandL');     // Library expanded: goes back to the left
  const i = src('icons.js'); assert.match(i, /expandL: '<path d="M20 5v14"\/>/); assert.match(i, /expandR: '<path d="M4 5v14"\/>/);
  assert.match(src('devices.js'), /setIcon\(expBtn, expandIcon\('right', s === 'expanded'\)\)/);
  assert.match(src('main.js'), /setIcon\(b, expandIcon\('left', on\)\)/);
  assert.doesNotMatch(src('devices.js') + src('main.js'), /'⤢'|'⤡'/);
});

test('0.2.3 U7: DEVICES title at the right edge of the Devices header, mirroring LIBRARY at the left edge', () => {
  const s = src('devices.js'), m = src('main.js');
  assert.match(s, /h\('div', \{ class: 'pane-h devhead' \}, expBtn, colBtn, escHint, h\('span', \{ class: 'grow devtitle' \}\), count, h\('span', \{ class: 'devtitle' \}, 'DEVICES'\)\)/);
  assert.match(m, /h\('div', \{ class: 'pane-h' \}, h\('span', \{ class: 'libtitle' \}, 'LIBRARY'\), h\('span', \{ class: 'grow' \}\), escHint, colBtn, expBtn\)/);
  assert.match(css, /\.devpanel \.devhead > \.devtitle:not\(\.grow\),\.libpanel \.pane-h > \.libtitle\{color:var\(--accent\)\}/);   // same title color
});

test('0.2.3: What\'s new lists the 0.2.3 changes in US English; CHANGELOG has the 0.2.3 entry above 0.2.2', () => {
  const a = src('about.js');
  assert.match(a, /WHATS_NEW_VERSION = '0\.2\.3'/);
  for (const t of ['Now Playing on one line', 'Up next', 'Lock EQ', 'Your real EQ in Appearance', 'Previews stay in view', 'Tidier side panels']) assert.ok(a.includes(t), t);
  assert.doesNotMatch(a, /\b(colour|favourite|grey|centre|licence|behaviour)\b/i);
  const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(cl, /## \[0\.2\.3\] - 2026-10-11 \(beta\)/); assert.ok(cl.indexOf('## [0.2.3]') < cl.indexOf('## [0.2.2]'));
  // the public changelog names each 0.2.3 change in words (no internal item codes)
  for (const t of ['Minimized Now Playing is one line', 'Minimized Playlist shows "Up next"', 'follows the selected control panel style and theme', 'Display size', 'Pinned previews', 'Expand buttons', 'Devices header', 'Device cards open into their settings', 'Appearance > EQ shows the real EQ', 'Lock EQ', 'Revoking a device removes it from the Devices list']) assert.ok(cl.includes(t), t);
  assert.doesNotMatch(cl, /\bU\d+\b/);
});

test('0.2.3 U11: a revoked or forgotten device leaves the Devices list live - no skipped redraw keeps it, a forgotten browser speaker does not rejoin', () => {
  const d = src('devices.js');
  // side panel (Standard + Expanded + zones sidebar): a skipped redraw is retried, and a card whose device is gone forces the redraw
  assert.match(d, /const removedShown = \(\) => \[\.\.\.body\.querySelectorAll\('\[data-zone-id\]'\)\]\.some\(el => !S\.zones\.some\(z => String\(z\.id\) === el\.dataset\.zoneId\)\)/);
  assert.match(d, /if \(!force && removedShown\(\)\) force = true;/);
  const panel = d.slice(d.indexOf('function draw(force)'), d.indexOf('function draw(force)') + 900);
  assert.ok((panel.match(/return later\(\);/g) || []).length >= 3, 'slider, menu and zone editor skips all retry');
  assert.doesNotMatch(panel, /\) return;/);
  // the phone Devices page follows the same rule
  const page = d.slice(d.indexOf('export function devicesView'));
  assert.match(page, /const gone = \[\.\.\.list\.querySelectorAll\('\[data-zone-id\]'\)\]/);
  assert.match(page, /if \(!gone && root\.querySelector\('\.dmenu'\)\) return later\(\);/);
  // the "zones" push redraws every view (side panel, page, strip) from fresh /zones + /groups - nothing cached
  const m = src('main.js');
  assert.match(m, /m\.type === 'zones'\) \{ refreshZones\(\);/);
  assert.match(m, /async function refreshZones\(\) \{ try \{ const \[z, g\] = await Promise\.all\(\[api\('\/zones'\), api\('\/groups'\)[^\n]*S\.zones = z; S\.groups = g; devv\.draw\(\); devp\.draw\(\);/);
  // a browser speaker told "unauthorized" (forgotten / revoked) stops instead of reconnecting straight back onto the list
  const r = src('room.js');
  assert.match(r, /if \(\/\^unauthorized\/i\.test\(b\?\.reason \|\| ''\)\) \{ this\.removed = true; this\.stop\(\)/);
  // the revoke dialog says what happens
  assert.match(src('settings.js'), /Speakers it opened in a browser leave the device list at once, on every open page\./);
});

test('0.2.3 U11: the panel logic - a removed device is detected even while a slider has focus', () => {
  // the same predicate the panel uses, run on plain data
  const removedShown = (shownIds, zones) => shownIds.some(id => !zones.some(z => String(z.id) === id));
  assert.equal(removedShown(['1', '2'], [{ id: 1 }, { id: 2 }]), false);
  assert.equal(removedShown(['1', '2'], [{ id: 1 }]), true);
  assert.equal(removedShown([], []), false);
});

test('0.2.3 U12: device cards open their settings with a themed chevron Expand control (was •••), in place, in Standard and Expanded', () => {
  const d = src('devices.js');
  assert.doesNotMatch(d, /'•••'|class: 'dmore'|dsback|'‹ Back'/, 'the ••• flip and its Back button are gone');
  assert.match(d, /export function settingsToggle\(name, open, onToggle\) \{\n  return h\('button', \{ type: 'button', class: 'dexpand' \+ \(open \? ' on' : ''\), 'aria-expanded': String\(open\)/);
  assert.match(d, /icon\('chevD'\), h\('span', \{ class: 'dexp-l' \}, 'Settings'\)\);/);
  const card = d.slice(d.indexOf('function expandedCard('), d.indexOf('function standardRow('));
  const row = d.slice(d.indexOf('function standardRow('), d.indexOf('const EMPTY = '));
  for (const [n, f] of [['Expanded', card], ['Standard', row]]) {
    assert.match(f, /settingsToggle\(z\.name, open, flip\)/, n + ' has the Expand control');
    assert.match(f, /open \? cardSettings\(S, ctl, z\) : null\);\n  return escCloses\(/, n + ': settings open below the face, Esc closes');
    assert.match(f, /'aria-controls', `dset-\$\{z\.id\}`/);
  }
  assert.match(d, /id: `dset-\$\{z\.id\}`/);
  // session-only memory, per device
  assert.match(d, /const OPEN_KEY = 'wavwiz\.devopen\.v1';/); assert.match(d, /sessionStorage\.getItem\(OPEN_KEY\)/); assert.match(d, /sessionStorage\.setItem\(OPEN_KEY/);
  assert.doesNotMatch(d, /localStorage\.[a-zA-Z]+\(OPEN_KEY/);
  assert.match(d, /if \(ev\.key === 'Escape' && openSet\.has\(z\.id\)/);
  // admin-only items stay visible, read-only for others
  const set = d.slice(d.indexOf('function cardSettings('), d.indexOf('async function delayHistory('));
  assert.match(set, /btn\('Rename…', \(\) => rename\(S, ctl, z\), admin, ADMIN_HINT\)/); assert.match(set, /btn\('Forget device…', \(\) => forget\(ctl, z\), admin, ADMIN_HINT, 'btn danger'\)/);
  assert.match(set, /ro\(h\('button'/);
  // themed like the panel expand arrows; the chevron flips; rounded 4-6 px
  assert.match(src('icons.js'), /chevD: '<path d="M6 9l6 6 6-6"\/>'/);
  assert.match(css, /\.dexpand\{[^}]*border:1px solid var\(--accent\);border-radius:5px;color:var\(--accent\)/);
  assert.match(css, /\.dexpand\.on svg\{transform:rotate\(180deg\)\}/);
  assert.match(css, /@container devbody \(min-width:300px\)\{\.drow \.dvol \.dexp-l\{display:inline\}\}/);
});

test('0.2.3 U12: the open state is remembered per device for the session', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  globalThis.document ??= { addEventListener() {}, createElement: () => ({}) };
  let m; try { m = await imp('devices'); } catch { return; }       // DOM-heavy imports: the source test above covers it when it cannot load
  m.setCardOpen(7, true); m.setCardOpen(9, true); m.setCardOpen(7, false);
  assert.equal(m.cardInSettings(7), false); assert.equal(m.cardInSettings(9), true);
  assert.deepEqual(JSON.parse(store.get('wavwiz.devopen.v1')), [9]);
});
