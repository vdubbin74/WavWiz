// 0.7.2 t2170u: an input with a problem never says Playing; Windows' mic privacy refusal shows the way to the setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/inputs.js', import.meta.url), 'utf8');
const pure = src.match(/export function inputBadges\(i\) \{[\s\S]*?\n\}\n/)[0].replace('export ', '');
const inputBadges = new Function(pure + 'return inputBadges;')();

test('t2170u: Problem replaces Playing when the input has an error', () => {
  assert.deepEqual(inputBadges({ playing: true, enabled: true }).map(b => b[0]), ['Playing']);
  const b = inputBadges({ playing: true, enabled: true, error: 'Windows is blocking the microphone.' }).map(b => b[0]);
  assert.ok(b.includes('Problem')); assert.ok(!b.includes('Playing'));
});

test('t2170u: the privacy line posts the one exact message in the Player and shows the path elsewhere', () => {
  assert.match(src, /export const MIC_SETTINGS_MSG = \{ open: 'ms-settings:privacy-microphone' \};/);
  assert.match(src, /'Open microphone settings'/);
  assert.match(src, /globalThis\.chrome\.webview\.postMessage\(MIC_SETTINGS_MSG\)/);
  assert.match(src, /'On the server PC: ' \+ MIC_SETTINGS_PATH/);
  assert.equal((src.match(/\.\.\.problemEls\(i\)/g) || []).length, 2, 'tile and Settings row');
  const forms = readFileSync(new URL('../../src/WavWiz.Player/Forms.cs', import.meta.url), 'utf8');
  assert.match(forms, /if \(UiUrl\.IsMicSettingsMessage\(j\)\) \{ OpenInBrowser\(UiUrl\.MicSettingsUri\); return; \}/);
});
