// WavWiz 0.6.9 item 9: the expanded-Library Now Playing player is the standalone mini player (same layout + controls), not a separate design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const mini = readFileSync(join(js, 'mini.js'), 'utf8'), main = readFileSync(join(js, 'main.js'), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/mini.css', import.meta.url), 'utf8');
test('0.6.9 #9: main mounts the in-app player as a replica with app-side pop-out / back actions', () => {
  assert.match(main, /mountMini\(host, \{ embedded: true, replica: true, run: runShortcut, home: goHome,/);
  assert.match(main, /popout: \(\) => \{ try \{ if \(window\.chrome\?\.webview\) \{ window\.chrome\.webview\.postMessage\(\{ cmd: 'mini' \}\); return; \} \}/);
  assert.match(main, /collapse: \(\) => toggleLibExpanded\(false\)/);
});
test('0.6.9 #9: the replica builds the standalone layout (title bar, Track bar pick, volume dock, docked transport) and is not .embedded', () => {
  assert.match(mini, /const solo = !embedded \|\| replica;/);
  const blk = mini.slice(mini.indexOf('if (embedded && replica) {'), mini.indexOf('} else if (embedded) {'));
  assert.match(blk, /class: 'mp-hd mp-sthd'/);
  assert.match(blk, /ctl\.firstChild\.replaceChildren\(shufB, prev, play, next, repB, mute\); ctl\.classList\.add\('mp-ctlr'\);/);
  assert.match(blk, /h\('div', \{ class: 'mp-dock' \}, volRow, ctl\)/);
  assert.match(mini, /root\.classList\.add\(replica \? 'mp-replica' : 'embedded'\)/);
  assert.match(mini, /if \(solo\) txt\.append\(npHost\);/);
});
test('0.6.9 #9: window-only behaviour never reaches the app window from the in-app player', () => {
  assert.match(mini, /function applyOpacity\(\) \{ if \(embedded\) \{ root\.style\.opacity = ''; return; \}/);
  assert.match(mini, /if \(!embedded\) document\.addEventListener\('contextmenu'/);
});
test('0.6.9 #9: every standalone rule is scoped to the mini window OR the column; the replica fills the column', () => {
  assert.doesNotMatch(css, /(^|[^(])body\.minibody \.mp/m);
  assert.ok((css.match(/:is\(body\.minibody,\.minicol\) \.mp/g) || []).length >= 60);
  assert.match(css, /\.minicol \.mp\.mp-replica\{width:100%;max-width:100%;min-width:0;box-sizing:border-box\}/);
});
