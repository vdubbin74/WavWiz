// WavWiz 0.4.2 - pure logic: zone tree model, move plan, titles, queue suffix, context-menu builders, EQ preset grouping. UI is covered by tests/ui/ui042.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const zones = [1, 2, 3, 4, 5].map(id => ({ id, name: 'S' + id }));
const groups = [
  { id: 10, name: 'Patio', deviceIds: [1], playbackId: 'zg:10', linked: ['x'] }, { id: 11, name: 'Kitchen', deviceIds: [2, 3], playbackId: 'zg:10', linked: ['x'] },
  { id: 12, name: 'Garage', deviceIds: [], playbackId: 'zg:12' }];

test('treeModel: boxes, unassigned, counts', async () => {
  const { treeModel, countsText } = await imp('tree42'); const m = treeModel(zones, groups);
  assert.deepEqual(m.boxes.map(b => b.kind), ['linked', 'solo']); assert.equal(m.boxes[0].zones.length, 2); assert.equal(m.boxes[0].leader.name, 'Patio');
  assert.deepEqual(m.unassigned.map(z => z.id), [4, 5]); assert.equal(countsText(m), 'ZONES 3 · SPEAKERS 5');
  assert.deepEqual(treeModel([], []).boxes, []);
});
test('boxTitle', async () => {
  const { treeModel, boxTitle } = await imp('tree42'); const m = treeModel(zones, groups);
  assert.equal(boxTitle(m.boxes[0], null), 'Queue: Patio · IN SYNC'); assert.equal(boxTitle(m.boxes[1], { state: 'playing' }), 'Queue: Garage · PLAYING'); assert.equal(boxTitle(m.boxes[1], null), 'Queue: Garage · IDLE');
});
test('movePlan: a speaker belongs to exactly one zone', async () => {
  const { movePlan } = await imp('tree42');
  const add = movePlan(groups, 4, 12); assert.deepEqual(add, [{ id: 12, name: 'Garage', deviceIds: [4] }]);
  const mv = movePlan(groups, 3, 12); assert.deepEqual(mv.map(o => o.id), [12, 11]); assert.deepEqual(mv[1].deviceIds, [2]);
  const un = movePlan(groups, 1, null); assert.deepEqual(un, [{ id: 10, name: 'Patio', deviceIds: [] }]);
  assert.deepEqual(movePlan(groups, 1, 10), []);
});
test('isControlling', async () => { const { isControlling } = await imp('tree42'); assert.ok(isControlling({ id: 3 }, { kind: 'zone', id: 3 })); assert.ok(!isControlling({ id: 3 }, { kind: 'device', id: 3 })); assert.ok(!isControlling({ id: 3 }, null)); });
test('crumb', async () => { const { crumb } = await imp('tree42'); assert.equal(crumb('Basement', 'PC'), 'Basement > PC'); assert.equal(crumb(null, 'PC'), 'Unassigned > PC'); assert.equal(crumb('Basement'), 'Basement'); });
test('queueSuffix + leaderOf', async () => {
  const { queueSuffix, leaderOf } = await imp('zones40');
  assert.equal(queueSuffix(groups, { kind: 'zone', id: 12, name: 'Garage' }), ' · GARAGE');
  assert.equal(queueSuffix(groups, { kind: 'zone', id: 10, name: 'Patio', linked: ['x'], playbackId: 'zg:10' }), ' · PATIO + KITCHEN');
  assert.equal(queueSuffix(groups, { kind: 'zone', id: 11, name: 'Kitchen', linked: ['x'], playbackId: 'zg:10' }), ' FROM PATIO'); assert.equal(queueSuffix(groups, null), '');
  assert.equal(leaderOf(groups, groups[1]).name, 'Patio'); assert.equal(leaderOf(groups, groups[2]).name, 'Garage');
});
test('zone menu: items, Split off only when linked, Link submenu', async () => {
  const { zoneMenu42 } = await imp('ctxmenu'); const lab = l => l.filter(i => !i.sep).map(i => i.label);
  const a = { admin: true, can: true, others: [{ id: 2, name: 'B' }], linked: false };
  assert.deepEqual(lab(zoneMenu42(a)), ['Play', 'Mute', 'Set as Controlling', 'Open queue', 'Link to…', 'Rename', 'Delete zone']);
  assert.deepEqual(lab(zoneMenu42({ ...a, linked: true, playing: true, muted: true })), ['Pause', 'Unmute', 'Set as Controlling', 'Open queue', 'Link to…', 'Split off', 'Rename', 'Delete zone']);
  assert.equal(zoneMenu42(a).find(i => i.id === 'link').sub[0].label, 'B'); assert.ok(zoneMenu42({ ...a, others: [] }).find(i => i.id === 'link').disabled);
  assert.ok(zoneMenu42({ ...a, controlling: true }).find(i => i.id === 'control').disabled); assert.ok(zoneMenu42({ ...a, admin: false }).find(i => i.id === 'delete').disabled);
  assert.ok(zoneMenu42(a).every(i => i.sep || i.ic));
});
test('speaker + unassigned menus', async () => {
  const { speakerMenu42, unassignedMenu42 } = await imp('ctxmenu');
  const s = speakerMenu42({ admin: true, can: true, muted: false, on: true, canCalibrate: true, zones: [{ id: 2, name: 'B' }] });
  assert.deepEqual(s.map(i => i.label), ['Mute', 'Settings', 'Move to zone', 'Calibrate', 'Rename', 'Disable']);
  assert.deepEqual(s[2].sub.map(i => i.label), ['B', 'Unassigned']); assert.ok(s.every(i => i.ic));
  assert.equal(speakerMenu42({ admin: true, can: true, muted: true, on: false, zones: [] })[0].label, 'Unmute'); assert.equal(speakerMenu42({ admin: true, can: true, on: false, zones: [] })[5].label, 'Enable');
  assert.ok(speakerMenu42({ admin: false, can: true, zones: [] })[2].disabled);
  const u = unassignedMenu42({ admin: true, zones: [{ id: 2, name: 'B' }] }); assert.deepEqual(u.map(i => i.label), ['Add to zone', 'Settings']); assert.ok(unassignedMenu42({ admin: true, zones: [] })[0].disabled);
});
test('groupPresets: Flat + 7 ordered built-ins, then My presets', async () => {
  const { groupPresets } = await imp('eqsettings');
  const names = ['Flat', 'Bass Boost', 'Treble Boost', 'Vocal', 'Late Night', 'Movie Night', 'Bluetooth Speaker', 'Rock / Metal'];
  const ps = [...names.map(n => ({ name: n, source: 'builtin' })).reverse(), { name: 'Mine', source: 'user' }, { name: 'Old Retired', source: 'user' }];
  const g = groupPresets(ps); assert.deepEqual(g.flatMap(x => x.items).map(p => p.name).slice(0, 8), names); assert.equal(g.at(-1).label, 'My presets'); assert.deepEqual(g.at(-1).items.map(p => p.name), ['Mine', 'Old Retired']);
});
test('EQ view keeps "Adjusting: <speaker>"', async () => {
  const { readFileSync } = await import('node:fs'); const cv = readFileSync(`${js}/centerview.js`, 'utf8');
  assert.match(cv, /`Adjusting: \$\{o\.zone\}`/);
  const lk = await imp('looks'); assert.ok(lk.overlayButtons('eq').includes('lock'));
});
