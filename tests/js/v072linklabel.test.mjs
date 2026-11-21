// 0.7.2 t2149u: linked zones show every zone name joined with " + " in the queue box title (they had only the leader's name, so zones nested
// under "Queue: Living Room" carried no sign that they were joined). Regression guard: the + label must stay on open, folded and empty linked boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const { treeModel, boxTitle } = await import(pathToFileURL(`${js}/tree42.js`).href);
const src = readFileSync(`${js}/tree42.js`, 'utf8');
const gs = [{ id: 1, name: 'Living Room', deviceIds: [1], playbackId: 'default', linked: ['Kitchen'] }, { id: 2, name: 'Kitchen', deviceIds: [2], playbackId: 'default', linked: ['Living Room'] }, { id: 3, name: 'Office', deviceIds: [3], playbackId: 'zg:3' }];
const zs = [1, 2, 3].map(id => ({ id, name: 'S' + id }));

test('a linked box title joins every zone with +; solo boxes keep their one name', () => {
  const m = treeModel(zs, gs);
  assert.equal(boxTitle(m.boxes[0], null), 'Queue: Living Room + Kitchen · IN SYNC');
  assert.equal(boxTitle(m.boxes[0], { state: 'playing' }), 'Queue: Living Room + Kitchen · IN SYNC');
  assert.equal(boxTitle(m.boxes[1], null), 'Queue: Office · IDLE');
  const three = treeModel(zs, gs.map(g => ({ ...g, playbackId: 'default', linked: ['x'] })));
  assert.equal(boxTitle(three.boxes[0], null), 'Queue: Living Room + Kitchen + Office · IN SYNC');
});
test('the open box shows that title; folded and empty linked rows keep "A + B"', () => {
  assert.match(src, /const bt = boxTitle\(box, now\), cut = bt\.lastIndexOf\(' · '\)/);
  assert.match(src, /h\('b', \{ class: 'qb42-name' \}, bt\.slice\(0, cut\)\)/);
  assert.match(src, /const name = linked \? box\.zones\.map\(g => g\.name\)\.join\(' \+ '\) : lead\.name;/);
  assert.match(src, /name = box\.zones\.map\(g => g\.name\)\.join\(' \+ '\);/);
});
