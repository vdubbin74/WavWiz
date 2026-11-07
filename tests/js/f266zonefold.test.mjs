// F266: every zone box folds to one compact row; saved per zone; green dot for an active speaker; old idle ▸/▾ toggle gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
installDom(); globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
const js = process.env.JS_DIR, src = f => readFileSync(join(js, f), 'utf8');
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('F266 fold state persists per zone in localStorage (wavwiz.zfold)', async () => {
  const T = await import(pathToFileURL(join(js, 'tree42.js')).href), st = mem();
  assert.equal(T.FOLD_KEY, 'wavwiz.zfold'); assert.deepEqual([...T.loadZoneFolds(st)], []);
  T.saveZoneFolds(new Set(['3', '7']), st); assert.deepEqual([...T.loadZoneFolds(st)], ['3', '7']);
  st.setItem('wavwiz.zfold', 'garbage'); assert.deepEqual([...T.loadZoneFolds(st)], []);
});
test('F266 tree42: folded box = compact empty-zone row with toggle + green dot; open box toggle on the title row; idle ▸ n toggle removed', () => {
  const t = src('tree42.js');
  assert.match(t, /if \(isFolded\(box\)\) return foldedBox\(box, \{ lead, linked, sel, ms, now \}\);/);
  assert.match(t, /class: 'qb42 empty42 zfold42'/); assert.match(t, /foldBtn\(box, true, name\), dot,/);
  assert.match(t, /const active = ms\.filter\(z => z\.enabled !== false && z\.connected\)/); assert.match(t, /'dot zfold42-dot ' \+ \(active\.length \? 'ok' : 'off'\)/);
  assert.match(t, /h\('div', \{ class: 'qb42-head' \}, h\('div', \{ class: 'qb42-trow' \}, expand, title\), Z\.nowLine\(/);
  assert.doesNotMatch(t, /class: 'qb42-exp' \+ \(collapsed/, 'old zone speakers toggle gone');
});
test('F266 devices.js: fold changes rebuild the tree (fold signature + storage signature)', () => {
  const d = src('devices.js');
  assert.match(d, /e\.classList\.contains\('zfold42'\) \? 'F' : ''/); assert.match(d, /localStorage\.getItem\('wavwiz\.zfold'\)/);
  const css = src('../app.css'); assert.match(css, /\.qb42\.idle \.qb42-head\{flex-direction:column;flex-wrap:nowrap;align-items:stretch\}/); assert.match(css, /\.zfold42-dot\.ok\{background:var\(--green/);
});
