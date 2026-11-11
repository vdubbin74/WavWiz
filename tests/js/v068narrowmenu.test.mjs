// 0.6.8f (t1728u / t1729u): narrow-PC hamburger menus. The shared label | pin | shortcut | arrow grid (79d74e6) must also hold in the
// narrow accordion (.desk-acc) and the narrow flyouts (.desk-fly), and a click anywhere outside the menu column must close the menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const css = readFileSync(join(www, 'app.css'), 'utf8');
const menuJs = readFileSync(join(www, 'js/menu.js'), 'utf8');
const mainJs = readFileSync(join(www, 'js/main.js'), 'utf8');
const flat = s => s.replace(/\s+/g, '');
const rule = sel => { const i = flat(css).lastIndexOf(flat(sel) + '{'); assert.ok(i >= 0, `rule not found: ${sel}`); const f = flat(css); return f.slice(i, f.indexOf('}', i)); };

test('accordion panels are the shared grid again (not the flex column that stacked label / pin / shortcut / arrow)', () => {
  const r = rule('.drawer nav.desk-menus.desk-acc .mgroup.open>.mpanel,\n.drawer nav.desk-menus.desk-acc .msub.open>.mpanel');
  assert.match(r, /display:grid/);
  assert.match(r, /grid-template-columns:6pxminmax\(0,1fr\)var\(--col-pin\)var\(--col-kbd\)var\(--col-arr\)6px/);
  assert.match(r, /width:auto;min-width:0;max-width:none/);
  // It comes after (and so beats) the older accordion display:flex rule of the same specificity.
  assert.ok(flat(css).lastIndexOf(flat('.drawer nav.desk-menus.desk-acc .msub.open>.mpanel{\n  display:flex;')) < flat(css).indexOf(flat('.drawer nav.desk-menus.desk-acc .mgroup.open>.mpanel,\n.drawer nav.desk-menus.desk-acc .msub.open>.mpanel{\n  display:grid;')));
});

test('an open accordion submenu spans the full row right under its item', () => {
  assert.match(rule('.drawer nav.desk-menus.desk-acc .msub>.mpanel'), /grid-column:1\/-1/);
});

test('narrow flyouts keep a 200px minimum instead of 100% of the window', () => {
  assert.match(rule('.drawer nav.desk-menus.desk-fly .mgroup.open>.mpanel,\n.drawer nav.desk-menus.desk-fly .msub.open>.mpanel'), /min-width:200px/);
});

test('the open menu is never part of the Windows title-bar drag region', () => {
  assert.match(rule('html.wtb .drawer.open,html.wtb .drawer.open *'), /app-region:no-drag;-webkit-app-region:no-drag/);
});

test('narrow PC accordion rules are not phone-only (no max-width media / pointer gate)', () => {
  const i = css.indexOf('0.6.8f (t1728u)'); assert.ok(i > 0);
  const before = css.slice(0, i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"/g, '""'); const opens = (before.match(/\{/g) || []).length, closes = (before.match(/\}/g) || []).length;
  assert.ok(opens <= closes, 'the 0.6.8f rules must sit at top level, outside any @media block (app.css has two stray closing braces earlier, hence <=)');
});

// drawerOutsideClick is DOM-only by shape; run its source against tiny fakes.
const src = menuJs.slice(menuJs.indexOf('export function drawerOutsideClick'), menuJs.indexOf('\n}\n', menuJs.indexOf('export function drawerOutsideClick')) + 2);
const drawerOutsideClick = new Function(src.replace('export function', 'return function'))();
const fakeEl = (cls = []) => ({ cls, closest: sel => (sel.split(/,\s*/).some(s => cls.includes(s.replace(/^[.#]/, ''))) ? {} : null) });
function fakeDrawer(open, nav) { return { classList: { contains: c => c === 'open' && open }, querySelector: () => nav }; }

test('click outside the menu column closes it; inside, on the hamburger, or on a sheet / dialog / toast it does not', () => {
  const inside = fakeEl(), outside = fakeEl(['scrim']), above = fakeEl(['libpanel']);
  const nav = { contains: t => t === inside };
  assert.equal(drawerOutsideClick(fakeDrawer(true, nav), outside), true);
  assert.equal(drawerOutsideClick(fakeDrawer(true, nav), above), true);
  assert.equal(drawerOutsideClick(fakeDrawer(true, nav), inside), false);
  assert.equal(drawerOutsideClick(fakeDrawer(false, nav), outside), false, 'closed menu: nothing to do');
  for (const c of ['hamburger', 'toasts', 'sheet']) assert.equal(drawerOutsideClick(fakeDrawer(true, nav), fakeEl([c])), false, c);
});

test('main.js wires the outside click in the capture phase; the menu column\'s own empty space closes too', () => {
  assert.match(mainJs, /import \{[^}]*drawerOutsideClick[^}]*\} from '\.\/menu\.js'/);
  assert.match(mainJs, /document\.addEventListener\('click', ev => \{ if \(drawerOutsideClick\(drawerEl, ev\.target\)\) toggleDrawer\(false\); \}, true\)/);
  assert.match(mainJs, /class: 'scrim', onclick: \(\) => toggleDrawer\(false\)/, 'scrim click still closes');
  assert.match(menuJs, /nav\.addEventListener\('click', ev => \{ if \(!ev\.target\.closest\?\.\('button, \[role=button\], \.mpanel'\)\) closeDrawer\(\); \}\)/);
  assert.match(menuJs, /if \(ev\.key === 'Escape'\) \{ if \(openGroup \|\| nav\.querySelector\('\.msub\.open'\)\) \{ closeAll\(\);/, 'Escape still folds an open submenu first');
  assert.match(mainJs, /if \(ev\.key === 'Escape'\) toggleDrawer\(false\)/, 'Escape still closes the menu');
});
