// F246: phone Devices speaker/zone sheet is a true viewport modal above .mini/.tabbar (body portal; not a guessed 96px pad).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const js = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/devices.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const room = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/room.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js', import.meta.url), 'utf8');

const i = js.indexOf('export function devicesView(');
assert.ok(i > 0, 'devicesView');
const body = js.slice(i, js.indexOf('\nexport { roomPillClass', i));

// Portal + lock + scroll restore (speaker + zone share sel42)
assert.match(body, /document\.body\.append\(pwrap\)/);
assert.match(body, /pwrap\.remove\(\)/);
assert.match(body, /classList\.toggle\('pd42-open', sel42\)/);
assert.match(body, /treeTop = sc \? sc\.scrollTop : 0/);
assert.match(body, /c\.scrollTop = t/);
assert.match(body, /X\.spk != null \|\| X\.zsel != null/, 'speaker + zone');
assert.match(body, /reconcile\(list, \[T\.treeNode\(false\), airplayDevicesStrip\(S, ctl\)\]\.filter\(Boolean\)\)/, 'sheet not left under #p-zones list');
assert.ok(!/sel42 \? pwrap : null/.test(body), 'no in-list sheet mount');

// Tag delegation still treats portaled sheet as phone page
assert.match(js, /closest\('#p-zones, \.pd42-sheet'\)/);

// CSS: viewport modal chrome
assert.match(css, /\.pd42-sheet\{[^}]*position:fixed;inset:0;z-index:9000/);
assert.match(css, /padding-top:var\(--safe-t\)/);
assert.match(css, /\.pd42-sheet>\.pd42\{[^}]*calc\(16px \+ var\(--safe-b\)\)/);
assert.match(css, /html\.pd42-open,html\.pd42-open body\{overflow:hidden\}/);
assert.match(css, /html\.pd42-open #app\{pointer-events:none\}/);
assert.match(css, /html\.pd42-open \.pd42-sheet\{pointer-events:auto\}/);
assert.match(css, /\.pd42-sheet>\.pd42\{min-height:0;flex:1 1 0\}/, 'F202 scroller kept');
assert.ok(!/#p-zones \.pd42-sheet\{position:fixed/.test(css), 'sheet no longer scoped only under #p-zones (portal)');

// F241 remote/mic dock preserved (in-flow above mini/tabbar)
assert.match(room, /dockRoleBanner/);
assert.match(room, /app\.querySelector\(':scope > \.mini'\) \|\| app\.querySelector\(':scope > \.tabbar'\)/);
assert.match(css, /\/\* F241: mic banner docks in #app above \.mini\/\.tabbar/);
assert.match(css, /\/\* F240 chrome \+ F241 dock: in-flow #app strip above \.mini\/\.tabbar/);

// .npeqsheet already body-mounted — not the same defect; leave alone
assert.match(main, /document\.body\.append\(el\)/);
assert.match(css, /\.eqsheet\.npeqsheet\{position:fixed;inset:0;z-index:9000/);

console.log('f246 ok');
