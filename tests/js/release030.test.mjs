// WavWiz 0.3.0: shared slider helper, confirm dialogs, scenes & schedules, panels, settings polish, EQ default, remote mode, jukebox, themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
globalThis.Element ??= class {};

test('0.3.0 §9: wheel = 1 step, Shift = coarse, clamped', async () => {
  const s = await imp('slider');
  assert.equal(s.wheelValue({ value: 50, min: 0, max: 100, step: 1 }, -1, false), 51);
  assert.equal(s.wheelValue({ value: 50, min: 0, max: 100, step: 1 }, 1, true), 40);
  assert.equal(s.wheelValue({ value: 995, min: 0, max: 1000, step: 5, coarse: 50 }, -1, true), 1000);
  assert.equal(s.wheelValue({ value: 0.5, min: -12, max: 12, step: 0.5 }, 1, false), 0);
});
test('0.3.0 §9: whenIdle runs now when no slider is dragged', async () => {
  const s = await imp('slider'); let n = 0; assert.equal(s.whenIdle(() => n++), true); assert.equal(n, 1);
});
test('0.3.0 §9: throttle sends the first value at once and the last one after', async () => {
  const s = await imp('slider'); const got = []; const f = s.throttle(v => got.push(v), 30);
  f(1); f(2); f(3); assert.deepEqual(got, [1]); await new Promise(r => setTimeout(r, 60)); assert.deepEqual(got, [1, 3]);
});
test('0.3.0 §7.10: no alert(), confirm() or prompt() left in any shipped script', () => {
  for (const f of readdirSync(js).filter(f => f.endsWith('.js'))) assert.ok(!/(^|[^.\w])(alert|confirm|prompt)\(/m.test(src(f).replace(/\/\/.*$/gm, '')), f);
});
test('0.3.0 §9: delay slider sends throttled live updates (not a 220 ms debounce) and the main redraws wait for the drag', () => {
  assert.match(src('latency.js'), /throttle\(/); assert.doesNotMatch(src('latency.js'), /setTimeout\(\(\) => onChange/);
  assert.match(src('main.js'), /installSliderGuard\(document\)/); assert.match(src('main.js'), /whenIdle\(\(\) => \{ devv\.draw\(\); devp\.draw\(\); \}/);
});
