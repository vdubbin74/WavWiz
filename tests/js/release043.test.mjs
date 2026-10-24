// WavWiz 0.4.3 - pure logic for the fix list: one lit preset chip, calibration line, Home EQ default speaker + short picker text, box titles,
// and source checks for the EQ label / Scenes header / panel layout fixes. UI is covered by tests/ui/ui043.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');

test('#4 activePreset: exactly one match (own name first), none for unsaved custom', async () => {
  const { activePreset } = await imp('spkset');
  const flat = new Array(10).fill(0), rock = [4, 3, 0, -1, 0, 1, 2, 3, 4, 4];
  const list = [{ name: 'Flat', json: { graphicDb: flat } }, { name: 'Basement EQ', json: { graphicDb: flat } }, { name: 'Rock', json: { graphicDb: rock } }];
  assert.equal(activePreset(list, { name: 'Basement EQ', graphicDb: flat }), 'Basement EQ');
  assert.equal(activePreset(list, { name: 'whatever', graphicDb: flat }), 'Flat');
  assert.equal(activePreset(list, { graphicDb: rock.map(String) }), 'Rock');
  assert.equal(activePreset(list, { graphicDb: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), null);
  assert.equal(activePreset([], null), null);
});
test('#8 calText: Done / Not calibrated · Quick / Thorough · date · offset', async () => {
  const { calText } = await imp('spkset'); const f = () => 'Oct 19, 2026';
  assert.equal(calText([], f), 'Calibration: Not calibrated');
  assert.equal(calText([{ current: false, latencyMs: 3, method: 'mic', measuredAt: '2026-10-19T10:00:00Z' }], f), 'Calibration: Not calibrated');
  assert.equal(calText([{ current: true, latencyMs: 12.4, method: 'mic', notes: 'quick', measuredAt: '2026-10-19T10:00:00Z' }], f), 'Calibration: Done · Quick · Oct 19, 2026 · +12 ms');
  assert.equal(calText([{ current: true, latencyMs: -5, method: 'mic', notes: 'thorough', measuredAt: '2026-10-19T10:00:00Z' }], f), 'Calibration: Done · Thorough · Oct 19, 2026 · -5 ms');
  assert.equal(calText([{ current: true, latencyMs: 0, method: 'manual', measuredAt: '2026-10-19T10:00:00Z' }], f), 'Calibration: Set by hand · Oct 19, 2026 · +0 ms');
});
test('#5 controllingTarget: first live speaker of the Controlling zone, in panel order', async () => {
  const { controllingTarget, pickerLabel } = await imp('eqstyle');
  const zones = [{ id: 1, name: 'Kitchen-Left', outputs: [{ deviceId: 'a', name: 'Browser audio', connected: true }] },
    { id: 3, name: 'PCBOXV1', outputs: [{ deviceId: 'c', name: 'Speakers', connected: false }] },
    { id: 5, name: 'Sub', outputs: [{ deviceId: 'e1', name: 'Speakers', connected: true }, { deviceId: 'e2', name: 'HDMI', active: true }] }];
  const groups = [{ id: 10, name: 'Basement', deviceIds: [5, 3] }, { id: 11, name: 'Kitchen', deviceIds: [1] }];
  const t = controllingTarget(zones, groups, { kind: 'zone', id: 10 });
  assert.equal(t.deviceId, 'e2'); assert.equal(t.zone, 'Sub'); assert.equal(t.zoneId, 5);
  assert.equal(controllingTarget(zones, groups, { kind: 'zone', id: 11 }).deviceId, 'a');
  assert.equal(controllingTarget(zones, groups, { kind: 'jukebox' }), null); assert.equal(controllingTarget(zones, groups, null), null);
  assert.equal(controllingTarget([{ id: 3, name: 'x', outputs: [] }], groups, { kind: 'zone', id: 10 }), null);
  const outs = [{ zoneId: 1, zone: 'Kitchen-Left', name: 'Browser audio' }, { zoneId: 5, zone: 'Sub', name: 'Speakers' }, { zoneId: 5, zone: 'Sub', name: 'HDMI' }];
  assert.equal(pickerLabel(outs[0], outs), 'Kitchen-Left'); assert.equal(pickerLabel(outs[2], outs), 'Sub · HDMI');
  assert.match(src('centerview'), /controllingTarget\(S\.zones, S\.groups, Z\.current\(\)\)/); assert.match(src('centerview'), /addEventListener\('wavwiz:zone', onZone\)/);
});
test('#2 #9 boxTitle: PAUSED when paused; sentence-case title split into name + status', async () => {
  const { treeModel, boxTitle } = await imp('tree42');
  const m = treeModel([{ id: 1, name: 'S1' }], [{ id: 12, name: 'Garage', deviceIds: [1], playbackId: 'zg:12' }]);
  assert.equal(boxTitle(m.boxes[0], { state: 'paused' }), 'Queue: Garage · PAUSED'); assert.equal(boxTitle(m.boxes[0], null), 'Queue: Garage · IDLE');
  const s = src('tree42'); assert.match(s, /lead\.now\?\.state === 'paused' && lead\.now\?\.positionMs > 0/); assert.match(s, /class: 'qb42-name'/); assert.match(s, /class: 'zcount42'/);
  assert.doesNotMatch(s, /'⠿'/); assert.doesNotMatch(s, /sp42-menu/); assert.match(s, /filter\(t => t\.k !== 'count'\)/);
});
test('#3 #6 #7 #1 CSS: EQ labels thin by width, header one line, no dotted outline, no CONTROLLING chip in the normal panel', () => {
  const c = css();
  assert.match(c, /\.eqarea\{container:eqa\/inline-size\}/); assert.match(c, /@container eqa \(max-width:560px\)\{ \.eqb-hzu\{display:none\} \}/);
  assert.match(c, /@container spkset \(max-width:820px\)\{ \.spkset \.spk-body\{grid-template-columns:1fr\} \}/);
  assert.doesNotMatch(c, /\.zwrap42\.picked \.zcard42\{outline/);
  assert.match(c, /\.devpanel:not\(\.expanded\) \.dmaster>\.dvol-master>\.zs-master\{display:none!important\}/); assert.doesNotMatch(c, /\.dmaster \.zs-master \.zs-lbl\{display:inline!important\}/);
  assert.match(src('scenesched'), /Server PC clock: /); assert.match(src('eqview'), /class: 'eqb-hzu'/);
});
