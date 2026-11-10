// 0.6.8-#6: Jukebox settings fill picker, zone toggle refresh, zoom-correct menus, view-only TV address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const www = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const js = f => readFileSync(new URL('js/' + f, www), 'utf8');
test('0.6.8-#6a fill picker lists any song + playlists + genres (no lone "Off")', () => {
  const s = js('settingsui.js');
  assert.match(s, /'Any allowed song'/);
  assert.match(s, /value: 'p:' \+ p\.id/);
  assert.match(s, /value: 'g:' \+ g\.name/);
  assert.match(s, /api\('\/library\/genres'\)/);
});
test('0.6.8-#6a menus place correctly under Display size zoom', () => {
  const c = js('ctxmenu.js');
  assert.match(c, /getPropertyValue\('--z'\)/);
  assert.match(c, /writeClientPos/);
  assert.match(c, /getBoundingClientRect/);
});
test('0.6.8-#6b zones-changed re-reads zones', () => {
  assert.match(js('main.js'), /addEventListener\('wavwiz:zones-changed', \(\) => \{ refreshZones\(\); \}\)/);
});
test('0.6.8-#6d TV address = join URL + tv=1; guest page TV mode drops inputs', () => {
  const src = js('jbtv.js').match(/export const tvUrlFrom = (.+);/)[1];
  const tvUrlFrom = (0, eval)(src);
  assert.equal(tvUrlFrom('http://10.0.0.5:8080/jukebox.html?j=abc'), 'http://10.0.0.5:8080/jukebox.html?j=abc&tv=1');
  assert.equal(tvUrlFrom(''), '');
  const g = js('jukebox-guest.js');
  assert.match(g, /if \(tv\) \{ document\.body\.classList\.add\('jbtv'\); app\.replaceChildren\(title, npSlot, noteSlot, bodySlot, foot\); return; \}/);
  assert.match(g, /\/api\/v1\/jukebox\/guest\/qr\.svg\?j=/);
});
