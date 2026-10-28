// WavWiz 0.5.0 F113 - desktop queue table reorders through the pointer path when dndMode() === 'pointer' (Player UA); F46 guards stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');
test('F113: pointer mode = pointer row reorder, rows not HTML5-draggable', () => {
  const l = src('listtable');
  assert.match(l, /import \{ pointerDropTarget, dndMode, usesPointer \} from '\.\/pdrag\.js'/);
  assert.match(l, /pmode = dndMode\(\) === 'pointer'/);
  assert.match(l, /draggable: dg && !pmode \? 'true' : 'false'/);
  assert.match(l, /tbody\.addEventListener\('pointerdown'/);
  assert.match(l, /usesPointer\(dndMode\(\), ev\.pointerType\)/);
  assert.match(l, /Math\.hypot\(e\.clientX - x0, y - y0\) < 5/);
  assert.match(l, /await moveRows\(rows, t\)/);
  assert.match(l, /if \(sort\) await applySortAsOrder\(\); else await moveRows\(rows, t\)/);
  assert.match(l, /insLine\.hidden = false;[^\n]*Move here/);
});
test('F113: F46 guards remain (HTML5 session, settling, cancel on collapse/resize, no move unless moved)', () => {
  const l = src('listtable');
  assert.match(l, /if \(rows && !dragging\) return;/);
  assert.match(l, /cancelDrag = \(\) => \{ dragging = null; pdrag\?\.cancel\(\);/);
  assert.match(l, /if \(dragging \|\| pdrag\) cancelDrag\(\)/);
  assert.match(l, /settling\(\) \|\| !usesPointer/);
  assert.match(l, /if \(!was \|\| !rows\) return;/);
  assert.match(l, /if \(dragging\) return;   \/\/ never redraw under a drag\n    if \(pdrag\) return;/);
});
test('F113: grab cursor + no text selection on queue rows', () => {
  const c = css();
  assert.match(c, /\.qtable tbody tr\[data-i\]\{cursor:grab;user-select:none/);
  assert.match(c, /body\.qrow-dragging,body\.qrow-dragging \*\{cursor:grabbing!important;user-select:none!important/);
});
test('F112 follow-up: airplaydev self() wraps host in an array', () => {
  assert.match(src('airplaydev'), /\.concat\(x\.host \? \[x\.host\] : \[\]\)/);
});
