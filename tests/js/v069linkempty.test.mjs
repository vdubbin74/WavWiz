// 0.6.9 #29 (t1882): LINKED zones with no speakers (Upstairs + Rooftop, nothing playing) are one card with both names, a working chevron and
// each member zone listed with 'No speakers' and Split off. Before, emptyBox(leader) drew only the leader: the dragged-in zone vanished and
// nothing could split them. Linked zones WITH speakers keep the queue box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const t = readFileSync(join(js, 'tree42.js'), 'utf8');
const { treeModel } = await import(join(js, 'tree42.js')).catch(() => ({}));
const body = t.slice(t.indexOf('const linkedEmptyBox ='), t.indexOf('// 0.4.9 F69: ONE manual order list'));

test('the server shape of two linked empty zones is ONE linked box with both zones (treeModel)', () => {
  const gs = [{ id: 5, name: 'Upstairs', deviceIds: [], playbackId: 'zg:5', linked: ['Rooftop'] }, { id: 6, name: 'Rooftop', deviceIds: [], playbackId: 'zg:5', linked: ['Upstairs'] }, { id: 4, name: 'Patio', deviceIds: [], playbackId: 'zg:4', linked: [] }];
  // tree42.js imports DOM modules; run the pure treeModel source on its own
  const src = t.slice(t.indexOf('export function treeModel'), t.indexOf('/** Creates a zone with its own queue'));
  const tm = treeModel || new Function(src.replace('export function', 'function') + '; return treeModel;')();
  const m = tm([], gs);
  assert.equal(m.boxes.length, 2);
  assert.deepEqual(m.boxes[0].zones.map(g => g.name), ['Upstairs', 'Rooftop']); assert.equal(m.boxes[0].kind, 'linked');
});

test('dispatch: an all-empty LINKED box uses linkedEmptyBox; solo empty zones keep emptyBox; speakers keep queueBox', () => {
  assert.match(t, /rank\(b\) === 2 \? \(b\.kind === 'linked' \? linkedEmptyBox\(b\) : emptyBox\(b\.leader, false, b\)\) : queueBox\(b\)/);
});

test('linkedEmptyBox: one card, both names, chevron, members with No speakers + Split off, no song needed', () => {
  assert.match(body, /name = box\.zones\.map\(g => g\.name\)\.join\(' \+ '\)/, 'title "Upstairs + Rooftop" like a folded linked box');
  assert.match(body, /folded = isFolded\(box\)/);
  assert.match(body, /foldBtn\(box, folded, name\)/, 'the same working chevron as the other zone boxes (F266 folds)');
  assert.match(body, /\.\.\.\(folded \? \[\] : box\.zones\.map\(member\)\)/, 'open = every member zone listed');
  assert.match(body, /'data-group-id': g\.id, 'data-drop': g\.id, 'data-zone': g\.name/, 'each member stays a drop / drag target');
  assert.match(body, /h\('span', \{ class: 'small dim ze42-note' \}, 'No speakers'\)/);
  assert.match(body, /'data-act': 'split'[^\n]*Z\.splitOff\(g, done\)/);
  assert.match(body, /zoneCtx\(g, row\.firstChild\)/, 'the zone menu (Split off, Link, …) on each member');
  assert.match(body, /'data-box': 'linked', 'data-leader-id': lead\.id/);
  assert.doesNotMatch(body, /now\?\.title|nowLine/, 'nothing in it depends on a song playing');
  assert.match(body, /return pickRow\(wrap, \(\) => controlZone\(lead\.id\)\);/);
});
