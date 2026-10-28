import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const js = n => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/' + n, import.meta.url), 'utf8');
const app = js('appearance.js'), main = js('main.js'), css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
// Pure logic, extracted from appearance.js so it runs without a DOM
const subs = app.match(/export const APP_SUBS = (\[.*\]);/)[1];
const APP_SUBS = eval(subs);
const forSrc = app.match(/export const appSubsFor = (.*);/)[1], subSrc = app.match(/export const appSubFor = (.*);/)[1];
const appSubsFor = eval(forSrc.replace('phone = isPhone()', 'phone')), appSubFor = eval(subSrc.replace('phone = isPhone()', 'phone'));
assert.ok(!appSubsFor(true).some(([, l]) => l === 'Visualizer'), 'phone excludes Visualizer');
assert.deepEqual(appSubsFor(true).map(x => x[1]), ['Theme', 'EQ', 'Now Playing']);
assert.ok(appSubsFor(false).some(([, l]) => l === 'Visualizer'), 'desktop keeps Visualizer');
assert.equal(appSubFor('viz', true), 'theme'); assert.equal(appSubFor('viz', false), 'viz'); assert.equal(appSubFor('eq', true), 'eq');
// init / select / resume / nav wiring
assert.match(app, /import \{[^}]*isPhone[^}]*\} from '\.\/viz\.js'/);
assert.match(app, /cur = appSubFor\(cur, phone\)/);
assert.match(app, /appSubsFor\(phone\)\.map/);
assert.match(app, /function select\(id\) \{\n\s*id = appSubFor\(id, phone\)/);
assert.match(app, /cur === 'viz' && !phone\) viz\.reload/);
assert.match(main, /\(k === 'themes' \|\| isPhone\(\)\) \? 'theme' : 'viz'/);
// not a CSS-only hide
assert.ok(!/\.appnav \[data-sub=["']?viz/.test(css), 'no CSS hide of viz sub-tab');
console.log('f125 ok');
