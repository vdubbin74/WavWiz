// 0.6.8 t1651: a long now-playing title must not squeeze the zone name; collapsed cards put the title on a second .zl-now row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const js = rel => readFileSync(join(www, 'js', rel), 'utf8');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');

test('collapsed zone card: name row has no title; now-playing uses expanded .zl-now under it; idle omits the line', () => {
  const t = js('tree42.js');
  const fold = t.slice(t.indexOf('const foldedBox ='), t.indexOf('const emptyBox ='));
  assert.match(fold, /foldBtn\(box, true, name\), dot,/);
  assert.match(fold, /now\?\.title \? Z\.nowLine\(now,/);
  assert.match(fold, /onSelect: \(\) => controlZone\(lead\.id\)/);
  assert.doesNotMatch(fold, /ze42-note/);
  assert.doesNotMatch(fold, /▶ \$\{now\.title/);
  const ap = js('airplaysetup.js');
  const card = ap.slice(ap.indexOf('function buildCard'), ap.indexOf('const steps ='));
  assert.match(card, /class: 'qb42-head'/);
  assert.doesNotMatch(card, /Z\.nowLine|zl-now/, 'collapsed AirPlay card stays idle (no now-playing line)');
});

test('CSS: zone / queue name does not shrink next to a title; collapsed now-line is its own row', () => {
  const s = css();
  assert.match(s, /0\.6\.8: zone name keeps its width; collapsed now-playing sits on its own line/);
  assert.match(s, /\.tree42 \.ze42-row \.zname\{[\s\S]*?flex:0 0 auto;width:max-content;max-width:50%/);
  assert.match(s, /\.tree42 \.qb42\.zfold42 \.ze42-row \.zname\{max-width:100%\}/);
  assert.match(s, /\.tree42 \.qb42\.zfold42>\.zempty42>\.zl-now\{/);
  assert.match(s, /\.tree42 \.qb42\.zfold42 \.zl-now \.zl-t\{flex:1 1 0;min-width:0/);
  assert.match(s, /\.qb42-t \.qb42-name\{[\s\S]*?flex:1 1 auto;min-width:0/);
  assert.match(s, /\.qb42-t \.qb42-st\{flex:0 0 auto\}/);
  assert.match(s, /\.zp-row \.zp-name\{flex:0 0 auto;width:max-content;max-width:50%/);
  assert.match(s, /\.zmenu40 \.zm-n\{flex:0 0 auto;width:max-content;max-width:50%/);
  assert.match(s, /\.ns-titles \.zlink,\.zl-line \.zlink\{flex:0 0 auto;width:max-content;max-width:50%/);
  assert.match(s, /\.mp\.embedded \.mp-txt \.zl-line \.zlink\{flex:none;max-width:100%\}/);
});
