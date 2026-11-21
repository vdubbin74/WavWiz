import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tree = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/tree42.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');

test('t2161u: normal speaker rows put tags, % and mute on line 2 under the name (mixer rows unchanged)', () => {
  assert.match(tree, /\} else \{[^\n]*t2161u[^\n]*\n\s*const nt = row\.querySelector\('\.sp42-nt'\), l2 = h\('div', \{ class: 'sp42-l2' \}, row\.querySelector\('\.sp42-tags'\), row\.querySelector\(':scope>\.sp42-v'\), row\.querySelector\(':scope>\.sp42-mute'\)\);\s*nt\.append\(l2\);/);
  assert.match(css, /\.tree42:not\(\.mx-on\) \.sp42-l2\{display:flex;/);
  assert.match(css, /\.tree42:not\(\.mx-on\) \.sp42-l2>\.sp42-v\{margin-left:auto\}/);
  assert.match(css, /\.tree42:not\(\.mx-on\) \.sp42-l2>\.sp42-tags:empty\{display:block\}/);
});
