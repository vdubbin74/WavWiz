// 0.6.8-#14: AirPlay… button + inline Find / Test / Add card; own receiver never addable; AIRPLAY speaker tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
globalThis.Element ??= class {}; globalThis.document ??= undefined;
globalThis.sessionStorage = { _m: Object.create(null), getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
const dir = process.env.JS_DIR ? 'file://' + process.env.JS_DIR + '/' : new URL('js/', W).href;
const { apRow, apProblem, STEPS, TV_STEPS, apFindList, apBadge, apStatus, apStep, apMergeRemembered, _apReset } = await import(dir + 'airplaysetup.js');

test('three steps, and only implemented devices can be picked', () => {
  assert.deepEqual(STEPS, ['Find', 'Test', 'Add to zone']);
  const self = apRow({ self: true, name: 'WavWiz – Everywhere' });
  assert.equal(self.pick, false);
  const found = apFindList([{ self: true, name: 'WavWiz – Everywhere', id: 'a' }, { self: false, name: 'Other WavWiz', id: 'b' }, { name: 'Kitchen Sonos', id: 'c' }]);
  assert.deepEqual(found.map(d => d.id), ['b', 'c']);
  assert.equal(apRow({ block: 'HomePod and Apple TV need a pairing WavWiz can’t do yet.', blockCode: 'auth' }).pick, false);
  assert.equal(apRow({ added: true }).pick, false);
  const ap2 = apRow({ airplay2: true, route: 'airplay2-ptp', manufacturer: 'Sonos' });
  assert.equal(ap2.pick, true); assert.match(ap2.note, /AirPlay 2 \(experimental\)/);
  assert.match(apRow({ route: 'raop', tv: true, manufacturer: 'Samsung' }).note, /TV/);
  assert.equal(apRow({ remembered: true, online: false, added: true }).pick, false);
});

test('badges and status text match the guided card', () => {
  assert.deepEqual(apBadge({ route: 'raop' }), { text: 'AirPlay 1 · Supported', kind: 'ap1' });
  assert.deepEqual(apBadge({ airplay2: true, route: 'airplay2-ptp' }), { text: 'AirPlay 2 · Experimental', kind: 'ap2' });
  assert.equal(apBadge({ block: 'HomePod and Apple TV need a pairing WavWiz can’t do yet.', blockCode: 'auth' }).kind, 'blocked');
  assert.equal(apStatus({}).text, '');
  assert.equal(apStatus({}, { busy: 'Connecting…' }).text, 'Testing…');
  assert.equal(apStatus({}, { heard: 'ask' }).text, '✓ Test sound played');
  assert.equal(apStatus({ added: true }).text, 'Added');
  assert.equal(apStatus({ remembered: true, online: false }).text, 'Remembered · Offline');
  assert.equal(apStep({}, null), 0);
  assert.equal(apStep({ heard: 'ask' }, { id: 'x' }), 1);
  assert.equal(apStep({ heard: 'yes' }, { id: 'x' }), 2);
});

test('remembered offline speakers come from zones airplay: playerIds (no invented backend)', () => {
  const merged = apMergeRemembered(
    [{ id: 'live', name: 'Kitchen', self: false }, { id: 'me', name: 'WavWiz', self: true }],
    [{ id: 1, name: 'Den Speaker', playerId: 'airplay:den1', connected: false }, { id: 2, name: 'Kitchen', playerId: 'airplay:live', connected: true }, { id: 3, name: 'PC', playerId: 'wasapi:0' }]);
  assert.deepEqual(merged.map(d => d.id), ['live', 'den1']);
  assert.equal(merged[1].remembered, true);
  assert.equal(merged[1].online, false);
  assert.equal(merged[1].added, true);
});

test('server error classes come through; Retry only when the server says so; no PIN promise', () => {
  const e = Object.assign(new Error('pair-setup M1: 403 Forbidden'), { data: { code: 'denied', title: 'The device said no', text: 'x', retry: true } });
  assert.deepEqual(apProblem(e, 'TV'), { code: 'denied', title: 'The device said no', text: 'x', retry: true });
  assert.equal(apProblem(Object.assign(new Error('y'), { data: { code: 'transport', retry: false } }), 'S').retry, false);
  assert.ok(TV_STEPS.some(t => /can’t type a PIN/.test(t)));
  const src = rd('js/airplaysetup.js');
  assert.doesNotMatch(src, /enter (the )?PIN|type the PIN/i);
  assert.match(src, /PIN aren’t supported yet|PIN aren't supported yet/);
});

test('AirPlay speakers card sits below Unassigned as a real zone card; no header AirPlay… button', () => {
  const t = rd('js/tree42.js');
  assert.doesNotMatch(t, /apsetup-btn/);
  assert.doesNotMatch(t, /AirPlay…/);
  assert.match(t, /root\.append\(unBox\)/);
  assert.match(t, /if \(admin\) \{ const apc = airPlaySetupCard\(S, ctl\); if \(apc\) root\.append\(apc\); \}/);
  const src = rd('js/airplaysetup.js');
  assert.match(src, /export function openAirPlaySetup/);
  assert.match(src, /apsetup-card/);
  assert.match(src, /class: 'qb42 solo idle apsetup-card'/);
  assert.match(src, /class: 'qb42-head'/);
  assert.match(src, /class: 'qb42-trow'/);
  assert.match(src, /class: 'qb42-name' \}, 'AirPlay speakers'/);
  assert.match(src, /data-leader-id.: '__airplay__/);
  assert.match(src, /zfold42-t/);
  assert.doesNotMatch(src, /\bdialog\(/);
  assert.match(rd('js/devices.js'), /startsWith\('airplay:'\)\) return \{ k: 'otype airplay', text: 'AIRPLAY'/);
  assert.match(rd('js/util.js'), /Object\.assign\(new ApiError\(/);
  assert.match(rd('app.css'), /apsetup-badge\.ap1/);
  _apReset();
});
