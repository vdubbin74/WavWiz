// 0.6.9 #24 (t1873/t1874): the Devices panel sliding open (rail -> open, the Roomy / Auto slide-over, expand / collapse) - every layout - must not
// rebuild the zone tree (each zone's Queue box, art and now-playing bar) at the start of the slide; that rebuild was the flash. The tree is
// size-independent, so a size change lays the panel out ('size' draw) and keeps the same tree node; only a real change of what it shows rebuilds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const d = readFileSync(join(js, 'devices.js'), 'utf8');
const setSize = d.slice(d.indexOf('const setSize = (s, highlight = null) =>'), d.indexOf('// 0.2.3 U11: a skipped redraw'));

test('setSize draws with "size", never draw(true)', () => {
  assert.ok(setSize.length > 200, 'setSize found');
  assert.match(setSize, /draw\('size'\);/);
  assert.doesNotMatch(setSize, /draw\(true\)/, 'a forced draw rebuilds the whole tree mid-slide');
});

test('only an explicit draw(true) rebuilds the tree; the size draw still passes the busy / menu gates', () => {
  const draw0 = d.slice(d.indexOf('function draw0(force) {'), d.indexOf('if (HASWIN) {   // F214'));
  assert.equal((draw0.match(/treeNode\(force === true\)/g) || []).length, 2, 'standard and expanded both keep the tree on a size draw');
  assert.doesNotMatch(draw0, /treeNode\(force\)/);
  assert.match(draw0, /if \(!force && body\.querySelector\('\.dmenu:not\(\[hidden\]\)'\)\) return later\(\);/, "'size' is truthy: never deferred by an open menu");
});

test('the tree does not depend on the panel size (no size / .e42 / .expanded reads in tree42.js)', () => {
  const t = readFileSync(join(js, 'tree42.js'), 'utf8');
  const tree = t.slice(t.indexOf('export function treeEl('), t.indexOf('export function zonePane('));
  assert.ok(tree.length > 1000);
  assert.doesNotMatch(tree, /\.size\b|closest\('\.e42'\)|classList\.contains\('expanded'\)|devexpanded/);
});

/** A model of treeNode's cache: same sig -> same node; the size draw passes force === true only for draw(true). */
test('model: opening / expanding / collapsing keeps the same tree node; a forced draw or a changed sig rebuilds', () => {
  let built = 0, sig = 's1', tnode = null, tsig = '';
  const treeNode = force => { if (!force && tnode && sig === tsig) return tnode; built++; tsig = sig; tnode = { n: built }; return tnode; };
  const draw = force => treeNode(force === true);
  const first = draw('size');
  for (let i = 0; i < 6; i++) assert.equal(draw('size'), first, 'slide ' + i);
  assert.equal(built, 1);
  sig = 's2'; assert.notEqual(draw('size'), first, 'a real change still rebuilds');
  const b = built; draw(true); assert.equal(built, b + 1, 'draw(true) still rebuilds on purpose');
});

test('on the rail the tree is kept warm off-screen and patched in place, so the open moves it in instead of building it', () => {
  const draw0 = d.slice(d.indexOf('function draw0(force) {'), d.indexOf('if (HASWIN) {   // F214'));
  assert.match(draw0, /if \(size === 'collapsed'\) \{ body\.replaceChildren\(\); treeNode\(false\); return; \}/);
  const tn = d.slice(d.indexOf('const treeNode = force =>'), d.indexOf('const restoreScroll ='));
  assert.match(tn, /if \(!force && !memMoved && openSg === topen && tnode\) \{ const fresh = treeEl\(S, ctl, kit42, st42\), r = patchRows42\(tnode, fresh\);/, 'no isConnected gate on the row patch');
  assert.match(tn, /if \(!force && !memMoved && openSg === topen && tnode && tnode\.isConnected && hov42\(tnode\)\) return tnode;/, 'the hover hold is unchanged');
});
