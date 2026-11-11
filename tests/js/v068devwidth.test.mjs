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
