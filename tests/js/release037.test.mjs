// WavWiz 0.3.7 - pure logic + markup checks. Browser behavior: tests/ui/ui037.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR, web = join(js, '..');
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(web, 'app.css'), 'utf8');

test('L27 locking the queue locks sort orders; unlocking gives them back', async () => {
  const m = await imp('plcols');
  const un = { locked: false }, lk = { locked: true };
  let s = m.applySort(un, null, 'title'); assert.deepEqual(s, { id: 'title', dir: 'asc' });
  s = m.applySort(un, s, 'title'); assert.deepEqual(s, { id: 'title', dir: 'desc' });
  const held = s;
  assert.equal(m.applySort(lk, held, 'artist'), held, 'a locked queue ignores a sort click');
  assert.equal(m.applySort(lk, null, 'artist'), null);
  assert.equal(m.sortAllowed(lk), false); assert.equal(m.sortAllowed(un), true);
  assert.deepEqual(m.applySort(un, held, 'artist'), { id: 'artist', dir: 'asc' }, 'unlocked again: sorting works');
  assert.match(m.SORT_LOCK_HINT, /locked/i);
  const t = src('listtable.js');
  assert.match(t, /sortlocked/); assert.match(t, /aria-disabled/); assert.match(t, /plp-sort/); assert.match(t, /disabled: L\.locked, title: L\.locked \? SORT_LOCK_HINT/);
  assert.match(css, /th\.sortlocked/);
});

test('L26 confidence shown only as a real 0-100 %', async () => {
  const m = await imp('calibrate');
  assert.equal(m.confPct(0.92), 92); assert.equal(m.confPct(68), 100); assert.equal(m.confPct(160), 100); assert.equal(m.confPct(-3), 0);
  assert.equal(m.confPct(NaN), null); assert.equal(m.confText(undefined), '—'); assert.equal(m.confText(0.234), '23%');
});
