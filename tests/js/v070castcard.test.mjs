// 0.7.0 t1901: the Cast speakers card matches the AirPlay card (0.6.9 #12 / #22 / #30) and the zone cards: the same ⋮ reorder handle and card key
// (saved in the shared card order, by default right below AirPlay), the same left edge, the same header status (Looking… / None found /
// Couldn't search) with a search that always ends, compact buttons and one 'Search again' wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
globalThis.Element ??= class {}; globalThis.document ??= undefined;
globalThis.sessionStorage ??= { _m: Object.create(null), getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.localStorage ??= globalThis.sessionStorage;
const dir = process.env.JS_DIR ? 'file://' + process.env.JS_DIR + '/' : new URL('js/', W).href;
const { csScanView, csBrowseProblem, CS_SCAN_MS } = await import(dir + 'castsetup.js');
const { apScanView, SCAN_MS } = await import(dir + 'airplaysetup.js');
const cs = rd('js/castsetup.js'), ap = rd('js/airplaysetup.js'), t = rd('js/tree42.js'), o = rd('js/devorder.js');
const arrangeSrc = o.match(/export function arrangeCards[\s\S]*?\n\}\n/)[0];
const cardKeysSrc = o.match(/(export )?(const|function) cardKeys[^\n]*\n/)?.[0] || '';
const arrangeCards = new Function((cardKeysSrc.replace(/^export /, '') || 'const cardKeys = c => c.keys || [c.key];\n') + arrangeSrc.replace('export function', 'function') + '; return arrangeCards;')();

test('header status: the same three states and the same deadline as the AirPlay card', () => {
  assert.equal(CS_SCAN_MS, SCAN_MS);
  for (const [a, c] of [[apScanView({ phase: 'searching' }), csScanView({ phase: 'searching' })], [apScanView({ phase: 'done' }), csScanView({ phase: 'done' })],
    [apScanView({ problem: 'x' }), csScanView({ problem: 'x' })], [apScanView({ n: 2 }), csScanView({ n: 2 })]]) {
    assert.equal(c.note, a.note); assert.equal(c.kind, a.kind);
  }
  assert.deepEqual([csScanView({ phase: 'searching' }).note, csScanView({ phase: 'done' }).note, csScanView({ problem: 'p' }).note], ['Looking…', 'None found', 'Couldn’t search']);
  assert.equal(csScanView({ phase: 'done' }).title, 'No Cast speakers found');
  assert.equal(csScanView({ problem: 'p', n: 1 }).kind, 'list', 'a list wins over a stale problem');
});

test('the server saying its Cast search is not running becomes plain words (the box: bound to loopback)', () => {
  assert.equal(csBrowseProblem({ running: true, problem: 'old' }), null, 'a running search is not an error');
  assert.match(csBrowseProblem({ running: false, problem: 'Cast search needs a home-network address (the server is bound to loopback).' }), /only listening on this PC \(127\.0\.0\.1\)/);
  assert.match(csBrowseProblem({ running: false, problem: 'Cast search unavailable: Address already in use' }), /couldn’t start its Cast search: Address already in use/);
  assert.match(csBrowseProblem({ running: false }), /isn’t running/);
  assert.equal(csBrowseProblem(null), null);
});

test('one search at a time with a deadline, like AirPlay (it used to say "Looking…" for ever)', () => {
  assert.match(cs, /if \(scanPhase === 'searching'\) return;/);
  assert.match(cs, /scanTimer = setTimeout\(\(\) => \{ if \(seq === scanSeq && scanPhase === 'searching'\) \{ scanPhase = 'done';/);
  assert.match(cs, /lastProblem = csBrowseProblem\(r\);/);
  assert.doesNotMatch(cs, /lastProblem = r\.problem/);
  assert.match(cs, /closed = true; stopPoll\(\); endScan\(\);/);
});

test('compact buttons and ONE "Search again" wording, as the AirPlay card', () => {
  assert.doesNotMatch(cs, /Scan again/);
  assert.match(cs, /class: 'btn sm apsetup-again', 'data-act': 'castsetup-again', onclick: \(\) => rescan\(\) \}, 'Search again'\)/);
  assert.match(cs, /bodyAgain \? null : h\('button', \{ type: 'button', class: 'linkbtn', 'data-act': 'castsetup-rescan'[^\n]*searching \? 'Searching…' : 'Search again'\)/);
  assert.match(cs, /class: 'btn sm', 'data-act': 'castsetup-close'/);
  assert.doesNotMatch(cs, /class: 'btn primary', 'data-act': 'castsetup-close'/);
  assert.match(cs, /class: 'btn sm primary', 'data-act': 'castsetup-ip-go'/);
  assert.match(cs, /class: 'btn sm', 'data-act': 'castsetup-ip-cancel'/);
  // the AirPlay card is unchanged
  assert.match(ap, /class: 'btn sm', 'data-act': 'apsetup-close'/);
});

test('a reorder card like AirPlay: data-card="cast", the ⋮ handle (kept across in-place repaints), the shared order', () => {
  assert.match(cs, /export const setCastCardDecor = fn =>/);
  assert.equal((cs.match(/try \{ cardDecor\?\.\(card\); \} catch/g) || []).length, 2, 'collapsed and open card both decorated');
  assert.match(t, /setCastCardDecor\(el => decorateCard\(el, 'cast', 'Cast speakers'\)\)/);
  assert.match(t, /c\.key === 'cast' \? 'Cast speakers'/);
  assert.doesNotMatch(t, /apEl\.after\(csc\)/, 'no longer glued after the AirPlay element outside the order');
  const card = k => ({ key: k, keys: [k] });
  const cards = ['g:1', 'g:2', 'jukebox', 'unassigned', 'airplay', 'cast'].map(card);
  assert.deepEqual(arrangeCards(cards, []).map(c => c.key), ['g:1', 'g:2', 'jukebox', 'unassigned', 'airplay', 'cast'], 'default: right below AirPlay');
  assert.deepEqual(arrangeCards(cards, ['airplay', 'g:2', 'unassigned', 'g:1', 'jukebox']).map(c => c.key), ['airplay', 'cast', 'g:2', 'unassigned', 'g:1', 'jukebox'], 'a 0.6.9 saved order (no cast key): Cast follows AirPlay');
  assert.deepEqual(arrangeCards(cards, ['cast', 'g:1', 'g:2', 'airplay', 'unassigned', 'jukebox']).map(c => c.key), ['cast', 'g:1', 'g:2', 'airplay', 'unassigned', 'jukebox'], 'moved Cast stays where put');
  assert.deepEqual(arrangeCards(cards.filter(c => c.key !== 'airplay'), ['g:1']).map(c => c.key), ['g:1', 'g:2', 'jukebox', 'unassigned', 'cast']);
});
