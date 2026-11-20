// 0.7.1 t2050u: the phone's full-screen Now Playing hid the bottom tab bar. It stays now (real phones, html.handset only); a tab collapses
// Now Playing and goes there; the tab it was opened from stays lit. A narrow PC window keeps its full-height Now Playing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const main = readFileSync(dir + '/main.js', 'utf8'), css = readFileSync(dir + '/../app.css', 'utf8');
const fnSrc = name => { const i = main.indexOf(`function ${name}(`); assert.ok(i >= 0, name + ' exists'); let d = 0, j = main.indexOf('{', i); for (let k = j; k < main.length; k++) { if (main[k] === '{') d++; else if (main[k] === '}' && --d === 0) return main.slice(i, k + 1); } };

test('CSS: the tab bar shows on Now Playing for html.handset only; the narrow-PC rule that hides it is kept', () => {
  assert.match(css, /#app>\.desk\[data-view=now\]~:is\(\.mini,\.tabbar\)\{display:none\}/, 'narrow PC unchanged');
  const i = css.indexOf('0.7.1 t2050u'); assert.ok(i > css.indexOf('#app>.desk[data-view=now]~:is(.mini,.tabbar){display:none}'), 'comes later (wins)');
  const block = css.slice(i);
  assert.match(block, /html\.handset #app>\.desk\[data-view=now\]~\.tabbar\{display:flex\}/);
  assert.doesNotMatch(block.split('}\n}')[0], /(^|[^.])\.mini\{display/, 'the mini player stays hidden on Now Playing');
  assert.match(css, /#app>\.tabbar\{[^}]*padding:[^}]*var\(--safe-b\)/, 'the tab bar owns the bottom safe area');
});
test('tabs: from Now Playing, the tab it came from collapses back (same page); another tab goes there; Settings collapses first', () => {
  const run = (view, ret, k) => {
    const calls = [], S = { view }, go = x => { calls.push(x); if (x === 'now:collapse') S.view = ret?.view || 'library'; else S.view = x; }; go.phoneNowReturn = ret;
    const openPhoneSettings = () => calls.push('settings-dialog');
    new Function('S', 'go', 'openPhoneSettings', fnSrc('phoneTab') + '; return phoneTab;')(S, go, openPhoneSettings)(k, {}); return calls;
  };
  assert.deepEqual(run('now', { view: 'library' }, 'library'), ['now:collapse'], 'back to the Library as it was (search, scroll)');
  assert.deepEqual(run('now', { view: 'library' }, 'devices'), ['devices']);
  assert.deepEqual(run('now', { view: 'library' }, 'queue'), ['queue']);
  assert.deepEqual(run('now', { view: 'library' }, 'settings'), ['now:collapse', 'settings-dialog']);
  assert.deepEqual(run('library', null, 'library'), ['library'], 'outside Now Playing: unchanged');
  assert.deepEqual(run('devices', null, 'settings'), ['settings-dialog']);
  assert.match(main, /onclick: ev => phoneTab\(k, ev\.currentTarget\)/);
});
test('highlight: on Now Playing the return tab stays lit without aria-current', () => {
  assert.match(main, /const tabK = k === 'now' \? go\.phoneNowReturn\?\.view : k;/);
  assert.match(main, /b\.dataset\.k === tabK; b\.classList\.toggle\('on', on\); if \(on && k !== 'now'\) b\.setAttribute\('aria-current', 'page'\)/);
});
