// 0.7.1 t2051u: a phone's Now Playing keeps the tab bar (t2050u), so its own Queue button was a duplicate. On html.handset the Queue / Sound
// pair is hidden and Sound opens from More playback controls; a narrow PC window (no tab bar there) keeps the pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const now = readFileSync(dir + '/now.js', 'utf8'), main = readFileSync(dir + '/main.js', 'utf8'), css = readFileSync(dir + '/../app.css', 'utf8');

test('phone Now Playing: the in-screen Queue / Sound pair is hidden on html.handset only', () => {
  const i = css.indexOf('0.7.1 t2051u'); assert.ok(i > 0); const block = css.slice(i);
  assert.match(block, /html\.handset \.np-phone-full \.np-phone-actions\{display:none\}/);
  assert.match(block, /^\.np-phone-xsound\{display:none\}/m, 'no extra Sound button outside a phone (narrow PC keeps the pair)');
  assert.match(block, /html\.handset \.np-phone-full \.np-phone-xsound\{display:inline-flex/);
  assert.doesNotMatch(block, /(^|\n)\s*\.np-phone-actions\{display:none/, 'never hidden without html.handset');
  assert.match(now, /class: 'np-phone-queue', onclick: \(\) => ctl\.go\('queue'\)/, 'the pair still exists for the narrow PC window');
});
test('Sound sits in More playback controls (phone row, next to Sleep) and opens the same Sound sheet', () => {
  assert.match(now, /isHandset\(\) \? \[mkSleepIc\(\), mkSoundX\(\)\]/);
  const f = now.slice(now.indexOf('function mkSoundX'), now.indexOf('\n', now.indexOf('function mkSoundX')));
  assert.match(f, /class: 'btn sm np-phone-sound np-phone-xsound'/); assert.match(f, /onclick: \(\) => ctl\.openEq\?\.\(\)/); assert.match(f, /'Sound'/);
  const extras = now.indexOf("h('details', { class: 'np-phone-extras' }"); assert.ok(extras > 0 && now.indexOf('mkSoundX()', extras) > extras, 'inside the More playback controls details');
  assert.match(main, /from: \[\.\.\.\(nowc\.el\?\.querySelectorAll\('\.np-phone-sound'\) \|\| \[\]\)\]\.find\(b => b\.getClientRects\?\.\(\)\.length\)/, 'focus returns to the visible Sound button');
});
