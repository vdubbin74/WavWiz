// 0.7.1 t2052u / t2055u: Settings > Appearance > Zone edge light. Six styles, default Waveform, per device (localStorage), applied live as
// html[data-edgelight]; reduced motion = a static lit edge; transform / opacity animations only; a short card gets no smear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(dir, '../app.css'), 'utf8'), rd = f => readFileSync(join(dir, f), 'utf8');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('styles, default and persistence', async () => {
  const e = await import(pathToFileURL(join(dir, 'edgelight.js')).href);
  assert.deepEqual(e.EDGE_STYLES.map(([id, nm]) => nm), ['Waveform', 'Light pipe', 'Heartbeat', 'Heartthrob', 'Gradient', 'Off']);
  const st = mem(); assert.equal(e.loadEdge(st), 'wave', 'default Waveform');
  for (const id of ['pipe', 'heartbeat', 'heartthrob', 'gradient', 'off', 'wave']) { assert.equal(e.applyEdge(id, st), id); assert.equal(e.loadEdge(st), id); }
  assert.equal(e.applyEdge('bogus', st), 'wave'); st.setItem(e.EDGE_KEY, 'nope'); assert.equal(e.loadEdge(st), 'wave');
});
test('Appearance row: Zone edge light radios apply live; reset + reapply include it; main.js loads it at boot', () => {
  const ap = rd('appearance.js');
  assert.match(ap, /'Zone edge light'/); assert.match(ap, /role: 'radiogroup', 'aria-label': 'Zone edge light'/);
  assert.match(ap, /'data-edge': id, title: tip, onclick: \(\) => \{ applyEdge\(id\); draw\(\); \}/);
  assert.match(rd('settingsui.js'), /THEME_RESET_KEYS = \[[^\]]*'wavwiz\.edgelight'\]/);
  assert.match(rd('settings.js'), /el\.applyEdge\?\.\(el\.loadEdge\(\)\)/);
  assert.match(rd('main.js'), /import '\.\/edgelight\.js';/);
  assert.match(rd('edgelight.js'), /document\.documentElement\.dataset\.edgelight = s;/);
});
test('CSS: one rule per style on the playing trim; Waveform is the default and uses a fixed px wavelength; no smear on short cards', () => {
  const sel = id => new RegExp(`html\\[data-edgelight="${id}"\\]\\)?[^{]*\\.qb42\\.playing > \\.cgrip69::after \\{`);
  for (const id of ['pipe', 'heartbeat', 'heartthrob', 'gradient', 'wave', 'off']) assert.match(css, sel(id), id);
  assert.match(css, /:is\(html\[data-edgelight="wave"\], html:not\(\[data-edgelight\]\)\)/, 'Waveform without the attribute too');
  // t2057u / t2058u: Waveform = two interwoven wave lines (main + second theme color), only on PLAYING zones
  const W = ':is(html[data-edgelight="wave"], html:not([data-edgelight])) .tree42 .qb42.playing > .cgrip69';
  assert.ok(css.includes(W + '::before { background: var(--accent); -webkit-mask-image: url("data:image/svg+xml,'), 'line 1: theme main color through an SVG wave mask');
  assert.ok(css.includes(W + '::after { background: var(--accent2); -webkit-mask-image: url("data:image/svg+xml,'), 'line 2: theme second color');
  const masks = [...css.matchAll(/mask-image: url\("data:image\/svg\+xml,([^"]+)"\)/g)].map(m => decodeURIComponent(m[1]));
  const A = 'M7 -2 C 10.6 4.5 10.6 13.5 7 20 C 3.4 26.5 3.4 35.5 7 42', B = 'M7 -2 C 3.4 4.5 3.4 13.5 7 20 C 10.6 26.5 10.6 35.5 7 42';
  assert.ok(masks.some(m => m.includes(A)) && masks.some(m => m.includes(B)), 'the two lines are half a wave apart (woven)');
  // t2060u: each line glows (a soft wide stroke under the crisp core, in the mask) and the two ALTERNATE (one swells + brightens while the other dims)
  const mA = masks.find(m => m.includes(A));
  assert.match(mA, /stroke-opacity='0\.12' stroke-width='9'/); assert.match(mA, /stroke-opacity='0\.32' stroke-width='5'/); assert.match(mA, /stroke-opacity='1' stroke-width='2'/);
  assert.match(css, /mask-size: 14px 40px;/, 'fixed 40px wavelength in px: a collapsed card shows fewer waves, same size');
  assert.match(css, /animation: ww-lp-weave 1\.4s ease-in-out infinite alternate, ww-lp-drift 2\.8s linear infinite;/);
  assert.ok(css.includes(W + '::after { background: var(--accent2);') && /::after \{ background: var\(--accent2\);[^}]*animation-delay: -1\.4s, 0s; \}/.test(css), 'the second line is half a cycle behind: they take turns');
  assert.match(css, /@keyframes ww-lp-weave \{ 0% \{ scale: 1\.3 1; opacity: 1; \} 100% \{ scale: \.7 1; opacity: \.45; \} \}/, 'swing + brightness: scale and opacity only');
  assert.match(css, /@keyframes ww-lp-drift \{ 0% \{ translate: 0 0; \} 100% \{ translate: 0 40px; \} \}/, 'slow drift of exactly one wavelength: seamless');
  assert.match(css, /cgrip69 \{\n  --ww-trim-w: 10px; opacity: 1; overflow: visible; clip-path: inset\(0 -6px 0 -6px\);/, 'clipped to the card height, glow may spill 6px sideways');
  assert.ok(!/\.qb42:not\(\.playing\)[^{]*cgrip69::(before|after)[^{]*\{[^}]*mask-image/.test(css) && !css.includes('.qb42.idle > .cgrip69::before'), 'idle / empty zones: plain edge, no wave');
  assert.ok(css.includes(W + '::before, ' + W + '::after { opacity: .9 !important; scale: 1 1; translate: 0 0; }'), 'reduced motion: the glowing wave stands still');
  assert.match(css, /--lp-t: clamp\(8px, 22%, 64px\)/, 'Light pipe head scales with the card (was 28% with a 28px floor = a smear on a 42px card)');
  assert.doesNotMatch(css, /@keyframes ww-pipe/, 'the old top-animating travel is gone');
  const kf = [...css.matchAll(/@keyframes ww-lp-[a-z]+ \{([^\n]*)\}/g)].map(m => m[1]).join(' ');
  assert.doesNotMatch(kf, /\b(top|height|left|box-shadow|filter|background)\s*:/, 'transform / opacity only');
  assert.match(css, /html\[data-edgelight="off"\] \.tree42 \.qb42\.playing > \.cgrip69::after \{ opacity: 0; animation: none; \}/);
});
test('reduced motion: static lit edge for every style; the trim stays the drag grip', () => {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce) {\n  html .tree42 .qb42.playing > .cgrip69'); assert.ok(i > 0);
  const b = css.slice(i, css.indexOf('\n}\n', i));
  assert.match(b, /animation: none !important/); assert.match(b, /::after, html \.tree42 \.qb42\.playing > \.cgrip69::before \{ opacity: 0 !important; \}/); assert.match(b, /> \.cgrip69 \{ opacity: 1 !important; \}/);
  assert.match(css, /\.qb42\.playing > \.cgrip69::after \{\n  top: 0;[^}]*pointer-events: none;/, 'the light never takes the pointer');
  assert.match(rd('tree42.js'), /closest\('\.zgut42,\.cgrip69'\)/, 'drag still starts on the trim');
});
