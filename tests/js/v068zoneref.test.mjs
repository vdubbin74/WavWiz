// 0.6.8-#15: one reference speaker per zone - client side (swap prompt, which reference a calibration starts from, the quiet note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.Element ??= class {};
const dir = new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url);
const rd = f => readFileSync(new URL(f, dir), 'utf8');
const { refFor, swapQuestion } = await import(new URL('zoneref.js', dir));

const S = {
  zones: [{ id: 1, name: 'Sofa L', reference: true }, { id: 2, name: 'Sofa R' }, { id: 3, name: 'Patio Sub', reference: true }, { id: 4, name: 'Patio Top' }, { id: 5, name: 'Desk', reference: true }],
  groups: [{ id: 10, name: 'Living', deviceIds: [1, 2], referenceId: 1 }, { id: 20, name: 'Patio', deviceIds: [3, 4], referenceId: 3 }, { id: 30, name: 'Empty', deviceIds: [] }],
};

test('a speaker is calibrated against its own zone reference; one in no zone uses the house reference', () => {
  assert.equal(refFor(S, 2).id, 1); assert.equal(refFor(S, 4).id, 3);
  assert.equal(refFor(S, 5).id, 5); assert.equal(refFor(S, null).id, 5);
});

test('moving a reference into a zone that has one asks, with the exact wording; otherwise no prompt', () => {
  assert.equal(swapQuestion(S, S.zones[0], 20), 'Patio already has a reference. Make Sofa L the reference instead?');
  assert.equal(swapQuestion(S, S.zones[1], 20), null);   // not a reference: joins as a regular speaker silently
  assert.equal(swapQuestion(S, S.zones[0], 30), null);   // empty zone: it simply becomes the reference
  assert.equal(swapQuestion(S, S.zones[0], null), null); // to Unassigned
});

test('wiring: tree move + Add to zone offer the swap, zone cards show the dismissible note, calibrate uses refFor', () => {
  const t = rd('tree42.js'), d = rd('devices.js');
  assert.match(t, /swapQuestion\(S, z, toId\)[\s\S]*applyMovePlan/); assert.match(t, /offerSwap\(q, toId, z, done\)/); assert.match(t, /zrefnote42[\s\S]*dismissNote\(g, done\)/);
  assert.match(d, /offerSwap\(q, g\.id, z, ctl\.refreshAll\)/);
  assert.match(rd('calibrate.js'), /house = refFor\(S, presetZoneId/);
  assert.match(rd('zoneref.js'), /\/groups\/\$\{toId\}\/reference/);
});
