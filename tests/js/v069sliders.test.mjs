// WavWiz 0.6.9 item 11: the Flat / Gradient slider style applies to every slider, not only the volume bars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = '../../src/WavWiz.Server/wwwroot/';
const css = readFileSync(new URL(W + 'app.css', import.meta.url), 'utf8');
const src = readFileSync(new URL(W + 'js/sliderstyle.js', import.meta.url), 'utf8');
const app = readFileSync(new URL(W + 'js/appearance.js', import.meta.url), 'utf8');
test('0.6.9 #11: the --v fill tracker covers every range input but the color picker', () => {
  assert.match(src, /export const VOL_SEL = 'input\[type=range\]:not\(\.npcolor-range\)';/);
});
test('0.6.9 #11: every range track, the div seek bars and the EQ fader fills use --voltrack (Flat = one color, Gradient = two)', () => {
  const t = css.slice(css.indexOf('---- 0.6.9 #11'));
  assert.match(t, /input\[type=range\]:not\(\.npcolor-range\)::-webkit-slider-runnable-track\{background:var\(--voltrack\) 0 0\/var\(--v,50%\) 100% no-repeat/);
  assert.match(t, /input\[type=range\]:not\(\.npcolor-range\)::-moz-range-track\{background:var\(--voltrack\)/);
  assert.match(t, /\.prog \.fill,\.ns-prog \.fill,\.mp-npl \.npl-fill\{background:var\(--voltrack\)\}/);
  assert.match(t, /:root:not\(\[data-slider=flat\]\) \.eqarea\[data-eqstyle=faders\] \.eqb-fill\{/);
  assert.match(css, /:root\[data-slider=flat\]\{--voltrack:linear-gradient\(var\(--accent\),var\(--accent\)\)\}/);
});
test('0.6.9 #11: the setting says it is every slider', () => {
  assert.match(app, /'Slider style'/);
  assert.match(app, /Every slider in WavWiz/);
});
