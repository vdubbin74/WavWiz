// 0.6.9 #31 (t1888 / t1889): linking two EMPTY zones (drag Rooftop onto Upstairs) or pressing Split off in their linked card did not show until
// something else forced the Devices panel to redraw (a speaker move, folding the card, the pointer leaving the tree). The server did link / split and
// published "zones"; the client fetched the new /groups and called treeNode(), but the tree rebuild was held by the hover hold (F151b) because the
// pointer was still on the card it had just dropped on / clicked. Only a membership move (F269: deviceIds) or a card-order move skipped that hold, and
// linking or splitting empty zones changes neither. Now the link leader (playbackId) is part of the move signature too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const d = readFileSync(join(js, 'devices.js'), 'utf8'), t = readFileSync(join(js, 'tree42.js'), 'utf8');
// devices.js imports DOM modules: run the pure helper's own source
const src = d.match(/export const treeMoveSig42 = [^\n]+\n/)?.[0] || '';
const treeMoveSig42 = new Function(src.replace('export const', 'const') + '; return treeMoveSig42;')();

// GET /api/v1/groups from a real local server (fields the tree uses), before POST /groups/6/link {"with":5}, after it, and after POST /groups/6/split
const base = [{ id: 1, name: 'Everywhere', deviceIds: [1], playbackId: 'default', linked: [] }, { id: 2, name: 'Living Room', deviceIds: [2], playbackId: 'zg:2', linked: ['Kitchen'] },
  { id: 3, name: 'Kitchen', deviceIds: [3], playbackId: 'zg:2', linked: ['Living Room'] }, { id: 4, name: 'Patio & Backyard Speakers', deviceIds: [], playbackId: 'zg:4', linked: [] }];
const split = [...base, { id: 5, name: 'Upstairs', deviceIds: [], playbackId: 'zg:5', linked: [], linkedIds: [] }, { id: 6, name: 'Rooftop', deviceIds: [], playbackId: 'zg:6', linked: [], linkedIds: [] }];
const linked = [...base, { id: 5, name: 'Upstairs', deviceIds: [], playbackId: 'zg:5', linked: ['Rooftop'], linkedIds: [6] }, { id: 6, name: 'Rooftop', deviceIds: [], playbackId: 'zg:5', linked: ['Upstairs'], linkedIds: [5] }];

test('linking / splitting two empty zones is a deliberate move (the server /groups before and after)', () => {
  assert.ok(src, 'treeMoveSig42 is a pure export');
  assert.notEqual(treeMoveSig42(split), treeMoveSig42(linked), 'link: Rooftop now follows Upstairs');
  assert.notEqual(treeMoveSig42(linked), treeMoveSig42(split), 'split off: Rooftop has its own music again');
  // the old signature (speakers only) saw no change - the bug
  const old = gs => JSON.stringify(gs.map(g => [g.id, g.deviceIds || []]));
  assert.equal(old(split), old(linked));
});

test('a status / level push is not a move (the hover hold still protects the row under the pointer)', () => {
  const tick = linked.map(g => ({ ...g, volume: 33, online: 1, now: { state: 'playing', title: 'x' } }));
  assert.equal(treeMoveSig42(tick), treeMoveSig42(linked));
  assert.equal(treeMoveSig42(null), '[]');
});

test('wiring: the drop and Split off refresh, and a move skips the hover hold', () => {
  assert.match(d, /const memSig42 = \(\) => treeMoveSig42\(S\.groups\)( \+ '\|' \+ treeSwitchSig42\(S\.zones\))?;/);   // t1894 + t1897 add who is muted / off
  assert.match(d, /mem = memSig42\(\) \+ '\|' \+ JSON\.stringify\(getCardOrder\(\)\), memMoved = !!tnode && mem !== tmem;/);
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode && tnode\.isConnected && hov42\(tnode\)\) return tnode;/, 'the hover hold is unchanged for other refreshes');
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode\) \{ const fresh = treeEl/, 'no row patch (which defers hovered rows) for a move');
  // zone-card drop onto the middle of a zone -> POST link -> done() = refreshAll + zones-changed; the empty linked card's Split off -> Z.splitOff(g, done)
  assert.match(t, /done = \(\) => \{ ctl\.refreshAll\?\.\(\); window\.dispatchEvent\(new CustomEvent\('wavwiz:zones-changed'\)\); \}/);
  assert.match(t, /await api\(`\/groups\/\$\{fromId\}\/link`, \{ method: 'POST', body: \{ with: toId \} \}\);[^\n]*done\(\);/);
  const box = t.slice(t.indexOf('const linkedEmptyBox ='), t.indexOf('// 0.4.9 F69: ONE manual order list'));
  assert.match(box, /'data-act': 'split'[^\n]*Z\.splitOff\(g, done\)/);
});
