// 0.7.3 t2251u: docs/AUDIO-INPUTS.md explains This PC · Speakers (loopback) and the other inputs, and Settings > Devices > Audio inputs links
// to it. The guide quotes the app's own texts; these checks keep the quotes in step with the code (C# and JS), so the page never drifts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const root = new URL('../../', import.meta.url).pathname;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const doc = () => readFileSync(join(root, 'docs/AUDIO-INPUTS.md'), 'utf8');
const cs = p => readFileSync(join(root, 'src', p), 'utf8');

test('the guide exists and is linked from the README, FIRST-RUN and KNOWN-ISSUES', () => {
  assert.ok(existsSync(join(root, 'docs/AUDIO-INPUTS.md')));
  for (const f of ['README.md', 'docs/FIRST-RUN.md', 'KNOWN-ISSUES.md']) assert.ok(readFileSync(join(root, f), 'utf8').includes('AUDIO-INPUTS.md'), f);
});

test('Settings > Audio inputs links to the guide (new window = system browser in the Player)', async () => {
  const m = await imp('inputs');
  assert.equal(m.INPUTS_GUIDE_URL, 'https://github.com/vdubbin74/WavWiz/blob/main/docs/AUDIO-INPUTS.md');
  assert.match(readFileSync(join(js, 'inputs.js'), 'utf8'), /h\('a', \{ href: INPUTS_GUIDE_URL, target: '_blank', rel: 'noopener' \}, INPUTS_GUIDE_TEXT\)/);
});

test('the guide quotes the app word for word', async () => {
  const d = doc(), m = await imp('inputs'), inputs = cs('WavWiz.PlayerCore/Inputs.cs'), svc = cs('WavWiz.Server/Inputs/InputService.cs');
  const echo = /EchoRefused = "([^"]+)"/.exec(inputs)[1];
  assert.ok(d.includes(echo), 'echo refusal text');
  const noPlayer = /NoPlayerNote = "([^"]+)"/.exec(svc)[1];
  assert.ok(d.includes(noPlayer), 'no-player note');
  assert.ok(d.includes(m.NO_SPARE), 'no spare output text');
  for (const name of ['stereo mix', 'what u hear', 'wave out mix', 'what you hear', 'loopback']) {
    assert.ok(inputs.includes(`n.Contains("${name}")`), name);
    assert.ok(d.toLowerCase().includes(name), name);
  }
});

test('the guide states the numbers the code uses', () => {
  const d = doc(), wire = cs('WavWiz.Core/Protocol/Wire.cs'), svc = cs('WavWiz.Server/Inputs/InputService.cs'), wasapi = cs('WavWiz.Player/WasapiInputProvider.cs');
  assert.match(wire, /InputAudio = 13/); assert.match(wire, /InputCmd = 14/);
  assert.match(d, /type 13/); assert.match(d, /type 14/);
  assert.match(svc, /MinGainDb = -12, MaxGainDb = 6/); assert.match(svc, /MicMaxGainDb = 24/);
  assert.match(d, /-12 to \+6 dB/); assert.match(d, /\+24 dB/);
  assert.match(svc, /TargetMs = 800/); assert.match(d, /0\.8 s/);
  assert.match(wasapi, /19041/); assert.match(d, /19041/);
  assert.match(wasapi, /ExcludeTargetProcessTree/);
  assert.match(d, /Real time vs Sync|Real time or Sync with WavWiz/);
});
