// F236: right-click Add/Remove Favorites on Library songs + Queue songs.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const ui = readFileSync(dir.replace(/\/?$/, '/') + 'ui.js', 'utf8');
assert.match(ui, /export function trackIdFromRef/);
assert.match(ui, /export function favActionForTrack/);
assert.match(ui, /favActionForTrack\(S, trackIdFromRef\(ref\)/);
assert.match(ui, /Remove from Favorites/);
assert.match(ui, /Add to Favorites/);
const tid = new Function(ui.match(/export function trackIdFromRef[\s\S]*?\n}/)[0].replace('export ', '') + '\nreturn trackIdFromRef;')();
assert.equal(tid({ kind: 'tracks', ids: [7] }), 7);
assert.equal(tid({ kind: 'tracks', ids: [1, 2] }), null);
assert.equal(tid({ kind: 'remote' }), null);
const qm = readFileSync(dir.replace(/\/?$/, '/') + 'queuemenu.js', 'utf8');
assert.match(qm, /export function queueFavoriteItem/);
assert.match(qm, /FAV_REMOTE_HINT/);
assert.match(qm, /case 'favorite'/);
assert.match(qm, /favorite: fav/);
const isFav = () => false;
const fn = qm.match(/export function queueFavoriteItem[\s\S]*?\n}/)[0].replace('export ', '')
  + '\n' + qm.match(/export const FAV_REMOTE_HINT[\s\S]*?;/)[0].replace('export ', '')
  + '\n' + qm.match(/export function queueMenuItems[\s\S]*?\n}/)[0].replace('export ', '')
  + '\nreturn { queueFavoriteItem, queueMenuItems, FAV_REMOTE_HINT };';
const api = new Function('isFav', fn)(isFav);
const remote = api.queueFavoriteItem({ kind: 'remote', refId: 'x' });
assert.equal(remote.disabled, true);
assert.match(remote.hint, /library songs/i);
const radio = api.queueFavoriteItem({ kind: 'radio', refId: 1 });
assert.equal(radio.disabled, true);
const local = api.queueFavoriteItem({ kind: 'track', refId: 42 }, { canFav: true });
assert.equal(local.id, 'favorite');
assert.equal(local.disabled, false);
assert.ok(api.queueMenuItems({ i: 0, n: 2, favorite: local }).some(x => x.id === 'favorite'));
console.log('f236ctxfavorite ok');
