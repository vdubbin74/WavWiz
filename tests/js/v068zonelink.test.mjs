// 0.6.8-#12: the zone-card "Link" word became a chain-link icon button that sits beside OFF/ON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
test('tree42 + devices link buttons are icon-only with an aria-label', () => {
  for (const f of ['js/tree42.js', 'js/devices.js']) {
    const s = rd(f);
    assert.ok(!/icon\('link'\), ' Link'\)/.test(s), f + ' still renders the Link word');
    assert.match(s, /zlinkbtn link zlinkic'[^\n]*'aria-label': `Link \$\{g\.name\} to another zone`/, f);
  }
});
test('tree42 puts the unlinked link button in the OFF/ON actions span', () => {
  assert.match(rd('js/tree42.js'), /h\('span', \{ class: 'zacts' \}, linked \? null : lb, pill\)/);
  assert.match(rd('js/devices.js'), /edit, linkBtn, pill\)/);
});
test('css styles the square icon button', () => {
  assert.match(rd('app.css'), /\.zlinkbtn\.zlinkic\{[^}]*width:26px/);
});
