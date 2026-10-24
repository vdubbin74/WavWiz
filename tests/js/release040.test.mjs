// WavWiz 0.4.0 Stage 2: the zone-selection helpers (pure), the zoneId the API gets, and the drag-drop target maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR; installDom(); const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const groups = [
  { id: 1, name: 'Kitchen', playbackId: 'default', linked: [], now: { title: 'A', state: 'playing' }, online: 2 },
  { id: 3, name: 'Basement', playbackId: 'zg:3', linked: ['Patio'], now: { title: 'C', state: 'paused' }, online: 1 },
  { id: 4, name: 'Patio', playbackId: 'zg:3', linked: ['Basement'], now: { title: 'C', state: 'paused' }, online: 0 }];
test('choices: every zone in order, the Jukebox only once it has its own speakers', async () => {
  const Z = await imp('zones40'); assert.equal(Z.choices(groups, null).length, 3); assert.equal(Z.choices(groups, { own: false }).length, 3);
  const c = Z.choices(groups, { own: true, zoneId: 'jukebox', now: { title: 'J' } }); assert.equal(c.length, 4); assert.equal(c[3].key, 'jukebox'); assert.equal(c[1].linked, true); assert.equal(c[0].linked, false);
});
test('resolve: a stale or missing selection falls back to the first zone; nothing when there are no zones', async () => {
  const Z = await imp('zones40'); assert.equal(Z.resolve(groups, null, 'g:3').name, 'Basement'); assert.equal(Z.resolve(groups, null, 'g:99').name, 'Kitchen'); assert.equal(Z.resolve(groups, null, null).name, 'Kitchen'); assert.equal(Z.resolve([], null, 'g:1'), null);
  assert.equal(Z.resolve(groups, { own: true, zoneId: 'jukebox' }, 'jukebox').kind, 'jukebox');
});
test('zoneIdFor: the house group adds nothing to the URL', async () => {
  const Z = await imp('zones40'); assert.equal(Z.zoneIdFor(Z.resolve(groups, null, 'g:1')), null); assert.equal(Z.zoneIdFor(Z.resolve(groups, null, 'g:4')), 'zg:3'); assert.equal(Z.zoneIdFor(null), null);
});
test('labels: now, link text, all linked', async () => {
  const Z = await imp('zones40'); assert.equal(Z.nowLabel({ title: 'S', state: 'playing' }), '▶ S'); assert.equal(Z.nowLabel({ title: 'S', state: 'paused' }), 'S'); assert.equal(Z.nowLabel(null), 'Nothing playing');
  assert.equal(Z.linkText(['Patio']), 'Linked with Patio'); assert.equal(Z.linkText(['A', 'B', 'C']), 'Linked with 3 zones'); assert.equal(Z.linkText([]), '');
  assert.equal(Z.allLinked(groups), false); assert.equal(Z.allLinked(groups.map(g => ({ ...g, playbackId: 'default' }))), true); assert.equal(Z.allLinked([groups[0]]), true);
  assert.equal(Z.livePos({ positionMs: 1000, durationMs: 5000, state: 'playing' }, 0, 2000), 3000); assert.equal(Z.livePos({ positionMs: 1000, durationMs: 1500, state: 'playing' }, 0, 9000), 1500); assert.equal(Z.livePos({ positionMs: 1000, durationMs: 5000, state: 'paused' }, 0, 9000), 1000);
});
test('selection is stored per browser', async () => {
  const Z = await imp('zones40'); const m = new Map(); const st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  assert.equal(Z.loadSel(st), null); Z.saveSel('g:3', st); assert.equal(Z.loadSel(st), 'g:3'); Z.saveSel(null, st); assert.equal(Z.loadSel(st), null);
});
test('withZone: stream / queue / save-queue calls name the zone; everything else is untouched', async () => {
  const U = await imp('util'); assert.equal(U.withZone('/stream', {}, 'zg:3'), '/stream?zoneId=zg%3A3'); assert.equal(U.withZone('/queue/add', {}, 'jukebox'), '/queue/add?zoneId=jukebox');
  assert.equal(U.withZone('/stream', {}, null), '/stream'); assert.equal(U.withZone('/stream/zones', {}, 'x'), '/stream/zones'); assert.equal(U.withZone('/zones/master', {}, 'x'), '/zones/master'); assert.equal(U.withZone('/stream?zoneId=a', {}, 'x'), '/stream?zoneId=a');
  assert.equal(U.withZone('/playlists', { body: { fromQueue: true } }, 'zg:3'), '/playlists?zoneId=zg%3A3'); assert.equal(U.withZone('/playlists', { body: { name: 'x' } }, 'zg:3'), '/playlists');
});
test('dropTarget: before the first card, between cards, after the last', async () => {
  const D = await imp('devorder'); const r = [{ top: 0, height: 100 }, { top: 110, height: 100 }, { top: 220, height: 100 }];
  assert.deepEqual(D.dropTarget(r, 10), { index: 0, after: false, grid: false }); assert.deepEqual(D.dropTarget(r, 70), { index: 1, after: false, grid: false }); assert.deepEqual(D.dropTarget(r, 300), { index: 2, after: true, grid: false }); assert.equal(D.dropTarget([], 5), null);
  const g = [{ top: 0, left: 0, width: 100, height: 50 }, { top: 0, left: 110, width: 100, height: 50 }, { top: 60, left: 0, width: 100, height: 50 }, { top: 60, left: 110, width: 100, height: 50 }];
  assert.deepEqual(D.dropTarget(g, 20, 190), { index: 1, after: true, grid: true }); assert.deepEqual(D.dropTarget(g, 80, 20), { index: 2, after: false, grid: true }); assert.equal(D.dropTarget(g, 200, 300).index, 3);
});
test('Stage 3: zone targets for alarms / sleep timer, summary names the zone', async () => {
  const Z = await imp('zones40'); const jb = { own: true, zoneId: 'jukebox' };
  assert.deepEqual(Z.targetKeys(groups, jb).map(x => x[0]), ['g:1', 'g:3', 'g:4', 'jukebox']); assert.deepEqual(Z.targetKeys(groups, null).length, 3);
  assert.equal(Z.targetName('g:3', groups, jb), 'Basement'); assert.equal(Z.targetName('jukebox', groups, jb), 'Jukebox'); assert.equal(Z.targetName('g:77', groups, jb), '(deleted zone)'); assert.equal(Z.targetName('', groups, jb), '');
  const S = await imp('scenesched');
  assert.match(S.summary({ action: 'play', payload: { source: 'radio', name: 'KEXP', zoneKey: 'g:3' } }, { groups }), /in Basement/);
  assert.match(S.summary({ action: 'stop', payload: { zoneKey: 'jukebox' } }, { groups, jb }), /Stop playback in Jukebox/);
  assert.equal(S.summary({ action: 'stop', payload: {} }, { groups }), 'Stop playback');
});
