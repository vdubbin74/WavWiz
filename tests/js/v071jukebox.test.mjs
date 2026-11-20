// 0.7.1 Jukebox fixes:
//  t2036u Settings > Jukebox: the CD-changer sound and Show Jukebox zone in Devices OFF / ON did nothing (the switch face covered the checkbox
//         and was not inside a <label>);
//  t2037u the Jukebox zone OFF / ON looked dead (staged behind an easy-to-miss Save) and a stray "‹ Back" sat beside the Devices list;
//  t2038u ticking a Jukebox speaker said "device not found" (a removed default speaker was re-sent with every tick);
//  t2040u Jukebox settings save on each change (numbers after a pause, flushed on leave); no Save button, no "unsaved changes" prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = () => readFileSync(join(js, '..', 'app.css'), 'utf8');
const doc = installDom(); doc.defaultView = globalThis;
globalThis.matchMedia ??= q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.getComputedStyle ??= () => ({ overflowY: 'visible', getPropertyValue: () => '' });
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.cancelAnimationFrame ??= t => clearTimeout(t);
globalThis.CSS ??= { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.innerWidth ??= 1440; globalThis.innerHeight ??= 900;
const imp = f => import(pathToFileURL(join(js, f)).href);
const wait = ms => new Promise(r => setTimeout(r, ms));

// the API: records every call; `fail` makes the next PUT/POST answer 500
const calls = []; let fail = null;
const jbCfg = { style: 'modern', folders: [], playlists: [], perGuest: 3, voteSkip: true, votesNeeded: 3, explicitFilter: false, artistCooldownMin: 0, autofill: { kind: 'playlist', id: null, genre: '' }, beat: 50, cdSound: false, showInDevices: true, defaultSpeakers: null, hasPin: false };
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET', path = String(url).replace('/api/v1', ''); calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, keepalive: !!init.keepalive });
  if (method !== 'GET' && fail) { const m = fail; fail = null; return { ok: false, status: 500, text: async () => JSON.stringify({ error: m }) }; }
  const body = method === 'GET' ? (path === '/jukebox/config' ? JSON.stringify(jbCfg) : '[]') : '{}';
  return { ok: true, status: 200, text: async () => body };
};
const sent = (method, re) => calls.filter(c => c.method === method && re.test(c.path));
const change = (el, v) => { if (typeof v === 'boolean') el.checked = v; else el.value = v; el.dispatchEvent(ev('change', { target: el })); };
const input = (el, v) => { el.value = v; el.dispatchEvent(ev('input', { target: el })); };
const click = el => el.dispatchEvent(ev('click', { target: el }));
const toasts = () => [...doc.querySelectorAll('.toast')].map(t => t.textContent);

