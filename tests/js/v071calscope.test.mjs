// 0.7.1 Calibrate: Whole house / one zone picker, the zone's own reference by default, RECOMMENDED + one-tap Use, no "(house reference)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev as ev0 } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const doc = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.matchMedia ??= q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.getComputedStyle ??= () => ({ overflowY: 'visible', getPropertyValue: () => '' });
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.CSS ??= { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
const imp = f => import(pathToFileURL(join(js, f)).href);
const ev = (type, extra = {}) => ev0(type, { stopImmediatePropagation() { this.stopPropagation?.(); this.preventDefault?.(); }, ...extra });
const src = f => readFileSync(join(js, f), 'utf8');

globalThis.navigator ??= { userAgent: 'node', mediaDevices: null };
try { Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) node', configurable: true }); } catch { /* fixed */ }
globalThis.location ??= { href: 'http://x/', protocol: 'http:', host: 'x', hostname: 'x', origin: 'http://x', search: '', hash: '' };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const out = k => ({ deviceId: 'd' + k, active: true, kind: k === 3 ? 'bluetooth' : 'wired', label: 'Line out', notCalibrated: false, latencyMs: 0 });
const zones = [1, 2, 3, 4].map(i => ({ id: i, name: ['Basement Amp', 'Deck Pi', 'Deck BT', 'Kitchen PC'][i - 1], connected: true, enabled: true, playerId: 'p' + i, outputs: [out(i)], reference: i === 1, mine: false }));
const groups = [{ id: 7, name: 'Deck', deviceIds: [2, 3], referenceId: null, recommendedId: 2, recommendedReason: 'Wired output on a WavWiz player', recommendedWarn: false },
  { id: 8, name: 'Downstairs', deviceIds: [1, 4], referenceId: 1, recommendedId: 1, recommendedReason: 'Wired output on the server, lowest delay (0 ms)' }];
const rankAll = { defaultId: 1, recommendedId: 1, ranking: [{ id: 1, connected: true, reason: 'Wired output on the server, lowest delay (0 ms)', warn: false }, { id: 2, connected: true, reason: 'Wired output on a WavWiz player' }, { id: 4, connected: true, reason: 'Wired output on a PC' }, { id: 3, connected: true, reason: 'Bluetooth: its delay can change when it reconnects', warn: true }] };

test('pure: calZones, scopeMembers, recFor (zone and Whole house)', async () => {
  const c = await imp('calibrate.js');
  assert.deepEqual(c.calZones({ groups: [...groups, { id: 9, name: 'Empty', deviceIds: [] }] }, zones).map(g => g.id), [7, 8]);
  assert.deepEqual(c.scopeMembers(zones, groups[0]).map(z => z.id), [2, 3]);
  assert.equal(c.scopeMembers(zones, null).length, 4);
  assert.deepEqual(c.recFor(groups[0], rankAll, zones), { id: 2, name: 'Deck Pi', reason: 'Wired output on a WavWiz player', warn: false });
  assert.equal(c.recFor(null, rankAll, zones).id, 1);
  assert.equal(c.recFor({ ...groups[0], recommendedId: null }, rankAll, zones), null);
});

async function open(preset, opts = {}) {
  const calls = [];
  globalThis.fetch = async (url, o) => { const u = String(url); calls.push([o?.method || 'GET', u]);
    const body = /calibration\/ranking/.test(u) ? rankAll : /\/settings/.test(u) ? {} : /phone-link$/.test(u) ? { token: 't', shortUrl: 'http://x/c/t', https: true } : /calibration\/(mics|pcs)/.test(u) ? [] : {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }; };
  const { openCalibration } = await imp('calibrate.js');
  const S = { zones: zones.map(z => ({ ...z })), groups: groups.map(g => ({ ...g })), me: { role: 'admin' }, auth: { role: 'admin' }, role: 'admin', admin: true };
  await openCalibration(S, () => {}, preset, { linkAdmin: true, ...opts });
  await new Promise(r => setTimeout(r, 30));
  const dlg = [...doc.body.querySelectorAll('.calview')].pop();
  return { dlg, calls };
}

test('admin: the picker offers Whole house + each zone; Whole house is the default and lists every speaker', async () => {
  const { dlg } = await open(undefined);
  const scope = dlg.querySelector('[data-act="cal-scope"]'); assert.ok(scope, 'the zone picker is there');
  assert.deepEqual(scope.options.map(o => o.textContent), ['Whole house - every speaker, one reference', 'Deck', 'Downstairs']);
  assert.equal(scope.value, 'all');
  assert.doesNotMatch(dlg.textContent, /house reference/, 'the house reference is not named in the UI');
  assert.match(dlg.textContent, /RECOMMENDED/); assert.match(dlg.textContent, /Wired output on the server/);
  assert.match(dlg.textContent, /reference Basement Amp/);
  for (const n of ['Deck Pi', 'Deck BT', 'Kitchen PC']) assert.match(dlg.textContent, new RegExp(n));
});

test('admin from a speaker in a zone with no reference: the zone is picked, nothing is set, RECOMMENDED + Use + Pick another', async () => {
  const { dlg, calls } = await open(3);
  assert.match(dlg.textContent, /Deck has no reference yet/);
  const use = dlg.querySelector('[data-act="cal-use-recommended"]'); assert.equal(use.textContent, 'Use Deck Pi');
  assert.ok(dlg.querySelector('[data-act="cal-pick-another"]'));
  assert.equal(calls.filter(c => c[0] === 'PUT').length, 0, 'never set automatically');
  use.dispatchEvent(ev('click')); await new Promise(r => setTimeout(r, 20));
  assert.ok(calls.some(c => c[0] === 'PUT' && /\/groups\/7\/reference$/.test(c[1])), 'one tap saves it as the zone reference');
});

test('admin from a speaker in a zone with a reference: that zone and its reference are picked; switching to Whole house measures everyone', async () => {
  const { dlg } = await open(4);
  const scope = dlg.querySelector('[data-act="cal-scope"]'); assert.equal(scope.value, '8');
  assert.match(dlg.textContent, /reference Basement Amp · measures Kitchen PC/);
  const ref = dlg.querySelector('[aria-label="Reference speaker"]'); assert.deepEqual(ref.options.map(o => o.value), ['1', '4'], 'only the zone\'s speakers can be its reference');
  scope.value = 'all'; scope.dispatchEvent(ev('change', { target: scope }));
  const d2 = [...doc.body.querySelectorAll('.calview')].pop();
  assert.equal(d2.querySelector('[data-act="cal-scope"]').value, 'all');
  assert.match(d2.textContent, /reference Basement Amp · measures Deck Pi, Deck BT, Kitchen PC/);
});

test('wiring: no "(house reference)" label, Start waits for a reference, regular users keep the old path', () => {
  const c = src('calibrate.js');
  assert.doesNotMatch(c, /\(house reference\)/);
  assert.match(c, /if \(st\.ref == null\) return toast\('Pick a reference speaker first/);
  assert.match(c, /const calGroups = admin \? calZones\(S, zones\) : \[\];/);
  assert.match(c, /: refFor\(S, presetZoneId \?\? \(!admin \? mine\?\.id : null\)\);/);
  assert.match(src('zoneref.js'), /if \(me\?\.timedBy != null && byId\(me\.timedBy\)\) return byId\(me\.timedBy\);/);
});
