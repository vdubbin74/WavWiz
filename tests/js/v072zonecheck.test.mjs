// WavWiz 0.7.2 D: acoustic zone-to-zone timing check ("Check with phone" on Timing vs house): pure parts of zonecheck.js and the wiring contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
installDom();
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
const src = f => readFileSync(join(js, f), 'utf8');

test('0.7.2 D: median, spread and the suggestion (same rule and clamp as the server)', async () => {
  const Z = await imp('zonecheck.js');
  assert.equal(Z.median([9, 5, 1]), 5); assert.equal(Z.median([3, 5]), 4); assert.equal(Z.median([]), null); assert.equal(Z.median([NaN, 2]), 2);
  assert.equal(Z.spreadOf([3, 7, 5]), 4); assert.equal(Z.spreadOf([]), 0);
  assert.equal(Z.suggest(0, 37), -37); assert.equal(Z.suggest(0, -12.34), 12.3); assert.equal(Z.suggest(10, 4), 6); assert.equal(Z.suggest(-150, 80), -200); assert.equal(Z.suggest(190, -30), 200);
  assert.equal(Z.outOfRange(0, 250), true); assert.equal(Z.outOfRange(0, 199), false);
  assert.equal(Z.offLabel(-37), '−37.0 ms'); assert.equal(Z.offLabel(0), '0.0 ms'); assert.equal(Z.offLabel(4.25), '+4.3 ms');
  assert.equal(Z.RUNS, 3);
});

test('0.7.2 D: result lines say later / earlier / in step', async () => {
  const { resultText } = await imp('zonecheck.js');
  assert.equal(resultText('Kitchen', 'Living', 37.24), 'Kitchen sounds 37.2 ms later than Living here.');
  assert.equal(resultText('Kitchen', 'Living', -8), 'Kitchen sounds 8.0 ms earlier than Living here.');
  assert.match(resultText('Kitchen', 'Living', 0.4), /in step/);
  assert.equal(resultText('K', 'L', NaN), '');
});

test('0.7.2 D: the zone to compare with: the house reference zone first, never Everywhere unless alone; zones need an online speaker', async () => {
  const { againstOptions, defaultAgainst, concat } = await imp('zonecheck.js');
  const S = { zones: [{ id: 1, connected: true }, { id: 2, connected: true, reference: true }, { id: 3, connected: false }, { id: 4, connected: true }],
    groups: [{ id: 10, name: 'Kitchen', deviceIds: [1] }, { id: 11, name: 'Everywhere', deviceIds: [1, 2, 4] }, { id: 12, name: 'Porch', deviceIds: [3] }, { id: 13, name: 'Den', deviceIds: [4] }, { id: 14, name: 'Living', deviceIds: [2] }] };
  assert.deepEqual(againstOptions(S, S.groups[0]).map(g => g.id), [11, 13, 14]);   // Porch is offline
  assert.equal(defaultAgainst(S, S.groups[0]).id, 11);                              // Everywhere holds the reference too (first in order)...
  const S2 = { ...S, groups: S.groups.filter(g => g.id !== 11) };
  assert.equal(defaultAgainst(S2, S2.groups[0]).id, 14);                            // ...the zone holding the house reference
  assert.equal(defaultAgainst({ ...S2, zones: S2.zones.map(z => ({ ...z, reference: false })) }, S2.groups[0]).id, 13);
  assert.equal(defaultAgainst({ zones: S.zones, groups: [S.groups[0]] }, S.groups[0]), null);
  assert.deepEqual([...concat([new Float32Array([1, 2]), new Float32Array([3])])], [1, 2, 3]);
});

test('0.7.2 D: the button: Control may check (needs two zones online), Apply stays Admin; raw mic asked for in the press', async () => {
  const { checkButton, MIC_CONSTRAINTS } = await imp('zonecheck.js');
  const S = { zones: [{ id: 1, connected: true }, { id: 2, connected: true }], groups: [{ id: 10, name: 'Kitchen', deviceIds: [1] }, { id: 11, name: 'Living', deviceIds: [2] }] };
  assert.equal(checkButton(S, S.groups[0], false, true).hasAttribute('disabled'), false);
  assert.equal(checkButton(S, S.groups[0], false, false).hasAttribute('disabled'), true);
  assert.equal(checkButton({ ...S, groups: [S.groups[0]] }, S.groups[0], true, true).hasAttribute('disabled'), true);
  assert.deepEqual(MIC_CONSTRAINTS.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
  const zc = src('zonecheck.js');
  assert.match(zc, /const mic = navigator\.mediaDevices\.getUserMedia\(MIC_CONSTRAINTS\);[^\n]*\n[\s\S]*?await mic/);   // requested before any await
  assert.ok(zc.indexOf('getUserMedia(MIC_CONSTRAINTS)') < zc.indexOf("await api(`/groups/${g.id}/timing-check`"));
  assert.match(zc, /isSecureContext[\s\S]*insecureSheet\(INSECURE_TITLE/);
  assert.match(zc, /admin \? h\('button'[^\n]*'data-act': 'zc-apply'/);
  assert.match(zc, /house-offset`, \{ method: 'PUT'/);
  assert.match(zc, /timing-check\/\$\{my\.sid\}\/end`[\s\S]*offerResume\(r\.resumeGroups\)/);    // never resumes by itself
  assert.match(zc, /sink\.gain\.value = 0/);
  assert.match(src('refrec.js'), /checkButton\(S, g, admin, control, done\)/);
  assert.match(src('tree42.js'), /zoneTimingRow\(S, g, admin, done, can\)/);
  assert.match(src('announce.js'), /export function insecureSheet\(title = INSECURE_TITLE/);
});
