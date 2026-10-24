// WavWiz 0.4.6 F30 - zones drag to reorder (tree42 attachZoneDrag on the pdrag engine). UI covered by tests/ui/f30zonedrag.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');

test('F30 zoneOrderAfterDrop: boxes move as a whole, before / after the target', async () => {
  const { zoneOrderAfterDrop } = await import(`${js}/devorder.js`);
  const b = [[1], [2, 3], [4]];
  assert.deepEqual(zoneOrderAfterDrop(b, 0, 2, true), ['2', '3', '4', '1']);
  assert.deepEqual(zoneOrderAfterDrop(b, 0, 2, false), ['2', '3', '1', '4']);
  assert.deepEqual(zoneOrderAfterDrop(b, 2, 0, false), ['4', '1', '2', '3']);
  assert.deepEqual(zoneOrderAfterDrop(b, 1, 0, false), ['2', '3', '1', '4']);   // a linked set stays together
  assert.deepEqual(zoneOrderAfterDrop(b, 1, 1, true), ['1', '2', '3', '4']);
});
test('F30 wiring: pointer engine, saved in the shared device order, tree redraws on a reorder, grab cursor, no link underline', () => {
  const t = src('tree42');
  assert.match(t, /attachZoneDrag\(root, model\.boxes/);
  assert.match(t, /startPointerDrag\(ev, grab, \(\) => \(\{ kind: 'zone42'/);
  assert.match(t, /saveOrder\(\{ \.\.\.o, g: zoneOrderAfterDrop/);
  assert.match(src('devices'), /orderedGroups\(S\.groups \|\| \[\]\)\.map\(g => g\.id\)\]\);/);
  const c = css();
  assert.match(c, /\.tree42 \.zcard42 \.zc42-body,\.tree42 \.zcard42 \.zname,\.tree42 \.qb42-pick\{cursor:grab/);
  assert.doesNotMatch(c, /\.qb42-pick:hover \.qb42-name\{[^}]*underline/);
});
test('F31: Roomy holds in the expanded views (Auto keeps the T1 opt-out); F32 no column mini player in tight; F33 strip label top-aligned', () => {
  const m = src('main'), c = css();
  assert.match(m, /isTight\(window\.innerWidth, pageZoom\(\), window\.devicePixelRatio \|\| 1, mode\) && \(mode === 'roomy' \|\| \(!P6\.exp && P6\.list !== 'expanded'\)\);\s+desk\.classList\.toggle\('tight', tight\)/);
  assert.match(m, /const need = wide\(\) && desk\.classList\.contains\('libexpanded'\)/);
  assert.match(c, /\.desk\.tight\.libexpanded \.npbar\{display:none!important\}/); assert.match(c, /\.desk\.tight\.libexpanded:not\(\.libdev\) \.minicol\{display:block!important;grid-area:2\/2\/3\/3!important/); assert.match(c, /\.desk\.tight\.listexpanded:not\(\.libexpanded\):not\(\.devexpanded\) \.npbar\{display:flex!important/);
  assert.match(c, /\.desk\.tight \.devtab\{align-items:flex-start;/);
});
test('version labels: one value (data-wwv), refreshed from the WebSocket hello', () => {
  const m = src('main');
  assert.match(m, /export function paintVersion/); assert.match(m, /m\.type === 'hello' && m\.data\?\.appVersion/);
  for (const f of ['main', 'about', 'menu']) assert.match(src(f), /'data-wwv': '[^']*\{v\}'/);
});
test('F34: the side Library tabs are one row with a tab-style ⋯ (no native select)', () => {
  const l = src('library'); assert.match(l, /if \(compact && !expanded\) return ctabRow\(T\);/); assert.match(l, /class: 'tabmore', role: 'tab'/);
});
test('F35: the tree trunk is drawn per row (ends at the last elbow), no fixed 14 px bottom', () => {
  const c = css(); assert.match(c, /\.zsp42:has\(\.sp42\)::before\{content:none\}/); assert.match(c, /\.zsp42>\.sp42:not\(:has\(~ \.sp42\)\)::after\{bottom:auto;height:calc\(50% \+ 4px\)\}/);
});
test('F36/F37: fullscreen Queue keeps the full-width bar; no corner mini box; art falls back to the themed placeholder', () => {
  const c = css(), m = src('main'), mi = src('mini');
  assert.match(c, /\.desk\.listexpanded:not\(\.libexpanded\):not\(\.devexpanded\):not\(\.tight\)/);
  assert.match(c, /\.desk\.tight:not\(\.libexpanded\) \.minicol,\.desk\.listexpanded:not\(\.libexpanded\) \.minicol\{display:none!important\}/);
  assert.doesNotMatch(m, /minicol\.addEventListener\('(click|pointerdown|keydown)'/); assert.match(mi, /noart/);
});
test('F38: the condensed player wears the active Now Playing layout (pn-<style>)', () => {
  const m = src('main'), c = css(); assert.match(m, /function paintMiniStyle/); assert.match(m, /wavwiz:npstyle/);
  for (const s of ['classic', 'center', 'stack', 'horizon']) assert.match(c, new RegExp('\\.minicol\\.pn-' + s));
});
test('F39: expanded Devices - Library rail full height, bar spans exactly the Devices column', () => {
  const c = css(); assert.match(c, /\.desk\.devexpanded:not\(\.libexpanded\):not\(\.tight\) \.libpanel\{grid-row:1\/3!important\}/);
  assert.match(c, /\.desk\.devexpanded:not\(\.libexpanded\):not\(\.tight\) \.npbar\{grid-area:2\/3\/3\/4!important\}/);
});
test('F40: no native <select> anywhere in the Library; themed dropdowns open the themed menu', () => {
  const l = src('library'); assert.doesNotMatch(l, /h\('select'/); assert.match(l, /const ddBtn = /); assert.match(css(), /0\.4\.6 F40: Library theme pass/);
});
test('F41: phone zone / speaker settings are a full-width sheet over the tree; closing clears the zone too', () => {
  const d = src('devices'), c = css(); assert.match(d, /setSpk: id => \{ spk = id; if \(id == null\) zsel = null;/); assert.match(d, /'data-act': 'pd-done'/);
  assert.match(d, /reconcile\(list, \[T\.treeNode\(false\), sel42 \? pwrap : null\]/); assert.match(c, /#p-zones \.pd42-sheet\{position:fixed;inset:0/); assert.match(c, /#p-zones\{overflow-x:hidden\}/);
});
test('F42/F43: EQ header wraps on narrow screens (44 px on touch); the phone drawer has a Done', () => {
  const c = css(); assert.match(c, /0\.4\.6 F42: EQ card header/); assert.match(c, /\.np-stage \.vbtns \.ib\{min-width:44px;min-height:44px\}/);
  assert.match(src('menu'), /'data-act': 'drawer-close'/); assert.match(c, /0\.4\.6 F43: phone theme \+ navigation pass/);
});
test('F45: fine -/+ and a typed box on the Delay slider only (1 ms, clamped, hold repeats)', () => {
  const s = src('spkset'); assert.match(s, /let delay = fineDelay\(delayRow\(\)\);/); assert.equal((s.match(/fineDelay\(/g) || []).length, 1);
  assert.match(s, /inputmode: \+r\.min < 0 \? 'text' : 'numeric'/); assert.match(s, /Math\.max\(\+r\.min, Math\.min\(\+r\.max, v\)\)/);
});
test('F46: collapse / expand cancels drags and ignores stray presses; row drops need a live session; qreorder needs a real move', () => {
  const l = src('listtable'), q = src('qreorder'); assert.match(l, /const settling = \(\) => performance\.now\(\) - toggledAt < 600/); assert.match(l, /if \(rows && !dragging\) return;/);
  assert.match(l, /th\.addEventListener\('click', \(\) => \{ if \(th\._drag\) \{ th\._drag = false; return; \} if \(settling\(\)\) return;/); assert.match(q, /e\.type === 'pointercancel' \|\| !moved/);
});
test('F47: scene editor - Update on its own row, Delete / Duplicate left, Cancel / Save right', () => {
  const s = src('scenesched'); assert.match(s, /class: 'row ss-updrow'/); assert.match(s, /class: 'ss-left'/); assert.match(s, /class: 'ss-right'/); assert.match(css(), /0\.4\.6 F47: scene editor action rows/);
});
