// 0.7.1: the phone mic page honors Whole house / one zone like Calibrate: it starts on the zone asked for (from the player or Calibrate on the PC),
// else the phone's selected zone; a zone measures only its own speakers against its own reference (fixed); none yet = the recommended one is
// offered (one tap, never by itself); an offline reference offers the next best as a stand-in for this session; faster speakers are reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const doc = installDom();
const imp = f => import(pathToFileURL(join(js, f)).href);
const src = f => readFileSync(join(js, f), 'utf8');
// the phone page's own element helper (calmic.js)
function h(tag, attrs, ...kids) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : doc.createTextNode(String(k)));
  return e;
}
const store = v => ({ getItem: k => (k === 'wavwiz.zone' ? v : null) });
const zones = [{ id: 7, name: 'Roof deck', referenceId: null }, { id: 8, name: 'Kitchen', referenceId: 3 }];
const base = { allSpeakers: true, zones, scope: 'all', scopeSet: false, reference: { id: 3, name: 'Kitchen amp', connected: true }, speakers: [{ id: 1, name: 'Deck amp' }, { id: 2, name: 'Deck PC' }] };

test('the starting scope: the address wins, then the phone\'s selected zone only when Calibrate on the PC chose nothing', async () => {
  const { urlScope, storedScope, firstScope } = await imp('calmic-core.js');
  assert.equal(urlScope('?cal=ABC123&zone=7'), '7'); assert.equal(urlScope('?zone=all'), 'all'); assert.equal(urlScope('?zone=x7'), null); assert.equal(urlScope('?cal=ABC123'), null);
  assert.equal(storedScope(store('g:7')), '7'); assert.equal(storedScope(store('jukebox')), null); assert.equal(storedScope(null), null);
  assert.equal(firstScope(base, '7', '8'), '7');
  assert.equal(firstScope(base, null, '7'), '7', 'nothing chosen on the PC: the phone\'s own zone');
  assert.equal(firstScope({ ...base, scopeSet: true, scope: '8' }, null, '7'), null, 'the zone chosen in Calibrate on the PC stays');
  assert.equal(firstScope(base, '99', null), null, 'an unknown zone is ignored');
  assert.equal(firstScope({ ...base, allSpeakers: false }, '7', '7'), null, 'a regular user\'s link cannot choose');
});

test('runPlan: the reference (or the session stand-in) is never measured; the stand-in replaces it for this run only', async () => {
  const { runPlan, buildPlan } = await imp('calmic-core.js');
  const p = { ...base, reference: { id: 1, name: 'Deck amp', connected: false }, speakers: [{ id: 2, name: 'Deck PC' }, { id: 4, name: 'Deck BT' }] };
  assert.deepEqual(runPlan(p, null).speakers.map(z => z.id), [2, 4]);
  const r = runPlan(p, { id: 2, name: 'Deck PC' });
  assert.equal(r.reference.id, 2); assert.equal(r.reference.standIn, true); assert.deepEqual(r.speakers.map(z => z.id), [4]);
  assert.equal(p.reference.id, 1, 'the plan itself is not changed');
  const steps = buildPlan(r); assert.ok(steps.every(s => s.kind !== 'dev' || s.zone !== 2)); assert.equal(steps[0].zone, 2);
});

test('scopeBlock: Whole house / zones; a zone without a reference offers the recommended one (one tap, nothing set by itself)', async () => {
  const { scopeBlock } = await imp('calmic-core.js');
  const calls = [];
  const z = { ...base, scope: '7', scopeSet: true, reference: null, recommended: { id: 1, name: 'Deck amp', reason: 'Wired output on a PC', warn: false } };
  const el = scopeBlock(h, z, { onScope: v => calls.push(['scope', v]), onUse: r => calls.push(['use', r.id]), onStandIn: r => calls.push(['standin', r.id]) }); doc.body.append(el);
  const sel = el.querySelector('[data-act="cal-scope"]');
  assert.deepEqual([...sel.querySelectorAll('option')].map(o => o.textContent), ['Whole house - every speaker, one reference', 'Roof deck', 'Kitchen']);
  assert.equal([...sel.querySelectorAll('option')].find(o => o.hasAttribute('selected'))?.textContent, 'Roof deck');
  assert.match(el.textContent, /Roof deck has no reference yet/); assert.match(el.textContent, /RECOMMENDED/); assert.match(el.textContent, /Wired output on a PC/);
  el.querySelector('[data-act="use-recommended"]').dispatchEvent(ev('click'));
  for (const o of sel.querySelectorAll('option')) o.removeAttribute('selected'); sel.querySelector('option').setAttribute('selected', ''); sel.value = 'all'; sel.dispatchEvent(ev('change'));
  assert.deepEqual(calls, [['use', 1], ['scope', 'all']]);
  el.remove();
  assert.equal(scopeBlock(h, { ...base, allSpeakers: false }, {}), null, 'a regular user\'s link: no choice');
  assert.equal(scopeBlock(h, { ...base, zones: [] }, {}), null, 'no zones: nothing to choose');
});

