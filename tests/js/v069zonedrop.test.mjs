// WavWiz 0.6.9 item 12 fix: a zone card dropped on the MIDDLE of another zone links them (the 0.4.1 zone-onto-zone action, POST /groups/{from}/link);
// near a card's edge (or over Jukebox / Unassigned / AirPlay) it only reorders with an insertion line. Speaker drops still assign (unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const D = await import(pathToFileURL(join(js, 'devorder.js')).href);
const tree = readFileSync(join(js, 'tree42.js'), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const R = { top: 100, height: 100 };

test('zone onto the middle of another zone = link; near the top / bottom edge = reorder before / after', () => {
  assert.equal(D.cardDropMode(R, 150, 'g:2', 'g:3'), 'link');
  assert.equal(D.cardDropMode(R, 131, 'g:2', 'g:3'), 'link');
  assert.equal(D.cardDropMode(R, 169, 'g:2', 'g:3'), 'link');
  assert.equal(D.cardDropMode(R, 110, 'g:2', 'g:3'), 'before');
  assert.equal(D.cardDropMode(R, 195, 'g:2', 'g:3'), 'after');
});

test('Jukebox / Unassigned / AirPlay never link: dragged or as the target, they only reorder', () => {
  for (const [a, b] of [['airplay', 'g:3'], ['g:2', 'unassigned'], ['jukebox', 'g:3'], ['g:2', 'airplay'], ['g:2', 'g:2']]) assert.notEqual(D.cardDropMode(R, 150, a, b), 'link', `${a} -> ${b}`);
});

test('gap drop reorders: moveCard puts the card before / after the target exactly as the insertion line shows', () => {
  const cards = ['g:1', 'airplay', 'g:2', 'g:3', 'unassigned'].map(key => ({ key }));
  assert.deepEqual(D.moveCard(cards, 'g:2', 'g:3', true), ['g:1', 'airplay', 'g:3', 'g:2', 'unassigned']);
  assert.deepEqual(D.moveCard(cards, 'unassigned', 'g:1', false), ['unassigned', 'g:1', 'airplay', 'g:2', 'g:3']);
});

test('the tree wires link on the middle band, reorder with the insertion line only, and the link highlight differs', () => {
  assert.match(tree, /if \(mode === 'link'\) \{ where = \{ key: t\.dataset\.card, link: \+zw\.dataset\.groupId \}; zw\.classList\.add\('droplink42'\)/);
  assert.match(tree, /if \(where\.link\) \{ onLink\(fromZone, where\.link\); return; \} onMove\(from, where\.key, where\.after\);/);
  assert.match(tree, /api\(`\/groups\/\$\{fromId\}\/link`, \{ method: 'POST', body: \{ with: toId \} \}\)/);
  assert.doesNotMatch(tree, /t\.classList\.add\('dropping'\); t\.classList\.toggle\('zins-after'/, 'a reorder no longer fills the whole card like a drop-into');
  assert.match(css, /\.tree42\.zdrag \.zwrap42\.droplink42\{outline:3px dashed var\(--accent\)/);
});

test('speaker drops are untouched: the grip drag still assigns to the zone / Unassigned under the pointer', () => {
  assert.match(tree, /const grip = ev\.target\.closest\('\.dgrip42'\)/);
  assert.match(tree, /accept: pl => pl\?\.kind === 'device42'/);
  assert.match(tree, /drop: \(\) => \{ const d = t\.dataset\.drop, to = d === 'none' \? null : \+d; if \(\(from\?\.id \?\? null\) !== to\) move\(z, to\); \}/);
  // the card drag never starts from a speaker grip and never accepts a speaker payload
  assert.match(tree, /const grab = ev\.target\.closest\('\.zgut42,\.cgrip69'\)/);
  assert.match(tree, /accept: pl => pl\?\.kind === 'zone42'/);
});
