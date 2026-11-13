// WavWiz 0.6.9 #12 (zone card order on the server, exactly as left - Jukebox / Unassigned / AirPlay included) and #13 (no per-tick MASTER swap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
globalThis.window ??= globalThis; globalThis.dispatchEvent ??= () => true; globalThis.CustomEvent ??= class { constructor(t) { this.type = t; } };
const D = await import(pathToFileURL(join(js, 'devorder.js')).href);
const C = (key, keys) => ({ key, keys: keys || [key] });
const def = [C('g:1'), C('g:2', ['g:2', 'g:5']), C('jukebox'), C('g:3'), C('unassigned'), C('airplay')];
const keys = l => l.map(c => c.key);

test('#12 arrangeCards: no saved order = the default; a saved order is shown exactly (AirPlay / Unassigned / Jukebox where the user put them)', () => {
  assert.deepEqual(keys(D.arrangeCards(def, null)), keys(def));
  const saved = ['airplay', 'g:3', 'unassigned', 'g:1', 'jukebox', 'g:2', 'g:5'];
  assert.deepEqual(keys(D.arrangeCards(def, saved)), ['airplay', 'g:3', 'unassigned', 'g:1', 'jukebox', 'g:2']);
  // a linked set is placed by the first of its zone keys
  const k2 = keys(D.arrangeCards(def, ['g:5', 'airplay'])); assert.equal(k2[0], 'g:2'); assert.ok(k2.indexOf('g:2') < k2.indexOf('airplay'));
});
test('#12 arrangeCards: a new zone the saved list does not know slots in after the last saved zone, never pushes the others around', () => {
  const saved = ['g:3', 'airplay', 'g:1', 'unassigned', 'jukebox', 'g:2', 'g:5'];
  const withNew = [...def, C('g:9')];
  assert.deepEqual(keys(D.arrangeCards(withNew, saved)), ['g:3', 'airplay', 'g:1', 'unassigned', 'jukebox', 'g:2', 'g:9']);
});
test('#12 moveCard / stepCard produce the full flat key list (linked sets keep all their zone keys)', () => {
  assert.deepEqual(D.moveCard(def, 'airplay', 'g:1', false), ['airplay', 'g:1', 'g:2', 'g:5', 'jukebox', 'g:3', 'unassigned']);
  assert.deepEqual(D.moveCard(def, 'g:1', 'unassigned', true), ['g:2', 'g:5', 'jukebox', 'g:3', 'unassigned', 'g:1', 'airplay']);
  assert.deepEqual(D.stepCard(def, 'unassigned', 'top')[0], 'unassigned');
  assert.deepEqual(D.stepCard(def, 'g:1', 'down').slice(0, 3), ['g:2', 'g:5', 'g:1']);
  assert.deepEqual(D.stepCard(def, 'airplay', 'bottom').at(-1), 'airplay');
});
test('#12 saveCardOrder is optimistic, PUTs once, and rolls back when the server refuses', async () => {
  D.setCardOrder(['g:1']); const puts = [];
  await D.saveCardOrder(['jukebox', 'g:1'], async k => { puts.push(k); });
  assert.deepEqual(D.getCardOrder(), ['jukebox', 'g:1']); assert.deepEqual(puts, [['jukebox', 'g:1']]);
  assert.ok(D.cardOrderChangedAt() > 0);
  await assert.rejects(D.saveCardOrder(['g:1', 'jukebox'], async () => { throw new Error('403'); }));
  assert.deepEqual(D.getCardOrder(), ['jukebox', 'g:1'], 'refused -> previous order back');
  // orderedGroups follows the shared order
  D.setCardOrder(['g:3', 'jukebox', 'g:1']);
  assert.deepEqual(D.orderedGroups([{ id: 1 }, { id: 2 }, { id: 3 }]).map(g => g.id), [3, 1, 2]);
  D.setCardOrder(null);
});
test('#12 tree42: every card is keyed and reorderable, loaded from / saved to /zones/order; main loads the order with the zones', () => {
  const t = readFileSync(join(js, 'tree42.js'), 'utf8'), m = readFileSync(join(js, 'main.js'), 'utf8'), ap = readFileSync(join(js, 'airplaysetup.js'), 'utf8');
  assert.match(t, /shownCards = arrangeCards\(cardList, getCardOrder\(\)\)/);
  assert.match(t, /key: 'unassigned'/); assert.match(t, /key: 'airplay'/); assert.match(t, /key: 'jukebox'/);
  assert.match(t, /api\('\/zones\/order', \{ method: 'PUT', body: \{ order: k \} \}\)/);
  assert.doesNotMatch(t, /active: b => rank\(b\) === 0/, 'no "active zones only" drag');
  assert.match(m, /api\('\/zones\/order'\)/); assert.match(ap, /cardDecor\?\.\(card\)/);
});
test('#13 the MASTER strip is not swapped every tick: alignment carried over, inline styles ignored when comparing', () => {
  const d = readFileSync(join(js, 'devices.js'), 'utf8');
  assert.match(d, /export function carryAlign\(old, fresh\)/);
  assert.match(d, /sansStyle\(old\) === sansStyle\(fresh\)\) return old;/);
  assert.match(d, /carryAlign\(old, fresh\);   \/\/ 0\.6\.9 #13/);
});
