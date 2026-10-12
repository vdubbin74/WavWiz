// WavWiz 0.3.0 §7.11 / §8: contrast ≥ 4.5:1 on all 10 themes, Pepecoin brand-only, no fixed colors outside theme files, focus ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const root = join(js, '..');

test('§7.11: every text/fill pair is at least 4.5:1 on all 10 themes', async () => {
  const t = await imp('theme');
  assert.equal(Object.keys(t.PRESETS).length, 10);
  for (const [id, p] of Object.entries(t.PRESETS)) {
    const v = t.derive({ ...p, preset: id });
    const pairs = [['--ink', '--bg'], ['--ink', '--panel'], ['--ink', '--panel2'], ['--dim', '--bg'], ['--dim', '--panel'], ['--dim', '--panel2'],
      ['--accent-text', '--bg'], ['--accent-text', '--panel'], ['--accent-text', '--panel2'], ['--accent2-text', '--bg'], ['--accent2-text', '--panel'], ['--hl-text', '--bg'], ['--hl-text', '--panel'], ['--hl-text', '--panel2'],
      ['--accent-ink', '--accent'], ['--hl-ink', '--hl']];
    for (const [f, b] of pairs) assert.ok(t.contrast(v[f], v[b]) >= 4.5, `${id}: ${f} on ${b} = ${t.contrast(v[f], v[b]).toFixed(2)}`);
  }
});
test('§8: Pepecoin uses only the brand kit colors (tints of them allowed)', async () => {
  const t = await imp('theme'); const BRAND = ['#269B4D', '#208241', '#16532A', '#C07A4E', '#212121', '#FFFFFF'];
  const p = t.PRESETS.pepecoin; for (const k of ['accent', 'accent2', 'hl', 'bg', 'ink']) assert.ok(BRAND.includes(p[k].toUpperCase()), k);
  const v = t.derive({ ...p, preset: 'pepecoin' });
  assert.ok(BRAND.includes(v['--accent-ink'].toUpperCase()) && BRAND.includes(v['--hl-ink'].toUpperCase()), 'text on fills from the kit');
  // every derived color is a mix of two kit colors (a tint), never a new hue
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const onSegment = c => BRAND.some(a => BRAND.some(b => { const A = hex(a), B = hex(b), C = hex(c); let tt = null; for (let i = 0; i < 3; i++) { const d = B[i] - A[i]; if (Math.abs(d) < 1) { if (Math.abs(C[i] - A[i]) > 2) return false; continue; } const u = (C[i] - A[i]) / d; if (tt == null) tt = u; else if (Math.abs(u - tt) > 0.03) return false; } return tt == null || (tt >= -0.02 && tt <= 1.02); }));
  for (const [k, c] of Object.entries(v)) if (/^#[0-9a-f]{6}$/i.test(c)) assert.ok(onSegment(c), `${k} ${c} is a tint of the kit`);
});
test('§8: no hard-coded hex/rgb colors in the 0.3.0 CSS and UI modules (theme files excepted)', () => {
  const strip = s => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const NEW_CSS = ['jukebox.css'];
  for (const f of NEW_CSS) assert.doesNotMatch(strip(readFileSync(join(root, f), 'utf8')), /#[0-9a-f]{3,8}\b|rgba?\(/i, f);
  // app.css: everything added in 0.3.0 sits after the "0.3.0" markers; those blocks use theme variables only
  const css = readFileSync(join(root, 'app.css'), 'utf8'); const i = css.indexOf('0.3.0'); assert.ok(i > 0);
  const tail = strip(css.slice(i)).replace(/rgba\(0,0,0,\.\d+\)/g, '');      // neutral shadows (no hue) are allowed
  const bad = tail.match(/#[0-9a-f]{3,8}\b|rgb\((?!0,0,0)/gi) || [];
  assert.deepEqual(bad, [], 'fixed colors in the 0.3.0 CSS');
  for (const f of ['scenesched.js', 'jukebox-kiosk.js', 'jukebox-guest.js', 'jukebox-view.js', 'jukebox-core.js', 'remotemode.js', 'centerview.js', 'settingsui.js', 'panels.js', 'slider.js', 'flags.js'])
    assert.doesNotMatch(strip(readFileSync(join(js, f), 'utf8')), /['"`]#[0-9a-f]{3,8}['"`]|rgba?\(\d/i, f);
});
test('§7.11: a visible focus ring on every control', () => {
  const css = readFileSync(join(root, 'app.css'), 'utf8');
  assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\);outline-offset:2px\}/);
});