test('scopeBlock: an offline reference offers the next best for this session; a better reference is offered, never applied', async () => {
  const { scopeBlock } = await imp('calmic-core.js');
  const calls = [];
  const off = { ...base, scope: '7', reference: { id: 1, name: 'Deck amp', connected: false }, nextBest: { id: 2, name: 'Deck PC', reason: 'Wired output on a PC' } };
  const a = scopeBlock(h, off, { onStandIn: r => calls.push(['standin', r.id]), onUse: r => calls.push(['use', r.id]) });
  assert.match(a.textContent, /The reference Deck amp is offline/); assert.match(a.textContent, /NEXT BEST/);
  a.querySelector('[data-act="standin-next-best"]').dispatchEvent(ev('click'));
  assert.deepEqual(calls, [['standin', 2]]);
  const using = scopeBlock(h, off, { standIn: { id: 2, name: 'Deck PC' } });
  assert.match(using.textContent, /Using Deck PC as the reference for this session only/); assert.equal(using.querySelector('[data-act="standin-next-best"]'), null);
  const better = { ...base, scope: '7', reference: { id: 2, name: 'Deck PC', connected: true }, recommended: { id: 1, name: 'Deck amp', reason: 'Wired output on the server' } };
  calls.length = 0; const b = scopeBlock(h, better, { onUse: r => calls.push(['use', r.id]), onStandIn: r => calls.push(['standin', r.id]) });
  b.querySelector('[data-act="use-recommended"]').dispatchEvent(ev('click'));
  const wh = scopeBlock(h, { ...better, scope: 'all' }, { onUse: r => calls.push(['use', r.id]), onStandIn: r => calls.push(['standin', r.id]) });
  wh.querySelector('[data-act="use-recommended"]').dispatchEvent(ev('click'));
  assert.deepEqual(calls, [['use', 1], ['standin', 1]], 'a zone: saved as its reference; Whole house: this session only (the house reference is internal)');
});

test('faster speakers are reported (the reference is never moved)', async () => {
  const { fasterOf } = await imp('calmic-core.js');
  assert.deepEqual(fasterOf([{ zoneId: 1, fasterMs: 12 }, { zoneId: 2, fasterMs: null }, { zoneId: 3 }]).map(p => p.zoneId), [1]);
  const m = src('calmic.js');
  assert.match(m, /fasterOf\(props\)\.map\(p => h\('div', \{ class: 'calfaster'/);
  assert.match(m, /ms faster than the reference, so it cannot be lined up by adding delay/);
  assert.match(m, /'data-act': 'make-faster-ref'/);
});

test('phoneScope (Calibrate on a phone hands its zone to the mic page): asked zone, then the speaker\'s zone, then the selected zone', async () => {
  const { phoneScope } = await imp('calibrate.js');
  const S = { groups: [{ id: 7, deviceIds: [1, 2] }, { id: 8, deviceIds: [3] }] };
  assert.equal(phoneScope(S, null, { groupId: 8 }, store('g:7')), '8');
  assert.equal(phoneScope(S, 2, {}, store('g:8')), '7');
  assert.equal(phoneScope(S, null, {}, store('g:8')), '8');
  assert.equal(phoneScope(S, null, {}, store('g:99')), null);
  assert.equal(phoneScope(S, null, {}, store(null)), null);
});

test('wiring: the page loads the chosen scope, measures the run plan, and the PC passes its choice along', () => {
  const m = src('calmic.js'), c = src('calibrate.js');
  assert.match(m, /const sc = firstScope\(plan, zone0, storedScope\(globalThis\.localStorage\)\); if \(sc && sc !== plan\.scope\) plan = await call\(`\/calibration\/phone-link\/\$\{code\}\/plan\?scope=/);
  assert.match(m, /referenceZoneId: runPlan\(plan, standIn\)\.reference\.id/);
  assert.match(m, /const steps = buildPlan\(runPlan\(plan, standIn\)\)/);
  assert.match(m, /body: JSON\.stringify\(zone0 \? \{ scope: zone0 \} : \{\}\)/);
  assert.match(c, /location\.href = '\/calmic\.html' \+ \(z \? '\?zone=' \+ z : ''\)/);
  assert.match(c, /body: sent \? \{ scope: sent \} : \{\}/);
  assert.match(c, /if \(usePhone && admin\) phoneCard\.setScope\?\.\(String\(st\.scope\)\)/);
  assert.match(c, /api\(`\/calibration\/phone-link\/\$\{link\.token\}\/scope`, \{ method: 'PUT', body: \{ scope: v \} \}\)/);
});
