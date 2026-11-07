// F269: Devices speaker drag - drag back to the original zone works; the move shows at once (optimistic), never held by hover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
installDom(); globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
const js = process.env.JS_DIR;

test('F269 A->B then back B->A: source zone read live, A becomes a target again', async () => {
  const { applyMovePlan, movePlan, dragFromKey } = await import(pathToFileURL(join(js, 'tree42.js')).href);
  const S = { groups: [{ id: 1, name: 'A', deviceIds: [5, 6] }, { id: 2, name: 'B', deviceIds: [7] }] };
  applyMovePlan(S, movePlan(S.groups, 5, 2));
  assert.deepEqual(S.groups.map(g => g.deviceIds), [[6], [7, 5]]);
  assert.equal(dragFromKey(S.groups, 5).fromKey, '2', 'after the move the source is B, so A is droppable');
  assert.ok(S._optAt > 0);
  applyMovePlan(S, movePlan(S.groups, 5, 1));
  assert.deepEqual(S.groups.map(g => g.deviceIds), [[6, 5], [7]]);
  assert.equal(dragFromKey(S.groups, 5).fromKey, '1');
  applyMovePlan(S, movePlan(S.groups, 5, null));
  assert.equal(dragFromKey(S.groups, 5).fromKey, 'none');
});
test('F269 wiring: source read at drag start, optimistic redraw, hover hold skipped for membership moves, stale poll ignored', () => {
  const t = readFileSync(join(js, 'tree42.js'), 'utf8'), d = readFileSync(join(js, 'devices.js'), 'utf8'), m = readFileSync(join(js, 'main.js'), 'utf8');
  assert.match(t, /const onStart = \(\) => \{\s*\(\{ from, fromKey \} = dragFromKey\(S\.groups, id\)\);/);
  assert.doesNotMatch(t, /const from = \(S\.groups \|\| \[\]\)\.find\(g => \(g\.deviceIds \|\| \[\]\)\.includes\(id\)\), fromKey/);
  assert.match(t, /const plan = movePlan\(S\.groups, z\.id, toId\);\s*applyMovePlan\(S, plan\);\s*try \{ window\.dispatchEvent\(new CustomEvent\('wavwiz:devredraw'\)\)/);
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode && tnode\.isConnected && hov42\(tnode\)\) return tnode;/);
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode && tnode\.isConnected\) \{ const fresh = treeEl/);
  assert.match(d, /tmem = mem;/);
  assert.match(m, /if \(\(S\._optAt \|\| 0\) >= t0\) g = S\.groups;/);
});
