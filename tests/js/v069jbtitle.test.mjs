// 0.6.9 #26 (t1876): the title bar is the same with the Jukebox on or off. PC: no 'Jukebox TV <address>' pill (the TV address moved into the
// Jukebox host panel as 'Show on a TV…'); Return to Jukebox no longer grows the bar. Phone: 'Jukebox on' and Return are 30 px icon squares and
// 'Connected' shows as its dot while they are there, so the header never wraps or runs past the edge; logo + BETA untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');

test('main.js: the title bar has no Jukebox TV pill', () => {
  const m = src('main.js');
  assert.doesNotMatch(m, /jbTvChip/);
  assert.match(m, /const bar = topbar\(\[menubar, adminChip\(S\), h\('span', \{ class: 'conn row'/);
});

test('the TV address is still reachable: host panel "Show on a TV…" opens the same dialog (view-only ?tv=1 address + QR + Copy)', () => {
  const k = src('jukebox-kiosk.js'), t = src('jbtv.js');
  assert.match(k, /import \{ showTvInfo \} from '\.\/jbtv\.js';/);
  assert.match(k, /'data-act': 'jb-tv-info',[^\n]*?onclick: \(\) => \{ close\(\); showTvInfo\(\); \} \}, 'Show on a TV…'\)/);
  const f = t.slice(t.indexOf('export async function showTvInfo()'));
  assert.match(f, /url = tvUrlFrom\(\(await api\('\/jukebox\/join'\)\)\?\.url \|\| ''\)/);
  assert.match(f, /dialog\('Show the Jukebox on a TV'/); assert.match(f, /text: 'Copy address'/);
  assert.match(k, /'OPEN ON ANOTHER SCREEN'/, 'the big-screen address stays too');
});

test('chip + Return: icon and label spans (label for screen readers / tooltip)', () => {
  const k = src('jukebox-kiosk.js');
  assert.match(k, /h\('span', \{ class: 'jbc-ic', 'aria-hidden': 'true' \}, '♫'\), h\('span', \{ class: 'jbc-t' \}, ' ' \+ lbl\)/);
  assert.match(k, /c\.setAttribute\('aria-label', lbl \+ ' - Jukebox controls'\)/);
  assert.match(k, /'aria-label': 'Return to Jukebox' \}, h\('span', \{ class: 'jbr-ic', 'aria-hidden': 'true' \}, '♫'\), h\('span', \{ class: 'jbr-t' \}, ' Return to Jukebox'\)\)/);
});

test('CSS: desktop Return capped to 30 px (bar height unchanged); phone = 30 px icon squares, visually hidden labels, dot-only Connected', () => {
  assert.match(css, /\.topbar #jbreturn\.jbreturn76\{min-height:0;height:30px;padding-top:0;padding-bottom:0;display:inline-flex;align-items:center;flex:none\}/);
  const at = css.indexOf('/* desktop: Return to Jukebox no longer grows the bar'), ph = css.slice(at, css.indexOf('\n}\n', at) + 3);
  assert.match(ph, /@media \(max-width:900px\)\{\s*\.topbar #jbchip\.jbchip,\.topbar #jbreturn\.jbreturn76\{flex:none;width:30px;min-width:30px;height:30px;padding:0;margin:0;/);
  assert.match(ph, /\.topbar #jbchip \.jbc-t,\.topbar #jbreturn \.jbr-t\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/);
  assert.match(ph, /\.topbar:has\(#jbchip\) \.conn #conntxt\{position:absolute;width:1px;height:1px;overflow:hidden;/);
  assert.match(ph, /\.topbar #jbreturn \.jbr-ic::after\{content:'↩'/);
  assert.doesNotMatch(ph, /\.beta|\.wtb-logo|titlebarLogo/, 'logo / BETA rules untouched');
});
