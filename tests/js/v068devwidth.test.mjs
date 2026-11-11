// 0.6.8c: resizing the window never resizes the docked Devices panel - only the middle column grows / shrinks, down to the phone layout
// (<= 900 px). The expanded Speakers column never keeps a narrow width measured in a slide-over / phone layout.
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

test('wide -> just above the narrow breakpoint -> wide: Devices width constant, middle column changes', async () => {
  const P = await imp('panels');
  const p = P.normPanels({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open', ctlSet: true });
  const devW = (e, w) => (P.shown(e, 'dev') === 'rail' ? P.RAIL_PX : P.DEV_PX);
  const mids = [];
  for (const w of [1920, 1600, 1300, 1100, 1000, 950, 901, 1100, 1600, 1920]) {
    const e = P.effective(p, w);
    assert.equal(P.shown(e, 'dev'), 'normal', `${w}px: Devices stays docked open`);
    assert.equal(devW(e, w), 380, `${w}px: Devices keeps 380 px`);
    const np = P.npWidth(e, w); assert.ok(np >= P.NP_MIN, `${w}px: middle ${np}`); mids.push(np);
  }
  assert.ok(new Set(mids).size > 3, 'the middle column is what changes');
  assert.equal(mids[0], mids[mids.length - 1], 'back to the same layout at the same width');
  assert.equal(p.lib, 'normal', 'auto-rail is never saved');
  // opening the Library from its rail still folds Devices (the user's explicit choice wins)
  assert.equal(P.effective(p, 920, { opened: 'lib' }).dev, 'rail');
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
