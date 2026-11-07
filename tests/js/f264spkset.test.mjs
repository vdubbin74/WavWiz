// F264: phone Speaker Settings - More menu sizing/placement, one-line Zone row, single profile Save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
installDom(); globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
const js = process.env.JS_DIR, src = f => readFileSync(join(js, f), 'utf8');
const vp = { x: 0, y: 0, w: 390, h: 844 };

test('F264 menuPlace: opens below, right-aligned, inside the screen', async () => {
  const { menuPlace } = await import(pathToFileURL(join(js, 'devices.js')).href);
  const p = menuPlace({ left: 300, right: 370, top: 200, bottom: 230 }, { width: 200, height: 180 }, vp);
  assert.deepEqual(p, { left: 170, top: 234, up: false, maxHeight: 0 });
  // clamped to the left edge when wider than room to the left of the button
  assert.equal(menuPlace({ left: 10, right: 80, top: 200, bottom: 230 }, { width: 200, height: 100 }, vp).left, 8);
  // flips up near the bottom, never off-screen
  const u = menuPlace({ left: 300, right: 370, top: 760, bottom: 790 }, { width: 200, height: 180 }, vp);
  assert.equal(u.up, true); assert.equal(u.top, 760 - 4 - 180); assert.ok(u.top >= 8);
  // neither side fits: capped height on the bigger side
  const c = menuPlace({ left: 300, right: 370, top: 400, bottom: 430 }, { width: 200, height: 900 }, vp);
  assert.ok(c.maxHeight > 0 && c.top >= 8 && c.top + c.maxHeight <= 844 - 8 + 1);
});
test('F264 More menu: content-sized, nowrap, solid, on top; placed only inside the phone sheet', () => {
  const css = src('../app.css'), d = src('devices.js');
  assert.match(css, /\.dmore \.dmenu\{min-width:max-content;max-width:calc\(100vw - 16px\);white-space:nowrap;z-index:9600;background:var\(--panel\);opacity:1\}/);
  assert.match(css, /\.dmore \.dmenu button\{max-width:none;white-space:nowrap\}/);
  assert.match(d, /if \(!btn\.closest\('\.pd42-sheet'\)\) return;/); assert.match(d, /function open\(\) \{ menu\.hidden = false; place\(\);/);
});
test('F264 Zone row: just "Zone" + the select (no static name, no Move to zone label), one line', () => {
  const d = src('devices.js'), css = src('../app.css');
  const row = d.slice(d.indexOf('function zoneRow42'), d.indexOf('return { treeNode, restoreScroll'));
  assert.match(row, /h\('div', \{ class: 'spk-zonerow' \}, h\('span', \{ class: 'dlbl' \}, 'Zone'\), ro\(sel,/);
  assert.match(row, /applyGroupOp\(S, op\)/); assert.match(row, /ev\.target\.value = was/);
  assert.doesNotMatch(row, /spk-zname|MOVE TO ZONE/); assert.match(row, /movePlan\(S\.groups, z\.id, to\)/);
  assert.match(css, /\.spk-zonerow\{flex-wrap:nowrap;min-width:0\}/); assert.match(css, /\.spk-zonerow \.spk-zsel\{flex:1 1 auto;min-width:0;[^}]*text-overflow:ellipsis;white-space:nowrap\}/);
});
test('F264 Profile: one Save beside the picker; name field + Create/Cancel only while naming (New…)', () => {
  const t = src('spkset.js');
  assert.match(t, /naming \? null : saveBtn, naming \? \[nameIn, h\('button', \{ type: 'button', class: 'btn sm primary', 'data-act': 'prof-saveas-ok', onclick: doAs \}, 'Create'\)/);
  assert.match(t, /'data-act': 'prof-saveas', onclick: \(\) => \{ naming = true; paintProfile\(\); \} \}, '＋ New…'\)/);
  assert.match(t, /delBtn\.hidden = st\.profileId == null \|\| naming;/);
  assert.match(t, /naming = false, gone = false/, 'not naming by default');
  for (const a of ['prof-save', 'prof-saveas', 'prof-del']) assert.ok(t.includes(a), a);
});

test('F264 zone move: local state + row signature update right after success (row/breadcrumb repaint)', async () => {
  const { applyGroupOp, zoneSig } = await import(pathToFileURL(join(js, 'devices.js')).href);
  const S = { groups: [{ id: 1, name: 'Basement', deviceIds: [7, 8] }, { id: 2, name: 'Upstairs', deviceIds: [] }] }, z = { id: 7 };
  const before = zoneSig(z, S.groups);
  applyGroupOp(S, { id: 1, name: 'Basement', deviceIds: [8] }); applyGroupOp(S, { id: 2, name: 'Upstairs', deviceIds: [7] });
  assert.equal(S.groups.find(g => g.deviceIds.includes(7)).name, 'Upstairs');
  assert.notEqual(zoneSig(z, S.groups), before);
  assert.equal(applyGroupOp(S, { id: 99, deviceIds: [] }), null);
  const d = src('devices.js'), t = src('spkset.js');
  assert.match(d, /zoneRow: z => zoneRow42\(z, orderedGroups\(S\.groups \|\| \[\]\)\)/, 'live groups, not the build-time snapshot');
  assert.match(t, /z = \{ \.\.\.z, \.\.\.nz \}; paintTitle\(\); paintTags\(\); paintZoneRow\(\);/);
  assert.match(t, /fresh\._zsig === zoneRowEl\._zsig\) return;/);
});
test('F264 phone cleanup: sheet-scoped CSS hides Rename (in More ▾), hint, SPEAKER chip, profile helper; helper kept as tooltip', () => {
  const css = src('../app.css'), t = src('spkset.js'), d = src('devices.js');
  assert.match(css, /\.pd42-sheet \.dhint42,\.pd42-sheet \.spk-head \.spk-rename,\.pd42-sheet \.spk-tags \.dtag\.role,\.pd42-sheet \.spk-profrow \.spk-hint,\.pd42-sheet \.spk-profrow>\.grow\{display:none\}/);
  assert.match(d, /item\('Rename', \(\) => rename\(S, ctl, z, wrap\)/);
  assert.match(t, /class: 'spk-profrow', title: 'Saves volume, cap, delay/);
});
