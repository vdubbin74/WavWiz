// 0.6.9 t1894 + t1897 (zone ON/OFF took a while to grey the speakers out - the same hold): the zone card's mute button. The master mute showed every speaker's mute indicator at once; the zone card's mute muted the speakers on
// the server but their indicators did not appear while the pointer (or focus) stayed on the card, so the next presses looked "wonky".
// Root cause (client): the zone button only repainted itself; the server's "zones" refresh changed sig42 (z.muted), and patchRows42 held every row in
// the hovered / focused zone box (hovZone42 / activeElement), so the speaker rows kept their old indicators. Root cause (server): GroupMute patched each
// member with its own "zones" event, so a refresh could land half-way (one speaker muted) and flip the zone button back.
// Fix: who-is-muted (treeSwitchSig42) is part of the move signature -> a mute change rebuilds the tree at once, never held by hover; the zone press
// redraws at once; GroupMute / MuteAll / DevicesMute publish ONE event; zone unmute un-mutes what the zone mute muted (like the master mute).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const d = readFileSync(join(js, 'devices.js'), 'utf8'), t = readFileSync(join(js, 'tree42.js'), 'utf8');
const src = d.match(/export const treeSwitchSig42 = [^\n]+\n/)?.[0] || '';
const treeSwitchSig42 = new Function(src.replace('export const', 'const') + '; return treeSwitchSig42;')();
// GET /api/v1/zones (fields used) from the harness server: Den Speaker (2) + Kitchen Echo (3) in the linked Living Room + Kitchen box
const zs = (m2, m3, extra = {}) => [{ id: 1, name: 'Office PC', muted: false, volume: 51 }, { id: 2, name: 'Den Speaker', muted: m2, volume: 60, ...extra }, { id: 3, name: 'Kitchen Echo', muted: m3, volume: 60, ...extra }];

test('the real flow changes the mute signature at every step (each one rebuilds at once, never held by hover)', () => {
  assert.ok(src, 'treeSwitchSig42 is a pure export');
  const steps = [['start', zs(false, false)], ['zone mute', zs(true, true)], ['zone unmute', zs(false, false)], ['Den on its own', zs(true, false)],
    ['Kitchen on its own', zs(true, true)], ['Den unmuted on its own', zs(false, true)], ['zone mute again', zs(true, true)], ['zone unmute again (Kitchen keeps its own mute)', zs(false, true)],
    ['master mute', zs(true, true).map(z => ({ ...z, muted: true }))], ['master unmute', zs(false, true)]];
  for (let i = 1; i < steps.length; i++) {
    const [n, cur] = steps[i], prev = steps[i - 1][1];
    if (JSON.stringify(cur.map(z => z.muted)) !== JSON.stringify(prev.map(z => z.muted))) assert.notEqual(treeSwitchSig42(cur), treeSwitchSig42(prev), n);
  }
  assert.equal(treeSwitchSig42(zs(true, true)), '[[2,3],[]]');
  assert.equal(treeSwitchSig42(null), '[[],[]]');
});

test('a level / status push is not a mute change (the hover hold still protects the row under the pointer)', () => {
  assert.equal(treeSwitchSig42(zs(true, false, { volume: 33, connected: false })), treeSwitchSig42(zs(true, false)));
  assert.equal(treeSwitchSig42([...zs(true, false)].reverse()), treeSwitchSig42(zs(true, false)), 'order does not matter');
});

test('wiring: the mute signature is part of the move signature, so patchRows42 / the hover hold never hold it', () => {
  assert.match(d, /const memSig42 = \(\) => treeMoveSig42\(S\.groups\) \+ '\|' \+ treeSwitchSig42\(S\.zones\);/);
  assert.match(d, /mem = memSig42\(\) \+ '\|' \+ JSON\.stringify\(getCardOrder\(\)\), memMoved = !!tnode && mem !== tmem;/);
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode\) \{ const fresh = treeEl/, 'no row patch (which defers hovered rows) for a mute change');
  assert.match(d, /if \(!force && !memMoved && openSg === topen && tnode && tnode\.isConnected && hov42\(tnode\)\) return tnode;/, 'hover hold unchanged for other refreshes');
  assert.match(d, /cls: \['zmute', 'sp42-mute'\]\.find\(c => ae\.classList\?\.contains\(c\)\)/, 'focus goes back to the pressed mute button after the rebuild');
});

