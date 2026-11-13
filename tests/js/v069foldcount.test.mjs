// 0.6.9 #25 (t1875): a collapsed zone card with speakers shows how many (the same speaker-icon chip as the open zone's name row); empty zones keep
// 'No speakers'; the now-playing line keeps its own row; nothing else in the tree changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const t = readFileSync(join(js, 'tree42.js'), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');

test('folded zone row: [▸] dot name, then the speaker-count chip; the now-playing line stays below', () => {
  const fold = t.slice(t.indexOf('const foldedBox ='), t.indexOf('const emptyBox ='));
  assert.match(fold, /h\('div', \{ class: 'ze42-row' \}, foldBtn\(box, true, name\), dot, h\('button', \{[\s\S]*?onclick: \(\) => st\.onZone\(lead\.id\) \}, name\), foldCount\(ms, linked\)\),\s*line,/);
});

test('foldCount: chip with the volume icon + count, null with no speakers (empty zones keep their note)', () => {
  const src = t.slice(t.indexOf('const foldCount ='), t.indexOf('// F266: a folded zone box'));
  const h = (tag, a, ...k) => ({ tag, a, k: k.flat() }), icon = n => ({ icon: n });
  const foldCount = new Function('h', 'icon', src + '; return foldCount;')(h, icon);
  assert.equal(foldCount([], false), null);
  const c = foldCount([{}, {}, {}, {}], false);
  assert.equal(c.a.class, 'zcount42 zfold42-n'); assert.deepEqual(c.k, [{ icon: 'volume' }, '4']);
  assert.equal(c.a.title, '4 speakers in this zone'); assert.equal(c.a['aria-label'], '4 speakers');
  assert.equal(foldCount([{}], true).a.title, '1 speaker in the linked zones');
  const empty = t.slice(t.indexOf('const emptyBox ='), t.indexOf('const emptyBox =') + 1500);
  assert.match(empty, /'No speakers'/); assert.doesNotMatch(empty, /foldCount/);
});

test('CSS: only a row that has the chip lets the name shrink; the chip never shrinks; base zcount42 unchanged', () => {
  assert.match(css, /\.tree42 \.qb42\.zfold42 \.ze42-row:has\(>\.zfold42-n\)>\.zname\{flex:0 1 auto;min-width:0\}/);
  assert.match(css, /\.tree42 \.qb42\.zfold42 \.ze42-row>\.zfold42-n\{flex:none\}/);
  assert.match(css, /\.zcount42\{flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 5px;/);
  assert.match(css, /\.tree42 \.qb42\.zfold42 \.ze42-row \.zname\{max-width:100%\}/, 'the 0.6.8 full-name rule is kept');
});
