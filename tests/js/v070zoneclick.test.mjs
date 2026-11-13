// t1948u / t1954u: in Devices, clicking the zone NAME opens zone settings (st.onZone) and must not also
// select the zone. Clicking the rest of the zone BOX / card selects that zone for Now Playing and the Queue.
// A drag must not also count as a click (the follow-up click can land on the drop-target card, not the grip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev as ev0 } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
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

const groups = [
  { id: 1, name: 'Basement', deviceIds: [10], playbackId: 'zg:1', online: 1, now: { state: 'playing', title: 'Song A' } },
  { id: 2, name: 'Upstairs', deviceIds: [11], playbackId: 'zg:2', online: 1, now: { state: 'paused', title: 'Song B' } },
];
const zones = [
  { id: 10, name: 'Den', enabled: true, connected: true, muted: false, volume: 40 },
  { id: 11, name: 'Hall', enabled: true, connected: true, muted: false, volume: 40 },
];

test('t1954u wiring: the zone name opens settings (stopPropagation); the rest of the box / card selects the zone', () => {
  const t = src('tree42.js'), z = src('zones40.js'), m = src('main.js');
  assert.match(t, /const zoneName = \(id, label\) => h\('button', \{ type: 'button', class: 'dname zname ell', title: `\$\{label\} - open the zone settings`, onclick: ev => \{ ev\.stopPropagation\(\); st\.onZone\(id\); \} \}, label\);/);
  assert.match(t, /const card = h\('div', \{ class: 'zcard42' \+ \(on \? '' : ' off'\), 'data-group-id': g\.id, onclick: ev => \{ ev\.stopPropagation\(\); if \(ev\.target\.closest\([^)]+\)\) return; controlZone\(g\.id\); \}/);
  assert.match(t, /const controlZone = id => \{ Z\.select\('g:' \+ id\);/);
  assert.match(t, /title: 'Jukebox - open the zone settings \(pick its speakers\)', onclick: ev => \{ ev\.stopPropagation\(\); open\(\); \}/);
  assert.match(t, /data-group-id': JB, onclick: ev => \{ ev\.stopPropagation\(\); if \(ev\.target\.closest\([^)]+\)\) return; pickJb\(\); \}/);
  assert.match(t, /settings: \(\) => st\.onZone\(g\.id\)/, '⋮ Zone settings still opens the pane');
  assert.match(z, /onclick: \(\) => \{ const edit = !!menu\?._for\?._link; select\(c\.key\);/);
  assert.match(z, /export function select\(key\) \{ markPicked\(\); saveSel\(key\); closeMenu\(\); sync\(\);/);
  assert.match(m, /Z\.select\(sel\.value\)/, 'the Queue zone list calls Z.select');
  assert.match(m, /window\.addEventListener\('wavwiz:zone', \(\) => \{ devv\.draw\(\); devp\.draw\(\); nowc\.draw\(\); listt\.draw\(\); \}\);/);
});

test('t1948u wiring: a finished zone-card drag is not also a click (flag is on the tree, set when the drag starts)', () => {
  const t = src('tree42.js');
  assert.match(t, /root\.addEventListener\('click', ev => \{ if \(root\.dataset\.justdragged \|\| ev\.target\.closest\?\.\('\[data-justdragged\]'\)\) \{ ev\.stopImmediatePropagation\(\); ev\.preventDefault\(\); \}/);
  assert.match(t, /root\.dataset\.justdragged = '1';   \/\/ t1948u: set now, so the click after pointerup/);
  assert.match(t, /setTimeout\(\(\) => \{ delete root\.dataset\.justdragged; \}, 0\);/);
  assert.match(t, /const grab = ev\.target\.closest\('\.zgut42,\.cgrip69'\)/, 'drag still starts only from the ⋮ handle, not from a click on the card');
});

function kit() {
  const ro = (el) => el;
  const onPill = (label, on, can, toggle) => {
    const b = doc.createElement('button'); b.className = 'onpill' + (on ? ' on' : ''); b._set = () => {}; b.onclick = toggle; return ro(b);
  };
  const capBar = (label, value) => {
    const wrap = doc.createElement('div'); wrap.className = 'vbar';
    const vol = doc.createElement('input'); vol.setAttribute('type', 'range'); vol.value = String(value ?? 0);
    const pct = doc.createElement('span'); pct.className = 'pct';
    wrap.append(vol); return { wrap, vol, pct, cancelSend() {}, patch() {} };
  };
  return {
    capBar, onPill, ro, tagEls3: () => [], cardTags3: () => [], zoneTags3: () => [],
    zoneMembers: (zs, g) => (zs || []).filter(z => (g.deviceIds || []).includes(z.id)),
    zoneMuted: () => false, zoneOn: () => true, zoneLevel: () => 40, zoneCap: () => null,
    canControl: () => true, isAdmin: () => true, promptName() {}, confirmRemoveZone() {},
    canTune: () => false, dotClass: () => 'ok', orderedGroups: gs => gs, openCalibration() {}, forget() {},
  };
}

test('t1954u: the name opens settings and does not select; the box selects; a drag does neither', async () => {
  const Z = await imp('zones40.js');
  const { getApiZone } = await imp('util.js');
  const { treeEl } = await imp('tree42.js');
  Z._resetAutoPick();
  try { localStorage.removeItem('wavwiz.zone'); sessionStorage.removeItem('wavwiz.zone.picked'); } catch { /* */ }
  const S = { groups, zones, jb: null, _groupsAt: Date.now() };
  Z.init(S);
  assert.equal(Z.current()?.key, 'g:1', 'starts on the first zone');
  assert.equal(getApiZone(), 'zg:1', 'Now Playing / Queue API zone follows the pick');

  const opened = [];
  const ctl = { refreshAll() {}, refreshNow() {}, go() {}, act() {}, setDevSize() {}, openQueue() {} };
  const st = { zone: null, spk: null, onZone(id) { opened.push(id); }, onSpk() {}, busy() { return false; } };
  const root = treeEl(S, ctl, kit(), st);
  doc.body.append(root);

  const upName = [...root.querySelectorAll('.zname')].find(b => b.textContent === 'Upstairs');
  assert.ok(upName, 'the Upstairs zone name is in the Devices tree');
  const card = upName.closest('.zcard42') || upName.closest('[data-group-id="2"]');
  assert.ok(card, 'the Upstairs zone card is in the Devices tree');
  const body = card.querySelector('.zc42-body') || card.querySelector('.dot') || card;

  // name: settings only — must not bubble into a select
  opened.length = 0;
  upName.dispatchEvent(ev('click', { target: upName, bubbles: true }));
  assert.deepEqual(opened, [2], 'a click on the zone name opens zone settings');
  assert.equal(Z.current()?.key, 'g:1', 'the name click does not also select the zone');
  assert.equal(getApiZone(), 'zg:1', 'Now Playing / Queue stay on the previous zone');

  // the rest of the box / card selects the zone and does not open settings
  opened.length = 0;
  body.dispatchEvent(ev('click', { target: body, bubbles: true }));
  assert.equal(Z.current()?.key, 'g:2', 'a click on the rest of the zone box selects it');
  assert.equal(Z.current()?.name, 'Upstairs');
  assert.equal(getApiZone(), 'zg:2', 'Queue / Now Playing requests now go to Upstairs');
  assert.deepEqual(opened, [], 'a box click does not open settings');

  // a finished drag must not also pick or open settings (the flag lives on the tree)
  Z.select('g:1');
  opened.length = 0;
  assert.equal(Z.current()?.key, 'g:1');
  root.dataset.justdragged = '1';
  body.dispatchEvent(ev('click', { target: body, bubbles: true }));
  assert.equal(Z.current()?.key, 'g:1', 'a drag is not also a click: the selected zone stays put');
  assert.deepEqual(opened, [], 'a drag does not open settings either');
  delete root.dataset.justdragged; root.removeAttribute('data-justdragged');
  body.dispatchEvent(ev('click', { target: body, bubbles: true }));
  assert.equal(Z.current()?.key, 'g:2', 'after the drag flag clears, a real box click selects again');
  root.remove();
});
