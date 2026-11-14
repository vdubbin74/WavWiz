// 0.7.1: the AirPlay / Cast Devices cards (and their ⋮ handles, t1937) are gone; add those speakers from the header button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');

test('0.7.1: AirPlay and Cast cards are not in the Devices tree; Add speaker is', () => {
  const t = rd('js/tree42.js'), ap = rd('js/airplaysetup.js'), cs = rd('js/castsetup.js');
  assert.doesNotMatch(t, /airPlaySetupCard\(S, ctl\)/);
  assert.doesNotMatch(t, /castSetupCard\(S, ctl\)/);
  assert.match(t, /class: 'btn sm zadd-spk'/);
  assert.match(t, /openAddSpeaker\(S, ctl\)/);
  assert.match(ap, /export function airPlaySetupCard[\s\S]*return null/);
  assert.match(cs, /export function castSetupCard[\s\S]*return null/);
});
