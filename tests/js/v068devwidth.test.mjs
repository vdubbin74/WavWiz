// 0.6.8c/d: resizing the window never resizes the docked Devices panel and never folds a panel - only the middle column grows / shrinks,
// down to the phone layout (<= 900 px). The expanded Speakers column never keeps a narrow width measured in a slide-over / phone layout.
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

test('a stream of resize events: no panel folds or unfolds, Devices width constant, only the middle changes', async () => {
  const P = await imp('panels');
  const p = P.normPanels({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open', ctlSet: true });
  const ws = []; for (let w = 1920; w >= 901; w -= 7) ws.push(w); for (let w = 901; w <= 1920; w += 7) ws.push(w);
  const states = new Set(), mids = [];
  for (const w of ws) {
    const e = P.effective(p, w);
    states.add(`${P.shown(e, 'lib')}/${P.shown(e, 'dev')}/${e.auto}`);
    assert.equal(P.shown(e, 'dev'), 'normal'); assert.equal(P.DEV_PX, 380);
    mids.push(P.npWidth(e, w));
  }
  assert.deepEqual([...states], ['normal/normal/false'], 'no class toggling while the window is dragged');
  assert.ok(Math.min(...mids) > 0 && new Set(mids).size > 50, 'the middle column absorbs the change');
  // the user's own fold is kept as is
  assert.equal(P.shown(P.effective({ ...p, lib: 'rail' }, 1000), 'lib'), 'rail');
});

test('visualizer: a resize tick resizes the canvas at most once per frame and keeps the last picture (no dark flash)', () => {
  const v = src('viz.js');
  assert.match(v, /resize\(\) \{ if \(!this\.canvas \|\| this\.rzRaf\) return; this\.rzRaf = requestAnimationFrame\(/);
  assert.match(v, /this\.sizeCanvas\(false, true\)\) this\.last = 0;/);
  const sc = v.slice(v.indexOf('sizeCanvas(force, keep = false)'), v.indexOf('async start()'));
  assert.match(sc, /w !== this\.canvas\.width \|\| h !== this\.canvas\.height/, 'only when the size really changed');
  assert.match(sc, /if \(snap\) \{ try \{ this\.ctx\.drawImage\(snap, 0, 0, w, h\)/);
});

test('CSS: the docked Devices track is a fixed --devw, not a vw clamp', () => {
  const blk = css.slice(css.indexOf('0.6.8c: the docked Devices side panel keeps ONE width'));
  assert.ok(blk.length > 50);
  assert.match(blk, /:root\{--devw:380px;--spkcol:var\(--devw\)\}/);
  assert.match(blk, /\.desk\{grid-template-columns:var\(--libw,[^}]*\) minmax\(0,1fr\) var\(--rightw,var\(--devw\)\)\}/);
  assert.doesNotMatch(blk, /22vw/);
});

test('devices.js: --devstdw is only measured on the docked panel and refreshed when measured', () => {
  const d = src('devices.js');
  const c = d.slice(d.indexOf('const cacheStd = () =>'), d.indexOf('const setSize ='));
  assert.match(c, /classList\.contains\('tight'\)/);
  assert.match(c, /window\.innerWidth <= 900/);
  assert.match(c, /root\.style\.setProperty\('--devstdw', root\._stdw \+ 'px'\)/);
});

// 0.6.8e: resizing must leave the Library list / Devices cards in place (the Library blanked mid-drag)
test('a stream of resize events never rebuilds the Library or Devices: same DOM nodes until the drag ends', async () => {
  const m = src('main.js');
  assert.match(m, /resizeRaf = requestAnimationFrame\(\(\) => \{ resizeRaf = 0; applyMode\(\); applyPanels\(\); \}\)/, 'one layout pass per frame');
  assert.match(m, /if \(ls !== 'rail' && !first && !libWasShown\) libC\.reload\(\); libWasShown = ls !== 'rail';/, 'Library redrawn only when it is opened');
  assert.match(m, /if \(devSz !== devWasSize \|\| devHl != null \|\| first\) \{ devWasSize = devSz; devp\.setSize\(devSz, devHl\); \}/, 'Devices only on a real size change');
  assert.match(src('library.js'), /rzT = setTimeout\(\(\) => \{ if \(st\.dirty && visible\(\)\) draw\(\); \}, 150\)/, 'a pending redraw waits for the end of the drag');
  // simulate the applyPanels gate over a resize stream: the panel state never changes, so nothing is rebuilt
  let libWasShown = false, devWasSize = null, reloads = 0, sizes = 0; const node = { id: 'row-1' }; let list = [node];
  const pass = (ls, devSz, first = false) => { if (devSz !== devWasSize || first) { devWasSize = devSz; sizes++; } if (ls !== 'rail' && !first && !libWasShown) { reloads++; list = [{ id: 'row-1' }]; } libWasShown = ls !== 'rail'; };
  pass('normal', 'standard', true); const before = list[0];
  for (let i = 0; i < 200; i++) pass('normal', 'standard');
  assert.equal(reloads, 0, 'no pass during the drag redraws the list (startup draws it once on its own)'); assert.equal(sizes, 1);
  const kept = list[0]; for (let i = 0; i < 200; i++) pass('normal', 'standard'); assert.equal(list[0], kept, 'list rows are the same objects through the drag');
  assert.equal(list[0], before);
  pass('rail', 'standard'); pass('normal', 'standard'); assert.equal(reloads, 1, 'opening the Library from its rail does redraw it');
  // the Expand button icon is not rewritten when it has not changed
  assert.match(src('devices.js'), /if \(btn\.dataset\.icon !== name \|\| !\/\^<svg\/\.test\(btn\.innerHTML\)\) \{ btn\.dataset\.icon = name; btn\.innerHTML = iconSvg\(name\); \}/, 'Expand icon only rewritten when it changes');
});
