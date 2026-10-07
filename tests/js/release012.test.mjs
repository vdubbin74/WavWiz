// WavWiz 0.1.2 hotfix: 5 themes (+ Violet Pulse), NP viz panel + solid control panel, playlist collapse-down, flowing solid Terrain (no Pepecoin viz).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
const vc = await imp('vizcore');
const theme = await imp('theme');
const art = await imp('art');

test('0.1.2 five theme presets; Violet Pulse + Pepecoin; custom knobs are bg/accent/ink', () => {
  assert.deepEqual(Object.keys(theme.PRESETS), ['default', 'ember', 'arctic', 'pepecoin', 'violet']);
  assert.equal(theme.PRESETS.default.name, 'Midnight Neon');
  assert.equal(theme.PRESETS.violet.name, 'Violet Pulse');
  assert.equal(theme.PRESETS.violet.bg.toUpperCase(), '#1A1028');
  assert.equal(theme.PRESETS.violet.accent.toUpperCase(), '#A855F7');
  assert.equal(theme.PRESETS.violet.ink.toUpperCase(), '#F5F3FF');
  assert.equal(theme.PRESETS.violet.accent2.toUpperCase(), '#C084FC');
  assert.equal(theme.PRESETS.pepecoin.accent.toUpperCase(), '#269B4D');
  assert.equal(theme.PRESETS.pepecoin.accent2.toUpperCase(), '#C07A4E');
  assert.equal(theme.PRESETS.pepecoin.bg.toUpperCase(), '#212121');
  assert.ok(theme.companionAccent);
  assert.ok(theme.isHex(theme.companionAccent('#FF3C00')));
  const d = theme.derive({ bg: '#14171A', accent: '#FF3C00', ink: '#E8EDF0' });
  assert.equal(d['--ink'], '#E8EDF0');
  assert.ok(theme.isHex(d['--accent2']));
  assert.match(src('themes.js'), /Background/);
  assert.match(src('themes.js'), /['"]Accent['"]/);
  assert.match(src('themes.js'), /['"]Text['"]/);
  assert.doesNotMatch(src('themes.js'), /Second color/);
});

test('0.1.2 removed themes migrate to Midnight Neon; Pepecoin viz gone; terrain relief stays', () => {
  assert.ok(!vc.VIZ_LIST.some(([k]) => k === 'pepecoin'));
  assert.ok(!vc.FX.pepecoin);
  assert.ok(vc.FX.terrain.some(d => d[0] === 'relief'));
  assert.equal(vc.loadSettings('terrain', { getItem: () => null, setItem() {}, removeItem() {} }).fx.height, 50);
  const store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  store['unison.theme.v1'] = JSON.stringify({ accent: '#2ECC71', accent2: '#A8E6CF', bg: '#0C1410', preset: 'forest' });
  assert.equal(theme.loadTheme().preset, 'default');
  assert.equal(theme.loadTheme().name, 'Midnight Neon');
  delete globalThis.localStorage;
});

test('0.1.2 streaming source chip labels', () => {
  assert.equal(art.streamingChip({ kind: 'airplay' }, { airplay: {} }), 'AirPlay');
  assert.equal(art.streamingChip({ kind: 'airplay' }, { airplay: { lastSender: "Alex's iPhone" } }), "AirPlay — Alex's iPhone");
  assert.equal(art.streamingChip({ kind: 'airplay' }, { airplay: { lastSender: 'AABBCCDDEEFF0011' } }), 'AirPlay');
  assert.equal(art.streamingChip({ kind: 'spotify' }, { spotify: { user: 'alice' } }), 'Spotify Connect — alice');
  assert.equal(art.streamingChip({ kind: 'spotify' }, {}), 'Spotify Connect');
});

test('0.1.2 Now Playing viz panel + solid control panel, playlist collapse-down, flowing Terrain', () => {
  const n = src('now.js');
  for (const k of ['np-vizpanel', 'np-ctlpanel', 'np-ctlbody', 'np-tablemeta', 'np-tablexport', 'np-tablevol', 'np-tablefoot', 'np-srcchip', 'streamingChip']) assert.match(n, new RegExp(k), k);
  assert.match(n, /˅/);
  assert.match(n, /˄/);
  assert.doesNotMatch(n, /np-glasspod/);
  assert.doesNotMatch(n, /FOLLOWED SPEAKERS/);
  // panel hotfix: control layout unchanged (title/times | transport | volume, device dots below)
  assert.match(n, /np-tablemain' \}, tableMeta, tableXport, tableVol\), tableFoot/);
  assert.match(n, /shuffle, prev, play, next, repeat/);
  // arrow reuses the Playlist toggle class (plus listcol), persisted per device; collapse grows the viz panel
  assert.match(n, /class: 'plus listcol np-ctlcol'/);
  assert.match(n, /wavwiz\.npctlcollapsed/);
  assert.doesNotMatch(css, /\.np-ctlcol\{|\.np-ctlcol\.plus|\.np-statuscol/, 'no bespoke arrow styling');
  // both NP panels share the exact Library/Devices/Playlist chrome rule; solid, no glass
  assert.match(css, /\.libpanel,\.nowcol,\.devpanel,\.listpanel,\.np-vizpanel,\.np-ctlpanel\{/);
  assert.doesNotMatch(css, /backdrop-filter:blur/);
  assert.doesNotMatch(css, /\.np-table\{/);
  assert.match(css, /\.np-vizpanel\{flex:1 1 0/);
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-ctlbody\{max-height:0/);
  assert.match(css, /\.np-srcchip\b/);
  assert.match(css, /inset:0!important/);
  assert.match(css, /listcollapsed.*--listh:36px|--listh:36px/);
  assert.match(css, /--listh:clamp\(110px/);   // short-screen uses var, not hard-coded grid rows
  assert.doesNotMatch(css, /grid-template-rows:minmax\(0,1fr\) clamp\(110px/);
  assert.match(src('vizgl.js'), /flowing SOLID|SOLID vibrant|flow\(u, P\)/);
  assert.match(src('vizgl.js'), /g\.quad\(/);
  assert.match(src('settings.js'), /airplay\.levelDb/);
  assert.match(src('settings.js'), /spotify\.levelDb/);
  assert.match(src('settings.js'), /reset-password/);
});
