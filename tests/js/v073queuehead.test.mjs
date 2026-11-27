// 0.7.3 t2245u: Queue header - a small "Queue" label over the zone picker (the page title), a zone says "· playing" / "· paused" only when
// it really is, "Tracks · N" over the rows, the track count + time never break mid-phrase at 320 px, and with nothing playing Up next is the
// first queued track instead of "Nothing queued after this". Also: ONE line beside each speaker (the old tree guide line is gone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const imp = f => import(pathToFileURL(join(js, f)).href);
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
const block = (a, b) => { const i = css.indexOf(a), j = css.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return css.slice(i, j); };

test('choiceLabel: the real playing / paused state, never "(playing)" for the selected zone', async () => {
  const Z = await imp('zones40.js');
  const a = { key: 'g:1', name: 'Basement' }, b = { key: 'g:2', name: 'Downstairs', now: { state: 'playing' } };
  assert.equal(Z.choiceLabel(a, a), 'Basement');
  assert.equal(Z.choiceLabel(b, a), 'Downstairs · playing');
  assert.equal(Z.choiceLabel({ ...a, now: { state: 'paused' } }, a), 'Basement · paused');
  assert.equal(Z.choiceLabel({ ...a, now: { state: 'stopped' } }, null), 'Basement');
  assert.equal(Z.choiceLabel({ key: 'j', name: 'Jukebox', empty: true }, a), 'Jukebox · no speakers');
  assert.equal(Z.choiceLabel({ key: 'p', name: 'Patio', empty: true, now: { state: 'playing' } }, null), 'Patio · no speakers · playing');
  assert.doesNotMatch(src('zones40.js').match(/export const choiceLabel[^\n]*/)[0], /\(playing\)|cur && c\.key/);
});

test('Queue header: "Queue" label + zone picker title; rows heading "Tracks · N"; About text matches', () => {
  const m = src('main.js');
  assert.match(m, /h\('div', \{ class: 'qtitle-line qtitle-zone' \}, h\('div', \{ class: 'qtitle-stack' \}, h\('span', \{ class: 'qeyebrow' \}, 'Queue'\), phonePick\(\) \|\| h\('h1', \{ class: 'qzone-title' \}, zone\?\.name \|\| 'No zone selected'\)\)\)/);
  assert.match(m, /h\('h2', \{ class: 'qrows-heading' \}, 'Tracks', h\('span', \{ class: 'small dim' \}, ' · ' \+ nTracks\)\)/);
  assert.doesNotMatch(m, /' · all tracks'|h\('h1', \{\}, 'Queue'\)/);
  const a = src('about.js');
  assert.doesNotMatch(a, /marked "\(playing\)"/);
  assert.match(a, /zone picker at the top of the Queue\. A zone that is playing or paused says so/);
  const b = block('/* 0.7.3 t2245u: Queue header', '/* end 0.7.3 t2245u queue */');
  assert.match(b, /\.phone-queue \.qtitle-stack \.pqwrap\{display:block;min-width:0;max-width:100%!important/, 'overrides the old 55% picker width');
  assert.match(b, /\.qeyebrow\{font-size:11px;letter-spacing:\.14em;text-transform:uppercase/);
  assert.match(b, /\.phone-queue \.qtitle-stack \.qzpick\.wwdd \.wwdd-t\{[^}]*text-overflow:ellipsis;white-space:nowrap/);
});

test('Track count + time: two no-wrap pieces; stacked beside the tools, one line above them in a narrow header', () => {
  const m = src('main.js');
  assert.match(m, /h\('span', \{ class: 'qc-n' \}, `\$\{nTracks\} track\$\{nTracks === 1 \? '' : 's'\}`\)/);
  assert.match(m, /h\('span', \{ class: 'qc-d' \}, h\('span', \{ class: 'qc-sep', 'aria-hidden': 'true' \}, '• '\), fmtDur\(total\)\)/);
  const b = block('/* 0.7.3 t2245u: Queue header', '/* end 0.7.3 t2245u queue */');
  assert.match(b, /\.phone-queue \.qpage-heading\{container:qhead\/inline-size\}/);
  assert.match(b, /\.phone-queue \.qcount-line \.qcount\{display:flex;flex-direction:column;flex:0 0 auto;min-width:0;white-space:nowrap/);
  assert.match(b, /@container qhead \(max-width:330px\)\{[\s\S]*\.phone-queue \.qcount-line\{flex-wrap:wrap;row-gap:6px\}[\s\S]*\.qcount\{flex:1 0 100%;flex-direction:row[\s\S]*\.pq-tools\{margin-left:auto\}/);
  assert.doesNotMatch(b, /@media/, 'width by container, not a viewport query');
});

test('Up next: nothing playing + tracks queued -> the first track; otherwise queueNextIndex', () => {
  const m = src('main.js');
  assert.match(m, /const nextIdx0 = queueNextIndex\(S\.now, S\.queue\), nextIdx = nextIdx0 < 0 && !hasNow && nTracks \? 0 : nextIdx0, nxt = nextIdx >= 0 \? S\.queue\[nextIdx\] : null;/);
  assert.match(m, /hasNow = !!item && state !== 'stopped'/);
  assert.match(m, /'Nothing queued after this'/, 'still said when the last track is playing');
});

test('One line beside each speaker: the old tree guide (.zsp42>.sp42::after) is off; the grip strip joins the open mixer drawer line', () => {
  const b = block('/* 0.7.3 t2245u: ONE line', '/* end 0.7.3 t2245u */');
  assert.match(b, /\.tree42 \.zsp42>\.sp42::after\{content:none!important;display:none!important\}/);
  assert.match(css, /\.tree42\.mx-on \.sp42\.mx-sp\+\.mx-drawer::before\{content:"";position:absolute;left:calc\(-1 \* var\(--mxdl\)\);top:-5px;bottom:2px;width:3px/);
  assert.match(css, /\.tree42 \.sp42\.mx-sp>\.dgrip42\{position:absolute;left:0;top:8px;bottom:4px/, 'the grip strip stays');
});
