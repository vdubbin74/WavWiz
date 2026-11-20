// 0.7.1 t2063u: the Parallel Flow emblem replaces the hamburger (phone + narrow PC). Tapping it opens the same menu; the header keeps
// only the wordmark next to it (one emblem); it reads as a button (surface, border, pressed / open glow, focus ring, 44px).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emblemSvg, LOGO } from '../../src/WavWiz.Server/wwwroot/js/logo.js';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(dir, '../app.css'), 'utf8'), main = readFileSync(join(dir, 'main.js'), 'utf8');

test('the menu button is the emblem, keeps Menu / aria-expanded, and opens the same drawer', () => {
  const m = main.match(/const hamburger = h\('button', \{([^}]*)\}, ([^\n]*)\);/);
  assert.ok(m, 'hamburger button');
  assert.match(m[1], /class: 'iconbtn hamburger logomenu'/);
  assert.match(m[1], /'aria-label': 'Menu'/); assert.match(m[1], /'aria-expanded': 'false'/);
  assert.match(m[1], /onclick: \(\) => toggleDrawer\(true\)/);
  assert.equal(m[2], "emblem('pf-emblem hb-emblem')", 'the emblem, not the three bars');
  assert.doesNotMatch(m[2], /hb-bars/);
  assert.match(main, /import \{ emblem \} from '\.\/logo\.js';/);
  assert.match(main, /setAttribute\('aria-expanded', String\(open\)\)/, 'toggleDrawer still flips aria-expanded');
});
test('emblem colors follow the theme: top wave = Wav color, bottom = Wiz color', () => {
  assert.equal(LOGO.top, 'wav'); assert.equal(LOGO.bottom, 'wiz');
  const s = emblemSvg({ cls: 'pf-emblem hb-emblem' });
  assert.match(s, /class="pf-top"[^>]*><path style="fill:var\(--accent-text,var\(--accent\)\)"/);
  assert.match(s, /class="pf-bot"[^>]*><path style="fill:var\(--accent2-text,var\(--accent2\)\)"/);
  assert.match(s, /aria-hidden="true"/, 'decorative inside the labelled button');
});
test('CSS: button look, 44px, pressed/open glow, focus ring; header emblem hidden only where the menu button shows', () => {
  const at = css.indexOf('0.7.1 t2063u'); assert.ok(at > css.indexOf('.iconbtn.hamburger{'), 'after the 0.5.0 hamburger box rule');
  const r = css.slice(at);
  assert.match(r, /\.iconbtn\.hamburger\.logomenu\{width:44px;height:44px;min-width:44px;min-height:44px;[^}]*background:[^}]*border:1px solid/);
  assert.match(r, /\.hamburger\.logomenu:active,\.hamburger\.logomenu\[aria-expanded=true\]\{[^}]*box-shadow:0 0 0 3px/);
  assert.match(r, /\.hamburger\.logomenu:focus-visible\{outline:2px solid/);
  assert.match(r, /@media \(max-width:900px\)\{ \.topbar:has\(> \.hamburger\.logomenu\) \.logo \.brand-emblem\{display:none\} \}/);
  assert.doesNotMatch(r, /html\.handset[^{]*logomenu/, 'phone and narrow PC share it (no handset-only rule)');
  assert.match(css, /^\.hamburger\{display:none\}/m, 'wide PC still has no menu button');
});
