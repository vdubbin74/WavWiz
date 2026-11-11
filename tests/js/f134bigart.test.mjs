import fs from 'node:fs'; import assert from 'node:assert';
const css = fs.readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const f = css.slice(css.indexOf('F134:'));
const m = f.match(/np-flat:not\(\.collapsed\) \.pn-art\{width:clamp\((\d+)px,(?:[^,()]|\([^()]*\))+,(\d+)px\)/);   // 0.7.0 item 5c: the middle term is now `Nvw / var(--z,1)` (Display size), which has its own comma
assert.ok(m, 'F134 art clamp'); assert.ok(+m[1] > 76 && +m[2] > 92, 'art min/max above 76/92');
assert.match(f, /\.np-tablexport \.tbtn\.play\{width:(6[4-9]|7[0-9])px/);   // 0.7.0 item 5c: F137 made play ~14% smaller (74 -> 64); still the biggest button
assert.match(f, /\.np-tablexport \.tbtn\{width:5\dpx/);
// 0.7.0 item 5c: only F134's own block (up to the next feature comment); slicing to the end of app.css also caught later features' colors
const f134end = f.slice(5).search(/\/\* (?:[\d.]+ )?F(?!134\b)\d+/); const own = f134end < 0 ? f : f.slice(0, 5 + f134end); assert.ok(own.includes('.np-tablexport .tbtn.play{'));
assert.doesNotMatch(own, /#[0-9a-f]{3,6}\b/i);
assert.ok(css.indexOf('F134:') > css.indexOf('F133:'));
console.log('f134bigart ok');
