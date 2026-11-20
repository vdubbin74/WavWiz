// 0.7.1 t2077u: Devices, an EMPTY Jukebox zone row showed "Jukebox  No speakers  [Settings] [v]". The chevron only folded a
// "Drop speakers here" hint that shows while dragging (and the Jukebox row is not even a drop target), so it did nothing; the
// Settings button did exactly what the name does (open the Jukebox zone settings). Both are gone. The name still opens the
// settings (button, keyboard, aria-label), the row still picks the Jukebox, the card still reorders, and with speakers the full
// Jukebox card keeps its chevron for the speaker list.
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

function kit() {
  const ro = el => el;
  const onPill = (label, on, can, toggle) => { const b = doc.createElement('button'); b.className = 'onpill' + (on ? ' on' : ''); b._set = () => {}; b.onclick = toggle; return b; };
  const capBar = (label, value) => { const wrap = doc.createElement('div'); wrap.className = 'vbar'; const vol = doc.createElement('input'); vol.setAttribute('type', 'range'); vol.value = String(value ?? 0); const pct = doc.createElement('span'); wrap.append(vol); return { wrap, vol, pct, cancelSend() {}, patch() {} }; };
  return { capBar, onPill, ro, tagEls3: () => [], cardTags3: () => [], zoneTags3: () => [], zoneMembers: (zs, g) => (zs || []).filter(z => (g.deviceIds || []).includes(z.id)),
    zoneMuted: () => false, zoneOn: () => true, zoneLevel: () => 40, zoneCap: () => null, canControl: () => true, isAdmin: () => true, promptName() {}, confirmRemoveZone() {},
    canTune: () => false, dotClass: () => 'ok', orderedGroups: gs => gs, openCalibration() {}, forget() {} };
}
const groups = [{ id: 1, name: 'Basement', deviceIds: [10], playbackId: 'zg:1', online: 1, now: { state: 'paused', title: 'Song A' } }];
const zones = [{ id: 10, name: 'Den', enabled: true, connected: true, muted: false, volume: 40 }, { id: 11, name: 'Patio', enabled: true, connected: true, muted: false, volume: 40 }];
const jbOf = ids => ({ own: true, running: false, zoneOn: true, showInDevices: true, deviceIds: ids, defaultSpeakers: ids, now: null, perGuest: 3, voteSkip: true });

async function render(jb) {
  const Z = await imp('zones40.js'), { treeEl } = await imp('tree42.js');
  try { localStorage.removeItem('wavwiz.zone'); sessionStorage.removeItem('wavwiz.zone.picked'); } catch { /* */ }
  Z._resetAutoPick();
  const S = { groups, zones, jb, _groupsAt: Date.now() }; Z.init(S);
  const opened = [];
  const ctl = { refreshAll() {}, refreshNow() {}, go() {}, act() {}, setDevSize() {}, openQueue() {} };
  const st = { zone: null, spk: null, onZone(id) { opened.push(id); }, onSpk() {}, busy() { return false; } };
  const root = treeEl(S, ctl, kit(), st); doc.body.append(root);
  return { Z, root, opened };
}

test('t2077u: an empty Jukebox row has no Settings button and no chevron; the name opens its settings, the row picks it', async () => {
  const { Z, root, opened } = await render(jbOf([]));
  const row = root.querySelector('.qb42.jb42');
  assert.ok(row, 'the Jukebox row is in the tree');
  assert.ok(row.classList.contains('empty42'), 'empty Jukebox = the compact row');
  assert.match(row.textContent, /No speakers/);
  assert.equal(row.querySelector('.jb42-set'), null, 'no Settings button');
  assert.equal(row.querySelector('[data-act="jb-settings"]'), null);
  assert.ok(![...row.querySelectorAll('button')].some(b => b.textContent.trim() === 'Settings'), 'no button reads Settings');
  assert.equal(row.querySelector('.zfold42-t'), null, 'no chevron');
  assert.equal(row.querySelector('.chv'), null, 'no chevron of any kind');
  assert.equal(row.querySelector('.ze42-drop'), null, 'no "Drop speakers here" (not a drop target)');
  const name = row.querySelector('.zname');
  assert.equal(name.tagName, 'BUTTON', 'the name is a real button (keyboard)');
  assert.equal(name.getAttribute('aria-label'), 'Jukebox - open the zone settings');
  name.dispatchEvent(ev('click', { target: name, bubbles: true }));
  assert.deepEqual(opened, ['jukebox'], 'the name opens the Jukebox zone settings');
  assert.notEqual(Z.current()?.kind, 'jukebox', 'and does not also pick it');
  opened.length = 0;
  const note = row.querySelector('.ze42-note');
  note.dispatchEvent(ev('click', { target: note, bubbles: true }));
  assert.equal(Z.current()?.kind, 'jukebox', 'the rest of the row picks the Jukebox');
  assert.deepEqual(opened, []);
  assert.equal(row.dataset.card, 'jukebox', 'still a reorderable top-level card with its saved-order key');
  // 0.7.1 t2078u: the same grey status dot as every other empty zone, before the name
  const dot = row.querySelector('.ze42-row .dot');
  assert.ok(dot, 'an empty Jukebox has a status dot');
  assert.ok(dot.classList.contains('ze42-dot') && dot.classList.contains('off'), 'grey, like an empty zone');
  assert.equal(dot.getAttribute('title'), 'No speakers');
  assert.equal(dot.nextElementSibling ?? dot.nextSibling, name, 'dot, then the name');
  root.remove();
});

test('t2077u: with speakers the Jukebox card keeps its chevron (it lists real speakers) and other zones keep theirs', async () => {
  const { root } = await render(jbOf([11]));
  const jb = root.querySelector('.qb42.jb42');
  assert.ok(jb && !jb.classList.contains('empty42'), 'full Jukebox card');
  assert.ok(jb.querySelector('.qb42-exp'), 'its speaker-list chevron is still there');
  assert.ok([...jb.querySelectorAll('.zsp42 [data-device-id]')].length >= 1 || /Patio/.test(jb.textContent), 'and lists the speaker');
  const base = root.querySelector('.qb42[data-leader-id="1"]');
  assert.ok(base?.querySelector('.zfold42-t'), 'an ordinary zone keeps its fold chevron');
  root.remove();
});
