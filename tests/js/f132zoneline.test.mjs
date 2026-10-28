import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
assert.ok(css.includes('.np-ctlpanel.np-flat .np-tablevol{flex-direction:row;align-items:center;flex-wrap:nowrap}'), 'flat tablevol is a row');
assert.ok(css.includes('.np-tablevol{display:flex;flex-direction:column;'), 'base (phone) column untouched');
console.log('f132zoneline ok');
