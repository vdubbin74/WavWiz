// 0.7.0 F169: Google Cast setup card (Find / Test / Add) directly below the AirPlay card; CAST speaker tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
globalThis.Element ??= class {}; globalThis.document ??= undefined;
globalThis.sessionStorage ??= { _m: Object.create(null), getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
const dir = process.env.JS_DIR ? 'file://' + process.env.JS_DIR + '/' : new URL('js/', W).href;
const { STEPS, csRow, csBadge, csStatus, csStep, csProblem, csMergeRemembered, SYNC_NOTE, _csReset } = await import(dir + 'castsetup.js');

test('same three steps as AirPlay; groups, TVs and speakers are all pickable', () => {
  assert.deepEqual(STEPS, ['Find', 'Test', 'Add to zone']);
  assert.equal(csRow({ kind: 'speaker', model: 'Google Home Mini' }).pick, true);
  assert.match(csRow({ kind: 'group', group: true, model: 'Google Cast Group' }).note, /Cast group/);
  assert.match(csRow({ kind: 'tv', model: 'Chromecast', status: 'YouTube' }).note, /Now: YouTube/);
  assert.equal(csRow({ added: true }).pick, false);
  assert.equal(csRow({ remembered: true, online: false, added: true }).pick, false);
  assert.deepEqual(csBadge({ kind: 'tv' }), { text: 'Cast · TV', kind: 'ap1' });
  assert.deepEqual(csBadge({ kind: 'group' }), { text: 'Cast · Group', kind: 'ap1' });
  assert.equal(csBadge({}).text, 'Cast · Speaker');
});

test('status, step and problem words follow the AirPlay card', () => {
  assert.equal(csStatus({}).text, '');
  assert.equal(csStatus({}, { busy: 'Connecting…' }).text, 'Testing…');
  assert.equal(csStatus({}, { heard: 'ask' }).text, '✓ Test sound played');
  assert.equal(csStatus({ added: true }).text, 'Added');
  assert.equal(csStatus({ remembered: true, online: false }).text, 'Remembered · Offline');
  assert.equal(csStep({}, null), 0); assert.equal(csStep({ heard: 'ask' }, { id: 'x' }), 1); assert.equal(csStep({ heard: 'yes' }, { id: 'x' }), 2);
  const e = Object.assign(new Error('cast LOAD failed (LOAD_FAILED)'), { data: { code: 'transport', title: 'It couldn’t play WavWiz’s stream', text: 't', retry: true } });
  assert.deepEqual(csProblem(e, 'Kitchen'), { code: 'transport', title: 'It couldn’t play WavWiz’s stream', text: 't', retry: true });
  assert.equal(csProblem(new Error('x'), 'K').code, 'other');
});

test('remembered Cast speakers come from zones cast: playerIds only', () => {
  const m = csMergeRemembered([{ id: 'live', name: 'Kitchen' }], [
    { id: 1, name: 'Den Nest', playerId: 'cast:den', connected: false }, { id: 2, name: 'Kitchen', playerId: 'cast:live', connected: true },
    { id: 3, name: 'Sonos', playerId: 'airplay:s1' }]);
  assert.deepEqual(m.map(d => d.id), ['live', 'den']);
  assert.equal(m[1].remembered, true); assert.equal(m[1].online, false);
});

test('0.7.1: Cast setup lives in the Add speaker sheet, not a Devices card; CAST tag and sync note stay', () => {
  const t = rd('js/tree42.js');
  assert.doesNotMatch(t, /castSetupCard\(S, ctl\)/);
  assert.doesNotMatch(t, /cardList\.push\(\{ key: 'cast'/);
  assert.match(t, /class: 'btn sm zadd-spk'/);
  const src = rd('js/castsetup.js');
  assert.match(src, /export function openCastSetup/);
  assert.match(src, /openAddSpeaker\(S, ctl, 'cast'\)/);
  assert.match(SYNC_NOTE, /roughly/);                  // honest about Cast buffering
  _csReset();
});

test('a Cast speaker gets a CAST tag like AIRPLAY / HDMI', () => {
  const d = rd('js/devices.js');
  assert.match(d, /startsWith\('cast:'\)\) return \{ k: 'otype cast', text: 'CAST'/);
  assert.match(d, /startsWith\('airplay:'\)\) return \{ k: 'otype airplay', text: 'AIRPLAY'/);
});

test('0.7.1: opening the Add speaker sheet starts a Cast scan (no Devices card to restore)', () => {
  const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/castsetup.js', import.meta.url), 'utf8');
  assert.match(src, /export function csSheetAttach/);
  assert.match(src, /if \(!open \|\| closed\) setOpen\(true\)/);
  assert.match(src, /if \(open && !was\) \{ closed = false; rescan\(\); startPoll\(\); \}/);
});
