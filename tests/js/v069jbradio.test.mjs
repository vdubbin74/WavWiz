// 0.6.9 #27 (t1877u): Radio can't go in the Jukebox queue - the UI greys out / explains Radio play + queue while the picked zone is the Jukebox's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const JS = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const src = f => readFileSync(join(JS, f), 'utf8');
// zones40.js pulls in DOM modules: run its two pure lines (zoneIdFor + radioBlocked) on their own
const zsrc = src('zones40.js');
const line = name => zsrc.split('\n').find(l => l.startsWith(`export const ${name} =`)).replace(/^export /, '');
const Z = new Function(line('zoneIdFor') + '\n' + line('RADIO_JB_TIP') + '\n' + line('radioBlocked') + '\nreturn { zoneIdFor, RADIO_JB_TIP, radioBlocked };')();

const house = { key: 'g:1', kind: 'zone', id: 1, playbackId: 'default' };
const kitchen = { key: 'g:2', kind: 'zone', id: 2, playbackId: 'p2' };
const jbz = { key: 'jukebox', kind: 'jukebox', playbackId: 'jukebox' };

test('the tooltip is the server message word for word', () => {
  assert.equal(Z.RADIO_JB_TIP, "Radio can't go in the Jukebox queue");
  assert.match(readFileSync(new URL('../../src/WavWiz.Server/Playback/Conductor.cs', import.meta.url), 'utf8'), /LiveRefusedText = "Radio can't go in the Jukebox queue"/);
});

test('blocked only while the Jukebox runs and the picked zone is its queue', () => {
  // stopped: nothing blocked
  for (const c of [house, kitchen, jbz]) assert.equal(Z.radioBlocked(c, { running: false, own: true }), false);
  assert.equal(Z.radioBlocked(house, null), false);
  // running with its own speakers: only the Jukebox zone
  const own = { running: true, own: true, zoneId: 'jukebox' };
  assert.equal(Z.radioBlocked(jbz, own), true);
  assert.equal(Z.radioBlocked(house, own), false);
  assert.equal(Z.radioBlocked(kitchen, own), false);
  // running with no speakers: it plays in the main zone, so that one is blocked too (other zones are not)
  const empty = { running: true, own: false, zoneId: 'jukebox' };
  assert.equal(Z.radioBlocked(jbz, empty), true);
  assert.equal(Z.radioBlocked(house, empty), true);
  assert.equal(Z.radioBlocked(kitchen, empty), false);
  assert.equal(Z.radioBlocked(null, empty), false);
});

test('station menus grey out Play / Play next / Add to queue with the reason; the ▶ buttons check at click time', () => {
  const s = src('radiostation.js');
  assert.match(s, /const jbNo = radioBlockedNow\(\), qok = can && !jbNo, qhint = jbNo \? RADIO_JB_TIP : null;/);
  for (const id of ['play', 'next', 'add']) assert.match(s, new RegExp(`id: '${id}'[^\\n]*disabled: !qok, hint: qhint`));
  assert.match(s, /id: 'save'[^\n]*disabled: !can,/, 'Save to My Stations stays allowed');
  assert.equal((s.match(/onclick: radioPlayGuard\(/g) || []).length, 4, 'all four tile / row ▶ buttons');
  assert.match(s, /radioPlayGuard = fn => ev => \{ ev\?\.stopPropagation\?\.\(\); if \(radioBlockedNow\(\)\) \{ toast\(RADIO_JB_TIP, true\); return; \} fn\(\); \}/);
  assert.doesNotMatch(s, /onclick: ev => \{ ev\.stopPropagation\(\); act\('\/stream\/play', \{ kind: 'radio'/);
  const f = src('radiofinder.js');
  assert.match(f, /onclick: radioPlayGuard\(async \(\) => \{/);
  assert.match(f, /disabled: !canControl\(S\) \|\| radioBlockedNow\(\), hint: radioBlockedNow\(\) \? RADIO_JB_TIP : null/);
  assert.match(f, /if \(radioBlockedNow\(\)\) return toast\(RADIO_JB_TIP, true\);/);
  // the context menu shows the hint as the disabled item's tooltip
  assert.match(src('ctxmenu.js'), /title: it\.disabled && it\.hint \? it\.hint : null/);
});
