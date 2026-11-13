// WavWiz 0.6.9 item 8: narrow PC Now Playing - Sleep, Master volume and the pins in ONE no-wrap row of the same rounded-square buttons,
// no Home, no duplicate Sleep / Master volume; phones keep their own row, and the PC row is not a phone media-query rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const now = readFileSync(join(js, 'now.js'), 'utf8');
const imp = m => import(pathToFileURL(join(js, m + '.js')).href);
test('0.6.9 #8: rowOrder without Home = pins left to right, no separator; shownPins drops the row\'s own buttons', async () => {
  installDom(); const s = await imp('shortcuts');
  assert.deepEqual(s.rowOrder(['eq', 'queue']).map(x => x.kind), ['pin', 'pin', 'sep', 'home']);   // unchanged default
  assert.deepEqual(s.rowOrder(['eq', 'queue'], false), [{ kind: 'pin', id: 'eq' }, { kind: 'pin', id: 'queue' }]);
  assert.deepEqual(s.shownPins(['eq', 'sleep', 'queue', 'mixer'], ['sleep', 'mixer']), ['eq', 'queue']);
});
test('0.6.9 #8: the narrow PC row - Sleep, Master volume, pins without Home / Sleep / Master volume, fit to the line', () => {
  assert.match(now, /isRealPhone\(\) \? h\('div', \{ class: 'row wrap np-phone-xrow' \}/);
  assert.match(now, /h\('div', \{ class: 'row np-phone-xrow np-xrow-pc' \}, mkSleepIc\(\), mkMix\(\), shortcutsRow\(\{ run: [^}]*\}?[^)]*home: false, cls: 'np-phone-shortcuts np-xpins', exclude: \['sleep', 'mixer'\], fit: 'siblings', btnW: 52 \}\)\.el\)/);
});
test('0.6.9 #8: the PC row CSS is no-wrap, rounded squares, outside any media query', () => {
  const at = css.indexOf('---- 0.6.9 #8'); assert.ok(at > 0);
  const block = css.slice(at, css.indexOf('---- ', at + 10) > 0 ? css.indexOf('---- ', at + 10) : undefined);
  assert.doesNotMatch(block, /@media/);
  assert.match(block, /\.np-phone-full \.np-xrow-pc\{display:flex;flex-wrap:nowrap/);
  assert.match(block, /height:44px;[^}]*border-radius:var\(--radius,3px\)/);
  assert.match(block, /\.np-xpins>\.scsep\{display:none\}/);
});
