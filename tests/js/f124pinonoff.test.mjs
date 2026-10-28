import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
assert.match(css, /\.pane-h \.tpin\.on\{color:var\(--accent-ink,#fff\);border-color:var\(--accent\);background:var\(--accent\)\}/);
assert.ok(!/\.tpin\.on\{[^}]*accent-soft/.test(css), 'tpin.on not soft');
assert.match(css, /\.mpin\.on,[^{]*\{opacity:1;color:var\(--accent-ink,#fff\);background:var\(--accent\)\}/);
assert.match(css, /\.pane-h \.tpin:hover\{[^}]*background:transparent/);
console.log('f124 ok');