test('wiring: the zone card mute (and its menu, and the zone pane) redraw at once; unmute is left to the server (it keeps own mutes)', () => {
  const card = t.slice(t.indexOf("const mute = ro(h('button', { type: 'button', class: 'mutebtn zmute'"), t.indexOf('const selectLead = () => controlZone(lead.id);'));
  assert.match(card, /m = !\(cur\.length > 0 && cur\.every\(z => z\.muted\)\); if \(m\) for \(const z of cur\) z\.muted = true; for \(const g of live\) ctl\.act\(`\/groups\/\$\{g\.id\}\/mute`, \{ muted: m \}\);/);
  assert.match(card, /if \(m\) try \{ window\.dispatchEvent\(new CustomEvent\('wavwiz:devredraw'\)\); \}/);
  assert.match(card, /cur = phoneMaxBars \? livePhoneMs\(\) : uniqueMembers/, 'the press reads the same speakers the button shows (phone: switched-on ones)');
  assert.doesNotMatch(card, /for \(const z of cur\) z\.muted = m;/, 'no optimistic unmute of a speaker muted on its own');
  assert.match(t, /const mixed = !muted && phoneMs\.some\(z => z\.muted\), muteTitle = muted \? 'Unmute' : mixed \? 'Mute \(some speakers are muted\)' : 'Mute';/);
  assert.match(t, /mute: \(\) => \{ const m = !zoneMuted\(S\.zones, g\); if \(m\) for \(const z of zoneMembers\(S\.zones, g\)\) z\.muted = true; ctl\.act\(`\/groups\/\$\{g\.id\}\/mute`, \{ muted: m \}\); try \{ window\.dispatchEvent/);
  assert.match(t, /onclick: \(\) => \{ const m = !zoneMuted\(S\.zones, g\); if \(m\) for \(const z of zoneMembers\(S\.zones, g\)\) z\.muted = true; ctl\.act\(`\/groups\/\$\{g\.id\}\/mute`, \{ muted: m \}\); if \(m\) try/);
});

test('master mute is unchanged (regression)', () => {
  assert.match(d, /ctl\.act\('\/zones\/mute-all', \{ muted: want \}\)/);
});

test('t1897: zone ON / OFF is a deliberate change too (the speakers grey out at once), level ticks are not', () => {
  const on = zs(false, false), off = zs(false, false).map(z => z.id === 2 ? { ...z, enabled: false } : z);
  assert.notEqual(treeSwitchSig42(off), treeSwitchSig42(on), 'zone off');
  assert.equal(treeSwitchSig42(off), '[[],[2]]');
  assert.notEqual(treeSwitchSig42(on), treeSwitchSig42(off), 'zone back on');
  assert.equal(treeSwitchSig42(on.map(z => ({ ...z, enabled: true }))), treeSwitchSig42(on.map(z => { const { enabled, ...r } = z; void enabled; return r; })), 'missing enabled = on');
  assert.equal(treeSwitchSig42(off.map(z => ({ ...z, volume: 12, connected: true }))), treeSwitchSig42(off));
});

test('t1897 wiring: the zone pill (card + zone pane) updates S.zones, sends ONE /groups/{id}/enabled and redraws at once', () => {
  const card = t.slice(t.indexOf("const pill = onPill(`Zone ${g.name}`, on, can, () => { const live"), t.indexOf("{ empty: ms.length ? '' : EMPTY_ZONE_TIP });   // 0.6.9 #19"));
  assert.match(card, /for \(const z of zoneMembers\(S\.zones, live\)\) z\.enabled = want; ctl\.act\(`\/groups\/\$\{live\.id\}\/enabled`, \{ enabled: want \}\); pill\._set\(want\); try \{ window\.dispatchEvent\(new CustomEvent\('wavwiz:devredraw'\)\)/);
  assert.match(t, /if \(lz\) lz\.enabled = want; \} ctl\.act\(`\/groups\/\$\{g\.id\}\/enabled`, \{ enabled: want \}\); pill\._set\(want\); try \{ window\.dispatchEvent/);
});
