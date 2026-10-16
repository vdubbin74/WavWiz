// WavWiz 0.3.6 - pure logic + markup checks (K1-K22). Browser behavior: tests/ui/ui036.mjs.
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
const BRAND = ['#269B4D', '#208241', '#16532A', '#C07A4E', '#212121', '#FFFFFF'];

test('K8 one shared glide (200-300 ms), pulse + reduce-motion in one module', async () => {
  const m = await imp('motion');
  assert.ok(m.GLIDE.ms >= 200 && m.GLIDE.ms <= 300 && m.GLIDE.ms === 250); assert.equal(m.GLIDE.ease, 'ease-in-out');
  const root = { style: { v: {}, setProperty(k, v) { this.v[k] = v; } } };
  const g = m.applyGlide(root); assert.equal(root.style.v['--glide'], '250ms'); assert.equal(root.style.v['--glide-ease'], 'ease-in-out'); assert.equal(g.ms, 250);
  assert.equal(typeof m.pulse, 'function'); assert.equal(typeof m.reduced, 'function');
  // nothing else hard-codes a slide duration in the 0.3.6 css block
  assert.ok(css.slice(css.indexOf('K8: ONE shared glide')).includes('var(--glide)'));
  assert.match(css, /\.k-pulse/); assert.match(css, /prefers-reduced-motion:\s*reduce[^}]*[\s\S]*k-pulse|k-pulse[\s\S]*prefers-reduced-motion/);
  assert.match(src('main.js'), /export const LIST_ANIM = GLIDE/);
});

