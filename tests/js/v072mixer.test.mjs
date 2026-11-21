// 0.7.2 (t2145u / t2148u): the Volume Mixer is a mode of the Devices panel. Every Master volume entry point opens Devices in that mode; the old
// separate F49 window is gone (nothing shown twice). Speaker rows: dot + name, volume + %, mute, zone-card chevron -> Max volume + Delay drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR, rd = f => readFileSync(join(js, f), 'utf8');
const mixer = rd('mixer.js'), tree = rd('tree42.js'), dev = rd('devices.js'), main = rd('main.js'), slider = rd('slider.js'), css = readFileSync(join(js, '..', 'app.css'), 'utf8');

test('the separate mixer window is gone; every entry point opens the Devices Volume Mixer', () => {
  assert.doesNotMatch(mixer, /dialog\(|mixer-dlg|export function openMixer/);
  assert.doesNotMatch(main, /openMixer\(/);
  assert.match(main, /addEventListener\('wavwiz:mixer', \(\) => openMixerMode\(\)\)/);
  assert.match(main, /export function openMixerMode\(\)[\s\S]{0,900}setMixer\(true\)/);
  assert.match(main, /else if \(S\.view !== 'devices'\) go\('devices'\)/, 'phone / narrow: the Devices page');
  assert.match(main, /P6\.dev === 'rail' && P6\.exp !== 'dev'\) setDevSize\('standard'\)/, 'PC: a railed Devices panel opens');
  assert.match(mixer, /export function mixerButton[\s\S]*?fire\('wavwiz:mixer'\)/);
});

test('mode state: Done and Esc leave it; the tree and the bar redraw from it', () => {
  assert.match(mixer, /export function setMixer\(v\)[\s\S]*?fire\('wavwiz:devredraw'\)/);
  assert.match(mixer, /'data-act': 'mixer-done'[^\n]*setMixer\(false\)/);
  assert.match(mixer, /ev\.key !== 'Escape'[\s\S]{0,300}setMixer\(false\)/);
  assert.match(dev, /openSig42\(\), isMixerOpen\(\)\]\);/, 'mode change rebuilds the tree (sig42)');
  assert.match(dev, /LIVE42 = \[[^\]]*'\.mx-vol'/, 'speaker bars patched live like the other levels');
  assert.match(dev, /masterRow\(S, ctl\), busy\), mxBar\(tcol\)/, 'PC: the bar under MASTER');
  assert.match(dev, /pinMxBar\(root\);/, 'phone: the bar pinned under the header');
});

test('one-line speaker rows in the same tree order: no tags, volume + %, mute, chevron, drawer after the row', () => {
  assert.match(tree, /class: 'tree42' \+ \(mx \? ' mx-on' : ''\)/);
  assert.match(tree, /if \(mx\) \{[^\n]*\n(?:\s*\/\/[^\n]*\n)?\s*row\.classList\.add\('mx-sp'\); row\.querySelector\('\.sp42-tags'\)\?\.remove\(\); row\.querySelector\('\.sp42-v'\)\?\.remove\(\);/);
  assert.match(tree, /l2 = h\('div', \{ class: 'mx-l2' \}, mixVol\(S, z\), mb\);\n\s*row\.append\(mixChev\(z, dr\), l2\)/, 'line 1 = dot + name + chevron; line 2 = slider, %, mute');
  assert.match(css, /\.tree42\.mx-on \.mx-l2\{flex:1 0 100%;/, 'line 2 is full width');
  assert.match(css, /\.tree42\.mx-on section\.qb42\.linked \.mx-l2\{margin-left:-7px;margin-right:-7px;width:calc\(100% \+ 14px\)\}/, 'same slider edges in linked and solo zones');
  assert.match(tree, /ms\.flatMap\(z => spRows\(z, g\.id\)\)/);
  assert.match(mixer, /class: 'plus chv zfold42-t mx-chev'/, 'the zone card chevron (same classes / size)');
  assert.match(css, /\.tree42\.mx-on \.dtag,\.tree42\.mx-on \.dtagrow:empty\{display:none!important\}/);
});

test('kept behaviours: Max before Delay, admin cap / canTune delay, wheel gate', () => {
  const d = mixer.slice(mixer.indexOf('export function mixDrawer'));
  assert.ok(d.indexOf('mv-caprow') < d.indexOf('mv-delayrow'), 'Max volume first');
  assert.match(d, /\/zones\/\$\{z\.id\}\/volcap`, \{ method: 'PUT', body: \{ cap: v, locked: v < 100 \} \}/);
  assert.match(d, /disabled: !admin \|\| undefined/);
  assert.match(d, /\/outputs\/\$\{encodeURIComponent\(c\.deviceId\)\}\/latency`, \{ method: 'PUT', body: \{ latencyMs: v, playerId: z\.playerId, live: true, method: 'manual' \} \}/);
  assert.match(d, /clamp\(v, 0, 600\)/);
  assert.match(slider, /const inMixer = r\.closest\?\.\('\.tree42\.mx-on'\);\n\s*if \(inMixer && !r\.closest\?\.\('section\.qb42\.mx-ctl'\)\) return;/);
});

test('t2155u: normal Devices speaker rows stay as they were (no slider; % + mute + tags); only the dot moves beside the name', () => {
  const row = tree.slice(tree.indexOf('const spRow = (z, gid) => {'), tree.indexOf('if (mx) {   // 0.7.2 Volume Mixer'));
  assert.doesNotMatch(row, /type: 'range'|mixVol|mx-l2/, 'no slider outside the mixer');
  assert.match(row, /h\('span', \{ class: 'sp42-v small', title: 'Volume' \}, `\$\{Math\.round\(z\.volume\)\}%`\)/);
  assert.match(row, /h\('span', \{ class: 'dtagrow sp42-tags' \}, tagEls3\(tags\)\)/);
  assert.match(css, /\.tree42 \.sp42>\.dot\{align-self:flex-start;margin-top:7px\}/);
  assert.match(css, /\.tree42\.mx-on \.sp42\.mx-sp>\.dot\{align-self:center;margin-top:0\}/);
});
