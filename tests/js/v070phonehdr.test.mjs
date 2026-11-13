// 0.7.0 (t1892): the phone header fits at 360-390 px with the Jukebox on or off - the Parallel Flow logo is scaled down on REAL phones only.
// The real-layout check (no overflow at 360 / 390 px, Jukebox on and off, connection status on screen) is tests/ui/v070phonehdr.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR, css = readFileSync(join(js, '..', 'app.css'), 'utf8'), main = readFileSync(join(js, 'main.js'), 'utf8');
const block = css.slice(css.indexOf('/* 0.7.0 (t1892)'), css.indexOf('/* end 0.7.0 (t1892) */')).replace(/\/\*[\s\S]*?\*\//g, '');   // the t1892 block, comments dropped

test('html.handset follows the device (isRealPhone), set once at start-up', () => {
  assert.match(main, /document\.documentElement\.classList\.toggle\('handset', isRealPhone\(\)\);/);
  assert.match(readFileSync(join(js, 'viz.js'), 'utf8'), /export const isRealPhone = \(\) => \{[^\n]*iPhone\|iPad\|iPod\|Android/);
});

test('every phone header size rule is for a real phone in the phone layout, never the PC title bar', () => {
  assert.ok(css.includes('/* 0.7.0 (t1892)') && block.length > 100, 'the t1892 block exists');
  const rules = [...block.matchAll(/^\s*([^@\/{}\n][^{]*)\{/gm)].map(m => m[1].trim());
  assert.ok(rules.length >= 7, rules.join(' | '));
  for (const r of rules) { assert.match(r, /^html\.handset \.topbar:not\(\.wtitlebar\)/, r); }
  for (const q of block.match(/@media[^{]*/g)) assert.match(q, /^@media \(max-width:(900|400|380)px\)\s*$/, q);
});

test('the logo is only scaled: emblem height + wordmark size, same classes; full size everywhere else', () => {
  assert.match(block, /\.logo \.brand-emblem\{height:var\(--logo-em,24px\);/);
  assert.match(block, /\.wordmark\{font-size:var\(--logo-wm,18px\)\}/);
  assert.match(block, /--logo-em:20px;--logo-wm:16px/); assert.match(block, /--logo-em:18px;--logo-wm:15px/);
  assert.doesNotMatch(block, /display:\s*none|visibility:\s*hidden|color:|font-family|font-weight/, 'nothing hidden, recolored or re-fonted');
  // the shared (PC, narrow PC window, About) sizes are unchanged
  assert.match(css, /\.pf-emblem\{display:block;flex:none;width:auto;height:30px;overflow:visible\}/);
  assert.match(css, /\.logo \.brand-emblem\{height:30px;margin:0 -2px 0 -4px\}/);
  assert.match(css, /\.wordmark\{display:inline-flex;[^}]*font:800 26px\/1\.05 /);
});
