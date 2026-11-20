// 0.7.1 reference speakers: RECOMMENDED tag + one-line reason, one-tap Use for a zone with no reference, a flag (never a silent re-pick)
// when the reference leaves, and the speaker settings REFERENCE card.
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
  { id: 1, name: 'Basement Amp', connected: true, enabled: true, outputs: [], reference: false },
  { id: 2, name: 'Deck Pi', connected: true, enabled: true, outputs: [], reference: false },
  { id: 3, name: 'Kitchen BT', connected: true, enabled: true, outputs: [], reference: true },
];
const g0 = { id: 7, name: 'Deck', deviceIds: [1, 2, 3], referenceId: null, recommendedId: 2, recommendedReason: 'Wired output on a WavWiz player, lowest delay (4 ms)', recommendedWarn: false, refFlag: null };

test('refState: the recommendation is offered, never applied; a reference that is the recommended one gets the tag', async () => {
  const { refState } = await imp('refrec.js');
  let st = refState({ zones, groups: [g0] }, g0);
  assert.equal(st.ref, null); assert.equal(st.offer.id, 2); assert.equal(st.refIsRec, false);
  st = refState({ zones, groups: [] }, { ...g0, referenceId: 2 });
  assert.equal(st.ref.id, 2); assert.equal(st.refIsRec, true); assert.equal(st.offer, null);
  st = refState({ zones, groups: [] }, { ...g0, referenceId: 3 });
  assert.equal(st.ref.id, 3); assert.equal(st.offer.id, 2, 'a user-chosen reference stays; the better one is only offered');
});

test('flagNote: "left" names the recommended replacement with a Use action; "offline" is not a tree note', async () => {
  const { flagNote } = await imp('refrec.js');
  const S = { zones };
  const f = flagNote(S, { ...g0, refFlag: { kind: 'left', text: 'The reference Old left this zone. Recommended: Deck Pi.', oldId: 9, nextId: 2 } });
  assert.equal(f.kind, 'left'); assert.equal(f.use.id, 2); assert.match(f.text, /left this zone/);
  assert.equal(flagNote(S, { ...g0, refFlag: { kind: 'offline', text: 'x', nextId: 2 } }), null);
  assert.equal(flagNote(S, g0), null);
});

test('zone settings REFERENCE row: None yet + RECOMMENDED + one-tap Use (admin); a viewer sees it disabled', async () => {
  const { zoneRefBlock } = await imp('refrec.js');
  const S = { zones, groups: [g0] };
  const el = zoneRefBlock(S, g0, true, () => {}); doc.body.append(el);
  assert.match(el.textContent, /REFERENCE/); assert.match(el.textContent, /None yet/);
  assert.equal(el.querySelector('.dtag.rec')?.textContent, 'RECOMMENDED');
  assert.match(el.textContent, /Wired output on a WavWiz player, lowest delay \(4 ms\)/);
  const use = el.querySelector('[data-act="use-recommended"]'); assert.equal(use.textContent, 'Use Deck Pi'); assert.equal(use.hasAttribute('disabled'), false);
  el.remove();
  const v = zoneRefBlock(S, g0, false, () => {});
  assert.equal(v.querySelector('[data-act="use-recommended"]').hasAttribute('disabled'), true);
  assert.equal(v.querySelector('.zp42-refpick').hasAttribute('disabled'), true);
});

test('speaker settings REFERENCE card: the recommended speaker offers "Use as reference"; the reference says its delay stays fixed', async () => {
  const { speakerRefSec } = await imp('refrec.js');
  const S = { zones, groups: [g0] };
  const a = speakerRefSec(S, zones[1], true, () => {});
  assert.ok(a.querySelector('.dtag.rec')); assert.equal(a.querySelector('[data-act="use-as-reference"]')?.textContent, 'Use as reference');
  assert.match(a.textContent, /Deck has no reference yet/);
  const S2 = { zones, groups: [{ ...g0, referenceId: 3, recommendedId: 2 }] };
  const b = speakerRefSec(S2, zones[2], true, () => {});
  assert.match(b.textContent, /Reference for Deck/); assert.match(b.textContent, /Its delay stays fixed/);
  assert.equal(b.querySelector('[data-act="use-recommended"]')?.textContent, 'Use Deck Pi');
  assert.equal(speakerRefSec({ zones, groups: [] }, zones[0], true, () => {}), null, 'a speaker in no zone has no reference card');
});

test('wiring: tree note offers Use, zone pane shows the REFERENCE row, speaker settings get the card; no server auto re-pick text', () => {
  const t = src('tree42.js'), d = src('devices.js'), sp = src('spkset.js');
  assert.match(t, /const fn = flagNote\(S, g\) \|\| \(g\.refNote \? \{ text: g\.refNote, use: null \} : null\);/);
  assert.match(t, /useRef\(g, fn\.use, done\)/);
  assert.match(t, /zoneRefBlock\(S, g, admin, done\)/);
  assert.match(d, /refCard: zz => speakerRefSec\(S, zz, isAdmin\(S\), ctl\.refreshAll\)/);
  assert.match(d, /g\.referenceId, g\.refNote, g\.recommendedId, g\.refFlag\?\.kind/, 'the tree rebuilds when the reference / flag changes');
  assert.match(sp, /const refCard = parts\.refCard \? parts\.refCard\(z\) : null;/);
  assert.doesNotMatch(src('zoneref.js'), /picks a new one when it leaves/);
});
