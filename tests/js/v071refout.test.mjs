// 0.7.1 "Reference output changed": the reference now plays through another output (or type) than when it became the reference.
// Three choices: switch back, use the next best, keep it and recalibrate. Never switched by itself.
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

const zones = [
  { id: 1, name: 'Basement Amp', connected: true, enabled: true, outputs: [], reference: true },
  { id: 2, name: 'Deck Pi', connected: true, enabled: true, outputs: [], reference: false },
];
const flag = { kind: 'output', text: 'Reference output changed: Basement Amp - it now plays through Headphones (Bluetooth), not Line Out (wired).', refId: 1, nextId: 2, nextName: 'Deck Pi', nextReason: 'Wired output on a WavWiz player',
  wasDeviceId: 'd1', wasName: 'Line Out', wasKind: 'analog', wasEndpointId: 44, nowName: 'Headphones', nowKind: 'bluetooth' };
const g = { id: 7, name: 'Deck', deviceIds: [1, 2], referenceId: 1, recommendedId: 1, recommendedReason: 'Wired output on the server', refFlag: flag };

test('the flag card offers the three choices; a viewer sees them disabled', async () => {
  const { outputFlagCard } = await imp('refrec.js');
  const el = outputFlagCard({ zones, groups: [g] }, g, true, () => {});
  assert.match(el.textContent, /Reference output changed/); assert.match(el.textContent, /Headphones \(Bluetooth\), not Line Out \(wired\)/);
  assert.equal(el.querySelector('[data-act="ref-switch-back"]').textContent, 'Switch back to Line Out');
  assert.equal(el.querySelector('[data-act="ref-next-best"]').textContent, 'Use Deck Pi');
  assert.equal(el.querySelector('[data-act="ref-keep-recal"]').textContent, 'Keep it and recalibrate');
  for (const b of el.querySelectorAll('button')) assert.equal(b.hasAttribute('disabled'), false);
  const v = outputFlagCard({ zones, groups: [g] }, g, false, () => {});
  for (const b of v.querySelectorAll('button')) assert.equal(b.hasAttribute('disabled'), true);
  const off = outputFlagCard({ zones, groups: [g] }, { ...g, refFlag: { ...flag, wasEndpointId: null } }, true, () => {});
  assert.equal(off.querySelector('[data-act="ref-switch-back"]').hasAttribute('disabled'), true, 'the old output is not connected: no switch back');
  assert.equal(outputFlagCard({ zones }, { ...g, refFlag: null }, true, () => {}), null);
});

test('switch back posts the remembered endpoint; keep posts the new baseline; next best is a one-tap reference switch', async () => {
  const calls = []; globalThis.fetch = async (url, o) => { calls.push([String(url), o?.method, o?.body]); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }), text: async () => '{}' }; };
  const { outputFlagCard } = await imp('refrec.js');
  const el = outputFlagCard({ zones, groups: [g] }, g, true, () => {}); doc.body.append(el);
  el.querySelector('[data-act="ref-switch-back"]').dispatchEvent(ev('click'));
  el.querySelector('[data-act="ref-next-best"]').dispatchEvent(ev('click'));
  el.querySelector('[data-act="ref-keep-recal"]').dispatchEvent(ev('click'));
  await new Promise(r => setTimeout(r, 20));
  const flat = calls.map(c => `${c[1]} ${c[0].replace(/^.*\/api\/v1/, '')} ${c[2] ?? ''}`);
  assert.ok(flat.some(x => /^POST \/zones\/1\/output .*"endpointId":44/.test(x)), flat.join('\n'));
  assert.ok(flat.some(x => /^PUT \/groups\/7\/reference .*"zoneId":2/.test(x)), flat.join('\n'));
  assert.ok(flat.some(x => /^POST \/groups\/7\/reference-output/.test(x)), flat.join('\n'));
  el.remove();
});

test('the reference speaker settings and the zone settings show the card; the tree note says Review (no dismiss)', async () => {
  const { speakerRefSec, zoneRefBlock, flagNote } = await imp('refrec.js');
  const S = { zones, groups: [g] };
  assert.ok(speakerRefSec(S, zones[0], true, () => {}).querySelector('[data-flag="output"]'));
  assert.equal(speakerRefSec(S, zones[1], true, () => {}).querySelector('[data-flag="output"]'), null, 'only on the reference itself');
  assert.ok(zoneRefBlock(S, g, true, () => {}).querySelector('[data-flag="output"]'));
  const n = flagNote(S, g); assert.equal(n.kind, 'output'); assert.equal(n.review, true); assert.match(n.text, /Reference output changed: Basement Amp/);
  const t = src('tree42.js');
  assert.match(t, /fn\.review \? h\('button', \{ type: 'button', class: 'btn sm zrefnote-use', 'data-act': 'ref-review'/);
  assert.match(t, /st\.onZone\(g\.id\); \} \}, 'Review'\)/);
});

test('polish: the card does not repeat its heading, one "Use <next best>" only, and Use is the primary button only when the zone has no reference', async () => {
  const { speakerRefSec, zoneRefBlock } = await imp('refrec.js');
  const g2 = { ...g, recommendedId: 2, recommendedReason: 'Wired output on a WavWiz player' };   // the next best is also the recommended one
  const S = { zones, groups: [g2] };
  for (const el of [speakerRefSec(S, zones[0], true, () => {}), zoneRefBlock(S, g2, true, () => {})]) {
    assert.equal((el.textContent.match(/Reference output changed/g) || []).length, 1, el.textContent);
    assert.equal([...el.querySelectorAll('button')].filter(b => b.textContent === 'Use Deck Pi').length, 1, 'one Use Deck Pi');
    assert.equal(el.querySelector('.dtag.rec')?.textContent, 'RECOMMENDED', 'the tag still shows');
  }
  const noFlag = { ...g2, refFlag: null };
  assert.equal(zoneRefBlock({ zones, groups: [noFlag] }, noFlag, true, () => {}).querySelector('[data-act="use-recommended"]').classList.contains('primary'), false, 'a chosen reference: Use is not pushed');
  const none = { ...noFlag, referenceId: null };
  assert.equal(zoneRefBlock({ zones, groups: [none] }, none, true, () => {}).querySelector('[data-act="use-recommended"]').classList.contains('primary'), true, 'no reference yet: Use is the main action');
});
