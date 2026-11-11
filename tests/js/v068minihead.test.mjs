// 0.6.8b: standalone mini player - one row for every Album art style, the dismiss x in the title bar at header-icon size,
// one icon-button style in the title bar, Keep on top = stacked windows (the pin is only the shortcuts pin), shortcuts strip never clipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const rd = f => readFileSync(join(www, f), 'utf8');

test('app.css no longer gives the standalone song block a Tape/Sleeve flex-basis that wraps it under the art', () => {
  const a = rd('app.css');
  assert.doesNotMatch(a, /body\.minibody \.mp:not\(\.slim\):has\(\.mp-artbox\.pn-art-(cassette|sleeve)\) \.mp-txt\{flex-basis/);
  const m = rd('mini.css');
  assert.match(m, /body\.minibody \.mp:not\(\.slim\):not\(\.embedded\):has\(\.mp-artbox\) \.mp-txt\{flex:1 1 0;width:auto;min-width:0\}/);
});

test('standalone title bar: x stays header size (no 44 px phone target), one icon-button style, strip gets the whole bar', () => {
  const m = rd('mini.css');
  const blk = m.slice(m.indexOf('0.6.8b: the standalone mini really keeps art'));
  assert.ok(blk.length > 100);
  assert.match(blk, /\.mp-side \.mp-b\.mp-x\)\{\s*box-sizing:border-box;width:var\(--mp-hib\);height:var\(--mp-hib\)/);
  assert.match(blk, /@media \(max-width:900px\),\(pointer:coarse\)\{\s*body\.minibody \.mp\.mp-sttitle:not\(\.embedded\) \.mp-side \.mp-b\.mp-x\{width:var\(--mp-hib\);height:var\(--mp-hib\)/);
  assert.match(blk, /border:1px solid transparent;border-radius:3px;background:transparent;color:var\(--dim\)/);
  assert.match(blk, /\)\.on\{color:var\(--accent-text,var\(--accent\)\);border-color:var\(--accent\)/);
  assert.match(blk, /\.mp-scside\{left:6px;right:calc\(var\(--mp-hdp\) - 13px \+ var\(--mp-hib\) \+ 4px\);width:auto;max-width:none/);
  assert.match(blk, /\.scopen:not\(\.embedded\) \.mp-sthd \.mp-hdt\{visibility:hidden\}/);
});

test('Keep on top is the stacked-windows icon; the pin is only the shortcuts pin', () => {
  const i = rd('js/icons.js'), j = rd('js/mini.js'), s = rd('js/shortcuts.js');
  assert.match(i, /\bontop: '<path d="M9 8V5a1 1 0 0 1 1-1h9/);
  assert.match(j, /const pin = b\('mp-pin', 'ontop', 'Keep on top',/);
  assert.match(j, /sd\.toggle\.setAttribute\('aria-label', 'Pin to shortcuts'\)/);
  assert.match(s, /icon\('pin'\)\);/);
  assert.match(s, /const title = header\.classList\.contains\('mp-sthd'\) \? 0 : 88;/);
});
