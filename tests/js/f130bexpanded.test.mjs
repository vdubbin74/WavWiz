import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const i = css.indexOf('/* 0.5.0 F130b'); assert.ok(i > 0, 'F130b block present');
const b = css.slice(i);
// flat panel keeps pn-ctl beside titles above the phone breakpoint (desktop media + <=900 container)
assert.match(b, /@media \(min-width:761px\)\{[^@]*\.np-ctlpanel\.np-flat:not\(\.collapsed\) \.pn-ctl\{grid-column:auto/);
assert.match(b, /@container npctl \(max-width:900px\)\{[^@]*\.np-ctlpanel\.np-flat:not\(\.collapsed\) \.pn-ctl\{grid-column:auto\}/);
// the only flat full-width wrap is a truly narrow container (<=560px), never 720/900
assert.doesNotMatch(css, /@container npctl \((?:720|900)px\)[^}]*np-flat[^}]*\.pn-ctl\{grid-column:1 \/ -1/);
assert.doesNotMatch(css, /@container npctl \(max-width:(?:720|900)px\)\{[^\n]*\.np-ctlpanel\.np-flat \.pn-ctl\{grid-column:1 \/ -1/);
// zone pill grows to fit: no clip on flat .zl-ov
assert.match(b, /\.np-flat \.np-tablevol>\.zl-ov\{max-width:none/);
assert.match(b, /\.zl-ov \.zl-name\{overflow:visible;text-overflow:clip\}/);
console.log('f130bexpanded ok');
