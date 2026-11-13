// WavWiz 0.6.9 (t1837u-t1839u): every player opens Now Playing on the zone that holds its own speaker (on open and on connect), falls back to the
// last pick, then the first card in the Devices order; a zone the user picks by hand sticks for the session - no refresh / membership change / reconnect moves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {};
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.dispatchEvent ??= () => true;
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
const ls = mem(), ss = mem();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true });
const cls = () => ({ toggle() {}, add() {}, remove() {}, contains: () => false });
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { classList: cls() },
  documentElement: { style: { setProperty() {} }, classList: cls(), dataset: {} }, createElement: () => ({ style: {}, classList: cls(), setAttribute() {}, append() {} }) };
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');

// Upstairs is first in the server list (the bug: with no stored pick the app fell back to it); the phone's web speaker (id 3) is in Basement.
const groups = () => [{ id: 1, name: 'Upstairs', deviceIds: [1, 2] }, { id: 2, name: 'Basement', deviceIds: [3] }, { id: 9, name: 'Everywhere', deviceIds: [1, 2, 3] }];
const zones = (on = true) => [{ id: 1, playerId: 'pc-a', connected: true }, { id: 2, playerId: 'pc-b', connected: true }, { id: 3, playerId: 'web-phone', connected: on }];
const fresh = async () => { const Z = await imp('zones40'); ls.clear(); ss.clear(); Z._resetAutoPick(); ls.setItem('wavwiz.webRoom.id', 'web-phone'); return Z; };

test('ownZoneKey: the smallest zone holding the speaker; the last pick wins when it also holds it; none = null', async () => {
  const { ownZoneKey } = await imp('zones40');
  assert.equal(ownZoneKey(groups(), { id: 3 }, null), 'g:2');
  assert.equal(ownZoneKey(groups(), { id: 3 }, 'g:1'), 'g:2');           // Upstairs does not hold it
  assert.equal(ownZoneKey(groups(), { id: 3 }, 'g:9'), 'g:9');           // Everywhere does - keep the user's last pick
  assert.equal(ownZoneKey(groups(), { id: 7 }, null), null);
  assert.equal(ownZoneKey(groups(), null, null), null);
});

test('open: the phone / home-screen app opens on Basement (its own speaker), not Upstairs (first in the list)', async () => {
  const Z = await fresh();
  const S = { groups: groups(), zones: zones(), jb: null };
  Z.init(S);
  assert.equal(Z.current().name, 'Basement');
});

test('Windows Player window: the server-marked "mine" speaker picks its zone too', async () => {
  const Z = await fresh(); ls.removeItem('wavwiz.webRoom.id');
  const S = { groups: groups(), zones: [{ id: 1, connected: true, mine: true }, { id: 3, connected: true }], jb: null };
  Z.init(S);
  assert.equal(Z.current().name, 'Upstairs');
  ls.setItem('wavwiz.zone', 'g:2'); Z._resetAutoPick(); Z.init(S);    // stale pick that does not hold the PC's speaker: open still goes to the PC's zone
  assert.equal(Z.current().name, 'Upstairs');
});

test('fallbacks: no own speaker -> last pick; no last pick -> first card in the Devices card order', async () => {
  const Z = await fresh(); ls.removeItem('wavwiz.webRoom.id');
  const S = { groups: groups(), zones: zones(), jb: null };
  ls.setItem('wavwiz.zone', 'g:9'); Z.init(S);
  assert.equal(Z.current().name, 'Everywhere');
  const { setCardOrder } = await imp('devorder');
  ls.removeItem('wavwiz.zone'); setCardOrder(['g:2', 'g:1', 'g:9']); Z.sync();
  assert.equal(Z.current().name, 'Basement');
  setCardOrder(null);
});

test('manual pick sticks for the session: later refreshes, membership changes and reconnects never move it', async () => {
  const Z = await fresh();
  const S = { groups: groups(), zones: zones(), jb: null };
  Z.init(S);
  assert.equal(Z.current().name, 'Basement');
  Z.select('g:1');
  assert.equal(Z.current().name, 'Upstairs');
  Z.sync();                                                                   // a zones poll
  assert.equal(Z.current().name, 'Upstairs');
  S.groups = [{ id: 1, name: 'Upstairs', deviceIds: [1] }, { id: 2, name: 'Basement', deviceIds: [2, 3] }, groups()[2]]; Z.sync();   // membership change
  assert.equal(Z.current().name, 'Upstairs');
  S.zones = zones(false); Z.sync(); S.zones = zones(true); Z.sync();           // the phone speaker drops and reconnects
  assert.equal(Z.current().name, 'Upstairs');
  assert.equal(ss.getItem(Z.PICKED_KEY), '1');                               // survives a reload of the same window (sessionStorage)
});

test('connect: a speaker that connects after open pulls the view to its zone (no manual pick yet); before that the old fallback holds', async () => {
  const Z = await fresh();
  const S = { groups: groups(), zones: zones(false), jb: null };
  ls.setItem('wavwiz.zone', 'g:1');
  Z.init(S);                                                                  // open while the phone speaker is not connected: still its zone
  assert.equal(Z.current().name, 'Basement');
  ls.setItem('wavwiz.zone', 'g:1');                                           // (e.g. picked in another window before this one saw it)
  Z.sync();                                                                   // ordinary poll, still not connected: no move
  assert.equal(Z.current().name, 'Upstairs');
  S.zones = zones(true); Z.sync();                                            // connect
  assert.equal(Z.current().name, 'Basement');
  S.zones = zones(true); Z.sync(); ls.setItem('wavwiz.zone', 'g:1'); Z.sync(); // staying connected is not a new connect
  assert.equal(Z.current().name, 'Upstairs');
});

test('wired: sync runs the open/connect pick, select marks a manual pick, the stand-alone mini player loads /zones', () => {
  const z = src('zones40');
  assert.match(z, /if \(!S\) return; autoPick\(\);/);
  assert.match(z, /export function select\(key\) \{ markPicked\(\);/);
  assert.match(src('mini'), /api\('\/zones'\)\.catch\(\(\) => mz\.zones\)\]\); mz\.groups = g; mz\.jb = jb; mz\.zones = zs;/);
});
