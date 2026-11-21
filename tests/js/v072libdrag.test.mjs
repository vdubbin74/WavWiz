// 0.7.2 t2191u: on the phone, holding a Library item to drag it no longer selects text / shows the iOS callout; holding still opens the menu,
// moving drags, and dropping on the mini player / Now Playing plays it now in the current zone. Desktop unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = f => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/' + f, import.meta.url), 'utf8');
const ui = rd('js/ui.js'), pd = rd('js/pdrag.js'), css = rd('app.css');
test('t2191u: Library tiles / rows never select text or show the iOS callout (phone only)', () => {
  assert.match(css, /html\.handset \.ldrag,html\.handset \.ldrag \*,html\.handset \.tile,html\.handset \.tile \*,html\.handset \.item,html\.handset \.item \*\{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none\}/);
  assert.doesNotMatch(css, /^\.ldrag\{[^}]*user-select/m);   // desktop rule untouched
  assert.match(css, /\.item\.ldrag,\.tile\.ldrag,\.ldrag\{cursor:grab\}/);
});
test('t2191u: holding still opens the menu and that press can no longer become a drag; a running drag never opens it', () => {
  assert.match(ui, /t = setTimeout\(\(\) => \{ if \(PD\.active\) \{ t = null; return; \} fired = true; cancelPendingDrag\(\);/);
  assert.match(ui, /el\.addEventListener\('touchmove', ev => \{ const p = ev\.touches\[0\]; if \(Math\.abs\(p\.clientX - sx\) > 9 \|\| Math\.abs\(p\.clientY - sy\) > 9\) cancel\(\); \}/);   // moving cancels the menu
  assert.match(pd, /export function cancelPendingDrag\(\) \{ const f = pendingStop; pendingStop = null; f\?\.\(\); \}/);
  assert.match(pd, /const mine = \(\) => \{ if \(!started\) stop\(\); \}; pendingStop = mine;/);   // only a not-yet-started press is dropped
  assert.match(pd, /PD\.active = \{ payload: p, x, y, target: null, pointerType: type \}; pendingStop = null;/);
});
test('t2191u: drop on the mini player / full Now Playing = Play now in the current zone; phone only; queue targets unchanged', () => {
  assert.match(ui, /export const PHONE_NOW_DROP = 'section\.mini, \.np-phone-full:not\(\[hidden\]\)';/);
  assert.match(ui, /if \(typeof document === 'undefined' \|\| !document\.documentElement\.classList\.contains\('handset'\)\) return;/);
  assert.match(ui, /drop: async p => \{ el\.classList\.remove\('npdrop-over'\); if \(await playNow\(p\.ref\)\) toast\('Playing ' \+ \(p\.title \|\| 'it'\) \+ ' now'\); \}/);
  assert.match(ui, /onStart: \(\) => \{[^}]*phoneNowDrops\(\); \},/); assert.match(ui, /onEnd: \(\) => \{[^}]*phoneNowDropsOff\(\); \} \}\);/);
  assert.match(ui, /export const playNow = ref => act\('\/stream\/play', ref\);/);   // the same call as the menu's "Play now" (replaces the queue, keeps Undo)
  assert.match(css, /html\.handset \.npdrop-over\{outline:3px solid var\(--accent\)/);
});
test('t2191u: cancelPendingDrag stops a held press that has not started dragging', async () => {
  const listeners = new Map(); const doc = { addEventListener: (t, f) => listeners.set(t + (listeners.has(t) ? '2' : ''), f), removeEventListener: t => listeners.delete(t), documentElement: { classList: { contains: () => true } }, body: { classList: { add() {}, remove() {} } } };
  globalThis.document = doc; globalThis.window = globalThis.window || { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const m = await import(process.env.JS_DIR ? process.env.JS_DIR + '/pdrag.js' : '../../src/WavWiz.Server/wwwroot/js/pdrag.js');
  assert.equal(typeof m.cancelPendingDrag, 'function'); m.cancelPendingDrag();   // nothing pending: a no-op
});
