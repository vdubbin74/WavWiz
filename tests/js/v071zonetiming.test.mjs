// 0.7.1 zone timing vs house: an always-on per-zone offset with a small ± fine-tune (0 = as calibrated; upgrades start at 0).
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


test('offText / stepOff: signs, rounding, the ±200 ms clamp', async () => {
  const { offText, stepOff, HOUSE_OFF_MAX } = await imp('refrec.js');
  assert.equal(offText(0), '0 ms'); assert.equal(offText(undefined), '0 ms'); assert.equal(offText(5), '+5 ms'); assert.equal(offText(-3.4), '−3.4 ms');
  assert.equal(stepOff(0, 1), 1); assert.equal(stepOff(0, -10), -10); assert.equal(stepOff(199, 10), HOUSE_OFF_MAX); assert.equal(stepOff(-195, -10), -HOUSE_OFF_MAX);
});

test('the control: − / + / Reset, saved after a pause; a viewer sees it read-only', async () => {
  const calls = []; globalThis.fetch = async (url, o) => { calls.push([o?.method, String(url), o?.body]); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, ms: JSON.parse(o.body).ms }), text: async () => '{}' }; };
  const { zoneTimingRow } = await imp('refrec.js');
  const g = { id: 7, name: 'Deck', houseOffsetMs: 0 };
  const el = zoneTimingRow({}, g, true, () => {}); doc.body.append(el);
  assert.match(el.textContent, /TIMING VS HOUSE/); assert.equal(el.querySelector('output').textContent, '0 ms');
  assert.equal(el.querySelector('[data-act="zt-reset"]').hasAttribute('disabled'), true);
  el.querySelector('[data-act="zt-plus"]').dispatchEvent(ev('click')); el.querySelector('[data-act="zt-plus"]').dispatchEvent(ev('click', { shiftKey: true }));
  assert.equal(el.querySelector('output').textContent, '+11 ms');
  await new Promise(r => setTimeout(r, 500));
  assert.equal(calls.length, 1, 'one save after the pause'); assert.match(calls[0][1], /\/groups\/7\/house-offset$/); assert.equal(calls[0][0], 'PUT'); assert.equal(JSON.parse(calls[0][2]).ms, 11);
  el.querySelector('[data-act="zt-reset"]').dispatchEvent(ev('click')); assert.equal(el.querySelector('output').textContent, '0 ms');
  el.remove();
  const v = zoneTimingRow({}, { ...g, houseOffsetMs: -4 }, false, () => {});
  assert.equal(v.querySelector('output').textContent, '−4 ms');
  for (const b of v.querySelectorAll('button')) assert.equal(b.hasAttribute('disabled'), true);
});

test('wiring: zone settings show the timing row; the reference card mentions it; the tree rebuilds on a change', () => {
  assert.match(src('tree42.js'), /zoneTimingRow\(S, g, admin, done\)/);
  assert.match(src('refrec.js'), /timing vs house: \$\{offText\(g\.houseOffsetMs\)\} \(zone settings\)/);
  assert.match(src('devices.js'), /g\.refFlag\?\.kind, g\.houseOffsetMs\]/);
});
