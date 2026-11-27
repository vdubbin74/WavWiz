// WavWiz 0.7.3: Library > Inputs, Now Playing, the mini player and the Queue name the PC an audio input is on ("PCBOXV2 · Speakers (what you hear)")
// on every phone and other PC; only a browser on that same PC (auth/state thisMachine + machineName) shows "This PC".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const PHONE = { thisMachine: false, machineName: null }, SAME = { thisMachine: true, machineName: 'PCBOXV2' }, OTHER = { thisMachine: false };

test('pcText: the PC name stays everywhere except a browser on that PC', async () => {
  const { pcText } = await imp('pcname');
  assert.equal(pcText('PCBOXV2 · Speakers (what you hear)', PHONE), 'PCBOXV2 · Speakers (what you hear)');
  assert.equal(pcText('PCBOXV2 · Microphone', OTHER), 'PCBOXV2 · Microphone');
  assert.equal(pcText('PCBOXV2 · Speakers (what you hear)', SAME), 'This PC · Speakers (what you hear)');
  assert.equal(pcText('pcboxv2 · Microphone', SAME), 'This PC · Microphone');   // Windows names are case-insensitive
  assert.equal(pcText('Turntable', SAME), 'Turntable');                        // a renamed input is left alone
  assert.equal(pcText('PCBOXV3D · Microphone', SAME), 'PCBOXV3D · Microphone');  // another PC's input
  assert.equal(pcText('PCBOXV2 · Mic', null), 'PCBOXV2 · Mic');
  assert.equal(pcText(undefined, SAME), undefined);
});

test('pcInput / pcNow / pcQueue: only audio inputs are renamed', async () => {
  const { pcInput, pcNow, pcQueue } = await imp('pcname');
  const i = { id: 'i1', kind: 'loopback', name: 'PCBOXV2 · Speakers', defaultName: 'PCBOXV2 · Speakers', source: 'PCBOXV2 · Speakers (what you hear)', pc: 'PCBOXV2' };
  assert.deepEqual(pcInput(i, PHONE), i);
  const l = pcInput(i, SAME); assert.equal(l.name, 'This PC · Speakers'); assert.equal(l.source, 'This PC · Speakers (what you hear)'); assert.equal(i.name, 'PCBOXV2 · Speakers');
  const inItem = { kind: 'input', title: 'HyperX QuadCast', artist: 'PCBOXV2 · Microphone', album: 'Audio input' };
  const track = { kind: 'track', title: 'PCBOXV2 · Live', artist: 'PCBOXV2 · Band' };
  assert.equal(pcNow({ state: 'playing', item: inItem }, SAME).item.artist, 'This PC · Microphone');
  assert.equal(pcNow({ state: 'playing', item: inItem }, PHONE).item.artist, 'PCBOXV2 · Microphone');
  const n = { state: 'playing', item: track }; assert.equal(pcNow(n, SAME), n);
  assert.deepEqual(pcQueue([inItem, track], SAME).map(x => x.artist), ['This PC · Microphone', 'PCBOXV2 · Band']);
  assert.equal(pcNow(null, SAME), null);
});

test('wired where the labels are shown: Library > Inputs, Settings, Now Playing / Queue (main) and the mini player', () => {
  const inp = src('inputs'), main = src('main'), mini = src('mini');
  assert.match(inp, /import \{ pcInput \} from '\.\/pcname\.js'/);
  assert.match(inp, /list\.map\(i => tile\(pcInput\(i, S\.auth\)\)\)/);
  assert.match(inp, /l\.map\(i => row\(pcInput\(i, S\.auth\)\)\)/);
  assert.match(main, /S\.now = pcNow\(r\.now, S\.auth\); S\.queue = pcQueue\(r\.queue\.items, S\.auth\)/);
  assert.match(mini, /now = pcNow\(r\.now, mzAuth\)/);
  assert.match(mini, /mzAuth = s/);
});
