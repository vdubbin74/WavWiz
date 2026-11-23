// WavWiz 0.7.3 Direct (no processing) gaps: (1) picking a preset from Menu > Sound / EQ (menusub.js) keeps a speaker's Direct on;
// (2) the center EQ and the phone Sound sheet show that Direct is on (grayed, not editable) with Turn off / Speaker settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const BASS = { id: 2, name: 'Bass Boost', source: 'builtin', json: { name: 'Bass Boost', graphicDb: [5, 4, 2, 1, 0, -1, 0, 1, 2, 1], bass: { gainDb: 3, hz: 90 } } };
const OWN = { id: 7, name: 'REF speaker EQ', source: 'user', json: { name: 'REF speaker EQ', graphicDb: new Array(10).fill(0), direct: true } };
const OUT = { deviceId: 'ref-analog', zone: 'REF speaker', zoneId: 3 };
const fakeApi = (assignment) => { const calls = []; let next = 40; const fn = async (path, opts = {}) => { calls.push({ path, method: opts.method || 'GET', body: opts.body }); if (path.startsWith('/dsp/assignments/') && !opts.method) return assignment; if (path === '/dsp/presets' && opts.method === 'POST') return { id: next++ }; return { ok: true }; }; return { fn, calls }; };

test('0.7.3 gap 1: directKeepBody copies the picked preset into the speaker\'s own preset with direct kept', async () => {
  const { directKeepBody } = await imp('menusub');
  assert.equal(directKeepBody(BASS, null, 'REF speaker'), null);
  assert.equal(directKeepBody(BASS, { json: { direct: false } }, 'REF speaker'), null);
  const b = directKeepBody(BASS, OWN, 'REF speaker');
  assert.equal(b.name, 'REF speaker EQ'); assert.equal(b.preset.direct, true); assert.deepEqual(b.preset.graphicDb, BASS.json.graphicDb); assert.equal(b.preset.bass.gainDb, 3);
});

test('0.7.3 gap 1: assignPreset keeps Direct (updates the own preset and assigns it) and is unchanged when Direct is off', async () => {
  const { assignPreset } = await imp('menusub');
  let a = fakeApi({ presetId: 7, enabled: true, bypass: false });
  assert.equal(await assignPreset(OUT, BASS, [BASS, OWN], a.fn), true);
  const put = a.calls.find(c => c.path === '/dsp/presets/7'); assert.ok(put && put.method === 'PUT' && put.body.preset.direct === true && put.body.preset.bass.gainDb === 3);
  assert.deepEqual(a.calls.at(-1), { path: '/dsp/assignments/ref-analog', method: 'PUT', body: { presetId: 7, enabled: true, bypass: false } });
  // Direct on but no own preset yet (e.g. a profile preset) -> a new own preset
  const prof = { id: 9, name: 'Profile: Night', source: 'user', json: { direct: true } };
  a = fakeApi({ presetId: 9 }); assert.equal(await assignPreset(OUT, BASS, [BASS, prof], a.fn), true);
  const post = a.calls.find(c => c.path === '/dsp/presets' && c.method === 'POST'); assert.equal(post.body.name, 'REF speaker EQ'); assert.equal(post.body.preset.direct, true);
  assert.equal(a.calls.at(-1).body.presetId, 40);
  // Direct off -> the picked preset itself, no preset writes (as before 0.7.3)
  a = fakeApi({ presetId: 2 }); assert.equal(await assignPreset(OUT, BASS, [BASS, OWN], a.fn), false);
  assert.equal(a.calls.filter(c => c.path.startsWith('/dsp/presets')).length, 0);
  assert.deepEqual(a.calls.at(-1).body, { presetId: 2, enabled: true, bypass: false });
  assert.match(src('menusub'), /const kept = await assignPreset\(o, p, presets\)/); assert.match(src('menusub'), /\(Direct stays on\)/);
});

test('0.7.3 gap 2: the Direct notice text and card (same look as Speaker Settings)', async () => {
  const { DIRECT_NOTE, directNoteText } = await imp('directnote');
  assert.equal(DIRECT_NOTE, 'Direct is on — processing bypassed');
  assert.match(directNoteText('REF speaker'), /^Direct is on — processing bypassed\. .* of REF speaker are kept but not used until you turn Direct off\.$/);
  const s = src('directnote'); assert.match(s, /class: 'spk-direct direct-banner'/); assert.match(s, /'DIRECT \(NO PROCESSING\)'/); assert.match(s, /'data-act': 'direct-off'/); assert.match(s, /'data-act': 'direct-open'/);
  assert.doesNotMatch(s, /bit.?perfect/i);
  const css = readFileSync(`${js}/../app.css`, 'utf8'); assert.match(css, /\.direct-dim\{opacity:\.38;filter:saturate\(\.3\);pointer-events:none\}/);
});

test('0.7.3 gap 2: center EQ grays and locks the EQ + preset while Direct is on, with Turn off / Speaker settings', async () => {
  const s = src('centerview');
  assert.match(s, /locked: locked \|\| !ok \|\| !real \|\| direct/); assert.match(s, /if \(!real \|\| loadEqLock\(\) \|\| !ok \|\| real\.cur\.direct\) return;/);
  assert.match(s, /area\.el\.classList\.toggle\('direct-dim', direct\)/); assert.match(s, /disabled: \(!ok \|\| loadEqLock\(\) \|\| direct\) \|\| undefined/);
  assert.match(s, /real\.cur\.direct = false; previewNow\(\); saveSoon\(\); draw\(\);/); assert.match(s, /'wavwiz:openspk', \{ detail: o\.zoneId \}/);
  assert.match(s, /banner, real \? area\.el/);
});

test('0.7.3 gap 2: phone Sound sheet grays and locks while Direct is on; Turn off previews; Speaker settings closes the sheet first', async () => {
  const s = src('phonesound');
  assert.match(s, /r\?\.area\?\.setLocked\(!ok \|\| direct\); r\?\.lower\?\.setLocked\(!ok \|\| direct\)/);
  assert.match(s, /locked: !editable\(r\) \|\| direct/); assert.match(s, /pick: p => \{ if \(!editable\(r\) \|\| r\.cur\.direct\) return;/); assert.match(s, /flat: \(\) => \{ if \(!editable\(r\) \|\| r\.cur\.direct\) return;/);
  assert.match(s, /r\.cur\.direct = false; changed\(r\); draw\(r\);/);
  assert.match(s, /onOpenSpeaker: id => \{ close\(\); window\.dispatchEvent\(new CustomEvent\('wavwiz:openspk', \{ detail: id \}\)\); \}/);
  assert.match(s, /\$\{DIRECT_NOTE\}\. Turn it off above to edit\./);
});
