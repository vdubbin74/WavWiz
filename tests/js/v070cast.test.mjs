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

test('Cast card sits directly below the AirPlay card (Unassigned, AirPlay, Cast) and never touches it', () => {
  const t = rd('js/tree42.js');
  // 0.6.9 #12 merged in 0.7.0: Unassigned and AirPlay are cards in the shared card order. t1901: Cast is a reorder card too (own key 'cast'), by default right below AirPlay
  const un = t.indexOf("cardList.push({ key: 'unassigned'"), ap = t.indexOf('airPlaySetupCard(S, ctl)'), cs = t.indexOf('castSetupCard(S, ctl)');
  assert.ok(un > 0 && ap > un && cs > ap, 'order Unassigned < AirPlay < Cast');
  assert.match(t, /if \(admin\) \{ setCastCardDecor\(el => decorateCard\(el, 'cast', 'Cast speakers'\)\); const csc = castSetupCard\(S, ctl\); if \(csc\) cardList\.push\(\{ key: 'cast', keys: \['cast'\], el: csc \}\); \}/);
  const src = rd('js/castsetup.js');
  assert.match(src, /class: 'qb42 solo idle castsetup-card'/);
  assert.match(src, /data-leader-id.: '__cast__'/);
  assert.match(src, /class: 'qb42-name' \}, 'Cast speakers'/);
  assert.doesNotMatch(src, /\.apsetup-card/);          // its own selector: the AirPlay card's in-place repaint can't hit it
  assert.doesNotMatch(src, /\bdialog\(/);
  assert.match(SYNC_NOTE, /roughly/);                  // honest about Cast buffering
  assert.match(rd('app.css'), /\.apsetup-card,\.castsetup-card\{/);
  _csReset();
});

test('a Cast speaker gets a CAST tag like AIRPLAY / HDMI', () => {
  const d = rd('js/devices.js');
  assert.match(d, /startsWith\('cast:'\)\) return \{ k: 'otype cast', text: 'CAST'/);
  assert.match(d, /startsWith\('airplay:'\)\) return \{ k: 'otype airplay', text: 'AIRPLAY'/);
});

test('0.7.0 F169 preview fixes: Cast card restored open after a reload scans by itself; setup cards keep the normal 10 px tree gap', () => {
  const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/castsetup.js', import.meta.url), 'utf8');
  assert.match(src, /if \(open && closed\) \{ closed = false; setTimeout\(\(\) => \{ if \(open && !closed\) \{ rescan\(\); startPoll\(\); \} \}, 0\); \}/);
  const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.apsetup-card,\.castsetup-card\{margin:0;min-width:0\}/);
  assert.match(css, /\.tree42>\.apsetup-card:last-child,\.tree42>\.castsetup-card:last-child\{margin-bottom:8px\}/);
});
