// 0.6.8: menu width follows the longest label; shared columns label | pin | shortcut | arrow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');
const menuJs = () => readFileSync(join(www, 'js/menu.js'), 'utf8');

function menuBlock(s) {
  const start = s.indexOf('Menu rows: one grid on the menu itself');
  const end = s.indexOf('A–Z letter finder', start);
  assert.ok(start >= 0 && end > start, 'menu grid CSS block not found');
  return s.slice(start, end);
}

test('menu.js still wraps labels and adorns pin before shortcut', () => {
  const src = menuJs();
  assert.match(src, /const mlbl = t => h\('span', \{ class: 'mlbl' \}, t\)/);
  assert.match(src, /function adorn\(btn, o, pins = true\) \{/);
  assert.match(src, /if \(o\?\.pin && pins\) btn\.append\(pinSpan\(o\.pin\)\);\s*if \(o\?\.kbd\) btn\.append\(h\('span', \{ class: 'kbd' \}, o\.kbd\)\)/);
});

test('menu container is the shared grid; label track is max-content, not minmax(0,1fr)', () => {
  const s = css();
  const block = menuBlock(s);
  // The regression: each row was its own grid with a shrinkable 1fr label, so a
  // shrink-to-fit 200px panel left ~one letter and .mlbl ellipsized to "B...".
  assert.doesNotMatch(block, /grid-template-columns:minmax\(0,1fr\) var\(--col-pin\)/);
  assert.doesNotMatch(block, /--col-kbd:7\.5em/);
  assert.match(block, /grid-template-columns:6px minmax\(max-content,1fr\) var\(--col-pin\) var\(--col-kbd\) var\(--col-arr\) 6px/);
  assert.match(block, /grid-template-columns:subgrid/);
  assert.match(block, /\.menubar \.mgroup\.open>\.mpanel[\s\S]*?display:grid/);
  assert.match(block, /width:max-content/);
  assert.match(block, /min-width:100%/);
  assert.match(block, /max-width:calc\(100vw \/ var\(--z,1\) - 12px\)/);
  assert.match(block, /--col-kbd:max-content/);
  // Columns: 1+6 padding, 2 label, 3 pin, 4 shortcut, 5 arrow.
  assert.match(block, /\.mpanel button>\.mlbl[\s\S]*?grid-column:2/);
  assert.match(block, /\.mpanel button>\.mpin[\s\S]*?grid-column:3/);
  assert.match(block, /\.mpanel button>\.kbd[\s\S]*?grid-column:4/);
  assert.match(block, /msub>button::after[\s\S]*?grid-column:5/);
  assert.match(block, /\.mpanel button>\.mpin[\s\S]*?width:18px;height:18px;min-width:18px;min-height:18px/);
  assert.match(block, /\.mlbl[\s\S]*?white-space:nowrap/);
  // Same rules cover top-level dropdowns, flyouts, narrow PC drawer menus, and accordion.
  assert.match(block, /\.menubar \.mgroup\.open>\.mpanel,\.menubar \.msub\.open>\.mpanel/);
  assert.match(block, /\.drawer nav\.desk-menus \.mgroup\.open>\.mpanel/);
  assert.match(block, /\.drawer \.macc\.open>\.mpanel,\.drawer \.macc \.msub\.open>\.mpanel/);
  assert.match(block, /\.drawer nav\.desk-menus \.mpanel>\.msub/);
  // Narrow-PC 320px cap is overridden; only the screen edge caps width.
  assert.match(block, /\.drawer nav\.desk-menus \.mgroup>\.mpanel[\s\S]*?max-width:calc\(100vw \/ var\(--z,1\) - 12px\)/);
});