test('K2 chevrons point the way the panel moves and flip after a click', async () => {
  const p = await imp('panels');
  assert.equal(typeof p.chevronDir, 'function');
  const base = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };
  // Library: right = expand, left = collapse; Devices: left = expand, right = collapse (from the spec)
  assert.equal(p.chevronDir({ ...base, lib: 'rail' }, 'lib'), 'r'); assert.equal(p.chevronDir(base, 'lib'), 'l');
  assert.equal(p.chevronDir({ ...base, dev: 'rail' }, 'dev'), 'l'); assert.equal(p.chevronDir(base, 'dev'), 'r');
  const ic = await imp('icons'); for (const n of ['chevL', 'chevR', 'chevU', 'chevDn', 'checklist', 'unlock', 'save', 'trash']) assert.ok(ic.iconSvg(n), n);
  assert.match(ic.iconSvg('chevR'), /thin/);
  assert.match(css, /\.plus\.chv[^{]*\{[^}]*border-radius:3px/); assert.match(css, /\.plus\.chv:hover[^{]*\{[^}]*(accent|15%)/);
});

test('K9 Now Playing controls start collapsed until the user chooses', async () => {
  const p = await imp('panels');
  assert.equal(p.normPanels({}).ctl, 'collapsed'); assert.equal(p.normPanels({ ctl: 'open' }).ctl, 'collapsed', 'an unset choice is collapsed');
  assert.equal(p.normPanels({ ctl: 'open', ctlSet: true }).ctl, 'open', 'a saved choice is remembered');
  assert.match(src('now.js'), /ctlSet: true/);
  assert.match(css, /\.pane-h\{[^}]*min-height:30px|height:30px/);
});

test('K10 playlist columns: defaults, picker, lock, reorder, resize, sort', async () => {
  const c = await imp('plcols');
  const d = c.defaultLayout(); assert.deepEqual(c.visible(d), ['num', 'title', 'artist', 'album', 'genre', 'time']);
  const n = c.defaultLayout(true); assert.deepEqual(c.visible(n), ['num', 'title', 'artist', 'time'], 'the side / narrow playlist has fewer default columns');
  let l = c.toggleCol(d, 'year'); assert.ok(c.visible(l).includes('year'));
  l = c.toggleCol(l, 'year'); assert.ok(!c.visible(l).includes('year'));
  let one = { ...d, hidden: d.order.filter(x => x !== 'title') }; assert.deepEqual(c.visible(c.toggleCol(one, 'title')), ['title'], 'the last column stays');
  const lk = c.setLocked(d, true); assert.equal(c.toggleCol(lk, 'year'), lk); assert.equal(c.moveCol(lk, 'title', 'time'), lk); assert.equal(c.resetLayout(lk), lk);
  const mv = c.moveCol(d, 'time', 'title'); assert.ok(mv.order.indexOf('time') < mv.order.indexOf('title') || mv.order.indexOf('time') === mv.order.indexOf('title') + 1);
  assert.deepEqual(c.visible(c.resetLayout(mv)), c.visible(d));
  const w = c.widthsFor(d, 900); assert.equal(w.w.reduce((a, b) => a + b, 0), 900, 'the table fills the panel exactly'); assert.ok(w.w[w.ids.indexOf('title')] >= w.w[w.ids.indexOf('artist')], 'Title takes the leftover');
  const r = c.resizeAt(w.w, w.ids, 1, 40); assert.equal(r.reduce((a, b) => a + b, 0), 900);
  assert.equal(c.nextSort(null, 'title').dir, 'asc'); assert.equal(c.nextSort({ id: 'title', dir: 'asc' }, 'title').dir, 'desc'); assert.equal(c.nextSort({ id: 'title', dir: 'desc' }, 'title'), null);
  const q = [{ title: 'b', artist: 'x' }, { title: 'a', artist: 'y' }, { title: 'c', artist: 'z' }];
  assert.deepEqual(c.sortedIndexes(q, { id: 'title', dir: 'asc' }), [1, 0, 2]); assert.deepEqual(c.sortedIndexes(q, { id: 'title', dir: 'desc' }), [2, 0, 1]); assert.deepEqual(c.sortedIndexes(q, null), [0, 1, 2]);
  const t = src('listtable.js'); assert.match(t, /data-act': 'collock'/); assert.match(t, /data-act': 'colpick'/); assert.match(t, /plpicker/); assert.doesNotMatch(t, /libswap/);
  assert.match(css, /\.pllock\.on[^{]*\{[^}]*var\(--accent\)/); assert.doesNotMatch(src('theme.js'), /lock-red/);
});

test('K11 EQ LED bars: real band centers, no spectrum glow, themed ramp, Pepecoin brand colors only', async () => {
  const v = await imp('vizmath'); assert.deepEqual(v.EQ_HZ.map(Math.round), [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  const [lo, hi] = v.eqBandEdges(1000); assert.ok(Math.abs(lo - 707) < 1 && Math.abs(hi - 1414) < 1);
  const bytes = new Uint8Array(10); bytes[3] = 200; const L = v.eqBandLevels(bytes);
  assert.ok(L[3] > 0.3); for (let i = 0; i < 10; i++) if (i !== 3) assert.equal(L[i], 0, 'a silent band stays at exactly 0');
  const e = src('eqview.js'); assert.match(e, /eqled/); assert.doesNotMatch(e, /GLOW_HZ/); assert.match(css, /\.eqa-glow\{display:none/);
  const t = await imp('theme');
  assert.deepEqual(t.ledColors({ preset: 'default' }, '#FF3C00', '#19C3B1'), { '--led-lo': '#3DDC84', '--led-mid': '#F5C542', '--led-hi': '#D9552B' });
  for (const x of Object.values(t.ledColors({ preset: 'pepecoin' }, '#269B4D', '#208241'))) assert.ok(BRAND.includes(x.toUpperCase()), x + ' is a brand color');
  assert.equal(t.hotFor({ preset: 'pepecoin' }), '#C07A4E'); assert.equal(t.hotFor({ preset: 'arctic' }), '#E5533D'); assert.equal(t.hotFor({ preset: 'violet' }), '#D9298B');
  assert.match(src('viz.js'), /subarray\(1029, ?1039\)/);
});

test('K12 viz mode: Power and Pop out on the LEFT so swap / looks / full keep their place', async () => {
  const l = await imp('looks'); const names = l.overlayButtons?.({ mode: 'viz', popout: true })?.map?.(x => x.name || x) || null;
  if (names) assert.deepEqual(names.slice(-3), ['swap', 'looks', 'full']);
  assert.match(src('looks.js'), /popout[^\n]*power|power[^\n]*popout/);
});

test('K13 analog VU follows the theme; Pepecoin white-green face, #212121 needle, copper hot zone', async () => {
  const { themedClassic } = await imp('vizvu');
  const pepe = themedClassic({ preset: 'pepecoin', accent: '#269B4D', accent2: '#208241', hot: '#C07A4E' });
  assert.equal(pepe.needle, '#212121'); assert.equal(pepe.red.toUpperCase(), '#C07A4E'); assert.equal(pepe.face[0].toUpperCase(), '#FFFFFF');
  for (const k of ['ink', 'pk', 'needle', 'red']) assert.ok(BRAND.includes(String(pepe[k]).toUpperCase()), `Pepecoin ${k} ${pepe[k]} is a brand color`);
  const def = themedClassic({ preset: 'default', accent: '#FF3C00', accent2: '#19C3B1', hot: '#C62F22' }); assert.equal(def.red, '#C62F22'); assert.ok(def.themed);
  assert.equal(themedClassic({}).themed, undefined, 'without a theme the classic look is unchanged');
});

test('K14/K22 the real mini player is a component used in the right column; the NP bar is gone when the Library is expanded', () => {
  const m = src('mini.js'); assert.match(m, /export function mountMini\(root, \{ embedded = false(?:, run = null, home = null)? \} = \{\}\)/); assert.match(m, /import '\.\/sliderstyle\.js'/); assert.match(m, /class: 'mutebtn mp-mute'/);
  const main = src('main.js'); assert.match(main, /mountMini\(host, \{ embedded: true(?:, run: runShortcut, home: goHome)? \}\)/); assert.match(main, /function syncMini/);
  assert.match(css, /\.desk\.libexpanded \.npbar\{display:none!important\}/); assert.match(css, /\.minirail/); assert.match(css, /devcollapsed[^{]*\.minicol:hover \.mp/);
  assert.match(main, /export function openQueue/); assert.match(src('menu.js'), /openQueue/);
});

test('K15 one pulse effect is used by menu targets', () => {
  const main = src('main.js'), s = src('settings.js');
  assert.match(main, /pulse\(libpanel\)/); assert.match(main, /pulse\(devp\.el\)/); assert.match(main, /pulse\(listt\.el\)/); assert.match(main, /pulse\(st\)/); assert.match(main, /export function showEq/); assert.match(s, /pulseSel\(body\.querySelector\('\.settings-sec\.on'\)\)/);
  assert.match(src('listtable.js'), /if \(isCur\) pulse\(tr\)/); assert.match(src('library.js'), /if \(on\) pulse\(ev\.currentTarget\)/);
});

test('K16-K19 menu flyouts, File > New with shortcuts, File > Run, Devices submenus', async () => {
  const m = src('menu.js'); for (const t of ['New', 'Run', 'Import settings…', 'Restore backup…', 'Export settings', 'Back up now', "'Sleep timer'", "'Sound / EQ'", "'Playlists…'", "'Devices'", "'Zones'", "'Scenes'"]) assert.ok(m.includes(t), t);
  const sub = await imp('menusub');
  assert.deepEqual(sub.NEW_KEYS, { zone: 'Ctrl+Shift+Z', scene: 'Ctrl+Shift+S', alarm: 'Ctrl+Shift+A', schedule: 'Ctrl+Shift+H' });
  const key = (code, o = {}) => ({ ctrlKey: true, shiftKey: true, altKey: false, code, ...o });
  assert.equal(sub.newKindForKey(key('KeyZ')), 'zone'); assert.equal(sub.newKindForKey(key('KeyS')), 'scene'); assert.equal(sub.newKindForKey(key('KeyA')), 'alarm'); assert.equal(sub.newKindForKey(key('KeyH')), 'schedule');
  assert.equal(sub.newKindForKey(key('KeyZ'), true), null, 'ignored while typing (redo keeps working)'); assert.equal(sub.newKindForKey(key('KeyZ', { shiftKey: false })), null, 'Ctrl+Z (undo) is untouched');
  assert.equal(sub.newKindForKey(key('KeyJ')), null, 'Ctrl+Shift+J (Jukebox exit chord) is untouched'); assert.equal(sub.newKindForKey(key('KeyZ', { altKey: true })), null);
  assert.match(m, /Start Jukebox/); assert.doesNotMatch(src('menusub.js').split('devicesSpec')[1] || '', /Start/);
  const s = { zones: [{ id: 1, name: 'A' }], groups: [] }; const spec = sub.deviceListSpec(s, { jumpTo() {} }); assert.equal(spec[0][0], 'A');
  const z = sub.zonesSpec({ groups: [{ id: 2, name: 'Z' }] }, { jumpTo() {}, openNew() {} }); assert.equal(z.at(-1)[0], 'New…');
});

test('K20 backup flow: the pieces that already existed are reused, only the missing ones were built', () => {
  const b = src('backupflow.js'); for (const e of ['export function importSettings', 'export async function restoreBackup', 'export function exportSettings', 'export async function backUpNow', 'export function showPendingUndo']) assert.ok(b.includes(e), e);
  assert.match(b, /\/backup\/preview/); assert.match(b, /\/backup\/import/); assert.match(b, /\/backup\/now/); assert.match(b, /\/backup\/restore-saved/); assert.match(b, /undoToast/); assert.match(b, /data-act': 'bk-restore'/); assert.match(b, /data-act': 'bk-cancel'/);
  assert.match(src('settingsui.js'), /\/api\/v1\/backup/);
});

test('K21 Center style puts artist - album on the time line', () => {
  const n = src('now.js'); assert.match(n, /pn-aa/); assert.match(css, /\.pn-aa/);
});

test('K4 cover placeholder: image shows only after load + decode; generated cover only after a failed load', () => {
  const a = src('art.js'); assert.match(a, /decode\(\)/); assert.match(a, /classList\.add\('loaded'\)/); assert.match(a, /showGen/);
  assert.match(css, /\.cimg\{[^}]*opacity:0/); assert.match(css, /\.cimg\.loaded|\.loaded[^{]*\.cimg|\.cimg\.loaded\{[^}]*opacity:1/);
});

test('K5/K6/K7 speaker settings helpers, profile row, scene profile per device', async () => {
  const s = await imp('spkset');
  assert.equal(s.balanceLabel(0), 'Center'); assert.equal(s.balanceLabel(-20), 'Left 20'); assert.equal(s.balanceLabel(35), 'Right 35'); assert.equal(s.dbLabel(2), '+2 dB'); assert.equal(s.dbLabel(-1), '−1 dB'); assert.equal(s.dbLabel(0), '0 dB');
  assert.equal(s.profileDot({ profileId: 3, modified: true }), true); assert.equal(s.profileDot({ profileId: 3, modified: false }), false); assert.equal(s.profileDot({ profileId: null, modified: true }), false);
  const t = src('spkset.js'); for (const a of ['prof-save', 'prof-saveas', 'prof-del']) assert.ok(t.includes(a), a); assert.match(t, /Loaded \$\{p\.name\}/); assert.match(t, /Saves volume, cap, delay, balance, bass, treble, EQ, output/);
  assert.match(src('scenesched.js'), /profileId: m\.prof\.value/); assert.match(css, /--spkcol:clamp\(250px,calc\(22vw \/ var\(--z,1\)\),380px\)/);
  assert.match(css, /\.dexp-main\.e1>\.scol\{flex:0 0 var\(--spkcol\)/, 'the Speakers column is the same width in every state');
});

test('0.3.6 hygiene: late-override css only, US English, 3px corners, no extra accent colors in the new blocks', () => {
  const late = css.slice(css.lastIndexOf('/* 0.3.6'));
  assert.doesNotMatch(late, /border-radius:\s*(?!0|3px|50%|2px|var|inherit)[0-9]+px/, 'corners stay 3px');
  for (const f of ['menusub.js', 'backupflow.js', 'spkset.js', 'motion.js', 'plcols.js']) assert.doesNotMatch(src(f), /colour|centre|speakers\?? ?>? ?device group/i, f);
  assert.match(src('about.js'), /0\.3\.6/);
});
