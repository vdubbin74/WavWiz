// F251: Master volume — phone thumb margin-top pairs with size; paint holds dialog .body scrollTop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
test('F251 .mv-s WebKit thumb margin-top centers on 6px track (22/−8, phone 30/−12)', () => {
  const s = readFileSync(join(www, 'app.css'), 'utf8');
  assert.match(s, /input\[type=range\]::-webkit-slider-runnable-track\{height:6px/);
  assert.match(s, /input\.mv-s::-webkit-slider-thumb\{width:22px;height:22px;margin-top:-8px\}/);
  assert.match(s, /@media \(max-width:760px\)\{[\s\S]*?input\.mv-s::-webkit-slider-thumb\{width:30px;height:30px;margin-top:-12px\}/);
});
test('F251 mixer paint holds dialog.mixer-dlg > .body scrollTop across replaceChildren', () => {
  const s = readFileSync(join(www, 'js/mixer.js'), 'utf8');
  assert.match(s, /F251: dialog\.mixer-dlg > \.body is the sheet scroller/);
  assert.match(s, /closest\('dialog\.mixer-dlg'\)\?\.querySelector\(':scope > \.body'\)/);
  assert.match(s, /sc\.scrollTop = top/);
  assert.match(s, /requestAnimationFrame\(\(\) => \{ sc\.scrollTop = top; \}\)/);
  assert.match(s, /if \(dragging \|\| uiHold/);
});