test('t2036u: a switch face never takes the click, and the Jukebox switches sit in a <label> like every other switch', () => {
  assert.match(css(), /\.switch>span\{pointer-events:none\}/, 'the OFF | ON face lets the click through to the checkbox');
  const s = src('settingsui.js');
  for (const l of ['CD-changer sound', 'Show Jukebox zone in Devices']) {
    const at = s.indexOf(`'aria-label': '${l}'`); assert.ok(at > 0, l);
    assert.match(s.slice(at - 200, at), /h\('label', \{ class: 'switch' \}, A\(h\('input', \{ type: 'checkbox', role: 'switch', [^]*$/, `${l}: wrapped in a label`);
  }
  // every switch in the web UI is a <label class="switch"> or sits inside a label
  for (const f of ['settingsui.js', 'settings.js', 'airplayout.js', 'eq.js', 'eqsettings.js', 'scenesched.js']) {
    for (const m of src(f).matchAll(/h\('span', \{ class: 'switch' \}/g)) assert.match(src(f).slice(Math.max(0, m.index - 160), m.index), /h\('label', \{ class: '[^']*' \},\s*$/, `${f}: a span.switch is inside a label`);
  }
});

test('t2040u jbAutosave: now() saves at once, later() waits for the pause, flush() sends what waits (keepalive), errors reach onError', async () => {
  const { jbAutosave, jbFlushAll } = await imp('jbcfg.js');
  const put = [], saved = [], errs = []; let bad = false;
  const owner = doc.createElement('div'); doc.body.append(owner);
  const sv = jbAutosave(async (p, o) => { put.push([p, !!o?.keepalive]); if (bad) throw new Error('nope'); }, { ms: 80, onSaved: p => saved.push(p), onError: (e, p) => errs.push([e.message, p]), owner });
  await sv.now({ cdSound: true }); assert.deepEqual(put, [[{ cdSound: true }, false]]); assert.deepEqual(saved, [{ cdSound: true }]);
  sv.later({ perGuest: 4 }); sv.later({ perGuest: 5 }); await wait(30); assert.equal(put.length, 1, 'nothing while typing');
  await wait(90); assert.deepEqual(put.at(-1), [{ perGuest: 5 }, false], 'one save after the pause, the last value');
  sv.later({ perGuest: 7 }); await jbFlushAll(true); assert.deepEqual(put.at(-1), [{ perGuest: 7 }, true], 'leaving mid-pause sends it now (keepalive)');
  await wait(120); assert.equal(put.length, 3, 'and not twice');
  sv.later({ votesNeeded: 2 }); await sv.now({ voteSkip: false }); assert.deepEqual(put.at(-1)[0], { votesNeeded: 2, voteSkip: false }, 'a switch takes a waiting number along');
  bad = true; await sv.now({ beat: 70 }); assert.deepEqual(errs, [['nope', { beat: 70 }]]);
  owner.remove(); await jbFlushAll(); bad = false; sv.later({ beat: 1 }); await wait(120); assert.equal(put.at(-1)[0].beat, 1);
});

test('t2036u / t2040u Settings > Jukebox wiring: switches and numbers save through the autosaver, a failure puts the control back, closing Settings flushes', () => {
  const s = src('settingsui.js');
  assert.match(s, /const sv = jbAutosave\(\(patch, o\) => api\('\/jukebox\/config', \{ method: 'PUT', body: patch, keepalive: o\?\.keepalive \}\)/);
  assert.match(s, /onError: \(e, patch\) => \{ toast\('Not saved\. ' \+ e\.message, true\);[^\n]*revert\(patch\);/);
  assert.match(s, /oninput: ev => \{ const n = Math\.round\(\+ev\.target\.value\); if \(ev\.target\.value !== '' && n >= min && n <= max\) saveLater\(/, 'numbers: saved after a pause while typing');
  for (const k of ['cdSound', 'showInDevices']) assert.match(s, new RegExp(`'data-jbk': '${k}'`), `${k} can be put back`);
  assert.match(src('settings.js'), /onClose: \(\) => \{ jbFlushAll\(\);/, 'closing Settings flushes');
});

const jbS = (extra = {}) => ({ auth: { role: 'admin' }, zones: [{ id: 1, name: 'WavWiz Server', playerId: 'pc-1', connected: true, enabled: true, volume: 50, muted: false, outputs: [] },
  { id: 2, name: 'Onkyo TX-NR626', playerId: 'pc-2', connected: true, enabled: true, volume: 50, muted: false, outputs: [] },
  { id: 3, name: 'iPhone 13 / BlastBox200', playerId: 'web-3', connected: true, enabled: true, volume: 50, muted: false, outputs: [] }],
  groups: [{ id: 5, name: 'Basement', deviceIds: [1, 2, 3] }],
  jb: { zoneId: 'jukebox', deviceIds: [], own: true, running: false, zoneOn: false, perGuest: 3, voteSkip: true, defaultSpeakers: [999], ...extra } });
const ctl = { refreshAll() {}, act() {} };

test('t2037u / t2040u Jukebox zone panel: OFF / ON, Songs per guest and Vote to skip save on each change; no Save, no unsaved prompt', async () => {
  const d = await imp('devices.js'); const { jbFlushAll } = await imp('jbcfg.js');
  const S = jbS(); const card = d.jukeboxCard(S, ctl); doc.body.append(card);
  assert.equal(card.querySelector('[data-act="jb-zone-save"]'), null, 'no Save button'); assert.equal(card.querySelector('[data-act="jb-zone-discard"]'), null);
  calls.length = 0; const pill = card.querySelector('.onpill');
  click(pill); await wait(10);
  assert.deepEqual(sent('PUT', /^\/jukebox\/config$/).map(c => c.body), [{ zoneOn: true }], 'OFF / ON saved at once');
  assert.equal(pill.getAttribute('aria-checked'), 'true'); assert.match(card.querySelector('.jbzhint').textContent, /^On/);
  assert.match(card.querySelector('.jbz-saved').textContent, /Saved/, 'a small Saved cue');
  fail = 'nope'; click(pill); await wait(10);
  assert.equal(pill.getAttribute('aria-checked'), 'true', 'a failed save puts it back ON'); assert.ok(toasts().some(t => /Not saved\. nope/.test(t)));
  calls.length = 0; const vote = card.querySelector('.jbz-vote'); change(vote, false); await wait(10);
  assert.deepEqual(sent('PUT', /jukebox\/config/).map(c => c.body), [{ voteSkip: false }]);
  calls.length = 0; const per = card.querySelector('.jbz-per'); input(per, '6'); await wait(50); assert.equal(sent('PUT', /jukebox\/config/).length, 0);
  await jbFlushAll(); assert.deepEqual(sent('PUT', /jukebox\/config/).map(c => c.body), [{ perGuest: 6 }], 'leaving mid-pause still saves it');
  card.remove();
  const ds = src('devices.js');
  assert.doesNotMatch(ds, /Unsaved Jukebox zone settings|leaveJb|jbDirty|jbStage/, 'the unsaved-changes prompt and staging are gone');
  assert.match(ds, /if \(pnl\?\.dataset\.key === 'jb' && key !== 'jb'\) jbFlushAll\(\);/, 'leaving the panel flushes');
  assert.doesNotMatch(src('jbcfg.js'), /beforeunload/, 'no "leave page?" prompt either');
});

test('t2038u Speakers for Jukebox: ticks send the boxes on screen (never a removed default speaker), two quick ticks both count, chips follow', async () => {
  const d = await imp('devices.js');
  const S = jbS({ defaultSpeakers: [999] }); const card = d.jukeboxCard(S, ctl); doc.body.append(card);
  const chips = () => card.querySelector('.dc3chips').textContent;
  assert.match(chips(), /None picked: the Jukebox plays in the main zone/);
  const box = id => card.querySelector(`input[data-jb-dev="${id}"]`);
  calls.length = 0;
  change(box(1), true); change(box(2), true); await wait(10);   // before any redraw
  const puts = sent('PUT', /^\/jukebox\/zone$/).map(c => c.body.deviceIds);
  assert.deepEqual(puts, [[1], [1, 2]], 'the removed id 999 is never sent; the second tick keeps the first');
  assert.match(chips(), /WavWiz Server/); assert.match(chips(), /Onkyo TX-NR626/); assert.doesNotMatch(chips(), /None picked/);
  // a refused save un-ticks the box again
  fail = 'device not found'; change(box(3), true); await wait(10);
  assert.equal(box(3).checked, false); assert.ok(toasts().some(t => /device not found/.test(t)));
  // un-ticking everything brings the "None picked" line back
  change(box(1), false); change(box(2), false); await wait(10);
  assert.deepEqual(sent('PUT', /^\/jukebox\/zone$/).at(-1).body.deviceIds, []); assert.match(chips(), /None picked/);
  card.remove();
});

test('t2037u: no "‹ Back" beside the Devices list in the wide three-column view; phone keeps its own way back', () => {
  const ds = src('devices.js');
  assert.match(ds, /const listBeside = X\.size === 'expanded';/);
  assert.match(ds, /const deskBack = X\.size === 'phone' \|\| listBeside \|\| \(X\.spk == null && X\.zsel == null\) \? null :/);
});
