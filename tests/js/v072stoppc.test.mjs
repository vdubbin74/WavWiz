// 0.7.2 t2193u: stopping This PC · Speakers asks first: Pause PC audio & stop / Stop / Cancel, with "Don't show again".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/inputs.js', import.meta.url), 'utf8');
// inputs.js needs a DOM; the pure rule is taken from the source and run as is
const pick = n => src.match(new RegExp(`export const ${n} = ([^\\n]+);\\n`))[1];
const M = { stopPcChoice: new Function('return ' + pick('stopPcChoice'))(), STOP_PC_TEXT: new Function('return ' + pick('STOP_PC_TEXT'))() };
test('t2193u stopPcChoice: only this PC\'s sound asks; a remembered choice is used without asking', () => {
  assert.equal(M.stopPcChoice({ kind: 'aux' }, null), 'stop'); assert.equal(M.stopPcChoice({ kind: 'mic' }, 'pause'), 'stop');
  assert.equal(M.stopPcChoice({ kind: 'loopback' }, null), null); assert.equal(M.stopPcChoice({ kind: 'loopback' }, 'junk'), null);
  assert.equal(M.stopPcChoice({ kind: 'loopback' }, 'pause'), 'pause'); assert.equal(M.stopPcChoice({ kind: 'loopback' }, 'stop'), 'stop');
  assert.equal(M.STOP_PC_TEXT, "PC audio will go back to this PC's own speakers.");
});
test('t2193u wiring: the three buttons in the app dialog; Pause sends pausePc and reports what the server did', () => {
  assert.match(src, /\{ text: 'Pause PC audio & stop', cls: 'primary', onclick: \(\) => pick\(true\) \},\s*\{ text: 'Stop', onclick: \(\) => pick\(false\) \},\s*\{ text: 'Cancel', cls: 'quiet' \},/);
  assert.match(src, /h\('span', null, "Don't show again"\)/);
  assert.match(src, /if \(keep\.checked\) \{ try \{ localStorage\.setItem\(STOP_PC_KEY, pause \? 'pause' : 'stop'\); \}/);
  assert.match(src, /askStopPc\(i, async pause => \{ await go\(`\/inputs\/\$\{i\.id\}\/stop`, pause \? \{ pausePc: true \} : \{\}\); if \(pause\) toast\(data\.pausedPc \?/);
});
