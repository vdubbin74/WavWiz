// WavWiz 0.7.2 B: audio inputs on the server PC - Library > Inputs tiles (pure parts + wiring contracts), Settings > Devices > Audio inputs,
// events forwarded from the server, and phone-only CSS gated on html.handset (never on a narrow width).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const inp = readFileSync(join(js, 'inputs.js'), 'utf8');
const lib = readFileSync(join(js, 'library.js'), 'utf8');
const main = readFileSync(join(js, 'main.js'), 'utf8');
const set = readFileSync(join(js, 'settings.js'), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const pure = name => { const m = inp.match(new RegExp(`export function ${name}\\b[\\s\\S]*?\\n}\\n`)) || inp.match(new RegExp(`export const ${name} = .*\\n`)); assert.ok(m, name); return m[0].replace('export ', ''); };
const P = new Function(pure('inputBadges') + pure('meterPct') + pure('showMeter') + pure('mainAction') + pure('whereText') + '\nreturn { inputBadges, meterPct, showMeter, mainAction, whereText };')();

test('0.7.2: tile badges - Playing, Off / Muted, Turntable, Bluetooth, Problem', () => {
  assert.deepEqual(P.inputBadges({ enabled: false }).map(b => b[0]), ['Off']);
  assert.deepEqual(P.inputBadges({ enabled: true, muted: true, kind: 'mic' }).map(b => b[0]), ['Muted']);
  assert.deepEqual(P.inputBadges({ enabled: true, playing: true, turntable: true }).map(b => b[0]), ['Playing', 'Turntable']);
  assert.deepEqual(P.inputBadges({ enabled: true, bluetooth: true, error: 'x' }).map(b => b[0]), ['Bluetooth', 'Problem']);
});

test('0.7.2: meter maps -60..0 dBFS to 0..100 %', () => {
  assert.equal(P.meterPct(-60), 0); assert.equal(P.meterPct(-30), 50); assert.equal(P.meterPct(0), 100); assert.equal(P.meterPct(3), 100);
  assert.equal(P.meterPct(null), 0); assert.equal(P.meterPct(-Infinity), 0);
});

test('0.7.2: meters only where there is a level - Aux / S/PDIF while on, anything while it plays; never an idle mic or this PC\'s sound', () => {
  assert.equal(P.showMeter({ enabled: true, kind: 'aux' }), true);
  assert.equal(P.showMeter({ enabled: true, kind: 'spdif' }), true);
  assert.equal(P.showMeter({ enabled: false, kind: 'aux' }), false);
  assert.equal(P.showMeter({ enabled: true, kind: 'mic' }), false);
  assert.equal(P.showMeter({ enabled: true, kind: 'loopback' }), false);
  assert.equal(P.showMeter({ enabled: true, kind: 'loopback', playing: true }), true);
});

test('0.7.2: the main button - play an enabled input, stop a playing one, nothing for muted mics / off inputs / view-only', () => {
  assert.equal(P.mainAction({ enabled: true }, true), 'play');
  assert.equal(P.mainAction({ enabled: true, playing: true }, true), 'stop');
  assert.equal(P.mainAction({ enabled: true, muted: true }, true), null);
  assert.equal(P.mainAction({ enabled: false }, true), null);
  assert.equal(P.mainAction({ enabled: true }, false), null);
  assert.equal(P.whereText({ playing: true, zone: 'everywhere' }), 'Playing Everywhere');
  assert.equal(P.whereText({ playing: true, zone: 'g:4', groupId: 'x' }, [{ id: 4, name: 'Kitchen' }]), 'Playing in Kitchen');
  assert.equal(P.whereText({ playing: false }), '');
});

test('0.7.2: tiles play in this page\'s zone or Everywhere, and keep the server\'s meter lease while shown', () => {
  assert.match(inp, /go\(`\/inputs\/\$\{i\.id\}\/play`, \{ zoneId: getApiZone\(\) \}\)/);
  assert.match(inp, /go\(`\/inputs\/\$\{i\.id\}\/play`, \{ zoneId: 'everywhere' \}\)/);
  assert.match(inp, /go\(`\/inputs\/\$\{i\.id\}\/stop`\)/);
  assert.match(inp, /export const METER_RENEW_MS = 20000;/);          // the server's lease is 30 s
  assert.match(inp, /api\('\/inputs\/meter', \{ method: 'POST', body: \{ on: v \} \}\)/);
  assert.match(inp, /i\.turntable \? 'vinyl'/);                       // vinyl icon in Turntable mode
});

test('0.7.2: Library has an Inputs source, shown only when the server PC has inputs', () => {
  assert.match(lib, /export const LIB_SOURCES = \['local', 'remote', 'radio', 'playlists', 'inputs'\];/);
  assert.match(lib, /export const showInputsTab = n => Number\(n\) > 0;/);
  assert.match(lib, /\.\.\.\(showInputsTab\(inputsN\) \|\| st\.source === 'inputs' \? \[\['inputs', 'Inputs'\]\] : \[\]\)/);
  assert.match(lib, /else if \(st\.source === 'inputs'\) nodes = await extraPage\('inputs'\);/);
  assert.match(lib, /if \(st\.source === 'inputs' && !showInputsTab\(inputsN\)\) setSource\('local'\)/);
  assert.match(main, /get inputs\(\) \{ return inputs \|\|= inputsView\(S\); \}/);   // the phone page owns its own adapter
  assert.match(main, /inputs: inputsView\(S\), rip: ripView\(S\)/);
});

test('0.7.2: inputs / inputlevel server events reach the page', () => {
  assert.match(main, /else if \(m\.type === 'inputs' \|\| m\.type === 'inputlevel'\) window\.dispatchEvent\(new CustomEvent\('wavwiz:' \+ m\.type, \{ detail: m\.data \}\)\);/);
});

test('0.7.2: Settings > Devices > Audio inputs - admin switches, gain -12..+6, Turntable / auto-start (Aux), live source (mic), searchable', () => {
  assert.match(set, /players\.push\(inputsCard\(S, \{ admin \}\)\);/);
  assert.match(inp, /id: 'sec-inputs' \}, h\('h3', null, INPUTS_TITLE\)/);
  assert.match(inp, /type: 'range', min: -12, max: 6, step: 0\.5/);
  assert.match(inp, /i\.kind === 'aux' \? sw\('Turntable mode'/);
  assert.match(inp, /i\.kind === 'mic' \? sw\('Live source'/);
  assert.match(inp, /disabled: !admin \|\| dis/);
  assert.match(inp, /h\('span', \{ class: 'setterms', hidden: true \}, INPUT_TERMS\)/);
  assert.match(inp, /export const INPUT_TERMS = '[^']*turntable[^']*s\/pdif[^']*headset[^']*';/);
});

test('0.7.2: inputs CSS - phone layout only on html.handset; vinyl spin honors reduced motion', () => {
  const block = css.slice(css.indexOf('/* 0.7.2 audio inputs'));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /@media[^{]*max-width/);
  assert.match(block, /html\.handset \.inp-grid\{grid-template-columns:1fr/);
  assert.match(block, /@media \(prefers-reduced-motion:reduce\)\{\.inp-tile\.playing \.inp-ic\[data-ic=vinyl\] svg\{animation:none\}\}/);
});
