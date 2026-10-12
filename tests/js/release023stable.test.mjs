// WavWiz 0.2.3 fix: an open device card's settings kept "refreshing" - every status / level / heartbeat push rebuilt every card, so the open
// settings (Delay, Output…) were thrown away and re-created every few seconds. These tests build the real Devices panel and page on a tiny DOM,
// open a card, fire bursts of updates and check that the SAME nodes stay, focus and a typed delay are kept, a drag is not interrupted, and a
// removed device still leaves at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';
const document = installDom();
document.defaultView = globalThis;
const js = process.env.JS_DIR;
const d = await import(pathToFileURL(`${js}/devices.js`).href);
const wait = ms => new Promise(r => setTimeout(r, ms));

const out = (id, extra = {}) => ({ endpointDbId: id * 10, deviceId: `dev-${id}`, endpointId: `ep-${id}`, name: `Speakers ${id}`, kind: 'analog', connected: true, active: true, latencyMs: 120, notCalibrated: false, ...extra });
const zone = (id, extra = {}) => ({ id, name: `Room ${id}`, playerId: `pc-${id}`, connected: true, enabled: true, volume: 50, muted: false, badge: 'synced', link: 'wired', remoteIp: '192.168.1.' + id,
  syncErrorMs: 0.4, bufferMs: 80, hardResyncs: 0, health: 'ok', outputs: [out(id)], room: { state: 'ok', drops: 0, reconnects: 0, underrunEvents: 0 }, isWeb: false, mine: false, reference: id === 1, chosenDeviceId: `dev-${id}`, ...extra });
const ctl = { act() {}, refreshAll() {}, setDevSize() {}, toggleDev() {}, toggleDevExpanded() {} };
/** One status / level / heartbeat push: fresh objects from the server, live values changing. */
function push(S, i, change = {}) {
  S.zones = S.zones.map(z => ({ ...structuredClone(z), volume: 40 + (i % 7), syncErrorMs: 0.1 * i, bufferMs: 70 + i, room: { ...z.room, state: i % 2 ? 'ok' : 'idle', drops: i },
    outputs: z.outputs.map(o => ({ ...o, latencyMs: 120 + (i % 3) })), ...(change[z.id] || {}) }));
}
const card = (root, id) => root.querySelector(`.dcard[data-zone-id="${id}"]`);
const open = (root, id) => { card(root, id).querySelector('.dexpand').click(); return card(root, id); };

test('0.2.3 fix: Expanded panel - an open card, its settings and a typed delay survive a burst of updates', async () => {
  localStorage.setItem('wavwiz.devsize', 'expanded');
  const S = { auth: { role: 'admin' }, zones: [zone(1), zone(2), zone(3)], groups: [] };
  const p = d.devicesPanel(S, ctl); document.body.append(p.el);
  const c1 = open(p.el, 1), set1 = c1.querySelector('.dsettings'), box = set1.querySelector('.latbox'), other = card(p.el, 2);
  assert.ok(set1, 'settings open'); assert.ok(c1.classList.contains('dset'));
  box.focus(); box.value = '137';                                       // the user is typing an exact delay
  for (let i = 1; i <= 25; i++) { push(S, i, { 2: { muted: i > 20 } }); p.draw(); }
  assert.equal(card(p.el, 1), c1, 'the open card is the same element');
  assert.equal(c1.querySelector('.dsettings'), set1, 'its settings were not rebuilt');
  assert.equal(c1.querySelector('.latbox'), box);
  assert.equal(document.activeElement, box, 'focus stays in the delay box');
  assert.equal(box.value, '137', 'the typed delay is kept');
  assert.equal(card(p.el, 2), other, 'closed cards are kept too');
  // live values were patched in place
  assert.ok(other.classList.contains('muted')); assert.equal(other.querySelector('.dtag.muted').textContent, 'MUTED');   // 0.2.5: a MUTED tag (render v2)
  assert.equal(other.querySelector('.dvol input').value, String(S.zones[1].volume));
  assert.match(set1.querySelector('.dsconn').textContent, /sync ±2\.5 ms/);
  p.el.remove();
});

test('0.2.3 fix: a slider drag inside the open card is not interrupted; a change that needs a rebuild waits for pointerup', async () => {
  localStorage.setItem('wavwiz.devsize', 'expanded');
  const S = { auth: { role: 'admin' }, zones: [zone(1), zone(2)], groups: [] };
  const p = d.devicesPanel(S, ctl); document.body.append(p.el);
  const c1 = card(p.el, 1).classList.contains('dset') ? card(p.el, 1) : open(p.el, 1);
  const sl = c1.querySelector('.dsettings .latslider');
  sl.dispatchEvent(ev('pointerdown')); sl.value = '420';                  // finger down, dragging
  for (let i = 1; i <= 10; i++) { push(S, i, { 1: { name: 'Living room' } }); p.draw(); }   // a rename would rebuild the card
  assert.equal(card(p.el, 1), c1, 'not rebuilt under the drag');
  assert.equal(c1.querySelector('.dsettings .latslider'), sl);
  assert.equal(sl.value, '420', 'the dragged value is not overwritten');
  sl.dispatchEvent(ev('pointerup')); await wait(80);                      // drag ends -> the waiting rebuild applies
  assert.notEqual(card(p.el, 1), c1);
  assert.equal(card(p.el, 1).querySelector('.dname').textContent, 'Living room');
  assert.ok(card(p.el, 1).querySelector('.dsettings'), 'still open after the rebuild');
  assert.ok(card(p.el, 1).classList.contains('dsnoanim'), 'no slide-in replay');
  p.el.remove();
});

