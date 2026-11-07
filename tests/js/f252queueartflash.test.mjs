// F252: phone Queue drawQueue skips identical paints (keeps row art <img>s); drag deferral still forces redraw.
// F252-amend: occurrence-based row/menu validity; signature covers Now item + zone name/choices.
// F252-amend2: qResume shares qPaintSignature() so retained Now return cannot certify stale chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const main = () => readFileSync(join(js, 'main.js'), 'utf8');
test('F252 drawQueue skips teardown when render signature unchanged', () => {
  const s = main();
  assert.match(s, /qPaintSig = null/);
  assert.match(s, /if \(sig === qPaintSig && root\.firstChild && !document\.querySelector\('dialog\.songsheet\[open\], \.qmenu'\)\) return;/);
  assert.match(s, /qPaintSig = sig/);
  assert.match(s, /S\.queue\.map\(qRowSig\)/);
  assert.match(s, /artCv\(\)/);
  assert.match(s, /function qPaintSignature\(\)/);
  assert.match(s, /const sig = qPaintSignature\(\)/);
});
test('F252 drag deferral clears qPaintSig so post-drag redraw still replaces rows', () => {
  const s = main();
  assert.match(s, /if \(qReorder\?\.active && qReorder\.isCurrent\(\)\) \{ qPendingRefresh = true; qPaintSig = null; return; \}/);
  assert.match(s, /qPaintSig = null;   \/\/ F252: next show \/ forced rebuild must not inherit a stale skip/);
});
test('F252 refreshNow still calls drawQueue on phone Queue view (skip is inside drawQueue)', () => {
  const s = main();
  assert.match(s, /if \(S\.view === 'queue'\) drawQueue\(\)/);
  assert.match(s, /m\.type === 'tick'.*refreshNow/s);
});
test('F252-amend R1 row/menu validity uses occurrence not object ===', () => {
  const s = main();
  const body = s.slice(s.indexOf('function drawQueue()'), s.indexOf('function phonePick()'));
  assert.match(body, /sameOcc\(i, occ\)/);
  assert.doesNotMatch(body, /S\.queue\[i\] === q/);
  assert.match(body, /renderedOcc\.every\(\(occ, i\) => qOccurrence\(S\.queue\[i\]\) === occ\)/);
});
test('F252-amend R2 signature includes Now item / hasNow summary inputs', () => {
  const s = main();
  assert.match(s, /qNowItemSig\(nowItem\)/);
  assert.match(s, /hasNow0, qNowItemSig\(nowItem\)/);
  assert.match(s, /_qSummaryArt/);
});
test('F252-amend R3 signature includes zone name + choices inventory', () => {
  const s = main();
  assert.match(s, /zone0\?\.name/);
  assert.match(s, /choices0\.map\(c => \[c\.key, c\.playbackId, c\.name\]\)/);
  assert.match(s, /Z\.choicesNow\(\)/);
});

test('F252-amend2 qResume validates complete qPaintSignature (not occurrence-only)', () => {
  const s = main();
  const body = s.slice(s.indexOf('qResume = () =>'), s.indexOf('qResume();'));
  assert.match(body, /qPaintSignature\(\) !== sig/);
  assert.match(body, /qPaintSig = sig/);
  assert.doesNotMatch(body, /S\.queue\[i\] === /);
});
test('F252-amend2 drawQueue and qResume share one signature builder', () => {
  const s = main();
  assert.match(s, /function qPaintSignature\(\)/);
  assert.equal((s.match(/function qPaintSignature\(\)/g) || []).length, 1);
  assert.match(s, /const sig = qPaintSignature\(\)/);
  assert.match(s, /qPaintSignature\(\) !== sig/);
  assert.match(s, /qRowSig/);
  assert.match(s, /qNowItemSig/);
  assert.match(s, /sourceLabel/);
  assert.match(s, /choices0\.map\(c => \[c\.key, c\.playbackId, c\.name\]\)/);
});
