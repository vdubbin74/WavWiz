import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
assert.ok(css.includes('.lib .tabs:not(.xtabs) button,.lib .tabs.ctabs button{border-radius:3px}'), 'tabs 3px');
assert.ok(!css.includes('.lib .tabs.ctabs button{border-radius:999px}'), 'no pill tabs');
assert.ok(css.includes('.view .lib .tabs .wwdd{flex:none;border-radius:3px;'), 'phone wwdd 3px');
assert.ok(css.includes('.lib .albacts .chipbtn,.lib .albacts button:not(.tbtn){border-radius:999px}'), 'chips untouched');
assert.ok(css.includes('.view .lib .crumbs button{border-radius:999px;'), 'crumbs untouched');
console.log('f131libtabs ok');
