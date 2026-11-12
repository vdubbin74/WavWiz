// WavWiz 0.6.9 item 10: Studio EQ fader caps are solid. Root cause: the cap background used calc(1px / var(--z)), and eqview.js sets --z on every
// band to the 0 dB position as a percentage, so the declaration was invalid at computed-value time and the cap had no background at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/eq-premium.css', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/eqview.js', import.meta.url), 'utf8');
const rules = sel => css.split('}').filter(r => r.includes(sel));
test('0.6.9 #10: no fader cap rule divides by --z (eqview sets --z per band as a percentage)', () => {
  assert.match(view, /setProperty\('--z', z \+ '%'\)/, 'precondition: --z on a band is a percentage');
  for (const r of rules('.eqb-knob')) assert.doesNotMatch(r, /var\(--z/, r.slice(0, 120));
});
test('0.6.9 #10: Studio faders - curve behind the caps, no see-through bands, opaque fill', () => {
  const tail = css.slice(css.indexOf('0.6.9 #10'));
  assert.match(tail, /\.eqarea\[data-eqstyle=faders\] \.eqa-curve\{z-index:0\}/);
  assert.match(tail, /\.eqarea\[data-eqstyle=faders\] \.eqb,\.eqarea\[data-eqstyle=faders\]:has\(\.eqb\.sel\) \.eqb:not\(\.sel\)\{opacity:1\}/);
  assert.match(tail, /\.eqarea\[data-eqstyle=faders\] \.eqb-fill\{opacity:1;/);
  assert.match(tail, /\.eqarea\[data-eqstyle=faders\] \.eqb-knob\{z-index:5;opacity:1\}/);
});
