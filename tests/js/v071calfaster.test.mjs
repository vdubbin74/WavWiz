// 0.7.1 Calibrate: the reference keeps its delay (never shifted up); a faster speaker is offered as the reference.
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


test('fasterThanRef picks the speakers that sound earlier than the reference', async () => {
  const { fasterThanRef } = await imp('calibrate.js');
  const props = [{ zoneId: 1, zoneName: 'A', fasterMs: 20 }, { zoneId: 2, zoneName: 'B', fasterMs: null }, { zoneId: 3, zoneName: 'C' }];
  assert.deepEqual(fasterThanRef(props).map(p => p.zoneId), [1]);
  assert.deepEqual(fasterThanRef(null), []);
});

test('results: "Make X the reference" (admin) sets it with one tap and starts over; no "reference shifted" anywhere', () => {
  const c = src('calibrate.js');
  assert.match(c, /fasterBox\(props, phone\),/);
  assert.match(c, /`\$\{p\.zoneName\} is \$\{Math\.round\(p\.fasterMs\)\} ms faster than the reference\.`/);
  assert.match(c, /admin \? h\('button', \{ class: 'btn small', 'data-act': 'make-faster-ref'/);
  assert.match(c, /api\('\/calibration\/reference', \{ method: 'PUT', body: \{ zoneId: p\.zoneId \} \}\)/);
  assert.doesNotMatch(c, /reference shifted/i);
});
