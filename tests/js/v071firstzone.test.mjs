// 0.7.1 t2078u: a fresh setup makes no "Everywhere" zone. Devices with no zone yet shows a clear "No zones yet / + Add zone" prompt, the
// Unassigned card says its speakers are silent until added to a zone, and "Add to zone" with no zone makes the first one with that speaker
// (it was a disabled "Create a zone first").
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

function kit(admin) {
  const ro = el => el;
  const onPill = (label, on, can, toggle) => { const b = doc.createElement('button'); b._set = () => {}; b.onclick = toggle; return b; };
  const capBar = () => { const wrap = doc.createElement('div'); const vol = doc.createElement('input'); const pct = doc.createElement('span'); wrap.append(vol); return { wrap, vol, pct, cancelSend() {}, patch() {} }; };
  return { capBar, onPill, ro, tagEls3: () => [], cardTags3: () => [], zoneTags3: () => [], zoneMembers: (zs, g) => (zs || []).filter(z => (g.deviceIds || []).includes(z.id)),
    zoneMuted: () => false, zoneOn: () => true, zoneLevel: () => 40, zoneCap: () => null, canControl: () => true, isAdmin: () => admin, promptName() {}, confirmRemoveZone() {},
    canTune: () => false, dotClass: () => 'ok', orderedGroups: gs => gs, openCalibration() {}, forget() {} };
}
const zones = [{ id: 10, name: 'Den Speaker', enabled: true, connected: true, muted: false, volume: 40, groupIds: [] }];
async function render(admin, groups = []) {
  const Z = await imp('zones40.js'), { treeEl } = await imp('tree42.js');
  Z._resetAutoPick(); const S = { groups, zones, jb: null, _groupsAt: Date.now() }; Z.init(S);
  const ctl = { refreshAll() {}, refreshNow() {}, go() {}, act() {}, setDevSize() {}, openQueue() {} };
  const st = { zone: null, spk: null, onZone() {}, onSpk() {}, busy() { return false; } };
  const root = treeEl(S, ctl, kit(admin), st); doc.body.append(root); return root;
}

test('t2078u: no zone yet - "No zones yet" with + Add zone (admin), Unassigned says silent until added to a zone', async () => {
  const root = await render(true);
  const first = root.querySelector('.first42');
  assert.ok(first, 'the empty-state prompt is shown');
  assert.match(first.textContent, /No zones yet/);
  assert.match(first.textContent, /Speakers stay silent until they are in a zone\. Add a zone/);
  const add = first.querySelector('[data-act="first-zone"]');
  assert.equal(add?.textContent, '+ Add zone');
  add.dispatchEvent(ev('click', { target: add, currentTarget: add, bubbles: true }));
  assert.ok(root.querySelector('.zdraft42'), '+ Add zone opens the new-zone name field in place');
  assert.match(root.querySelector('.un42').textContent, /Silent until added to a zone/);
  assert.equal(root.querySelector('.un42 .saddzone')?.textContent, 'Add to zone');
  root.remove();
});

test('t2078u: a viewer gets the prompt without the button; with a zone the prompt is gone and Unassigned reads as before', async () => {
  const v = await render(false);
  assert.ok(v.querySelector('.first42')); assert.equal(v.querySelector('.first42 [data-act="first-zone"]'), null);
  assert.match(v.querySelector('.first42').textContent, /An administrator can add one/);
  v.remove();
  const r = await render(true, [{ id: 1, name: 'Basement', deviceIds: [], playbackId: 'default', online: 0, now: null }]);
  assert.equal(r.querySelector('.first42'), null);
  assert.match(r.querySelector('.un42').textContent, /Not in any zone, so silent/);
  r.remove();
});

test('t2078u: Add to zone with no zone makes the first zone with that speaker (no disabled "Create a zone first")', () => {
  const t = src('tree42.js');
  assert.doesNotMatch(t, /label: 'Create a zone first', disabled: true/);
  assert.match(t, /\[\{ id: 'new', label: `\+ New zone with \$\{z\.name\}`, onclick: \(\) => firstZoneWith\(z, btn\) \}\]/);
  assert.match(t, /save: async v => \{ await createZone\(v, \[z\.id\]\); toast\(`\$\{z\.name\} is in the new zone \$\{v\}`\); done\(\); \}/);
});

test('t2078u: right-click on an Unassigned speaker with no zone offers "Add to a new zone" (admin); with zones the menu is unchanged', async () => {
  const { unassignedMenu42 } = await imp('ctxmenu.js');
  assert.deepEqual(unassignedMenu42({ admin: true, zones: [] }).map(i => [i.id, i.label, !!i.disabled]), [['newzone', 'Add to a new zone', false], ['settings', 'Settings', false]]);
  assert.deepEqual(unassignedMenu42({ admin: true, zones: [{ id: 2, name: 'B' }] }).map(i => i.label), ['Add to zone', 'Settings']);
  assert.ok(unassignedMenu42({ admin: false, zones: [] })[0].disabled, 'a viewer still sees a disabled Add to zone');
  assert.match(src('tree42.js'), /act\.newzone = \(\) => firstZoneWith\(z, el\.querySelector\('\.saddzone'\)\);/);
});