test('0.2.3 fix: a removed device still leaves at once; the open card of another device is not disturbed', () => {
  localStorage.setItem('wavwiz.devsize', 'expanded');
  const S = { auth: { role: 'admin' }, zones: [zone(1), zone(2), zone(3)], groups: [] };
  const p = d.devicesPanel(S, ctl); document.body.append(p.el);
  const c1 = card(p.el, 1).classList.contains('dset') ? card(p.el, 1) : open(p.el, 1), box = c1.querySelector('.latbox');
  box.focus(); box.value = '88';
  S.zones = S.zones.filter(z => z.id !== 3); p.draw();
  assert.equal(card(p.el, 3), null, 'revoked device gone');
  assert.equal(card(p.el, 1), c1); assert.equal(document.activeElement, box); assert.equal(box.value, '88');
  S.zones = S.zones.filter(z => z.id !== 1); p.draw();                   // the open card's own device is removed: it closes and goes
  assert.equal(card(p.el, 1), null); assert.ok(card(p.el, 2));
  p.el.remove();
});

test('0.2.3 fix: the Devices page (phone / narrow screens) keeps its open card the same way', () => {
  const S = { auth: { role: 'control' }, zones: [zone(1, { mine: true }), zone(2)], groups: [] };
  const v = d.devicesView(S, ctl); document.body.append(v.el); v.draw();
  const c1 = card(v.el, 1).classList.contains('dset') ? card(v.el, 1) : open(v.el, 1), box = c1.querySelector('.latbox');
  box.focus(); box.value = '205';
  for (let i = 1; i <= 15; i++) { push(S, i); v.draw(); }
  assert.equal(card(v.el, 1), c1); assert.equal(document.activeElement, box); assert.equal(box.value, '205');
  S.zones = S.zones.filter(z => z.id !== 2); v.draw();
  assert.equal(card(v.el, 2), null); assert.equal(card(v.el, 1), c1);
  v.el.remove();
});

test('0.2.3 fix: helpers - reconcile keeps nodes in place, the signature ignores live values', () => {
  const a = document.createElement('div'), x = document.createElement('i'), y = document.createElement('b'), z = document.createElement('u');
  a.append(x, y); x.focus = undefined;
  d.reconcile(a, [z, y]);
  assert.deepEqual(a.childNodes, [z, y]); assert.equal(y.parentNode, a);
  const S = { auth: { role: 'admin' }, zones: [] };
  const z1 = zone(5), z2 = { ...zone(5), volume: 9, muted: true, syncErrorMs: 7, room: { state: 'dropped' }, outputs: [out(5, { latencyMs: 300 })] };
  assert.equal(d.cardSig(S, z1), d.cardSig(S, z2), 'volume / mute / sync / delay are live values');
  assert.notEqual(d.cardSig(S, z1), d.cardSig(S, { ...z1, name: 'Den' }));
});

test('0.2.3: Standard rows have no Settings; tapping a device opens Expanded with its card highlighted (even under a zone filter)', () => {
  localStorage.setItem('wavwiz.devsize', 'standard'); sessionStorage.setItem('wavwiz.devzone', '5');
  const S = { auth: { role: 'admin' }, zones: [zone(1), zone(2)], groups: [{ id: 5, name: 'Upstairs', deviceIds: [1], members: 1 }] };
  let p; const c = { ...ctl, setDevSize: (sz, id) => p.setSize(sz, id) };
  p = d.devicesPanel(S, c); document.body.append(p.el);
  const rows = p.el.querySelectorAll('.drow');
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.querySelector('.dexpand'), null, 'no Settings button'); assert.equal(r.querySelector('.dsettings'), null); assert.ok(r.querySelector('.dvol input')); assert.ok(r.querySelector('.mutebtn')); assert.ok(r.querySelector('.sw')); }
  const r2 = p.el.querySelector('.drow[data-zone-id="2"]');
  for (let i = 1; i <= 10; i++) { push(S, i); p.draw(); }
  assert.equal(p.el.querySelector('.drow[data-zone-id="2"]'), r2, 'rows are patched in place too');
  r2.querySelector('.dname').click();                                     // device 2 is not in the remembered zone filter
  assert.equal(p.size, 'expanded');
  const c2 = card(p.el, 2);
  assert.ok(c2, 'its card is shown'); assert.ok(c2.classList.contains('hl'), 'and highlighted');
  assert.ok(c2.querySelector('.dexpand'), 'one tap from its Settings');
  p.el.remove();
});
