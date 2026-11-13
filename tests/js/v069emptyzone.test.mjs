// 0.6.9 #21 (t1852/t1853): a zone with NO speakers (Upstairs, Rooftop, an empty Jukebox) must be pickable, so Now Playing and the Queue switch
// to it. Before: the Devices tree drew an empty zone as a compact row whose only action opened its settings (nothing called Z.select), and the
// zone list left out the Jukebox unless it had speakers. The server already accepted play / queue for an empty zone (it plays silently).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const src = f => readFileSync(join(js, f), 'utf8');
const imp = f => import(pathToFileURL(join(js, f + '.js')).href);
globalThis.Element ??= class {};
globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {};
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.dispatchEvent ??= () => true;
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
const ls = mem(), ss = mem();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true });
const cls = () => ({ toggle() {}, add() {}, remove() {}, contains: () => false });
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { classList: cls() },
  documentElement: { style: { setProperty() {} }, classList: cls(), dataset: {} }, createElement: () => ({ style: {}, classList: cls(), setAttribute() {}, append() {} }) };
const groups = [
  { id: 1, name: 'Basement', deviceIds: [10, 11], playbackId: 'default', online: true },
  { id: 2, name: 'Upstairs', deviceIds: [], playbackId: 'zg:2' },
  { id: 3, name: 'Rooftop', deviceIds: [], playbackId: 'zg:3' }];

test('#21 empty zones and an empty Jukebox are zone choices, marked empty, with a quiet note', async () => {
  const Z = await imp('zones40');
  const cs = Z.choices(groups, { own: false, deviceIds: [], showInDevices: true });
  assert.deepEqual(cs.map(c => c.key), ['g:1', 'g:2', 'g:3', 'jukebox'], 'every zone + the empty Jukebox');
  assert.deepEqual(cs.map(c => !!c.empty), [false, true, true, true]);
  assert.equal(Z.emptyNote(cs[1]), 'No speakers in this zone'); assert.equal(Z.emptyNote(cs[0]), '');
  assert.match(Z.emptyNote(cs[3]), /Jukebox.*main zone/);
  assert.equal(Z.choiceLabel(cs[1], cs[0]), 'Upstairs · no speakers'); assert.equal(Z.choiceLabel(cs[0], cs[0]), 'Basement (playing)');
  assert.equal(Z.zoneIdFor(cs[1]), 'zg:2', 'an empty zone uses its own stream, not the house one');
  assert.ok(!Z.choices(groups, { own: false, showInDevices: false }).some(c => c.kind === 'jukebox'), 'hidden from Devices = not a choice');
  assert.ok(!Z.targetKeys(groups, { own: false }).some(([k]) => k === 'jukebox'), 'alarms still wait for Jukebox speakers');
  assert.ok(Z.targetKeys(groups, { own: true, deviceIds: [10] }).some(([k]) => k === 'jukebox'));
});

test('#21 the Devices tree: empty / folded / empty-Jukebox rows control the zone; the zone link shows the note; lists label empty zones', () => {
  const t = src('tree42.js');
  assert.match(t, /const pickRow = \(el, fn\)/);
  assert.match(t, /return pickRow\(wrap, \(\) => controlZone\(g\.id\)\)/, 'empty zone row');
  assert.match(t, /return pickRow\(h\('section', \{ class: 'qb42 empty42 zfold42/, 'folded row');
  assert.match(t, /return pickRow\(wrap, pickJb\)/, 'empty Jukebox row');
  assert.doesNotMatch(t, /'ze42-row', onclick: open/, 'the Jukebox row no longer only opens settings');
  const z = src('zones40.js'); assert.match(z, /class: 'zl-empty', hidden: true/); assert.match(z, /emptyNote\(c\)/);
  assert.match(src('listtable.js'), /Z\.choiceLabel\(c, cur\)/); assert.match(src('main.js'), /Z\.choiceLabel\(c, cur\)/);
  assert.match(src('devices.js'), /onPill\([^)]*\{ empty/, '#19 greyed-out OFF\/ON for empty zones is kept');
});

test('#21 a manual pick of an empty zone sticks over the own-speaker auto-pick (d9e9ea1)', async () => {
  const Z = await imp('zones40'); ls.clear(); ss.clear(); Z._resetAutoPick();
  const state = { groups, zones: [{ id: 10, connected: true }], jb: null };
  Z.select('g:2');
  assert.equal(Z.autoPick(state, { id: 10, connected: true }), false, 'picked this session: auto-pick stays out');
  assert.equal(ls.getItem('wavwiz.zone'), 'g:2');
});

test('#21 a stored pick survives a page load: Z.init with the empty start-up zone list no longer wipes it', async () => {
  const Z = await imp('zones40'); ls.clear(); ss.clear(); Z._resetAutoPick();
  ls.setItem('wavwiz.zone', 'g:3');
  const S = { groups: [], zones: [], jb: null }; Z.init(S);
  assert.equal(ls.getItem('wavwiz.zone'), 'g:3', 'kept while the zones are still loading');
  S.groups = groups; S._groupsAt = Date.now(); Z.sync();
  assert.equal(Z.current().key, 'g:3', 'the empty Rooftop zone is still the pick'); assert.equal(Z.current().empty, true);
  S.groups = groups.slice(0, 2); Z.sync(); assert.equal(ls.getItem('wavwiz.zone'), null, 'a zone that is really gone is still forgotten');
});

test('#21b/#21c (t1854/t1856): green only with an active (online) speaker - an empty zone stays grey while playing; the text cue shows', async () => {
  const Z = await imp('zones40');
  for (const st of ['playing', 'paused', 'stopped']) assert.equal(Z.zoneDot([], { state: st }), 'off', 'empty zone stays grey: ' + st);
  assert.equal(Z.zoneDot([], null), 'off');
  assert.equal(Z.zoneDot([{ connected: true }], null), 'ok', 'an online speaker = green'); assert.equal(Z.zoneDot([{ connected: false }], { state: 'playing' }), 'off');
  const play = Z.choices([{ id: 4, name: 'Patio', deviceIds: [], playbackId: 'zg:4', now: { state: 'playing' } }], null)[0];
  assert.equal(play.online, false); assert.equal(Z.choiceLabel(play, null), 'Patio · no speakers · playing', 'Queue dropdown text cue');
  const t = src('tree42.js'); assert.match(t, /class: 'dot zfold42-dot ze42-dot off'/, 'compact row dot is always grey');
  assert.match(t, /g\.now\?\.state === 'playing' \? 'Playing · no speakers' : 'No speakers'/, 'compact row text cue');
  assert.match(src('devices.js'), /class: 'dot ' \+ Z\.zoneDot\(ms, g\.now\)/, 'zone cards use the online rule');
  const z = src('zones40.js'); assert.match(z, /h\('span', \{ class: 'dot ' \+ \(c\.online \? 'ok' : 'off'\), title: [^\n]*\}\), h\('b', \{ class: 'zm-n ell' \}, c\.name\)/, 'zone menu: online rule only, and the zone name stays on the same line (8e466cf had commented it out)');
  assert.doesNotMatch(z, /c\.empty && c\.now\?\.state === 'playing'\) \? 'ok'/);
});
