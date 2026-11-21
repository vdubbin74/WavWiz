// 0.7.2 t2175u: This PC · Speakers - Real time / Sync with WavWiz (Settings > Devices > Audio inputs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/inputs.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const syncView = new Function(src.match(/export const outRank = [^\n]+/)[0].replace('export ', '') + '\n' + src.match(/export function syncView\(i\) \{[\s\S]*?\n\}\n/)[0].replace('export ', '') + 'return syncView;')();

test('t2175u syncView: speakers = chosen or the active output; spares exclude them; none when only one output', () => {
  const outs = [{ id: 'spk', name: 'Speakers', active: true }, { id: 'hdmi', name: 'LG Monitor', active: false }];
  const v = syncView({ localMode: 'sync', outputs: outs });
  assert.equal(v.sync, true); assert.equal(v.speakers, 'spk'); assert.deepEqual(v.spares.map(o => o.id), ['hdmi']); assert.equal(v.spare, 'hdmi'); assert.equal(v.none, false);
  assert.equal(syncView({ localMode: 'realtime', outputs: outs, syncSpeakers: 'hdmi' }).spare, 'spk');
  const one = syncView({ localMode: 'realtime', outputs: [outs[0]] }); assert.equal(one.none, true); assert.equal(one.spare, null);
});

test('t2175u: the Settings row has the two choices, both pickers, the note, and the amber no-spare state with VB-Cable', () => {
  assert.match(src, /seg\('realtime', 'Real time', 'this PC plays live, zones follow'\), seg\('sync', 'Sync with WavWiz', 'this PC plays in step with every zone', v\.none && !v\.sync\)/);
  assert.match(src, /pick\('Spare output', v\.spares, v\.spare, 'spareOutput'\)/); assert.match(src, /pick\('Play synced on', v\.outs, v\.speakers, 'syncSpeakers'\)/);
  assert.match(src, /h\('p', \{ class: 'small warnc lsx-warn' \}, NO_SPARE\)/); assert.match(src, /VB-Cable/);
  assert.match(src, /syncBox\(i, admin, put\),/);
  assert.match(css, /\.lsx \.lsx-warn\{color:var\(--amber\)\}/);
});

test('t2183u/t2186u syncView: optical first, a headset in use never picked by itself (still listed), an empty headphone jack is ok', () => {
  const outs = [{ id: 'hx', name: 'HyperX', headset: true, rank: 9, winDefault: true }, { id: 'hdmi', name: 'LG', rank: 1 }, { id: 'spk', name: 'Speakers', rank: 2 }, { id: 'opt', name: 'Optical', rank: 0 }];
  const v = syncView({ localMode: 'realtime', outputs: outs });
  assert.equal(v.speakers, 'spk'); assert.equal(v.spare, 'opt'); assert.deepEqual(v.spares.map(o => o.id), ['opt', 'hdmi', 'hx']);
  assert.equal(syncView({ outputs: [outs[0], outs[2]] }).spare, null);                                   // only the headset: "Choose…"
  assert.equal(syncView({ outputs: [outs[2], { id: 'hp', name: 'Headphones', headset: true, rank: 3 }] }).spare, 'hp');
  assert.equal(syncView({ outputs: [outs[0]] }).speakers, null);
  assert.match(src, /'Choose\\u2026'/); assert.match(src, /' \(headset, nothing plugged in\)' : ' \(headset\)'/);
});
