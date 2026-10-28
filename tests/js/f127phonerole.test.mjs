import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/menu.js', import.meta.url), 'utf8');
const i = src.indexOf('export function createPhoneDrawerNav'); assert.ok(i > 0);
const fn = src.slice(i, src.indexOf('\n}\n', i));
assert.match(fn, /leaf\('Phone role…', \(\) => changePhoneRole\(\)\)/);
assert.match(fn, /isPhoneUa\(\) && !isPlayerUa\(\) \? \[leaf\('Phone role…'/);
const d = fn.indexOf("leaf('Devices & Zones'"), r = fn.indexOf("leaf('Phone role…'"), s = fn.indexOf("leaf('Scenes & Alarms'");
assert.ok(d < r && r < s, 'after Devices & Zones, before Scenes & Alarms');
assert.match(src, /import \{ changePhoneRole \} from '\.\/room\.js'/);
assert.ok(!/Settings holds[^\n]*phone role/.test(fn), 'F67 comment updated');
// desktop Devices entry unchanged
assert.match(src, /\['Phone role…', \(\) => changePhoneRole\(\), null, \(\) => !isPhoneUa\(\) \|\| isPlayerUa\(\)\]/);
console.log('f127 ok');
