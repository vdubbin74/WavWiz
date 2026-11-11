import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const body = (name) => { const i = src.indexOf(`export function ${name}(`); assert.ok(i > 0, name); return src.slice(i, src.indexOf('\n}\n', i)); };
// 0.7.0 item 5c: F250-P7 moved the sheet itself into phonesound.js (openPhoneSound, titled "Sound", phone Sound controls instead of centerEq);
// main.js keeps the phone path, the no-stacking guard and closePhoneEqSheet. The sheet rules below are unchanged.
const ps = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/phonesound.js', import.meta.url), 'utf8');
assert.match(src, /import \{[^}]*\bopenPhoneSound\b[^}]*\} from '\.\/phonesound\.js'/);
const se = body('showEq');
const ph = se.slice(se.indexOf('if (!wide()) {'), se.indexOf('return;') + 7);
assert.match(ph, /openPhoneEqSheet\(\)/);
assert.ok(!/showCenter/.test(ph), 'phone path must not call showCenter');
assert.match(se.slice(se.indexOf('return;')), /nowc\.showCenter\?\.\('eq'\)/, 'desktop still showCenter(eq)');
const om = body('openPhoneEqSheet');
assert.match(om, /if \(eqSheet\) \{/, 'no stacking'); assert.match(om, /openPhoneSound\(S, /);
const op = ps.slice(ps.indexOf('export function openPhoneSound('));
assert.match(op, /class: 'eqsheet open npeqsheet'/);
assert.match(op, /'aria-modal': 'true'/);
assert.match(op, /h\('b', \{\}, 'Sound'\)/);
assert.match(op, /eqsheet-h/); assert.match(op, /eqsheet-x/); assert.match(op, /eqsheet-b/);
assert.match(op, /const eq = phoneSound\(S, body/);
assert.match(op, /classList\.add\('eqsheet-lock'\)/);
assert.match(op, /Escape/);
assert.match(src, /export function closePhoneEqSheet\(\) \{ eqSheet\?\.close\(\); \}/);
const cp = op.slice(op.indexOf('const close = () => {'), op.indexOf('const check = '));
assert.match(cp, /eq\.destroy\(\)/); assert.match(cp, /el\.remove\(\)/); assert.match(cp, /classList\.remove\('eqsheet-lock'\)/);
// F109: close sheet before phone speaker settings
const o = src.slice(src.indexOf("addEventListener('wavwiz:openspk'"));
assert.ok(o.indexOf('closePhoneEqSheet()') > 0 && o.indexOf('closePhoneEqSheet()') < o.indexOf("go('devices')"));
assert.match(css, /@media \(max-width:900px\)\{\s*\.eqsheet\.npeqsheet\{position:fixed;inset:0/);
assert.ok(!/\.nowcol > \.np-vizpanel\{display:block/.test(css), 'np-vizpanel stays hidden');
assert.match(cl, /Phone: Sound \/ EQ opens a full-screen EQ sheet/);   // 0.7.0 item 5c: the 0.5.0 CHANGELOG polish (ca007a7) reworded the bullet
console.log('f128 ok');
