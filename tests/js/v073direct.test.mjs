// WavWiz 0.7.3 "Direct (no processing)" per speaker: Speaker Settings switch, saved in the speaker's own preset (direct: true), honoured by the
// browser / phone / TV speaker (roomeq.js) and the PC Player (WavWiz.Dsp). Never called bit-perfect (that is 0.8.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const repo = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const BUSY = { graphicDb: [5, 4, 2, 1, 0, -1, 0, 1, 2, 1], bass: { gainDb: 12, hz: 100 }, treble: { gainDb: 6, hz: 10000 }, trimDb: -4, preampDb: 3, balance: 60, loudness: { enabled: true, refVolume: 100 } };

test('0.7.3 Direct: the browser plan is null (no filters, trim, pre-gain, balance or clip guard) whatever else is set', async () => {
  const { eqPlan, normPreset } = await imp('roomeq');
  assert.equal(eqPlan({ preset: { ...BUSY, direct: true } }, 40), null);
  assert.equal(eqPlan({ preset: { ...BUSY, Direct: true } }, 40), null, 'PascalCase too');
  assert.equal(eqPlan({ preset: { ...BUSY, direct: true }, bypass: true }), null);
  const off = eqPlan({ preset: BUSY }, 40); assert.ok(off && off.filters.length > 0 && off.guard && off.left !== 1);
  assert.equal(normPreset({}).direct, false, 'old presets: off'); assert.equal(normPreset({ direct: 1 }).direct, true);
});

test('0.7.3 Direct: honest status chips (volume scaling, 48 kHz resampling, shared mode) and never "bit-perfect"', async () => {
  const { directChipList } = await imp('spkset');
  const t = z => directChipList(z).map(c => c[1]);
  const basement = t({ volume: 75, volCap: 75 });
  assert.ok(basement.some(s => /Volume 75% \(Max volume 75%\) - below 100% the samples are scaled/.test(s)), basement.join(' | '));
  assert.ok(t({ volume: 100, volCap: 100 }).some(s => /Volume 100% - samples not scaled/.test(s)));
  assert.ok(t({ volume: 60 }).some(s => /^⚠ Volume 60% - below 100%/.test(s)));
  for (const s of basement) assert.doesNotMatch(s, /bit.?perfect/i);
  assert.ok(basement.some(s => /resampled to 48 kHz/.test(s))); assert.ok(basement.some(s => /shared mode/.test(s)));
  assert.equal(directChipList({ volume: 75, volCap: 75 }).filter(c => c[0] === 'warn').length, 3);
});

test('0.7.3 Direct: Speaker Settings card, switch and greyed (inert, kept) DSP controls; Volume / Max volume / Delay stay live', async () => {
  const s = src('spkset');
  assert.match(s, /'DIRECT \(NO PROCESSING\)'/); assert.match(s, /'data-act': 'direct'/); assert.match(s, /edit\(c => \{ c\.direct = !c\.direct; \}\)/);
  assert.match(s, /\[balance, bass, treble, trim\]\.forEach\(r => r\.classList\.add\('spk-dsp'\)\)/);
  assert.match(s, /const dspBits = \[eqHead, presetRow, eqHost, extraSw\]/);
  assert.match(s, /\[balance, bass, treble, trim, \.\.\.dspBits\]\.forEach\(e => \{ e\.inert = on; \}\)/);
  assert.doesNotMatch(s, /\[(vol|capRow|delay)[,\]].*spk-dsp/, 'volume rows never greyed');
  assert.match(s, /h\('div', \{ class: 'spk-body' \}, directCard, left, right\)/);
  assert.match(s, /Object\.assign\(c, j, \{ bypass: c\.bypass, direct: !!c\.direct, name: c\.name \}\)/, 'picking a preset keeps Direct');
  assert.doesNotMatch(s, /Bit-perfect|BIT-PERFECT/);
  const css = readFileSync(`${js}/../app.css`, 'utf8');
  assert.match(css, /\.spkset\.spk-direct-on \.spk-dsp\{opacity:\.38;filter:saturate\(\.3\);pointer-events:none\}/);
  assert.match(css, /\.spk-direct\{grid-column:1\/-1;/);
});

test('0.7.3 Direct: new presets start off; the other preset pickers keep it', async () => {
  const { flatEq } = await imp('eq'); assert.equal(flatEq().direct, false);
  assert.match(src('phonesound'), /bypass: r\.cur\.bypass, direct: !!r\.cur\.direct \}/);
  assert.match(src('centerview'), /bypass: real\.cur\.bypass, direct: !!real\.cur\.direct \}/);
});

test('0.7.3 Direct: the PC Player turns everything off but the volume and the 0 dBFS clamp; the server keeps the flag', async () => {
  const pr = repo('src/WavWiz.Dsp/DspPreset.cs'), pg = repo('src/WavWiz.Dsp/DspProgram.cs'), ch = repo('src/WavWiz.Dsp/DspChain.cs');
  assert.match(pr, /public bool Direct \{ get; init; \}/);
  assert.match(pg, /bool eq = !Preset\.Bypass && !Preset\.Direct;/); assert.match(pg, /PreGainDb = Preset\.Direct \? 0 :/);
  assert.match(ch, /cur\.Preset\.Direct \? 0 : cur\.Preset\.Balance/); assert.match(ch, /cur\.Preset\.Direct \? DirectLimiter : cur\.Preset\.Limiter/);
  assert.match(ch, /DirectLimiter = new\(Enabled: false\)/);
  assert.match(repo('src/WavWiz.Server/Features/DeviceProfileService.cs'), /B\(eqA\["direct"\]\) != B\(eqB\["direct"\]\)/, 'a profile notices Direct changed');
  assert.match(repo('CHANGELOG.md'), /Direct \(no processing\)/); assert.match(src('about'), /Direct \(no processing\)/);
});
