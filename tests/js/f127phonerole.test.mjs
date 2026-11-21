import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/menu.js', import.meta.url), 'utf8');
// 0.7.1 t2117u: Phone role… stays in the shared Devices spec (phones only, not the Player WebView).
// The phone drawer reuses that same tree, so it is no longer a separate F67 leaf row.
assert.match(src, /import \{ changePhoneRole \} from '\.\/room\.js'/);
assert.match(src, /\['Phone role…', \(\) => changePhoneRole\(\), null, \(\) => !isPhoneUa\(\) \|\| isPlayerUa\(\)\]/);
const i = src.indexOf("['Phone role…'");
const file = src.lastIndexOf("file:", i), devices = src.lastIndexOf("devices:", i), help = src.lastIndexOf("help:", i);
assert.ok(devices > file && (help === -1 || devices < help), 'Phone role… lives in the Devices group');
assert.doesNotMatch(src, /leaf\('Phone role…'/);
console.log('f127 ok');
