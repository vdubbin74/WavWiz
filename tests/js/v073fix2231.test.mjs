// 0.7.3 t2231u: phone polish from iPhone screenshots - Speaker Settings rename row + tags, the Profile row, Paired devices & tokens as rows,
// Audio inputs > Playback on this PC fits, no empty gap under the Volume Mixer bar, one control height in the Devices toolbar / zone rows,
// plus the Settings siblings found by the 320 / 390 px audit (Delay defaults, AirPlay / Spotify boost, the phone QR card).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const block = css.slice(css.indexOf('/* 0.7.3 t2231u: phone polish'), css.indexOf('/* end 0.7.3 t2231u */'));
const doc = installDom(); doc.defaultView = globalThis;
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const imp = f => import(pathToFileURL(join(js, f)).href);

test('1: while a name is typed its row is marked (wwinl-host), and the mark goes when the edit ends', async () => {
  const { h } = await imp('util.js'); const { inlineName } = await imp('popover.js');
  const title = h('h3', { class: 'spk-title' }, 'SPEAKER SETTINGS · KITCHEN'), head = h('div', { class: 'spk-head' }, title, h('button', { class: 'btn sm spk-done' }, 'Done'));
  doc.body.append(head);
  const ed = inlineName(title, { value: 'Kitchen', setText: false, save: async () => {} });
  assert.ok(head.classList.contains('wwinl-host'));
  ed.input.dispatchEvent(ev('keydown', { key: 'Escape', target: ed.input }));
  assert.ok(!head.classList.contains('wwinl-host')); head.remove();
  // the phone look / sheet: the field fills the row, the row's own Cancel / Done (and title, status) step aside - the sheet header has them
  assert.match(block, /:is\(\.pd42-sheet,html\.phonelook\) \.spk-head\.wwinl-host>:not\(\.wwinl\)\{display:none!important\}/);
  assert.match(block, /:is\(\.pd42-sheet,html\.phonelook\) \.spk-head\.wwinl-host>\.wwinl\{flex:1 1 100%/);
  // tags right under the name (they were alone under the Zone row)
  assert.match(src('spkset.js'), /h\('span', \{ class: 'grow' \}\), cancel, done\), tagRow, zoneHost, profRow, refHost,/);
});

test('2: Profile row - the select gets the line, Save / + New / delete never wrap their text', () => {
  assert.match(block, /\.pd42-sheet \.spk-profrow,html\.phonelook \.spk-profrow\{display:flex;flex-wrap:wrap/);
  assert.match(block, /\.spk-profrow \.spk-pwrap\{flex:1 1 calc\(100% - 96px\);min-width:0/);
  assert.match(block, /\.spk-profrow \.btn\{flex:0 0 auto;white-space:nowrap/);
});

test('3: Paired devices & tokens - one row per device on the phone look, no mid-word breaks anywhere in tables there', () => {
  const s = src('settings.js');
  assert.match(s, /h\('table', \{ class: 'tbl toktbl' \}/);
  for (const c of ['tok-name', 'tok-role', 'tok-used', 'tok-act']) assert.match(s, new RegExp(`h\\('td', \\{ class: '${c}'`));
  assert.match(block, /html\.phonelook \.toktbl thead\{display:none\}/);
  assert.match(block, /grid-template-areas:"n n a" "r u a"/);
  assert.match(block, /html\.phonelook \.toktbl \.tok-act \.btn\{white-space:nowrap/);
  // .tbl td used word-break:break-word (= break anywhere when squeezed): Re/vo/ke, adm/in on a phone
  assert.match(block, /html\.phonelook \.tbl td,html\.phonelook \.tbl th\{word-break:normal;overflow-wrap:break-word\}/);
  assert.doesNotMatch(block, /overflow-wrap:anywhere|word-break:break-all/);
});

test('4: Audio inputs > Playback on this PC never grows past the card; the two choices share the width on the phone look', () => {
  assert.match(block, /^\.lsx\{grid-template-columns:minmax\(0,1fr\)\}/m, 'the grid column was sized by the max-content segmented control');
  assert.match(block, /^\.lsx \.seg button\{white-space:normal;min-width:0\}/m);
  assert.match(block, /html\.phonelook \.lsx \.seg\{display:flex;width:100%\}/);
  assert.match(block, /html\.phonelook \.lsx \.seg button\{flex:1 1 0/);
});

test('5: Volume Mixer - the spacer only adds what the pinned bar does not already cover', async () => {
  const { mixerSpace } = await imp('devices.js');
  assert.equal(mixerSpace(111, 112, 44), 11, 'bar over the page title: 10 px under the bar (was 54 px on top of the title)');
  assert.equal(mixerSpace(82, 112, 44), 40);
  assert.equal(mixerSpace(200, 112, 44), 0, 'never negative');
  assert.equal(mixerSpace(-500, 112, 44), 54, 'opened while scrolled down: the old full height');
  const d = src('devices.js');
  assert.match(d, /if \(!space\.dataset\.h && mxPinned\.offsetHeight > 0\) \{ space\.style\.height = mixerSpace\(/, 'measured once, never shifts the page while scrolled');
  assert.doesNotMatch(d, /space\.style\.height = \(mxPinned\.offsetHeight \+ 10\) \+ 'px'/);
});

test('6: Devices toolbar and zone rows - one 32 px control height and 16 px icons on the phone look', () => {
  assert.match(block, /html\.phonelook \.tree42-h :is\(\.annwrap \.annbtn,\.annwrap \.anntobtn,\.zadd-new,\.zadd-spk\)\{height:32px!important;min-height:32px!important/);
  assert.match(block, /html\.phonelook \.tree42-h :is\(\.zadd-new,\.zadd-spk\)\{width:32px!important/);
  assert.match(block, /html\.phonelook \.tree42-h :is\(\.annbtn,\.zadd-spk\) :is\(svg,\.ic,\.ic svg\)\{width:16px!important;height:16px!important\}/);
  assert.match(block, /html\.phonelook \.tree42 \.zc42-1 :is\(\.zlinkbtn\.zlinkic,\.onpill\)\{height:32px!important/);
  // look only: never on html.handset alone, never a width query
  assert.doesNotMatch(block, /@media/); assert.doesNotMatch(block, /html\.handset/);
});

test('audit siblings: Delay defaults, AirPlay / Spotify boost and the phone QR card wrap instead of overflowing', () => {
  const s = src('settings.js');
  assert.match(s, /h\('label', \{ class: 'row numrow' \}, h\('span', \{ class: 'numrow-l'/);
  assert.match(s, /h\('div', \{ class: 'row boostrow'/); assert.match(s, /h\('span', \{ class: 'boostrow-l'/);
  assert.match(s, /class: 'row wrap tls-qrrow'/);
  assert.match(s, /'Certificate fingerprint \(SHA-256\): ', h\('span', \{ class: 'mono' \}/, 'only the hash breaks anywhere, not the words');
  assert.match(block, /html\.phonelook :is\(\.numrow-l,\.boostrow-l\)\{min-width:0!important;flex:1 1 100%\}/);
  assert.match(block, /html\.phonelook \.tls-qrrow>\.grow\{flex:1 1 220px;min-width:0\}/);
});
